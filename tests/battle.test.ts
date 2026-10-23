import { describe, expect, it } from 'vitest';
import { autoAction, runAuto } from '../src/combat/ai';
import { advance, applyAction, bossIntent, createBattle, isLegal, legalActions, unitById } from '../src/combat/battle';
import { ENEMIES, NO_BONUS, SKILLS, enemyUnit, heroUnit } from '../src/combat/data';
import { MAX_ROUNDS } from '../src/core/config';
import { createHero } from '../src/core/state';
import { newGame } from '../src/core/state';
import type { Hero } from '../src/core/types';
import type { Battle, Unit } from '../src/combat/types';

function party(level = 1): Unit[] {
  const s = newGame(1);
  return s.heroes.map((h: Hero) => heroUnit({ ...h, level }, NO_BONUS));
}

function enemies(ids: string[], tier = 1): Unit[] {
  return ids.map((id, i) => enemyUnit(id, `e${i + 1}`, { tier, ramp: 0 }));
}

function fresh(seed = 1, level = 1, foes = ['skeleton', 'goblin', 'troll'], tier = 1): Battle {
  return createBattle(party(level), enemies(foes, tier), seed);
}

describe('бой', () => {
  it('редкость не даёт скрытого множителя характеристик', () => {
    const base = newGame(1).heroes[0]!;
    const common = heroUnit({ ...base, rarity: 'common' }, NO_BONUS);
    const legendary = heroUnit({ ...base, rarity: 'legendary' }, NO_BONUS);
    expect(legendary.stats).toEqual(common.stats);
  });
  it('детерминирован: один сид и одно поведение дают один и тот же журнал', () => {
    const a = fresh(42);
    const b = fresh(42);
    runAuto(a);
    runAuto(b);
    expect(a.log).toEqual(b.log);
    expect(a.result).toBe(b.result);
  });

  it('босс переходит во II фазу один раз при 50% HP и заранее раскрывает намерение', () => {
    const b = fresh(19, 1, ['guardian']);
    const boss = b.units.find((u) => u.boss)!;
    const attacker = b.units.find((u) => u.side === 'hero')!;
    expect(boss.bossPhase).toBe(1);
    expect(bossIntent(boss).label).toBe('Обычная атака');
    boss.cd = 0;
    expect(bossIntent(boss).targetsAll).toBe(true);
    expect(bossIntent(boss).label).toBe('Удар по площади');

    // Переходим порог не смертельным ударом, чтобы проверить собственно фазу, а не победу.
    boss.hp = Math.ceil(boss.stats.maxHp * 0.52);
    attacker.stats.atk = 60;
    b.current = attacker.id;
    const atkBefore = boss.stats.atk;
    const multBefore = boss.skill!.mult;
    const events = applyAction(b, { actorId: attacker.id, kind: 'attack', targetId: boss.id });

    expect(boss.alive).toBe(true);
    expect(boss.bossPhase).toBe(2);
    expect(boss.name).toContain('пробуждённый');
    expect(boss.stats.atk).toBe(Math.round(atkBefore * 1.2));
    expect(boss.skill!.mult).toBeCloseTo(multBefore * 1.25);
    expect(boss.skill!.name).toBe('Сокрушительный удар');
    expect(events.filter((e) => e.t === 'bossPhase')).toHaveLength(1);
    expect(bossIntent(boss).phase).toBe(2);
    expect(bossIntent(boss).label).toBe('Сокрушительный удар');

    // Изменение skill экземпляра босса не мутирует глобальный каталог умений.
    const nextBoss = enemyUnit('guardian', 'fresh-boss', { tier: 1, ramp: 0 });
    expect(nextBoss.skill!.mult).toBe(SKILLS.groundSlam!.mult);
    const atkPhaseTwo = boss.stats.atk;
    advance(b);
    expect(boss.stats.atk).toBe(atkPhaseTwo);
    expect(b.log.filter((e) => e.t === 'bossPhase')).toHaveLength(1);
  });

  it('старое сохранение с боссом ниже порога автоматически восстанавливает фазу II', () => {
    const b = fresh(23, 1, ['guardian']);
    const boss = b.units.find((u) => u.boss)!;
    const hero = b.units.find((u) => u.side === 'hero')!;
    delete boss.bossPhase;
    boss.hp = Math.floor(boss.stats.maxHp * 0.4);
    b.current = hero.id;
    const atkBefore = boss.stats.atk;
    advance(b);
    expect(boss.bossPhase).toBe(2);
    expect(boss.stats.atk).toBe(Math.round(atkBefore * 1.2));
    expect(b.log.some((e) => e.t === 'bossPhase')).toBe(true);
  });

  it('разные сиды дают разные бои', () => {
    const a = fresh(1);
    const b = fresh(2);
    runAuto(a);
    runAuto(b);
    expect(JSON.stringify(a.log)).not.toBe(JSON.stringify(b.log));
  });

  it('всегда заканчивается, не выходит за лимит раундов и не бросает ошибок', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const level = 1 + (seed % 8);
      const b = fresh(seed, level, ['shaman', 'shaman', 'troll']);
      const result = runAuto(b);
      expect(['victory', 'defeat']).toContain(result);
      expect(b.round).toBeLessThanOrEqual(MAX_ROUNDS);
    }
  });

  it('первым ходит самый быстрый (Плут, СКР 14)', () => {
    const b = fresh(7);
    const first = advance(b)!;
    expect(first.kind).toBe('rogue');
  });

  it('умение недоступно на первом ходу, готово на втором и уходит на перезарядку', () => {
    const b = fresh(5, 10, ['troll', 'troll', 'troll']);
    const rogue = unitById(b, party().find((u) => u.kind === 'rogue')!.id);
    expect(advance(b)!.id).toBe(rogue.id);
    expect(legalActions(b, rogue).some((a) => a.kind === 'skill')).toBe(false);
    applyAction(b, autoAction(b, rogue));
    // дойдём до следующего хода плута
    let guard = 0;
    while (guard++ < 20) {
      const u = advance(b)!;
      if (u.id === rogue.id) break;
      applyAction(b, autoAction(b, u));
    }
    expect(legalActions(b, rogue).some((a) => a.kind === 'skill')).toBe(true);
    const skillAction = legalActions(b, rogue).find((a) => a.kind === 'skill')!;
    applyAction(b, skillAction);
    expect(rogue.cd).toBe(rogue.skill!.cooldown);
  });

  it('лечение не превышает максимум здоровья', () => {
    const b = fresh(9, 5, ['skeleton']);
    const priest = b.units.find((u) => u.kind === 'priest')!;
    priest.cd = 0;
    priest.hp = priest.stats.maxHp - 1;
    // дадим ход жрецу
    b.current = priest.id;
    const heal = legalActions(b, priest).find((a) => a.kind === 'skill' && a.targetId === priest.id)!;
    applyAction(b, heal);
    expect(priest.hp).toBe(priest.stats.maxHp);
  });

  it('нелегальные действия отклоняются', () => {
    const b = fresh(11);
    const actor = advance(b)!;
    const foe = b.units.find((u) => u.side === 'enemy')!;
    expect(isLegal(b, { actorId: actor.id, kind: 'skill', targetId: foe.id })).toBe(false); // умение на перезарядке
    expect(() => applyAction(b, { actorId: actor.id, kind: 'skill', targetId: foe.id })).toThrow();
    foe.alive = false;
    expect(isLegal(b, { actorId: actor.id, kind: 'attack', targetId: foe.id })).toBe(false); // цель мертва
    const other = b.units.find((u) => u.side === 'hero' && u.id !== actor.id)!;
    expect(isLegal(b, { actorId: other.id, kind: 'attack', targetId: 'e2' })).toBe(false); // не его ход
  });

  it('Перо Феникса воскрешает первого павшего героя ровно один раз', () => {
    const b = createBattle(party(1), enemies(['troll', 'troll', 'troll'], 3), 3, { phoenix: true });
    const target = b.units.find((u) => u.side === 'hero')!;
    const attacker = b.units.find((u) => u.side === 'enemy')!;
    attacker.stats.atk = 9999;
    target.hp = 1;
    b.current = attacker.id;
    const ev = applyAction(b, { actorId: attacker.id, kind: 'attack', targetId: target.id });
    expect(ev.some((e) => e.t === 'phoenix')).toBe(true);
    expect(target.alive).toBe(true);
    expect(target.hp).toBe(Math.round(target.stats.maxHp * 0.3));
    expect(b.mods.phoenix).toBe(false);
    // второй раз не сработает
    target.hp = 1;
    b.current = attacker.id;
    attacker.cd = 5;
    applyAction(b, { actorId: attacker.id, kind: 'attack', targetId: target.id });
    expect(target.alive).toBe(false);
  });

  it('«ручной» игрок, выбирающий первое легальное действие, тоже доходит до конца боя', () => {
    const b = fresh(21, 3);
    let guard = 0;
    for (;;) {
      const actor = advance(b);
      if (!actor) break;
      const action = actor.side === 'hero' ? legalActions(b, actor)[0]! : autoAction(b, actor);
      applyAction(b, action);
      if (guard++ > 1000) throw new Error('бой не заканчивается');
    }
    expect(b.result).not.toBe('ongoing');
  });

  it('на глубоком подземелье высокий уровень героев решает', () => {
    expect(Object.keys(ENEMIES)).toContain('guardian');
    let winsLow = 0;
    let winsHigh = 0;
    for (let seed = 1; seed <= 100; seed++) {
      if (runAuto(fresh(seed, 1, ['troll', 'troll', 'skeleton'], 3)) === 'victory') winsLow++;
      if (runAuto(fresh(seed, 8, ['troll', 'troll', 'skeleton'], 3)) === 'victory') winsHigh++;
    }
    expect(winsHigh).toBeGreaterThan(winsLow);
  });
});

describe('вспомогательное', () => {
  it('createHero даёт уникальные id', () => {
    const s = newGame(1);
    const a = createHero(s, 'mage', 'rare');
    const b = createHero(s, 'mage', 'rare');
    expect(a.id).not.toBe(b.id);
  });
});

describe('влияние игрока на бой', () => {
  function firstHit(action: { power?: number; guard?: number }, actorSide: 'hero' | 'enemy'): number {
    const b = fresh(7);
    for (;;) {
      const actor = advance(b);
      if (!actor) throw new Error('бой кончился раньше времени');
      if (actor.side === actorSide) {
        const base = autoAction(b, actor);
        const ev = applyAction(b, { ...base, kind: 'attack', targetId: base.targetId ?? legalActions(b, actor)[0]?.targetId, ...action });
        const hit = ev.find((e) => e.t === 'hit');
        if (hit && hit.t === 'hit') return hit.dmg;
      }
      applyAction(b, autoAction(b, actor));
    }
  }

  it('идеальный тайминг бьёт сильнее обычного, а провал слабее', () => {
    const normal = firstHit({}, 'hero');
    expect(firstHit({ power: 1.35 }, 'hero')).toBeGreaterThan(normal);
    expect(firstHit({ power: 0.8 }, 'hero')).toBeLessThan(normal);
  });

  it('парирование гасит урон по герою, но не по врагу', () => {
    const normal = firstHit({}, 'enemy');
    expect(firstHit({ guard: 0.7 }, 'enemy')).toBeLessThan(normal);
    expect(firstHit({ guard: 0.7 }, 'hero')).toBe(firstHit({}, 'hero'));
  });

  it('значения вне допустимых границ обрезаются', () => {
    expect(firstHit({ power: 99 }, 'hero')).toBe(firstHit({ power: 1.5 }, 'hero'));
    expect(firstHit({ guard: 5 }, 'enemy')).toBe(firstHit({ guard: 0.7 }, 'enemy'));
  });
});
