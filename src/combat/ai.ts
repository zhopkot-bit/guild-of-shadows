import { advance, aliveUnits, applyAction, expectedDamage, intentDamage, mostVulnerable } from './battle';
import { LEGACY_ENEMY_KIND, isEnemyKind, type EnemyKind } from '../content/roster';
import type { Action, Battle, BattleResult, Intent, Unit } from './types';

/**
 * Контроллеры. Враги действуют по таблице поведения Content Bible без случайности,
 * поэтому интерфейс может честно показать их следующий ход. Автобой героев следует
 * приоритетам Combat Spec v0.3 («Автоконтроллер»).
 */

export const INTENTS: Record<Intent['id'], Omit<Intent, 'targetId'>> = {
  cleaver: { id: 'cleaver', name: 'Тяжёлый клинок', mult: 1.6, aoe: false },
  heavyBlow: { id: 'heavyBlow', name: 'Тяжёлый удар', mult: 1.6, aoe: false },
  ashBolt: { id: 'ashBolt', name: 'Пепельный заряд', mult: 1.4, aoe: false },
  spectralWave: { id: 'spectralWave', name: 'Призрачная волна', mult: 0.6, aoe: true },
};

function byIndex(b: Battle) {
  return (x: Unit, y: Unit) => b.units.indexOf(x) - b.units.indexOf(y);
}

function lowestAbs(b: Battle): Unit | undefined {
  return aliveUnits(b, 'hero').sort((x, y) => x.hp - y.hp || byIndex(b)(x, y))[0];
}

export function enemyKind(u: Unit): EnemyKind | null {
  if (isEnemyKind(u.kind)) return u.kind;
  return LEGACY_ENEMY_KIND[u.kind] ?? null;
}

function prepare(actor: Unit, id: Intent['id'], target: Unit | undefined): Action | null {
  const def = INTENTS[id];
  if (def.aoe) return { actorId: actor.id, kind: 'prepare', intent: { ...def, targetId: null } };
  if (!target) return null;
  return { actorId: actor.id, kind: 'prepare', intent: { ...def, targetId: target.id } };
}

function attack(actor: Unit, target: Unit | undefined): Action {
  return { actorId: actor.id, kind: 'attack', targetId: target?.id as string };
}

/** Ход врага. Чистая функция состояния: вызов без applyAction не меняет бой. */
export function enemyAction(b: Battle, actor: Unit): Action {
  if (actor.intent) return { actorId: actor.id, kind: 'release' };
  const turns = actor.turns ?? 0;
  const vulnerable = mostVulnerable(b, 'hero');
  switch (enemyKind(actor)) {
    case 'boneKing': {
      const t = actor.phaseTurns ?? 0;
      if (actor.bossPhase === 2) {
        // Фаза II: волна → удар волны → обычный удар; спецатака не чаще раза в три хода.
        if (t % 3 === 0) return prepare(actor, 'spectralWave', undefined) as Action;
        return attack(actor, vulnerable);
      }
      if (t % 3 === 1) return prepare(actor, 'cleaver', vulnerable) ?? attack(actor, vulnerable);
      return attack(actor, vulnerable);
    }
    case 'boneGuard':
      if (turns % 3 === 1) return prepare(actor, 'heavyBlow', vulnerable) ?? attack(actor, lowestAbs(b));
      return attack(actor, lowestAbs(b));
    case 'ashMage':
      if (turns % 3 === 2) return prepare(actor, 'ashBolt', lowestAbs(b)) ?? attack(actor, lowestAbs(b));
      return attack(actor, lowestAbs(b));
    case 'goblinRaider': {
      const defender = aliveUnits(b, 'hero').find((u) => u.kind === 'defender');
      return attack(actor, defender ?? lowestAbs(b));
    }
    case 'ashWolf':
    default:
      return attack(actor, vulnerable);
  }
}

/** Что враг сделает на своём следующем ходу при текущем состоянии боя (для панели намерений). */
export function previewEnemyAction(b: Battle, actor: Unit): Action | null {
  if (!actor.alive || actor.side !== 'enemy') return null;
  return enemyAction(b, actor);
}

// ---------- Автобой героев ----------

const HEAL_THRESHOLD = 0.5;

function hpRatio(u: Unit): number {
  return u.hp / u.stats.maxHp;
}

/** Сможет ли actor уложить цель одним ударом (по нижней границе разброса). */
function canKill(actor: Unit, target: Unit, mult: number, pen: number, bonus: number): boolean {
  return expectedDamage(actor, target, mult, pen, bonus) * 0.95 >= target.hp;
}

function threat(b: Battle, foe: Unit): number {
  let t = foe.stats.atk;
  if (foe.intent) t *= foe.intent.aoe ? foe.intent.mult * aliveUnits(b, 'hero').length : foe.intent.mult;
  return t;
}

export function heroAutoAction(b: Battle, actor: Unit): Action {
  const foes = aliveUnits(b, 'enemy');
  const friends = aliveUnits(b, 'hero');
  const skill = actor.skill && actor.cd === 0 ? actor.skill : null;
  const bonus = b.mods.skillDamageMult;
  const telegraphs = foes.filter((f) => f.intent);

  // Самые опасные объявленные удары: по каждому — кто под угрозой и смертелен ли удар.
  const dangers = telegraphs.flatMap((f) => {
    const intent = f.intent as Intent;
    const victims = intent.aoe ? friends : friends.filter((h) => h.id === intent.targetId);
    return victims.map((v) => ({ foe: f, victim: v, lethal: intentDamage(f, intent, v) * 1.05 >= v.hp }));
  });

  // 1. Предотвратить нокаут от телеграфа.
  for (const d of dangers.filter((x) => x.lethal)) {
    if (skill?.effect === 'damage' && canKill(actor, d.foe, skill.mult, skill.penetration ?? 0, bonus)) return { actorId: actor.id, kind: 'skill', targetId: d.foe.id };
    if (canKill(actor, d.foe, 1, 0, 1)) return attack(actor, d.foe);
    if (skill?.effect === 'cover' && (d.victim.cover ?? 0) === 0) return { actorId: actor.id, kind: 'skill', targetId: d.victim.id };
    if (skill?.effect === 'heal') {
      const healed = Math.min(d.victim.stats.maxHp, d.victim.hp + Math.round(d.victim.stats.maxHp * (skill.healPctMax ?? 0)));
      if (intentDamage(d.foe, d.foe.intent as Intent, { ...d.victim, hp: healed }) * 1.05 < healed) return { actorId: actor.id, kind: 'skill', targetId: d.victim.id };
    }
  }

  // 2. Лечение по порогу.
  if (skill?.effect === 'heal') {
    const weakest = friends.slice().sort((x, y) => hpRatio(x) - hpRatio(y) || byIndex(b)(x, y))[0];
    if (weakest && hpRatio(weakest) < HEAL_THRESHOLD) return { actorId: actor.id, kind: 'skill', targetId: weakest.id };
  }

  // 3. Ответ на нелетальный телеграф: Прикрытие на цель.
  if (skill?.effect === 'cover') {
    const d = dangers.find((x) => (x.victim.cover ?? 0) === 0);
    if (d) return { actorId: actor.id, kind: 'skill', targetId: d.victim.id };
  }

  // 4. Устранить опасную цель: сначала добивание, затем наибольшая угроза.
  const ordered = foes.slice().sort((x, y) => threat(b, y) - threat(b, x) || x.hp - y.hp || byIndex(b)(x, y));
  if (skill?.effect === 'damage') {
    const kill = ordered.find((f) => canKill(actor, f, skill.mult, skill.penetration ?? 0, bonus));
    return { actorId: actor.id, kind: 'skill', targetId: (kill ?? ordered[0] as Unit).id };
  }
  const kill = ordered.find((f) => canKill(actor, f, 1, 0, 1));
  return attack(actor, kill ?? ordered[0]);
}

export function autoAction(b: Battle, actor: Unit): Action {
  return actor.side === 'enemy' ? enemyAction(b, actor) : heroAutoAction(b, actor);
}

/** Доигрывает бой до конца в автоматическом режиме (симуляция, тесты, быстрый расчёт). */
export function runAuto(b: Battle): BattleResult {
  for (;;) {
    const actor = advance(b);
    if (!actor) return b.result;
    applyAction(b, autoAction(b, actor));
  }
}
