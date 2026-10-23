import { describe, expect, it } from 'vitest';
import { INTENTS, autoAction, enemyAction, runAuto } from '../src/combat/ai';
import { MAX_MITIGATION, advance, applyAction, createBattle, expectedDamage, isLegal, legalActions, unitById } from '../src/combat/battle';
import { CLASSES, ENEMIES, NO_BONUS, SKILLS, enemyUnit, heroUnit } from '../src/combat/data';
import type { EnemyKind } from '../src/content/roster';
import { HP_SCALE, MAX_ROUNDS } from '../src/core/config';
import { newGame } from '../src/core/state';
import type { Battle, Unit } from '../src/combat/types';

/** Все четыре героя (Бран, Мира, Рук, Нора), чтобы проверять каждую роль. */
function party(level = 1, ids?: string[]): Unit[] {
  const s = newGame(1);
  return s.heroes.filter((h) => !ids || ids.includes(h.identity ?? '')).map((h) => heroUnit({ ...h, level }, NO_BONUS));
}

function enemies(ids: EnemyKind[], tier = 1): Unit[] {
  return ids.map((id, i) => enemyUnit(id, `e${i + 1}`, { tier, ramp: 0 }));
}

function fresh(seed = 1, level = 1, foes: EnemyKind[] = ['goblinRaider', 'ashWolf', 'boneGuard'], tier = 1): Battle {
  return createBattle(party(level), enemies(foes, tier), seed);
}

function hero(b: Battle, kind: string): Unit {
  return b.units.find((u) => u.side === 'hero' && u.kind === kind) as Unit;
}

function act(b: Battle, actor: Unit, action: Omit<Parameters<typeof applyAction>[1], 'actorId'>) {
  b.current = actor.id;
  return applyAction(b, { actorId: actor.id, ...action });
}

describe('канон Content Bible / Combat Spec', () => {
  it('базовые характеристики ролей совпадают с Content Bible (HP × HP_SCALE)', () => {
    const b = fresh();
    expect(hero(b, 'defender').stats).toEqual({ maxHp: Math.round(145 * HP_SCALE), atk: 12, def: 8, spd: 6 });
    expect(hero(b, 'scout').stats).toEqual({ maxHp: Math.round(100 * HP_SCALE), atk: 15, def: 4, spd: 11 });
    expect(hero(b, 'shooter').stats).toEqual({ maxHp: Math.round(82 * HP_SCALE), atk: 19, def: 3, spd: 7 });
    expect(hero(b, 'healer').stats).toEqual({ maxHp: Math.round(110 * HP_SCALE), atk: 9, def: 5, spd: 7 });
    expect(ENEMIES.boneKing.stats).toEqual({ maxHp: 460, atk: 22, def: 8, spd: 6 });
    expect(Object.keys(ENEMIES).sort()).toEqual(['ashMage', 'ashWolf', 'boneGuard', 'boneKing', 'goblinRaider']);
  });

  it('у каждой роли своё умение из спецификации', () => {
    expect(SKILLS[CLASSES.defender.skill]).toMatchObject({ name: 'Прикрытие', effect: 'cover', coverPct: 0.3, cooldown: 2 });
    expect(SKILLS[CLASSES.scout.skill]).toMatchObject({ name: 'Точный выпад', mult: 1.7, cooldown: 2 });
    expect(SKILLS[CLASSES.shooter.skill]).toMatchObject({ name: 'Прицельный выстрел', mult: 2.0, penetration: 0.3, cooldown: 2 });
    expect(SKILLS[CLASSES.healer.skill]).toMatchObject({ name: 'Свет исцеления', healPctMax: 0.22, cooldown: 2 });
  });

  it('редкость не даёт скрытого множителя характеристик', () => {
    const base = newGame(1).heroes[0]!;
    expect(heroUnit({ ...base, rarity: 'legendary' }, NO_BONUS).stats).toEqual(heroUnit({ ...base, rarity: 'common' }, NO_BONUS).stats);
  });
});

describe('формула урона', () => {
  it('ATK × mult × 100/(100+DEF) × variance(0.95…1.05), округление один раз, минимум 1', () => {
    for (let seed = 1; seed < 40; seed++) {
      const b = fresh(seed);
      const bran = hero(b, 'defender');
      const goblin = unitById(b, 'e1');
      const before = goblin.hp;
      act(b, bran, { kind: 'attack', targetId: goblin.id });
      const dealt = before - goblin.hp;
      const base = expectedDamage(bran, goblin, 1);
      expect(dealt).toBeGreaterThanOrEqual(Math.round(base * 0.95));
      expect(dealt).toBeLessThanOrEqual(Math.round(base * 1.05));
    }
  });

  it('Прицельный выстрел игнорирует 30% DEF, обычная атака — нет', () => {
    const b = fresh(5);
    const rook = hero(b, 'shooter');
    const guard = unitById(b, 'e3');
    expect(expectedDamage(rook, guard, 2.0, 0.3)).toBeGreaterThan(expectedDamage(rook, guard, 2.0, 0));
    expect(legalActions(b, rook).some((a) => a.kind === 'skill')).toBe(true);
  });

  it('Дисциплина огня: обычная атака Стрелка по врагу с подготовленным ударом пробивает 10% DEF', () => {
    const a = fresh(77);
    const b = fresh(77);
    const guardA = unitById(a, 'e3');
    const guardB = unitById(b, 'e3');
    guardB.intent = { ...INTENTS.heavyBlow, targetId: hero(b, 'healer').id };
    const hpA = guardA.hp;
    const hpB = guardB.hp;
    act(a, hero(a, 'shooter'), { kind: 'attack', targetId: guardA.id });
    act(b, hero(b, 'shooter'), { kind: 'attack', targetId: guardB.id });
    expect(hpB - guardB.hp).toBeGreaterThanOrEqual(hpA - guardA.hp);
  });
});

describe('Прикрытие и Последний заслон', () => {
  it('Прикрытие снижает ровно один следующий удар на 30%, затем снимается', () => {
    const b = fresh(3);
    const bran = hero(b, 'defender');
    const nora = hero(b, 'healer');
    const ev = act(b, bran, { kind: 'skill', targetId: nora.id });
    expect(ev.some((e) => e.t === 'cover')).toBe(true);
    expect(nora.cover).toBeCloseTo(0.3);
    expect(bran.cd).toBe(2);
    const goblin = unitById(b, 'e1');
    const hit1 = act(b, goblin, { kind: 'attack', targetId: nora.id }).find((e) => e.t === 'hit');
    expect(hit1 && hit1.t === 'hit' && hit1.covered).toBe(true);
    expect(nora.cover).toBe(0);
    const hit2 = act(b, goblin, { kind: 'attack', targetId: nora.id }).find((e) => e.t === 'hit');
    expect(hit2 && hit2.t === 'hit' && hit2.covered).toBeFalsy();
  });

  it('Прикрытие защищает только одну цель волны; суммарное снижение не выше 45%', () => {
    const b = createBattle(party(1), enemies(['boneKing']), 9);
    const king = unitById(b, 'e1');
    const nora = hero(b, 'healer');
    nora.cover = 0.3;
    nora.hp = Math.floor(nora.stats.maxHp * 0.2); // ниже 35% — сработает и заслон
    king.intent = { ...INTENTS.spectralWave, targetId: null };
    const ev = act(b, king, { kind: 'release' });
    const hits = ev.filter((e) => e.t === 'hit');
    expect(hits.length).toBe(4);
    const covered = hits.filter((e) => e.t === 'hit' && e.covered);
    expect(covered).toHaveLength(1);
    expect(MAX_MITIGATION).toBe(0.45);
    expect(b.lastStandUsed).toBe(true);
  });

  it('Последний заслон срабатывает один раз за бой и только пока Защитник жив', () => {
    const b = fresh(4);
    const nora = hero(b, 'healer');
    const goblin = unitById(b, 'e1');
    nora.hp = Math.floor(nora.stats.maxHp * 0.3);
    const e1 = act(b, goblin, { kind: 'attack', targetId: nora.id }).find((e) => e.t === 'hit');
    expect(e1 && e1.t === 'hit' && e1.lastStand).toBe(true);
    const e2 = act(b, goblin, { kind: 'attack', targetId: nora.id }).find((e) => e.t === 'hit');
    expect(e2 && e2.t === 'hit' && e2.lastStand).toBeFalsy();
  });
});

describe('телеграфы врагов', () => {
  it('Костяной страж готовит удар по зафиксированной цели и бьёт ×1.6 на следующем ходу', () => {
    const b = createBattle(party(1), enemies(['boneGuard']), 11);
    const guard = unitById(b, 'e1');
    guard.turns = 1;
    const plan = enemyAction(b, guard);
    expect(plan.kind).toBe('prepare');
    expect(plan.intent?.targetId).toBeTruthy();
    applyActionAs(b, guard, plan);
    expect(guard.intent?.id).toBe('heavyBlow');
    const target = guard.intent!.targetId!;
    // Цель не меняется, даже если HP героев изменились.
    for (const u of b.units) if (u.side === 'hero' && u.id !== target) u.hp = 1;
    const release = enemyAction(b, guard);
    expect(release.kind).toBe('release');
    const ev = applyActionAs(b, guard, release);
    const hit = ev.find((e) => e.t === 'hit');
    expect(hit && hit.t === 'hit' && hit.target).toBe(target);
    expect(guard.intent).toBeNull();
  });

  it('если телеграфирующий враг выбыл до удара, удар отменяется', () => {
    const b = createBattle(party(1), enemies(['ashMage', 'goblinRaider']), 12);
    const mage = unitById(b, 'e1');
    mage.intent = { ...INTENTS.ashBolt, targetId: hero(b, 'healer').id };
    mage.hp = 1;
    const ev = act(b, hero(b, 'shooter'), { kind: 'attack', targetId: mage.id });
    expect(ev.some((e) => e.t === 'cancel')).toBe(true);
    expect(mage.intent).toBeNull();
  });

  it('если цель телеграфа выбыла, удар явно переадресуется (событие retarget)', () => {
    const b = createBattle(party(1), enemies(['boneGuard']), 13);
    const guard = unitById(b, 'e1');
    const nora = hero(b, 'healer');
    guard.intent = { ...INTENTS.heavyBlow, targetId: nora.id };
    nora.alive = false;
    nora.hp = 0;
    const ev = act(b, guard, { kind: 'release' });
    expect(ev.some((e) => e.t === 'retarget')).toBe(true);
  });

  it('Гоблин-налётчик бьёт Защитника, пока тот жив', () => {
    const b = fresh(14);
    const plan = enemyAction(b, unitById(b, 'e1'));
    expect(plan.targetId).toBe(hero(b, 'defender').id);
  });
});

describe('Костяной король', () => {
  it('фаза I: обычный удар → подготовка клинка (цель видна) → удар ×1.6', () => {
    const b = createBattle(party(1), enemies(['boneKing']), 21);
    const king = unitById(b, 'e1');
    expect(enemyAction(b, king).kind).toBe('attack');
    king.phaseTurns = 1;
    const prep = enemyAction(b, king);
    expect(prep.kind).toBe('prepare');
    expect(prep.intent).toMatchObject({ id: 'cleaver', mult: 1.6, aoe: false });
    expect(prep.intent?.targetId).toBeTruthy();
  });

  it('переход во II фазу ровно один раз при ≤50% HP, без бонусного хода и скрытых бонусов', () => {
    const b = createBattle(party(1), enemies(['boneKing']), 22);
    const king = unitById(b, 'e1');
    const rook = hero(b, 'shooter');
    king.intent = { ...INTENTS.cleaver, targetId: hero(b, 'healer').id };
    king.hp = Math.ceil(king.stats.maxHp * 0.51);
    rook.stats.atk = 80;
    const atk = king.stats.atk;
    const spd = king.stats.spd;
    const queueBefore = [...b.queue];
    const ev = act(b, rook, { kind: 'attack', targetId: king.id });
    expect(king.bossPhase).toBe(2);
    expect(king.name).toContain('пробуждённый');
    expect(ev.filter((e) => e.t === 'bossPhase')).toHaveLength(1);
    // Клинок срывается, характеристики не растут, очередь не перестраивается.
    expect(king.intent).toBeNull();
    expect(king.stats.atk).toBe(atk);
    expect(king.stats.spd).toBe(spd);
    expect(b.queue).toEqual(queueBefore);
    // Первое действие фазы II — телеграф волны по всему отряду.
    const first = enemyAction(b, king);
    expect(first.kind).toBe('prepare');
    expect(first.intent).toMatchObject({ id: 'spectralWave', aoe: true, mult: 0.6 });
    act(b, rook, { kind: 'attack', targetId: king.id });
    expect(b.log.filter((e) => e.t === 'bossPhase')).toHaveLength(1);
  });

  it('фаза II: волна не чаще раза в три собственных хода, цикл стабилен', () => {
    const b = createBattle(party(20), enemies(['boneKing']), 23);
    const king = unitById(b, 'e1');
    king.bossPhase = 2;
    king.phaseTurns = 0;
    const kinds: string[] = [];
    for (let i = 0; i < 9; i++) {
      const plan = enemyAction(b, king);
      kinds.push(plan.kind);
      applyActionAs(b, king, plan);
      for (const u of b.units) if (u.side === 'hero') {
        u.hp = u.stats.maxHp;
        u.alive = true;
      }
    }
    expect(kinds).toEqual(['prepare', 'release', 'attack', 'prepare', 'release', 'attack', 'prepare', 'release', 'attack']);
  });

  it('старое сохранение с боссом ниже порога восстанавливает фазу II при advance', () => {
    const b = createBattle(party(1), enemies(['boneKing']), 24);
    const king = unitById(b, 'e1');
    delete king.bossPhase;
    king.hp = Math.floor(king.stats.maxHp * 0.4);
    advance(b);
    expect(king.bossPhase).toBe(2);
    advance(b);
    expect(b.log.filter((e) => e.t === 'bossPhase')).toHaveLength(1);
  });
});

describe('ход боя', () => {
  it('детерминирован: один сид и одно поведение дают один и тот же журнал', () => {
    const a = fresh(42);
    const b = fresh(42);
    runAuto(a);
    runAuto(b);
    expect(a.log).toEqual(b.log);
  });

  it('всегда заканчивается и не выходит за лимит раундов', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const b = fresh(seed, 1 + (seed % 10), seed % 3 === 0 ? ['boneKing'] : ['goblinRaider', 'ashMage', 'ashWolf']);
      const r = runAuto(b);
      expect(['victory', 'defeat']).toContain(r);
      expect(b.round).toBeLessThanOrEqual(MAX_ROUNDS);
    }
  });

  it('первой ходит самая быстрая (Пепельный волк, СКР 12; среди героев — Мира, СКР 11)', () => {
    const b = fresh(1);
    expect(advance(b)?.kind).toBe('ashWolf');
    const order = b.queue.map((id) => unitById(b, id).kind);
    expect(order[0]).toBe('scout');
  });

  it('умение готово сразу, после применения уходит на 2 собственных хода', () => {
    const b = fresh(2);
    const mira = hero(b, 'scout');
    expect(mira.cd).toBe(0);
    act(b, mira, { kind: 'skill', targetId: 'e1' });
    expect(mira.cd).toBe(2);
    act(b, mira, { kind: 'attack', targetId: 'e1' });
    expect(mira.cd).toBe(1);
    act(b, mira, { kind: 'attack', targetId: 'e2' });
    expect(mira.cd).toBe(0);
  });

  it('лечение — 22% maxHP, не выше максимума, выбывших не воскрешает', () => {
    const b = fresh(6);
    const nora = hero(b, 'healer');
    const bran = hero(b, 'defender');
    bran.hp = bran.stats.maxHp - 3;
    const ev = act(b, nora, { kind: 'skill', targetId: bran.id });
    expect(ev.find((e) => e.t === 'heal')).toMatchObject({ amount: 3 });
    expect(bran.hp).toBe(bran.stats.maxHp);
    const dead = hero(b, 'scout');
    dead.alive = false;
    dead.hp = 0;
    nora.cd = 0;
    expect(legalActions(b, nora).some((a) => a.targetId === dead.id)).toBe(false);
  });

  it('после победы Целительница восстанавливает 5% самому раненому (Мягкое восстановление)', () => {
    const b = createBattle(party(1), enemies(['goblinRaider']), 7);
    const goblin = unitById(b, 'e1');
    const bran = hero(b, 'defender');
    bran.hp = 50;
    goblin.hp = 1;
    const ev = act(b, hero(b, 'shooter'), { kind: 'attack', targetId: goblin.id });
    expect(ev.find((e) => e.t === 'aftercare')).toMatchObject({ target: bran.id, amount: Math.round(bran.stats.maxHp * 0.05) });
  });

  it('нелегальные действия отклоняются', () => {
    const b = fresh(8);
    const actor = advance(b)!;
    expect(isLegal(b, { actorId: 'h999', kind: 'attack', targetId: 'e1' })).toBe(false);
    expect(isLegal(b, { actorId: actor.id, kind: 'attack', targetId: actor.id })).toBe(false);
    expect(() => applyAction(b, { actorId: actor.id, kind: 'attack', targetId: 'nope' })).toThrow();
  });

  it('Перо Феникса воскрешает первого павшего героя ровно один раз', () => {
    const b = createBattle(party(1), enemies(['goblinRaider']), 9, { phoenix: true });
    const goblin = unitById(b, 'e1');
    const nora = hero(b, 'healer');
    nora.hp = 1;
    const ev = act(b, goblin, { kind: 'attack', targetId: nora.id });
    expect(ev.some((e) => e.t === 'phoenix')).toBe(true);
    expect(nora.alive).toBe(true);
    nora.hp = 1;
    act(b, goblin, { kind: 'attack', targetId: nora.id });
    expect(nora.alive).toBe(false);
  });

  it('«ручной» игрок с первым легальным действием тоже доводит бой до конца', () => {
    const b = fresh(10);
    for (let i = 0; i < 2000; i++) {
      const actor = advance(b);
      if (!actor) break;
      applyAction(b, actor.side === 'hero' ? legalActions(b, actor)[0]! : autoAction(b, actor));
    }
    expect(b.result).not.toBe('ongoing');
  });

  it('высокий уровень героев решает исход против босса', () => {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const b = createBattle(party(14, ['bran', 'rook', 'nora']), enemies(['boneKing'], 1), seed);
      if (runAuto(b) === 'victory') wins += 1;
    }
    expect(wins).toBeGreaterThanOrEqual(27);
  });
});

function applyActionAs(b: Battle, actor: Unit, action: Parameters<typeof applyAction>[1]) {
  b.current = actor.id;
  return applyAction(b, action);
}
