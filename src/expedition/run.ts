import { advance as advanceBattle } from '../combat/battle';
import { createBattle } from '../combat/battle';
import { enemyUnit, heroStats, heroUnit, type HeroBonus } from '../combat/data';
import type { Battle, Stats, Unit } from '../combat/types';
import {
  FATE_BASE,
  FATE_MAX,
  FIRST_RUN_SEED,
  MAX_TIER,
  PARTY_SIZE,
  SAFE_EXPEDITIONS,
  TUTORIAL_ENEMY_SCALE,
  WOUND_MS,
} from '../core/config';
import { postEffect, refreshHeroes, totalIncome } from '../core/economy';
import { RNG } from '../core/rng';
import { createHero, nextSeed } from '../core/state';
import { HERO_CLASSES, type GameState, type Hero, type HeroClass } from '../core/types';
import { eventDef, outcomesFor, pickEvent, type Choice, type Effect, type EventDef } from './events';
import { generateMap, type MapNode } from './map';
import { relicDef, relicEffects, rollRelics, type RelicId } from './relics';

export type RunStage = 'map' | 'battle' | 'event' | 'eventResult' | 'chest' | 'camp' | 'ended';
export type BattleKind = 'battle' | 'elite' | 'boss' | 'ambush';

export interface RunMember {
  heroId: string;
  /** Доля от максимального HP (0..1). Храним долю, чтобы реликвии на HP не ломали текущее здоровье. */
  frac: number;
  alive: boolean;
}

export type ChestOffer =
  | { id: string; kind: 'relic'; relic: RelicId }
  | { id: string; kind: 'heal'; pct: number }
  | { id: string; kind: 'essence'; amount: number };

export interface Run {
  seed: number;
  tier: number;
  rng: RNG;
  map: MapNode[];
  currentNodeId: string | null;
  visited: string[];
  heroes: Record<string, Hero>;
  members: RunMember[];
  relics: RelicId[];
  atkBuff: number;
  postBonus: { hpPct: number; atkPct: number; campHeal: number };
  essenceEarned: number;
  stage: RunStage;
  battle: Battle | null;
  battleKind: BattleKind | null;
  phoenixLeft: boolean;
  event: EventDef | null;
  eventsSeen: string[];
  eventResult: { text: string; lines: string[] } | null;
  pendingAmbush: boolean;
  pendingRecruits: number;
  chestOffers: ChestOffer[] | null;
  /** Бросок судьбы и награды зависят от безопасности забега, а не от номера в момент завершения. */
  safe: boolean;
  /** Множитель силы врагов (обучающие забеги слабее). */
  enemyMult: number;
  fallen: string[];
  nodesCleared: number;
  elitesCleared: number;
  reviveLeft: number;
  result: 'victory' | 'defeat' | null;
  finished: boolean;
  /** Cached result makes reward application idempotent across reloads. */
  summary: RunSummary | null;
}

/** Persist a complete expedition, including both RNG streams, so refresh/reopen is deterministic. */
export function serializeRun(run: Run): string {
  return JSON.stringify(run, (_key, value: unknown) => {
    if (value instanceof RNG) return { __gosRngState: value.snapshot() };
    return value;
  });
}

/** Restore a run after JSON parsing, rebuilding RNG instances rather than plain objects. */
export function deserializeRun(json: string | null): Run | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    const revive = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(revive);
      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (typeof record.__gosRngState === 'number') return RNG.restore(record.__gosRngState);
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(record)) out[key] = revive(item);
        return out;
      }
      return value;
    };
    const run = revive(parsed) as Run;
    const stages: RunStage[] = ['map', 'battle', 'event', 'eventResult', 'chest', 'camp', 'ended'];
    if (
      !run ||
      !Number.isFinite(run.seed) ||
      !Number.isInteger(run.tier) || run.tier < 1 || run.tier > MAX_TIER ||
      !Array.isArray(run.map) || !Array.isArray(run.members) ||
      !(run.rng instanceof RNG) ||
      !stages.includes(run.stage) ||
      typeof run.finished !== 'boolean' ||
      (run.stage === 'battle' && (!run.battle || !(run.battle.rng instanceof RNG)))
    ) return null;
    return run;
  } catch {
    return null;
  }
}

export interface RunSummary {
  result: 'victory' | 'defeat';
  tier: number;
  safe: boolean;
  nodesCleared: number;
  gold: number;
  essence: number;
  recruits: Hero[];
  survivors: Hero[];
  lost: Hero[];
  unlockedTier: number | null;
}

// ---------- Запуск ----------

export function fateChance(state: GameState): number {
  return Math.min(FATE_MAX, FATE_BASE + postEffect(state, 'fateBonus'));
}

export function partyHeroes(state: GameState): Hero[] {
  return state.party
    .map((id) => state.heroes.find((h) => h.id === id))
    .filter((h): h is Hero => h !== undefined && h.status === 'ready');
}

export function canStartRun(state: GameState, nowMs: number, tier: number): { ok: true } | { ok: false; reason: string } {
  refreshHeroes(state, nowMs);
  if (tier < 1 || tier > Math.min(state.maxTier, MAX_TIER)) return { ok: false, reason: 'Подземелье ещё закрыто' };
  // Экспедиции — основной игровой цикл и не расходуют энергию/жетоны.
  if (partyHeroes(state).length !== PARTY_SIZE) return { ok: false, reason: `В отряде должно быть ${PARTY_SIZE} готовых героя` };
  return { ok: true };
}

export function startRun(state: GameState, nowMs: number, tier: number): Run {
  const check = canStartRun(state, nowMs, tier);
  if (!check.ok) throw new Error(check.reason);
  // Старые поля tickets остаются в сейве для обратной совместимости, но больше не списываются.
  state.stats.expeditionsStarted += 1;

  const first = state.expeditionsCompleted === 0 && tier === 1;
  const seed = first ? FIRST_RUN_SEED : nextSeed(state);
  const party = partyHeroes(state);
  return {
    seed,
    tier,
    rng: new RNG(seed ^ 0x5bd1e995),
    map: generateMap(seed),
    currentNodeId: null,
    visited: [],
    heroes: Object.fromEntries(party.map((h) => [h.id, { ...h }])),
    members: party.map((h) => ({ heroId: h.id, frac: 1, alive: true })),
    relics: [],
    atkBuff: 0,
    postBonus: {
      hpPct: postEffect(state, 'hpPct'),
      atkPct: postEffect(state, 'atkPct'),
      campHeal: postEffect(state, 'campHeal'),
    },
    essenceEarned: 0,
    stage: 'map',
    battle: null,
    battleKind: null,
    phoenixLeft: false,
    event: null,
    eventsSeen: [],
    eventResult: null,
    pendingAmbush: false,
    pendingRecruits: 0,
    chestOffers: null,
    safe: state.expeditionsCompleted < SAFE_EXPEDITIONS,
    enemyMult: TUTORIAL_ENEMY_SCALE[state.expeditionsCompleted] ?? 1,
    fallen: [],
    nodesCleared: 0,
    elitesCleared: 0,
    reviveLeft: 1,
    result: null,
    finished: false,
    summary: null,
  };
}

// ---------- Отряд внутри забега ----------

export function runBonus(run: Run): HeroBonus {
  const r = relicEffects(run.relics);
  return {
    hpPct: run.postBonus.hpPct + r.hpPct,
    atkPct: run.postBonus.atkPct + r.atkPct + run.atkBuff,
    defPct: r.defPct,
    spdPct: r.spdPct,
  };
}

export function memberStats(run: Run, member: RunMember): Stats {
  return heroStats(run.heroes[member.heroId] as Hero, runBonus(run));
}

export function memberHp(run: Run, member: RunMember): number {
  if (!member.alive) return 0;
  return Math.max(1, Math.round(member.frac * memberStats(run, member).maxHp));
}

export function liveMembers(run: Run): RunMember[] {
  return run.members.filter((m) => m.alive);
}

function partyHasClass(run: Run, cls: HeroClass): boolean {
  return liveMembers(run).some((m) => (run.heroes[m.heroId] as Hero).cls === cls);
}

function healParty(run: Run, pct: number): void {
  for (const m of liveMembers(run)) m.frac = Math.min(1, m.frac + pct);
}

function hurtParty(run: Run, pct: number): void {
  // Урон от событий никогда не убивает: минимум 5% здоровья.
  for (const m of liveMembers(run)) m.frac = Math.max(0.05, m.frac - pct);
}

// ---------- Карта ----------

export function nodeById(run: Run, id: string): MapNode {
  const n = run.map.find((x) => x.id === id);
  if (!n) throw new Error(`Нет узла ${id}`);
  return n;
}

export function availableNodes(run: Run): MapNode[] {
  if (run.stage !== 'map') return [];
  if (run.currentNodeId === null) return run.map.filter((n) => n.layer === 1);
  return nodeById(run, run.currentNodeId).next.map((id) => nodeById(run, id));
}

const ENEMY_POOL: Array<{ id: string; w: number }> = [
  { id: 'skeleton', w: 3 },
  { id: 'goblin', w: 3 },
  { id: 'troll', w: 2 },
  { id: 'shaman', w: 2 },
];

function rollEnemyIds(rng: RNG, count: number): string[] {
  const ids: string[] = [];
  while (ids.length < count) {
    const id = rng.weighted(ENEMY_POOL, (e) => e.w).id;
    if (id === 'shaman' && ids.includes('shaman')) continue; // двух знахарей в бою не бывает
    ids.push(id);
  }
  return ids;
}

function buildEnemies(run: Run, kind: BattleKind, layer: number): Unit[] {
  const ramp = (layer - 1) * 0.06;
  const scale = { tier: run.tier, ramp, mult: run.enemyMult };
  if (kind === 'boss') {
    return [enemyUnit('guardian', 'e1', scale), enemyUnit('goblin', 'e2', scale)];
  }
  if (kind === 'elite') {
    const eliteId = run.rng.pick(['skeleton', 'troll', 'goblin']);
    const rest = rollEnemyIds(run.rng, 2);
    return [
      enemyUnit(eliteId, 'e1', { ...scale, elite: true }),
      ...rest.map((id, i) => enemyUnit(id, `e${i + 2}`, scale)),
    ];
  }
  const count = layer <= 2 ? 2 : 3;
  return rollEnemyIds(run.rng, count).map((id, i) => enemyUnit(id, `e${i + 1}`, scale));
}

function startBattle(run: Run, kind: BattleKind, layer: number): void {
  const effects = relicEffects(run.relics);
  const bonus = runBonus(run);
  const heroes = liveMembers(run).map((m) => heroUnit(run.heroes[m.heroId] as Hero, bonus, memberHp(run, m)));
  run.battle = createBattle(heroes, buildEnemies(run, kind, layer), run.rng.int(1, 2_000_000_000), {
    skillDamageMult: effects.skillDamageMult,
    phoenix: run.phoenixLeft && effects.hasPhoenix,
  });
  run.battleKind = kind;
  run.stage = 'battle';
  advanceBattle(run.battle); // выставляем первого ходящего
}

function makeChest(run: Run, relicsOnly: boolean): ChestOffer[] {
  const relics = rollRelics(run.rng, run.relics, relicsOnly ? 2 : 1);
  const offers: ChestOffer[] = relics.map((relic, i) => ({ id: `relic${i}`, kind: 'relic', relic }));
  if (relicsOnly) {
    if (offers.length === 0) offers.push({ id: 'essence', kind: 'essence', amount: 3 + run.tier });
    return offers;
  }
  offers.push({ id: 'heal', kind: 'heal', pct: 0.3 });
  offers.push({ id: 'essence', kind: 'essence', amount: 2 + run.tier });
  return offers;
}

export function enterNode(run: Run, nodeId: string): void {
  if (!availableNodes(run).some((n) => n.id === nodeId)) throw new Error(`Узел ${nodeId} сейчас недоступен`);
  const node = nodeById(run, nodeId);
  run.currentNodeId = nodeId;
  run.visited.push(nodeId);
  switch (node.type) {
    case 'battle':
    case 'elite':
    case 'boss':
      startBattle(run, node.type, node.layer);
      break;
    case 'event': {
      const ev = pickEvent(run.rng, run.eventsSeen);
      run.eventsSeen.push(ev.id);
      run.event = ev;
      run.stage = 'event';
      break;
    }
    case 'chest':
      run.chestOffers = makeChest(run, false);
      run.stage = 'chest';
      break;
    case 'camp':
      run.stage = 'camp';
      break;
  }
}

// ---------- Бой ----------

/** Вызывать, когда battle.result != 'ongoing': переносит итоги боя в забег и двигает его дальше. */
export function finishBattle(run: Run): void {
  const b = run.battle;
  if (!b || b.result === 'ongoing') throw new Error('Бой ещё идёт');
  for (const unit of b.units) {
    if (unit.side !== 'hero') continue;
    const member = run.members.find((m) => m.heroId === unit.heroId);
    if (!member) continue;
    member.alive = unit.alive;
    member.frac = unit.alive ? unit.hp / unit.stats.maxHp : 0;
    if (!unit.alive && !run.fallen.includes(member.heroId)) run.fallen.push(member.heroId);
  }
  run.phoenixLeft = b.mods.phoenix;
  const kind = run.battleKind;
  run.battle = null;
  run.battleKind = null;

  if (b.result === 'defeat' || liveMembers(run).length === 0) {
    run.stage = 'ended';
    run.result = 'defeat';
    return;
  }
  run.nodesCleared += 1;
  const heal = relicEffects(run.relics).healAfterBattle;
  if (heal > 0) healParty(run, heal);

  if (kind === 'boss') {
    run.stage = 'ended';
    run.result = 'victory';
  } else if (kind === 'elite') {
    run.elitesCleared += 1;
    run.chestOffers = makeChest(run, true);
    run.stage = 'chest';
  } else {
    run.stage = 'map';
  }
}

// ---------- Сундук, лагерь, события ----------

function grantRelic(run: Run, relic: RelicId): void {
  if (run.relics.includes(relic)) return;
  run.relics.push(relic);
  if (relic === 'phoenixFeather') run.phoenixLeft = true;
}

export function chooseChest(run: Run, offerId: string): string {
  if (run.stage !== 'chest' || !run.chestOffers) throw new Error('Сундука нет');
  const offer = run.chestOffers.find((o) => o.id === offerId);
  if (!offer) throw new Error(`Нет варианта ${offerId}`);
  let text: string;
  if (offer.kind === 'relic') {
    grantRelic(run, offer.relic);
    text = `Реликвия: ${relicDef(offer.relic).name}`;
  } else if (offer.kind === 'heal') {
    healParty(run, offer.pct);
    text = 'Отряд подлечен';
  } else {
    run.essenceEarned += offer.amount;
    text = `+${offer.amount} Эссенции`;
  }
  run.chestOffers = null;
  run.stage = 'map';
  return text;
}

export function chooseCamp(run: Run, option: 'rest' | 'train'): string {
  if (run.stage !== 'camp') throw new Error('Это не лагерь');
  let text: string;
  if (option === 'rest') {
    const pct = 0.4 + run.postBonus.campHeal;
    healParty(run, pct);
    text = `Отдых: отряд восстановил ${Math.round(pct * 100)}% здоровья`;
  } else {
    run.atkBuff += 0.1;
    text = 'Тренировка: +10% АТК до конца забега';
  }
  run.stage = 'map';
  return text;
}

function describeEffect(e: Effect, run: Run, gainedRelic: RelicId | null): string | null {
  switch (e.k) {
    case 'essence':
      return `${e.v >= 0 ? '+' : ''}${e.v} Эссенции`;
    case 'partyHp':
      return e.v >= 0 ? `Отряд лечится на ${Math.round(e.v * 100)}%` : `Отряд теряет ${Math.round(-e.v * 100)}% здоровья`;
    case 'relic':
      return gainedRelic ? `Реликвия: ${relicDef(gainedRelic).name}` : 'Реликвий больше нет: +2 Эссенции';
    case 'ambush':
      return 'Засада!';
    case 'atkBuff':
      return `+${Math.round(e.v * 100)}% АТК`;
    case 'recruit':
      return run.pendingRecruits > 0 ? 'В гильдию придёт новый боец' : null;
  }
}

export function eventChoices(run: Run): Array<{ choice: Choice; hint: string | null }> {
  if (!run.event) return [];
  return run.event.choices.map((choice) => ({
    choice,
    hint: choice.ifClass && partyHasClass(run, choice.ifClass.cls) ? choice.ifClass.hint : null,
  }));
}

export function chooseEventOption(run: Run, choiceId: string): void {
  if (run.stage !== 'event' || !run.event) throw new Error('Событие не активно');
  const choice = eventDef(run.event.id).choices.find((c) => c.id === choiceId);
  if (!choice) throw new Error(`Нет варианта ${choiceId}`);
  const outcomes = outcomesFor(choice, (cls) => partyHasClass(run, cls));
  const outcome = run.rng.weighted(outcomes, (o) => o.weight);
  const lines: string[] = [];
  for (const e of outcome.effects) {
    let gained: RelicId | null = null;
    switch (e.k) {
      case 'essence':
        run.essenceEarned += e.v;
        break;
      case 'partyHp':
        if (e.v >= 0) healParty(run, e.v);
        else hurtParty(run, -e.v);
        break;
      case 'relic': {
        const [relic] = rollRelics(run.rng, run.relics, 1);
        if (relic) {
          grantRelic(run, relic);
          gained = relic;
        } else {
          run.essenceEarned += 2;
        }
        break;
      }
      case 'ambush':
        run.pendingAmbush = true;
        break;
      case 'atkBuff':
        run.atkBuff += e.v;
        break;
      case 'recruit':
        run.pendingRecruits += 1;
        break;
    }
    const line = describeEffect(e, run, gained);
    if (line) lines.push(line);
  }
  run.eventResult = { text: outcome.text, lines };
  run.stage = 'eventResult';
}

/** «Дальше» после результата события: либо засада, либо возврат на карту. */
export function continueFromEvent(run: Run): void {
  if (run.stage !== 'eventResult') throw new Error('Нет результата события');
  run.eventResult = null;
  run.event = null;
  if (run.pendingAmbush) {
    run.pendingAmbush = false;
    const layer = run.currentNodeId ? nodeById(run, run.currentNodeId).layer : 1;
    startBattle(run, 'ambush', layer);
  } else {
    run.stage = 'map';
  }
}

// ---------- Воскрешение за rewarded ----------

export function canRevive(run: Run): boolean {
  return run.reviveLeft > 0 && run.stage !== 'battle' && run.stage !== 'ended' && run.members.some((m) => !m.alive);
}

/** Воскрешает первого павшего героя с 30% HP. Вызывать после просмотра rewarded-рекламы. */
export function reviveFallen(run: Run): Hero | null {
  if (!canRevive(run)) return null;
  const member = run.members.find((m) => !m.alive);
  if (!member) return null;
  member.alive = true;
  member.frac = 0.3;
  run.reviveLeft -= 1;
  run.fallen = run.fallen.filter((id) => id !== member.heroId); // воскрешённый не бросает судьбу
  return run.heroes[member.heroId] as Hero;
}

// ---------- Итоги ----------

export function finishRun(run: Run, state: GameState, nowMs: number): RunSummary {
  if (run.stage !== 'ended' || !run.result) throw new Error('Забег ещё не окончен');
  if (run.finished) {
    if (run.summary) return run.summary;
    throw new Error('Итоги уже применены, но результат отсутствует');
  }
  run.finished = true;

  const victory = run.result === 'victory';
  const tier = run.tier;
  const effects = relicEffects(run.relics);

  const gold = Math.floor(totalIncome(state) * 120 * (1 + 0.5 * (tier - 1)) * (victory ? 1 : 0.4));
  const baseEssence = 3 + 2 * tier + 2 * run.elitesCleared + (victory ? 5 : 0);
  const essence = Math.floor(((victory ? baseEssence : baseEssence * 0.25) + run.essenceEarned) * effects.essenceMult);
  state.gold += gold;
  state.essence += essence;

  // Новобранцы: события и 30% за победу над боссом.
  const recruitRng = new RNG(nextSeed(state));
  let recruitCount = run.pendingRecruits;
  if (victory && recruitRng.chance(0.3)) recruitCount += 1;
  const recruits: Hero[] = [];
  for (let i = 0; i < recruitCount; i++) recruits.push(createHero(state, recruitRng.pick(HERO_CLASSES), 'rare'));

  // Поражение не уничтожает коллекцию: павшие в экспедиции герои временно ранены.
  // Это сохраняет цену ошибки, но не создаёт необратимой потери вложенного прогресса.
  const survivors: Hero[] = [];
  const lost: Hero[] = []; // поле оставлено для совместимости интерфейса/сейвов; в новом дизайне всегда пусто.
  for (const id of run.fallen) {
    const hero = state.heroes.find((h) => h.id === id);
    if (!hero) continue;
    if (!run.safe) {
      hero.status = 'wounded';
      hero.woundedUntil = nowMs + WOUND_MS;
    }
    survivors.push(hero);
  }
  // Не удаляем героев из коллекции или отряда; раненые временно недоступны до восстановления.
  state.party = state.party.filter((id) => state.heroes.some((h) => h.id === id));

  state.expeditionsCompleted += 1;
  if (victory) state.stats.expeditionsWon += 1;
  let unlockedTier: number | null = null;
  if (victory && tier === state.maxTier && tier < MAX_TIER) {
    state.maxTier += 1;
    unlockedTier = state.maxTier;
  }

  const summary: RunSummary = { result: run.result, tier, safe: run.safe, nodesCleared: run.nodesCleared, gold, essence, recruits, survivors, lost, unlockedTier };
  run.summary = summary;
  return summary;
}
