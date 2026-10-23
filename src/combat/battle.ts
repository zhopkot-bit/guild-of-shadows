import { MAX_ROUNDS } from '../core/config';
import { RNG } from '../core/rng';
import { BOSS_PHASE2_NAME } from './data';
import type { Action, Battle, BattleEvent, BattleMods, HitInfo, Intent, Unit } from './types';

/**
 * Боевой движок. Он ничего не знает ни об интерфейсе, ни о том, кто принимает решения:
 * автоконтроллер (ai.ts) и игрок в ручном режиме отдают одинаковые объекты Action.
 * Модель детерминирована: тот же сид и те же действия дают тот же бой.
 * Формулы — Combat & Expeditions Spec v0.3, раздел 04.
 */

export const DEFAULT_MODS: BattleMods = { skillDamageMult: 1, phoenix: false };
export const BATTLE_SCHEMA = 2;

/** Потолки из спецификации. */
export const MAX_PENETRATION = 0.6;
export const MAX_MITIGATION = 0.45;
export const LAST_STAND_PCT = 0.15;
export const LAST_STAND_HP = 0.35;
export const SHOOTER_PASSIVE_PEN = 0.1;
export const AFTERCARE_PCT = 0.05;

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
    lastStandUsed: false,
    schema: BATTLE_SCHEMA,
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

function pushEvent(b: Battle, out: BattleEvent[], e: BattleEvent): void {
  b.log.push(e);
  out.push(e);
}

/** Переход Костяного короля во II фазу: ровно один раз, без внеочередного хода и без скрытых бонусов к статам. */
function enterBossPhase(b: Battle, boss: Unit, out: BattleEvent[] | null): void {
  if (!boss.boss || !boss.alive || boss.bossPhase === 2) return;
  if (boss.hp > boss.stats.maxHp * 0.5) {
    if (boss.bossPhase === undefined) boss.bossPhase = 1;
    return;
  }
  boss.bossPhase = 2;
  boss.name = BOSS_PHASE2_NAME;
  boss.phaseTurns = 0;
  // Доспехи трескаются: подготовленный клинок срывается, следующий ход — телеграф волны.
  if (boss.intent) {
    const cancelled = boss.intent;
    boss.intent = null;
    const ev: BattleEvent = { t: 'cancel', actor: boss.id, intent: cancelled };
    if (out) pushEvent(b, out, ev);
    else b.log.push(ev);
  }
  const ev: BattleEvent = { t: 'bossPhase', unit: boss.id, phase: 2, name: boss.name };
  if (out) pushEvent(b, out, ev);
  else b.log.push(ev);
}

/**
 * Возвращает юнита, чей сейчас ход, при необходимости начиная новый раунд.
 * Повторный вызов без apply() возвращает того же юнита. null — бой окончен.
 */
export function advance(b: Battle): Unit | null {
  if (b.result !== 'ongoing') return null;
  // Миграция старых сохранений боя: если HP уже ниже порога, фаза всё равно активируется.
  for (const u of b.units) enterBossPhase(b, u, null);
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
    b.queue = initiativeOrder(b);
  }
}

function initiativeOrder(b: Battle): string[] {
  return aliveUnits(b)
    .map((u) => ({ u, i: b.units.indexOf(u) }))
    .sort((a, c) => c.u.stats.spd - a.u.stats.spd || a.i - c.i)
    .map((x) => x.u.id);
}

/** Порядок ходов для полоски очерёдности: сейчас идущий, остаток раунда и весь следующий раунд. */
export function turnOrder(b: Battle): { now: string[]; next: string[] } {
  const now: string[] = [];
  if (b.current !== null) now.push(b.current);
  for (const id of b.queue) if (unitById(b, id).alive && !now.includes(id)) now.push(id);
  return { now, next: initiativeOrder(b) };
}

export function legalActions(b: Battle, unit: Unit): Action[] {
  const actions: Action[] = [];
  if (!unit.alive) return actions;
  if (unit.side === 'enemy') {
    if (unit.intent) return [{ actorId: unit.id, kind: 'release' }];
    for (const foe of opponents(b, unit)) actions.push({ actorId: unit.id, kind: 'attack', targetId: foe.id });
    return actions;
  }
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
  if (b.current !== action.actorId || b.result !== 'ongoing') return false;
  const actor = unitById(b, action.actorId);
  if (action.kind === 'prepare') {
    if (actor.side !== 'enemy' || actor.intent || !action.intent) return false;
    if (action.intent.aoe) return true;
    const t = action.intent.targetId ? b.units.find((u) => u.id === action.intent?.targetId) : undefined;
    return !!t && t.alive && t.side !== actor.side;
  }
  return legalActions(b, actor).some((a) => a.kind === action.kind && a.targetId === action.targetId);
}

function finish(b: Battle, result: 'victory' | 'defeat', out: BattleEvent[]): void {
  b.result = result;
  b.current = null;
  if (result === 'victory') {
    // Пассивка Целительницы: после победы самый раненый живой союзник восстанавливает 5% maxHP.
    const healer = aliveUnits(b, 'hero').find((u) => u.kind === 'healer');
    if (healer) {
      const target = aliveUnits(b, 'hero')
        .filter((u) => u.hp < u.stats.maxHp)
        .sort((x, y) => x.hp / x.stats.maxHp - y.hp / y.stats.maxHp || b.units.indexOf(x) - b.units.indexOf(y))[0];
      if (target) {
        const amount = Math.min(target.stats.maxHp - target.hp, Math.round(target.stats.maxHp * AFTERCARE_PCT));
        if (amount > 0) {
          target.hp += amount;
          pushEvent(b, out, { t: 'aftercare', actor: healer.id, target: target.id, amount });
        }
      }
    }
  }
  pushEvent(b, out, { t: 'end', result });
}

/** Детерминированный разброс 0.95…1.05 с шагом 0.01. */
function variance(b: Battle): number {
  return (95 + b.rng.int(0, 10)) / 100;
}

/** Ожидаемый урон без разброса и защитных эффектов. Нужен ИИ и подсказкам интерфейса. */
export function expectedDamage(attacker: Unit, target: Unit, mult: number, penetration = 0, bonusFactor = 1): number {
  const effDef = target.stats.def * (1 - Math.min(MAX_PENETRATION, penetration));
  return attacker.stats.atk * mult * (100 / (100 + effDef)) * bonusFactor;
}

/** Ожидаемый урон подготовленного удара по цели с учётом Прикрытия (для подсказок и ИИ). */
export function intentDamage(attacker: Unit, intent: Intent, target: Unit): number {
  const cover = Math.min(MAX_MITIGATION, target.cover ?? 0);
  return expectedDamage(attacker, target, intent.mult) * (1 - cover);
}

function damage(
  b: Battle,
  out: BattleEvent[],
  actor: Unit,
  target: Unit,
  mult: number,
  opts: { penetration?: number; bonusFactor?: number; skill?: string; via: HitInfo['via']; intentId?: Intent['id'] },
): void {
  const raw = expectedDamage(actor, target, mult, opts.penetration ?? 0, opts.bonusFactor ?? 1) * variance(b);
  let mitigation = 0;
  let covered = false;
  let lastStand = false;
  if (target.side === 'hero') {
    if ((target.cover ?? 0) > 0) {
      mitigation += target.cover ?? 0;
      target.cover = 0; // Прикрытие расходуется на одном ударе
      covered = true;
    }
    const defenderAlive = aliveUnits(b, 'hero').some((u) => u.kind === 'defender');
    if (!b.lastStandUsed && defenderAlive && target.hp < target.stats.maxHp * LAST_STAND_HP) {
      mitigation += LAST_STAND_PCT;
      b.lastStandUsed = true;
      lastStand = true;
    }
  }
  mitigation = Math.min(MAX_MITIGATION, mitigation);
  const dmg = Math.max(1, Math.round(raw * (1 - mitigation)));
  const mitigated = Math.max(0, Math.round(raw) - dmg);
  target.hp = Math.max(0, target.hp - dmg);
  const killed = target.hp === 0;
  if (killed) {
    target.alive = false;
    target.cover = 0;
    // Выбывший юнит не выполнит подготовленный удар.
    if (target.intent) {
      const cancelled = target.intent;
      target.intent = null;
      pushEvent(b, out, { t: 'cancel', actor: target.id, intent: cancelled });
    }
  }
  const ev: HitInfo = { t: 'hit', actor: actor.id, target: target.id, dmg, killed, via: opts.via };
  if (opts.skill !== undefined) ev.skill = opts.skill;
  if (opts.intentId !== undefined) ev.intentId = opts.intentId;
  if (mitigated > 0) ev.mitigated = mitigated;
  if (covered) ev.covered = true;
  if (lastStand) ev.lastStand = true;
  pushEvent(b, out, ev);
  enterBossPhase(b, target, out);
  if (killed && target.side === 'hero' && b.mods.phoenix) {
    b.mods.phoenix = false;
    target.alive = true;
    target.hp = Math.max(1, Math.round(target.stats.maxHp * 0.3));
    pushEvent(b, out, { t: 'phoenix', target: target.id });
  }
}

/** Цель для удара, чья исходная цель выбыла: наименьшая доля HP, затем стабильный порядок. */
export function mostVulnerable(b: Battle, side: Unit['side']): Unit | undefined {
  return aliveUnits(b, side).sort((x, y) => x.hp / x.stats.maxHp - y.hp / y.stats.maxHp || b.units.indexOf(x) - b.units.indexOf(y))[0];
}

/** Выполняет действие текущего юнита и возвращает события для анимации. Нелегальное действие — ошибка. */
export function applyAction(b: Battle, action: Action): BattleEvent[] {
  if (!isLegal(b, action)) throw new Error(`Нелегальное действие: ${JSON.stringify(action)}`);
  const out: BattleEvent[] = [];
  const actor = unitById(b, action.actorId);
  const skill = action.kind === 'skill' ? actor.skill : null;

  if (action.kind === 'attack') {
    const target = unitById(b, action.targetId as string);
    // Дисциплина огня (Стрелок): обычная атака по врагу с подготовленным ударом пробивает 10% DEF.
    const pen = actor.kind === 'shooter' && target.intent ? SHOOTER_PASSIVE_PEN : 0;
    damage(b, out, actor, target, 1, { penetration: pen, via: 'attack' });
  } else if (action.kind === 'skill' && skill) {
    if (skill.effect === 'damage') {
      const bonus = actor.side === 'hero' ? b.mods.skillDamageMult : 1;
      if (skill.target === 'allEnemies') {
        for (const foe of opponents(b, actor)) damage(b, out, actor, foe, skill.mult, { penetration: skill.penetration ?? 0, bonusFactor: bonus, skill: skill.name, via: 'skill' });
      } else {
        damage(b, out, actor, unitById(b, action.targetId as string), skill.mult, { penetration: skill.penetration ?? 0, bonusFactor: bonus, skill: skill.name, via: 'skill' });
      }
    } else if (skill.effect === 'heal') {
      const target = unitById(b, action.targetId as string);
      const amount = Math.min(Math.round(target.stats.maxHp * (skill.healPctMax ?? 0)), target.stats.maxHp - target.hp);
      target.hp += amount;
      pushEvent(b, out, { t: 'heal', actor: actor.id, target: target.id, amount, skill: skill.name });
    } else {
      const target = unitById(b, action.targetId as string);
      const pct = skill.coverPct ?? 0.3;
      target.cover = Math.max(target.cover ?? 0, pct);
      pushEvent(b, out, { t: 'cover', actor: actor.id, target: target.id, pct });
    }
  } else if (action.kind === 'prepare' && action.intent) {
    actor.intent = { ...action.intent };
    pushEvent(b, out, { t: 'prepare', actor: actor.id, intent: actor.intent });
  } else if (action.kind === 'release' && actor.intent) {
    const intent = actor.intent;
    actor.intent = null;
    if (intent.aoe) {
      for (const hero of aliveUnits(b, 'hero')) damage(b, out, actor, hero, intent.mult, { skill: intent.name, via: 'intent', intentId: intent.id });
    } else {
      let target = intent.targetId ? b.units.find((u) => u.id === intent.targetId) : undefined;
      if (!target || !target.alive) {
        // Цель выбыла до удара: не переадресуем молча — событие фиксирует новую цель.
        const fallback = mostVulnerable(b, 'hero');
        if (fallback) {
          pushEvent(b, out, { t: 'retarget', actor: actor.id, from: intent.targetId ?? '', to: fallback.id });
          target = fallback;
        }
      }
      if (target) damage(b, out, actor, target, intent.mult, { skill: intent.name, via: 'intent', intentId: intent.id });
    }
  }

  // Перезарядка героев: после умения — полная, иначе тикает на собственном ходу.
  if (skill) actor.cd = skill.cooldown;
  else if (actor.cd > 0) actor.cd -= 1;
  actor.turns = (actor.turns ?? 0) + 1;
  if (actor.boss) actor.phaseTurns = (actor.phaseTurns ?? 0) + 1;

  b.current = null;
  if (aliveUnits(b, 'enemy').length === 0) finish(b, 'victory', out);
  else if (aliveUnits(b, 'hero').length === 0) finish(b, 'defeat', out);
  return out;
}
