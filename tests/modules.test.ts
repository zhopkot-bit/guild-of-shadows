import { describe, expect, it } from 'vitest';
import { INTENTS } from '../src/combat/ai';
import { advance, applyAction, createBattle, turnOrder, unitById } from '../src/combat/battle';
import { NO_BONUS, enemyUnit, heroUnit } from '../src/combat/data';
import type { Battle, Unit } from '../src/combat/types';
import { deserialize, serialize } from '../src/core/save';
import { newGame } from '../src/core/state';
import { MODULES, moduleEffects, normalizeModules } from '../src/expedition/modules';
import {
  BOSS_PREP_HEAL,
  chooseBossPrep,
  chooseCamp,
  deserializeRun,
  encounterPreview,
  enterNode,
  finishBattle,
  memberStats,
  serializeRun,
  startRun,
  type Run,
} from '../src/expedition/run';
import { HP_SCALE } from '../src/core/config';

const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);

function party(): Unit[] {
  return newGame(1).heroes.map((h) => heroUnit(h, NO_BONUS));
}
function shooter(b: Battle): Unit {
  return b.units.find((u) => u.kind === 'shooter') as Unit;
}
function act(b: Battle, actor: Unit, a: Omit<Parameters<typeof applyAction>[1], 'actorId'>) {
  b.current = actor.id;
  return applyAction(b, { actorId: actor.id, ...a });
}
function freshRun(): Run {
  const s = newGame(T0);
  s.expeditionsCompleted = 5;
  return startRun(s, T0, 1);
}

describe('модули экспедиции MOD01–MOD08', () => {
  it('восемь модулей Content Bible с уникальными id', () => {
    expect(MODULES.map((m) => m.contentId)).toEqual(['MOD01', 'MOD02', 'MOD03', 'MOD04', 'MOD05', 'MOD06', 'MOD07', 'MOD08']);
  });

  it('MOD01 Кольчуга хранителя: +12% maxHP отряда в забеге', () => {
    const run = freshRun();
    const before = memberStats(run, run.members[0]!).maxHp;
    run.relics.push('guardianMail');
    expect(memberStats(run, run.members[0]!).maxHp).toBe(Math.round(before * 1.12));
  });

  it('MOD02 Око ястреба: обычная атака Стрелка сильнее на 15%, у других — без изменений', () => {
    let more = 0;
    for (let seed = 1; seed < 30; seed++) {
      const a = createBattle(party(), [enemyUnit('boneGuard', 'e1', { tier: 1, ramp: 0 })], seed);
      const b = createBattle(party(), [enemyUnit('boneGuard', 'e1', { tier: 1, ramp: 0 })], seed, { shooterBasicBonus: 0.15 });
      act(a, shooter(a), { kind: 'attack', targetId: 'e1' });
      act(b, shooter(b), { kind: 'attack', targetId: 'e1' });
      if (unitById(b, 'e1').hp < unitById(a, 'e1').hp) more++;
    }
    expect(more).toBeGreaterThan(25);
  });

  it('MOD03 Пробивная стрела: срабатывает один раз за бой на первой атаке Стрелка', () => {
    const b = createBattle(party(), [enemyUnit('boneGuard', 'e1', { tier: 1, ramp: 0 })], 3, { pierceLeft: 0.3 });
    const first = act(b, shooter(b), { kind: 'attack', targetId: 'e1' }).find((e) => e.t === 'hit');
    expect(first && first.t === 'hit' && first.pierced).toBe(true);
    const second = act(b, shooter(b), { kind: 'attack', targetId: 'e1' }).find((e) => e.t === 'hit');
    expect(second && second.t === 'hit' && second.pierced).toBeFalsy();
  });

  it('MOD04 Щит хранителя: первый удар по отряду −8, затем заряд расходуется', () => {
    const b = createBattle(party(), [enemyUnit('goblinRaider', 'e1', { tier: 1, ramp: 0 })], 4, { wardenLeft: 8 });
    const g = unitById(b, 'e1');
    const hero = b.units[0]!;
    const e1 = act(b, g, { kind: 'attack', targetId: hero.id }).find((e) => e.t === 'hit');
    expect(e1 && e1.t === 'hit' && e1.warden).toBe(true);
    expect(b.mods.wardenLeft).toBe(0);
    const e2 = act(b, g, { kind: 'attack', targetId: hero.id }).find((e) => e.t === 'hit');
    expect(e2 && e2.t === 'hit' && e2.warden).toBeFalsy();
  });

  it('MOD05 Зелье восстановления: отдых в лагере лечит дополнительно 15 HP (× HP_SCALE)', () => {
    const a = freshRun();
    const b = freshRun();
    for (const r of [a, b]) {
      for (const m of r.members) m.frac = 0.2;
      r.stage = 'camp';
    }
    b.relics.push('healingPotion');
    chooseCamp(a, 'rest');
    chooseCamp(b, 'rest');
    const max = memberStats(b, b.members[0]!).maxHp;
    const diff = Math.round((b.members[0]!.frac - a.members[0]!.frac) * max);
    expect(Math.abs(diff - Math.round(15 * HP_SCALE))).toBeLessThanOrEqual(1);
  });

  it('MOD06 Карта следопыта: превью состава совпадает с реальным боем узла', () => {
    for (let i = 0; i < 30; i++) {
      const s = newGame(T0);
      s.expeditionsCompleted = 5;
      s.seedCounter = i;
      const run = startRun(s, T0, 1);
      const node = run.map.find((n) => n.layer === 1)!;
      node.type = 'battle';
      const preview = encounterPreview(run, node);
      enterNode(run, node.id);
      expect(run.battle!.units.filter((u) => u.side === 'enemy').map((u) => u.kind)).toEqual(preview);
    }
  });

  it('MOD07 Перо быстрого шага: +1 СКР героям только в первом раунде', () => {
    // Гоблин (СКР 8) обычно ходит раньше Норы (СКР 7); с пером в 1-м раунде — наоборот, во 2-м — снова гоблин.
    const foes = () => [enemyUnit('goblinRaider', 'e1', { tier: 1, ramp: 0 })];
    const plain = createBattle(party(), foes(), 5);
    const swift = createBattle(party(), foes(), 5, { firstRoundSpd: 1 });
    advance(plain);
    advance(swift);
    const order = (b: Battle) => [b.current, ...b.queue].map((id) => unitById(b, id!).kind);
    expect(order(plain).indexOf('goblinRaider')).toBeLessThan(order(plain).indexOf('healer'));
    expect(order(swift).indexOf('healer')).toBeLessThan(order(swift).indexOf('goblinRaider'));
    const next = turnOrder(swift).next.map((id) => unitById(swift, id).kind);
    expect(next.indexOf('goblinRaider')).toBeLessThan(next.indexOf('healer'));
  });

  it('MOD08 Сумка собирателя: +1 осколок после первой элиты, один раз за забег', () => {
    const run = freshRun();
    run.relics.push('relicPouch');
    for (let i = 0; i < 2; i++) {
      run.battle = createBattle(party(), [], 1);
      run.battle.result = 'victory';
      run.battleKind = 'elite';
      run.stage = 'battle';
      finishBattle(run);
    }
    expect(run.essenceEarned).toBe(1);
  });

  it('реликвии старых сейвов переводятся в модули без дублей', () => {
    expect(normalizeModules(['guardShield', 'wolfFang', 'guardianMail', 'phoenixFeather', 'nope'])).toEqual(['guardianMail', 'hawkEye']);
    const run = freshRun();
    (run as unknown as { relics: string[] }).relics = ['fireRune', 'phoenixFeather'];
    run.chestOffers = [{ id: 'relic0', kind: 'relic', relic: 'lifeChalice' } as never];
    run.stage = 'chest';
    const back = deserializeRun(serializeRun(run))!;
    expect(back.relics).toEqual(['piercingArrow']);
    expect(back.phoenixLeft).toBe(true);
    expect(back.chestOffers![0]).toMatchObject({ kind: 'module', module: 'healingPotion' });
  });

  it('эффекты не стакаются: повтор модуля не удваивает бонус', () => {
    expect(moduleEffects(['guardianMail', 'guardianMail']).hpPct).toBeCloseTo(0.12);
  });
});

describe('подготовка к боссу', () => {
  function toPrep(): Run {
    const run = freshRun();
    const boss = run.map.find((n) => n.type === 'boss')!;
    run.map.filter((n) => n.layer === boss.layer - 1).forEach((n) => (n.next = [boss.id]));
    run.currentNodeId = run.map.find((n) => n.layer === boss.layer - 1)!.id;
    enterNode(run, boss.id);
    return run;
  }

  it('вход в узел босса открывает экран подготовки, бой начинается после выбора', () => {
    const run = toPrep();
    expect(run.stage).toBe('prep');
    expect(run.battle).toBeNull();
    chooseBossPrep(run, 'ward');
    expect(run.stage).toBe('battle');
    expect(run.battle!.mods.bossWard).toBe(0.5);
  });

  it('«Перевязать раны» лечит каждого на 30%', () => {
    const run = toPrep();
    for (const m of run.members) m.frac = 0.3;
    chooseBossPrep(run, 'heal');
    for (const m of run.members) expect(m.frac).toBeCloseTo(0.3 + BOSS_PREP_HEAL);
    expect(run.battle!.mods.bossWard ?? 0).toBe(0);
  });

  it('«Сомкнуть щиты» ослабляет только первую спецатаку короля', () => {
    const b = createBattle(party(), [enemyUnit('boneKing', 'e1', { tier: 1, ramp: 0 })], 6, { bossWard: 0.5 });
    const king = unitById(b, 'e1');
    const target = b.units[3]!;
    king.intent = { ...INTENTS.cleaver, targetId: target.id };
    const ev1 = act(b, king, { kind: 'release' });
    expect(ev1.some((e) => e.t === 'ward')).toBe(true);
    king.intent = { ...INTENTS.cleaver, targetId: target.id };
    const ev2 = act(b, king, { kind: 'release' });
    expect(ev2.some((e) => e.t === 'ward')).toBe(false);
  });

  it('подготовка переживает сохранение и загрузку', () => {
    const run = toPrep();
    const back = deserializeRun(serializeRun(run))!;
    expect(back.stage).toBe('prep');
  });
});

describe('профиль', () => {
  it('просмотренные подсказки сохраняются; старые сейвы получают пустой список', () => {
    const s = newGame(T0);
    s.tipsSeen.push('turn');
    const r = deserialize(serialize(s), T0);
    expect(r.ok && r.state.tipsSeen).toEqual(['turn']);
    const old = JSON.parse(serialize(newGame(T0)));
    delete old.tipsSeen;
    const r2 = deserialize(JSON.stringify(old), T0);
    expect(r2.ok && r2.state.tipsSeen).toEqual([]);
  });
});
