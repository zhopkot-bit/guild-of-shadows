import { advance, aliveUnits, applyAction, expectedDamage } from './battle';
import type { Action, Battle, BattleResult, Unit } from './types';

/**
 * Автоконтроллер. Он же играет за врагов; в авто-режиме — и за героев.
 * Правила описаны в docs/expedition-design.md, раздел «Автоконтроллер».
 */

const HEAL_THRESHOLD = 0.5;

function hpRatio(u: Unit): number {
  return u.hp / u.stats.maxHp;
}

/** Цель одиночной атаки: сначала тот, кого можно добить, иначе самый слабый по HP. */
function pickTarget(foes: Unit[], actor: Unit, mult: number, ignoreDef: boolean): Unit {
  const killable = foes
    .filter((f) => expectedDamage(actor, f, mult, ignoreDef) * 0.9 >= f.hp)
    .sort((a, c) => c.stats.atk - a.stats.atk);
  if (killable[0]) return killable[0];
  return foes.slice().sort((a, c) => a.hp - c.hp)[0] as Unit;
}

export function autoAction(b: Battle, actor: Unit): Action {
  const foes = aliveUnits(b, actor.side === 'hero' ? 'enemy' : 'hero');
  const friends = aliveUnits(b, actor.side);
  const skill = actor.skill;

  if (skill && actor.cd === 0) {
    if (skill.target === 'ally') {
      const weakest = friends.slice().sort((a, c) => hpRatio(a) - hpRatio(c))[0];
      if (weakest && hpRatio(weakest) < HEAL_THRESHOLD) {
        return { actorId: actor.id, kind: 'skill', targetId: weakest.id };
      }
    } else if (skill.target === 'allEnemies') {
      if (foes.length >= 2 || actor.boss) return { actorId: actor.id, kind: 'skill' };
    } else {
      const target = actor.side === 'hero' ? pickTarget(foes, actor, skill.mult, skill.ignoreDef === true) : b.rng.pick(foes);
      return { actorId: actor.id, kind: 'skill', targetId: target.id };
    }
  }

  // Герои фокусируют слабейшего, враги бьют случайного героя: так бой не превращается в идеальный фокус.
  const target = actor.side === 'hero' ? pickTarget(foes, actor, 1, false) : b.rng.pick(foes);
  return { actorId: actor.id, kind: 'attack', targetId: target.id };
}

/** Доигрывает бой до конца в автоматическом режиме (симуляция, тесты, быстрый расчёт). */
export function runAuto(b: Battle): BattleResult {
  for (;;) {
    const actor = advance(b);
    if (!actor) return b.result;
    applyAction(b, autoAction(b, actor));
  }
}
