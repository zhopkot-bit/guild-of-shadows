import { MAX_ROUNDS } from '../core/config';
import { RNG } from '../core/rng';
import type { Action, Battle, BattleEvent, BattleMods, Unit } from './types';

/**
 * Боевой движок. Он ничего не знает ни об интерфейсе, ни о том, кто принимает решения:
 * автоконтроллер (ai.ts) и игрок в ручном режиме отдают одинаковые объекты Action.
 * Модель детерминирована: тот же сид и те же действия дают тот же бой.
 */

export const DEFAULT_MODS: BattleMods = { skillDamageMult: 1, phoenix: false };

export interface BossIntent {
  phase: 1 | 2;
  label: string;
  detail: string;
  targetsAll: boolean;
}

/**
 * Честный телеграф следующего действия босса. Он опирается на те же cooldown/skill,
 * которые использует AI, поэтому подпись не расходится с реально выбранным действием.
 */
export function bossIntent(boss: Unit): BossIntent {
  const phase: 1 | 2 = boss.bossPhase === 2 ? 2 : 1;
  const willUseSkill = !!boss.skill && boss.cd === 0 && boss.skill.target !== 'ally';
  if (willUseSkill && boss.skill) {
    const targetsAll = boss.skill.target === 'allEnemies';
    return {
      phase,
      label: boss.skill.name,
      detail: targetsAll ? 'Удар затронет весь отряд — приготовьтесь к блоку.' : 'Удар по одному герою — приготовьтесь к блоку.',
      targetsAll,
    };
  }
  return {
    phase,
    label: phase === 2 ? 'Тяжёлый удар' : 'Обычная атака',
    detail: 'Цель — один герой. Успейте выполнить блок.',
    targetsAll: false,
  };
}

/** Единственное место изменения характеристик при переходе босса во вторую фазу. */
function enterBossPhase(boss: Unit): BattleEvent | null {
  if (!boss.boss || !boss.alive || boss.bossPhase === 2) return null;
  if (boss.hp > boss.stats.maxHp * 0.5) {
    // Старое сохранение могло не содержать поле bossPhase.
    if (boss.bossPhase === undefined) boss.bossPhase = 1;
    return null;
  }

  boss.bossPhase = 2;
  boss.name = 'Страж гробницы — пробуждённый';
  boss.stats.atk = Math.round(boss.stats.atk * 1.2);
  boss.stats.spd += 1;
  // Skill хранится отдельной копией в Unit: нельзя менять глобальную таблицу SKILLS.
  if (boss.skill) {
    boss.skill = { ...boss.skill, name: 'Сокрушительный удар', mult: boss.skill.mult * 1.25 };
  }
  return { t: 'bossPhase', unit: boss.id, phase: 2, name: boss.name };
}

export function createBattle(heroes: Unit[], enemies: Unit[], seed: number, mods: Partial<BattleMods> = {}): Battle {
  return {
    units: [...heroes, ...enemies],
    round: 0,
    queue: [],
    current: null,
    rng: new RNG(seed),
    log: [],
    result: 'ongoing',
    mods: { ...DEFAULT_MODS, ...mods },
  };
}

export function unitById(b: Battle, id: string): Unit {
  const u = b.units.find((x) => x.id === id);
  if (!u) throw new Error(`Нет юнита ${id}`);
  return u;
}

export function aliveUnits(b: Battle, side?: Unit['side']): Unit[] {
  return b.units.filter((u) => u.alive && (side === undefined || u.side === side));
}

function opponents(b: Battle, unit: Unit): Unit[] {
  return aliveUnits(b, unit.side === 'hero' ? 'enemy' : 'hero');
}

function allies(b: Battle, unit: Unit): Unit[] {
  return aliveUnits(b, unit.side);
}

/** Ожидаемый урон без разброса. Нужен автоконтроллеру и подсказкам интерфейса. */
export function expectedDamage(attacker: Unit, target: Unit, mult: number, ignoreDef: boolean): number {
  const defFactor = ignoreDef ? 1 : 100 / (100 + target.stats.def);
  return attacker.stats.atk * mult * defFactor;
}

/** Поправки игрока: power усиливает удар героя, guard смягчает удар врага по герою. */
interface Mod {
  power: number;
  guard: number;
}

function rollDamage(b: Battle, attacker: Unit, target: Unit, mult: number, ignoreDef: boolean, mod: Mod): number {
  const variance = 0.9 + b.rng.next() * 0.2;
  const power = attacker.side === 'hero' ? mod.power : 1;
  const guard = target.side === 'hero' ? mod.guard : 0;
  return Math.max(1, Math.round(expectedDamage(attacker, target, mult, ignoreDef) * variance * power * (1 - guard)));
}

function pushEvent(b: Battle, out: BattleEvent[], e: BattleEvent): void {
  b.log.push(e);
  out.push(e);
}

/**
 * Возвращает юнита, чей сейчас ход, при необходимости начиная новый раунд.
 * Повторный вызов без apply() возвращает того же юнита. null — бой окончен.
 */
export function advance(b: Battle): Unit | null {
  if (b.result !== 'ongoing') return null;
  // Миграция старых сохранений боя: если HP уже ниже порога, фаза всё равно активируется.
  for (const boss of b.units) {
    const phaseEvent = enterBossPhase(boss);
    if (phaseEvent) b.log.push(phaseEvent);
  }
  if (b.current !== null) {
    const cur = unitById(b, b.current);
    if (cur.alive) return cur;
    b.current = null;
  }
  for (;;) {
    while (b.queue.length > 0) {
      const id = b.queue.shift() as string;
      const u = unitById(b, id);
      if (u.alive) {
        b.current = id;
        return u;
      }
    }
    if (b.round >= MAX_ROUNDS) {
      finish(b, 'defeat', []);
      return null;
    }
    b.round += 1;
    b.log.push({ t: 'round', n: b.round });
    b.queue = aliveUnits(b)
      .map((u, i) => ({ u, i }))
      .sort((a, c) => c.u.stats.spd - a.u.stats.spd || a.i - c.i)
      .map((x) => x.u.id);
  }
}

/** Порядок ходов для полоски очерёдности: сейчас идущий, остаток раунда и весь следующий раунд. */
export function turnOrder(b: Battle): { now: string[]; next: string[] } {
  const now: string[] = [];
  if (b.current !== null) now.push(b.current);
  for (const id of b.queue) if (unitById(b, id).alive && !now.includes(id)) now.push(id);
  const next = aliveUnits(b)
    .map((u, i) => ({ u, i }))
    .sort((a, c) => c.u.stats.spd - a.u.stats.spd || a.i - c.i)
    .map((x) => x.u.id);
  return { now, next };
}

export function legalActions(b: Battle, unit: Unit): Action[] {
  const actions: Action[] = [];
  const foes = opponents(b, unit);
  for (const foe of foes) actions.push({ actorId: unit.id, kind: 'attack', targetId: foe.id });
  const skill = unit.skill;
  if (skill && unit.cd === 0) {
    if (skill.target === 'enemy') {
      for (const foe of foes) actions.push({ actorId: unit.id, kind: 'skill', targetId: foe.id });
    } else if (skill.target === 'allEnemies') {
      actions.push({ actorId: unit.id, kind: 'skill' });
    } else {
      for (const ally of allies(b, unit)) actions.push({ actorId: unit.id, kind: 'skill', targetId: ally.id });
    }
  }
  return actions;
}

export function isLegal(b: Battle, action: Action): boolean {
  if (b.current !== action.actorId) return false;
  const actor = unitById(b, action.actorId);
  return legalActions(b, actor).some((a) => a.kind === action.kind && a.targetId === action.targetId);
}

function finish(b: Battle, result: 'victory' | 'defeat', out: BattleEvent[]): void {
  b.result = result;
  b.current = null;
  pushEvent(b, out, { t: 'end', result });
}

function damage(b: Battle, out: BattleEvent[], actor: Unit, target: Unit, mult: number, ignoreDef: boolean, mod: Mod, skillName?: string): void {
  const dmg = rollDamage(b, actor, target, mult, ignoreDef, mod);
  target.hp = Math.max(0, target.hp - dmg);
  const killed = target.hp === 0;
  if (killed) target.alive = false;
  const ev: BattleEvent = skillName === undefined
    ? { t: 'hit', actor: actor.id, target: target.id, dmg, killed }
    : { t: 'hit', actor: actor.id, target: target.id, dmg, killed, skill: skillName };
  pushEvent(b, out, ev);
  const phaseEvent = enterBossPhase(target);
  if (phaseEvent) pushEvent(b, out, phaseEvent);
  if (killed && target.side === 'hero' && b.mods.phoenix) {
    b.mods.phoenix = false;
    target.alive = true;
    target.hp = Math.max(1, Math.round(target.stats.maxHp * 0.3));
    pushEvent(b, out, { t: 'phoenix', target: target.id });
  }
}

/** Выполняет действие текущего юнита и возвращает события для анимации. Нелегальное действие — ошибка. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function applyAction(b: Battle, action: Action): BattleEvent[] {
  if (!isLegal(b, action)) throw new Error(`Нелегальное действие: ${JSON.stringify(action)}`);
  const out: BattleEvent[] = [];
  const actor = unitById(b, action.actorId);
  const mod: Mod = { power: clamp(action.power ?? 1, 0.5, 1.5), guard: clamp(action.guard ?? 0, 0, 0.7) };
  const skill = action.kind === 'skill' ? actor.skill : null;

  if (action.kind === 'attack') {
    damage(b, out, actor, unitById(b, action.targetId as string), 1, false, mod);
  } else if (skill) {
    const dmgMult = skill.mult * (actor.side === 'hero' ? b.mods.skillDamageMult : 1);
    if (skill.target === 'enemy') {
      damage(b, out, actor, unitById(b, action.targetId as string), dmgMult, skill.ignoreDef === true, mod, skill.name);
    } else if (skill.target === 'allEnemies') {
      for (const foe of opponents(b, actor)) damage(b, out, actor, foe, dmgMult, skill.ignoreDef === true, mod, skill.name);
    } else {
      const target = unitById(b, action.targetId as string);
      const raw = target.stats.maxHp * (skill.healPctMax ?? 0) + actor.stats.atk * (skill.healAtkMult ?? 0);
      const amount = Math.min(Math.round(raw), target.stats.maxHp - target.hp);
      target.hp += amount;
      pushEvent(b, out, { t: 'heal', actor: actor.id, target: target.id, amount, skill: skill.name });
    }
  }

  // Перезарядка: после умения — полная, иначе тикает.
  if (skill) actor.cd = skill.cooldown;
  else if (actor.cd > 0) actor.cd -= 1;

  b.current = null;
  if (aliveUnits(b, 'enemy').length === 0) finish(b, 'victory', out);
  else if (aliveUnits(b, 'hero').length === 0) finish(b, 'defeat', out);
  return out;
}
