import { advance as advanceBattle } from '../combat/battle';
import { createBattle } from '../combat/battle';
import { enemyUnit, heroStats, heroUnit, type HeroBonus } from '../combat/data';
import type { EnemyKind } from '../content/roster';
import { shards } from '../content/text';
import type { Battle, Stats, Unit } from '../combat/types';
import {
  FATE_BASE,
  FATE_MAX,
  FIRST_RUN_SEED,
  HP_SCALE,
  MAX_TIER,
  PARTY_SIZE,
  SAFE_EXPEDITIONS,
  TUTORIAL_ENEMY_SCALE,
  WOUND_MS,
} from '../core/config';
import { postEffect, refreshHeroes, totalIncome } from '../core/economy';
import { RNG } from '../core/rng';
import { nextSeed } from '../core/state';
import type { GameState, Hero, HeroIdentity } from '../core/types';
import { eventDef, outcomesFor, pickEvent, type Choice, type Effect, type EventDef } from './events';
import { generateMap, type MapNode } from './map';
import { moduleDef, moduleEffects, normalizeModules, rollModules, type ModuleId } from './modules';

export type RunStage = 'map' | 'battle' | 'event' | 'eventResult' | 'chest' | 'camp' | 'prep' | 'ended';
export type BattleKind = 'battle' | 'elite' | 'boss' | 'ambush';

export interface RunMember {
  heroId: string;
  /** Доля от максимального HP (0..1). Храним долю, чтобы реликвии на HP не ломали текущее здоровье. */
  frac: number;
  alive: boolean;
}

export type ChestOffer =
  | { id: string; kind: 'module'; module: ModuleId }
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
  /** Модули экспедиции (MOD01–08). Поле сохранило имя relics ради совместимости сейвов. */
  relics: ModuleId[];
  atkBuff: number;
  postBonus: { hpPct: number; atkPct: number; campHeal: number };
  essenceEarned: number;
  /** Золото из событий забега (начисляется в итогах). Optional для сейвов v1. */
  goldEarned?: number;
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
  /** Выбор на экране подготовки к боссу. Optional для сейвов до v1.8. */
  bossPrep?: 'heal' | 'ward' | null;
  /** Сумка собирателя уже сработала в этом забеге. */
  pouchUsed?: boolean;
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
    const stages: RunStage[] = ['map', 'battle', 'event', 'eventResult', 'chest', 'camp', 'prep', 'ended'];
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
    // Реликвии сейвов до v1.8 → модули Content Bible; Перо Феникса сохраняет свой отдельный эффект.
    const rawRelics = (run.relics as unknown as string[]) ?? [];
    if (rawRelics.includes('phoenixFeather') && !run.battle) run.phoenixLeft = true;
    run.relics = normalizeModules(rawRelics);
    if (run.chestOffers) {
      run.chestOffers = run.chestOffers.map((o) => {
        const legacy = o as unknown as { id: string; kind: string; relic?: string };
        if (legacy.kind !== 'relic') return o;
        const [mod] = normalizeModules([legacy.relic ?? '']);
        return mod ? { id: legacy.id, kind: 'module', module: mod } : { id: legacy.id, kind: 'essence', amount: 3 };
      });
    }
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
  /** Золото уже удвоено за rewarded-рекламу (сохраняется вместе с забегом). */
  doubled?: boolean;
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
    goldEarned: 0,
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
  const m = moduleEffects(run.relics);
  return {
    hpPct: run.postBonus.hpPct + m.hpPct,
    atkPct: run.postBonus.atkPct + run.atkBuff,
    defPct: 0,
    spdPct: 0,
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

export function partyHasIdentity(run: Run, identity: HeroIdentity): boolean {
  return liveMembers(run).some((m) => (run.heroes[m.heroId] as Hero).identity === identity);
}

/** Абсолютное изменение HP каждого живого героя; урон событий оставляет минимум 1 HP. */
function shiftPartyHp(run: Run, v: number): void {
  for (const m of liveMembers(run)) {
    const max = memberStats(run, m).maxHp;
    const hp = Math.round(m.frac * max) + Math.round(v * HP_SCALE);
    m.frac = Math.min(1, Math.max(1, hp) / max);
  }
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

/**
 * Составы встреч — Combat Spec v0.3, «Составы»:
 * слои 1–2 — 2 врага, без двух Костяных стражей; слои 3–6 — 2–3 врага, не больше одного волка
 * и одного врага с телеграфируемой атакой; элита — усиленный страж + 1 обычный; босс — один.
 */
const TELEGRAPHERS: readonly EnemyKind[] = ['boneGuard', 'ashMage'];

function allowedKinds(layer: number): EnemyKind[] {
  return layer <= 1 ? ['goblinRaider'] : ['goblinRaider', 'ashWolf', 'boneGuard', 'ashMage'];
}

function rollEnemyIds(rng: RNG, count: number, layer: number, preset: EnemyKind[] = []): EnemyKind[] {
  const ids: EnemyKind[] = [...preset];
  const weights: Record<EnemyKind, number> = { goblinRaider: 4, ashWolf: 2, boneGuard: 2, ashMage: 2, boneKing: 0 };
  let guard = 0;
  while (ids.length < count && guard++ < 100) {
    const id = rng.weighted(allowedKinds(layer), (k) => weights[k]);
    if (id === 'ashWolf' && ids.includes('ashWolf')) continue;
    if (TELEGRAPHERS.includes(id) && ids.some((x) => TELEGRAPHERS.includes(x))) continue;
    ids.push(id);
  }
  while (ids.length < count) ids.push('goblinRaider');
  return ids.slice(preset.length);
}

/**
 * Состав встречи узла зависит только от сида забега и id узла, поэтому его можно заранее показать
 * на карте (Карта следопыта, MOD06) и он не меняется от порядка посещения узлов.
 */
function encounterRng(run: Run, nodeId: string): RNG {
  let h = (run.seed ^ 0x2c1b3c6d) >>> 0;
  for (const ch of nodeId) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return new RNG(h);
}

export function encounterKinds(run: Run, kind: BattleKind, layer: number, nodeId: string | null): EnemyKind[] {
  const rng = nodeId ? encounterRng(run, nodeId) : run.rng;
  if (kind === 'boss') return ['boneKing'];
  if (kind === 'elite') return ['boneGuard', ...rollEnemyIds(rng, 2, Math.max(2, layer), ['boneGuard'])];
  const count = layer <= 2 ? 2 : rng.int(2, 3);
  return rollEnemyIds(rng, count, layer);
}

/** Превью состава для узла карты (null — узел не боевой). */
export function encounterPreview(run: Run, node: MapNode): EnemyKind[] | null {
  if (node.type !== 'battle' && node.type !== 'elite' && node.type !== 'boss') return null;
  return encounterKinds(run, node.type, node.layer, node.id);
}

function buildEnemies(run: Run, kind: BattleKind, layer: number, nodeId: string | null): Unit[] {
  const ramp = (layer - 1) * 0.06;
  const scale = { tier: run.tier, ramp, mult: run.enemyMult };
  return encounterKinds(run, kind, layer, nodeId).map((id, i) => enemyUnit(id, `e${i + 1}`, kind === 'elite' && i === 0 ? { ...scale, elite: true } : scale));
}

function startBattle(run: Run, kind: BattleKind, layer: number, nodeId: string | null): void {
  const m = moduleEffects(run.relics);
  const bonus = runBonus(run);
  const heroes = liveMembers(run).map((mem) => heroUnit(run.heroes[mem.heroId] as Hero, bonus, memberHp(run, mem)));
  run.battle = createBattle(heroes, buildEnemies(run, kind, layer, nodeId), run.rng.int(1, 2_000_000_000), {
    skillDamageMult: 1,
    phoenix: run.phoenixLeft,
    shooterBasicBonus: m.shooterBasicBonus,
    pierceLeft: m.shooterFirstPen,
    wardenLeft: m.wardenFlat,
    firstRoundSpd: m.firstRoundSpd,
    bossWard: kind === 'boss' && run.bossPrep === 'ward' ? BOSS_WARD : 0,
  });
  run.battleKind = kind;
  run.stage = 'battle';
  advanceBattle(run.battle); // выставляем первого ходящего
}

function makeChest(run: Run, relicsOnly: boolean): ChestOffer[] {
  const mods = rollModules(run.rng, run.relics, relicsOnly ? 2 : 1);
  const offers: ChestOffer[] = mods.map((module, i) => ({ id: `module${i}`, kind: 'module', module }));
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
      startBattle(run, node.type, node.layer, node.id);
      break;
    case 'boss':
      // Combat Spec: после шестого слоя — гарантированный экран подготовки к боссу.
      run.bossPrep = null;
      run.stage = 'prep';
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
  const mods = moduleEffects(run.relics);
  const kind = run.battleKind;
  run.battle = null;
  run.battleKind = null;

  if (b.result === 'defeat' || liveMembers(run).length === 0) {
    run.stage = 'ended';
    run.result = 'defeat';
    return;
  }
  run.nodesCleared += 1;

  if (kind === 'boss') {
    run.stage = 'ended';
    run.result = 'victory';
  } else if (kind === 'elite') {
    run.elitesCleared += 1;
    // Сумка собирателя (MOD08): один раз за забег после первой элиты.
    if (mods.pouch && !run.pouchUsed) {
      run.pouchUsed = true;
      run.essenceEarned += 1;
    }
    run.chestOffers = makeChest(run, true);
    run.stage = 'chest';
  } else {
    run.stage = 'map';
  }
}

// ---------- Сундук, лагерь, события ----------

function grantModule(run: Run, mod: ModuleId): void {
  if (!run.relics.includes(mod)) run.relics.push(mod);
}

export function chooseChest(run: Run, offerId: string): string {
  if (run.stage !== 'chest' || !run.chestOffers) throw new Error('Сундука нет');
  const offer = run.chestOffers.find((o) => o.id === offerId);
  if (!offer) throw new Error(`Нет варианта ${offerId}`);
  let text: string;
  if (offer.kind === 'module') {
    grantModule(run, offer.module);
    text = `Модуль: ${moduleDef(offer.module).name}`;
  } else if (offer.kind === 'heal') {
    healParty(run, offer.pct);
    text = 'Отряд подлечен';
  } else {
    run.essenceEarned += offer.amount;
    text = `+${shards(offer.amount)}`;
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
    const extra = moduleEffects(run.relics).campHealAbs;
    if (extra > 0) shiftPartyHp(run, extra);
    text = `Отдых: отряд восстановил ${Math.round(pct * 100)}% здоровья${extra > 0 ? ` и ещё ${Math.round(extra * HP_SCALE)} HP (Зелье восстановления)` : ''}`;
  } else {
    run.atkBuff += 0.1;
    text = 'Тренировка: +10% АТК до конца забега';
  }
  run.stage = 'map';
  return text;
}

function describeEffect(e: Effect, gainedRelic: ModuleId | null): string | null {
  switch (e.k) {
    case 'essence':
      return `${e.v >= 0 ? '+' : '−'}${shards(Math.abs(e.v))}`;
    case 'partyHp':
      return e.v >= 0 ? `Отряд лечится на ${Math.round(e.v * 100)}%` : `Отряд теряет ${Math.round(-e.v * 100)}% здоровья`;
    case 'relic':
      return gainedRelic ? `Модуль: ${moduleDef(gainedRelic).name}` : 'Модулей больше нет: +2 осколка реликвий';
    case 'ambush':
      return 'Засада!';
    case 'atkBuff':
      return `+${Math.round(e.v * 100)}% АТК`;
    case 'gold':
      return `+${e.v} золота`;
    case 'hp':
      return e.v >= 0 ? `Каждый герой восстанавливает ${Math.round(e.v * HP_SCALE)} HP` : `Каждый герой теряет ${Math.round(-e.v * HP_SCALE)} HP`;
  }
}

export function eventChoices(run: Run): Array<{ choice: Choice; available: boolean; hint: string | null }> {
  if (!run.event) return [];
  return eventDef(run.event.id).choices.map((choice) => {
    const available = !choice.requires || partyHasIdentity(run, choice.requires.identity);
    return { choice, available, hint: available ? null : choice.requires?.hint ?? null };
  });
}

export function chooseEventOption(run: Run, choiceId: string): void {
  if (run.stage !== 'event' || !run.event) throw new Error('Событие не активно');
  const choice = eventDef(run.event.id).choices.find((c) => c.id === choiceId);
  if (!choice) throw new Error(`Нет варианта ${choiceId}`);
  if (choice.requires && !partyHasIdentity(run, choice.requires.identity)) throw new Error(`Вариант ${choiceId} недоступен`);
  const outcomes = outcomesFor(choice);
  const outcome = run.rng.weighted(outcomes, (o) => o.weight);
  const lines: string[] = [];
  for (const e of outcome.effects) {
    let gained: ModuleId | null = null;
    switch (e.k) {
      case 'essence':
        run.essenceEarned += e.v;
        break;
      case 'gold':
        run.goldEarned = (run.goldEarned ?? 0) + e.v;
        break;
      case 'hp':
        shiftPartyHp(run, e.v);
        break;
      case 'partyHp':
        if (e.v >= 0) healParty(run, e.v);
        else hurtParty(run, -e.v);
        break;
      case 'relic': {
        const [mod] = rollModules(run.rng, run.relics, 1);
        if (mod) {
          grantModule(run, mod);
          gained = mod;
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
    }
    const line = describeEffect(e, gained);
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
    startBattle(run, 'ambush', layer, null);
  } else {
    run.stage = 'map';
  }
}

// ---------- Подготовка к боссу ----------

/** Защита от первой спецатаки босса: её урон уменьшается вдвое (одна атака за бой). */
export const BOSS_WARD = 0.5;
export const BOSS_PREP_HEAL = 0.3;

export function chooseBossPrep(run: Run, option: 'heal' | 'ward'): string {
  if (run.stage !== 'prep') throw new Error('Подготовка к боссу недоступна');
  run.bossPrep = option;
  if (option === 'heal') healParty(run, BOSS_PREP_HEAL);
  const node = run.currentNodeId ? nodeById(run, run.currentNodeId) : null;
  startBattle(run, 'boss', node?.layer ?? 7, node?.id ?? null);
  return option === 'heal' ? `Отряд восстановил ${Math.round(BOSS_PREP_HEAL * 100)}% здоровья` : 'Первая спецатака короля будет ослаблена вдвое';
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
  const gold = Math.floor(totalIncome(state) * 120 * (1 + 0.5 * (tier - 1)) * (victory ? 1 : 0.4)) + (run.goldEarned ?? 0);
  const baseEssence = 3 + 2 * tier + 2 * run.elitesCleared + (victory ? 5 : 0);
  const essence = Math.floor((victory ? baseEssence : baseEssence * 0.25) + run.essenceEarned);
  state.gold += gold;
  state.essence += essence;

  // Случайный найм исключён из MVP (UI/UX Spec v1.1, GDD v1.1): ростер задан вручную.
  // nextSeed сохраняет прежний расход сидов, чтобы следующие карты не сдвигались относительно v1.4.
  nextSeed(state);
  const recruits: Hero[] = [];

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
