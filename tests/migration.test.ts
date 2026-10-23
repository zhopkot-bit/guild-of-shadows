import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, deserialize, serialize } from '../src/core/save';
import { newGame } from '../src/core/state';
import { availableNodes, deserializeRun, enterNode, finishRun, serializeRun, startRun } from '../src/expedition/run';
import { advance, applyAction } from '../src/combat/battle';
import { autoAction, runAuto } from '../src/combat/ai';
import { RNG } from '../src/core/rng';

const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);

/** Сейв v1.4 в точности того формата, который писала прежняя версия (роли warrior/mage/rogue/priest). */
function legacySave(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    createdAt: T0 - 86_400_000,
    lastSeen: T0 - 3_600_000,
    gold: 4321,
    essence: 12,
    posts: { barracks: 14, forge: 3, library: 0, tavern: 0, alchemy: 0 },
    relicarium: 1,
    heroes: [
      { id: 'h1', name: 'Бран', cls: 'warrior', rarity: 'common', level: 7, status: 'ready', woundedUntil: 0, portrait: 2 },
      { id: 'h2', name: 'Мира', cls: 'mage', rarity: 'common', level: 6, status: 'wounded', woundedUntil: T0 + 60_000, portrait: 1 },
      { id: 'h3', name: 'Рук', cls: 'rogue', rarity: 'common', level: 5, status: 'ready', woundedUntil: 0, portrait: 3 },
      { id: 'h4', name: 'Нора', cls: 'priest', rarity: 'common', level: 8, status: 'ready', woundedUntil: 0, portrait: 1 },
      { id: 'h5', name: 'Ясна', cls: 'mage', rarity: 'rare', level: 4, status: 'ready', woundedUntil: 0, portrait: 2 },
    ],
    party: ['h1', 'h3', 'h4'],
    nextHeroId: 6,
    recruitsBought: 1,
    tickets: { count: 3, updatedAt: T0, rewardedToday: 0, rewardedDay: '2026-10-23' },
    expeditionsCompleted: 5,
    seedCounter: 17,
    maxTier: 2,
    stats: { expeditionsStarted: 6, expeditionsWon: 4, heroesLost: 0 },
    activeRun: null,
    ...extra,
  };
}

describe('миграция сохранений v1 → v2', () => {
  it('текущая версия схемы — 2', () => {
    expect(SAVE_VERSION).toBe(2);
  });

  it('канонические герои получают личность и роль по Content Bible; прогресс сохраняется', () => {
    const r = deserialize(JSON.stringify(legacySave()), T0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const by = Object.fromEntries(r.state.heroes.map((h) => [h.id, h]));
    expect(by.h1).toMatchObject({ name: 'Бран', identity: 'bran', cls: 'defender', level: 7 });
    expect(by.h2).toMatchObject({ name: 'Мира', identity: 'mira', cls: 'scout', level: 6, status: 'wounded' });
    expect(by.h3).toMatchObject({ name: 'Рук', identity: 'rook', cls: 'shooter', level: 5 });
    expect(by.h4).toMatchObject({ name: 'Нора', identity: 'nora', cls: 'healer', level: 8 });
    // Новобранец не получает чужого лица: identity = null, роль по таблице совместимости.
    expect(by.h5).toMatchObject({ name: 'Ясна', identity: null, cls: 'shooter', level: 4 });
    expect(r.state.gold).toBe(4321);
    expect(r.state.essence).toBe(12);
    expect(r.state.posts.barracks).toBe(14);
    expect(r.state.party).toEqual(['h1', 'h3', 'h4']);
    expect(r.state.version).toBe(2);
  });

  it('повторная загрузка мигрированного сейва ничего не меняет (идемпотентность)', () => {
    const r1 = deserialize(JSON.stringify(legacySave()), T0);
    if (!r1.ok) throw new Error('load');
    const r2 = deserialize(serialize(r1.state), T0);
    expect(r2.ok && r2.state).toEqual(r1.state);
  });

  it('активный бой v1 продолжается после миграции: роли, умения и враги переведены', () => {
    const fresh = newGame(T0);
    const run = startRun(fresh, T0, 1);
    // Собираем «бой v1» руками в старом формате JSON.
    const legacyRun = {
      seed: 99,
      tier: 1,
      rng: { __gosRngState: new RNG(5).snapshot() },
      map: run.map,
      currentNodeId: run.map[0]!.id,
      visited: [run.map[0]!.id],
      heroes: {
        h1: { id: 'h1', name: 'Бран', cls: 'warrior', rarity: 'common', level: 3, status: 'ready', woundedUntil: 0, portrait: 1 },
        h3: { id: 'h3', name: 'Рук', cls: 'rogue', rarity: 'common', level: 3, status: 'ready', woundedUntil: 0, portrait: 1 },
        h4: { id: 'h4', name: 'Нора', cls: 'priest', rarity: 'common', level: 3, status: 'ready', woundedUntil: 0, portrait: 1 },
      },
      members: [{ heroId: 'h1', frac: 1, alive: true }, { heroId: 'h3', frac: 0.6, alive: true }, { heroId: 'h4', frac: 1, alive: true }],
      relics: [], atkBuff: 0, postBonus: { hpPct: 0, atkPct: 0, campHeal: 0 }, essenceEarned: 2,
      stage: 'battle', battleKind: 'boss', phoenixLeft: false, event: null, eventsSeen: [], eventResult: null,
      pendingAmbush: false, pendingRecruits: 0, chestOffers: null, safe: false, enemyMult: 1, fallen: [],
      nodesCleared: 4, elitesCleared: 0, reviveLeft: 1, result: null, finished: false, summary: null,
      battle: {
        units: [
          { id: 'h1', name: 'Бран', side: 'hero', kind: 'warrior', stats: { maxHp: 200, atk: 18, def: 9, spd: 8 }, hp: 150, cd: 3, skill: { id: 'powerStrike', name: 'Мощный удар', cooldown: 3, target: 'enemy', mult: 2 }, alive: true, heroId: 'h1' },
          { id: 'h3', name: 'Рук', side: 'hero', kind: 'rogue', stats: { maxHp: 140, atk: 22, def: 6, spd: 14 }, hp: 90, cd: 1, skill: null, alive: true, heroId: 'h3' },
          { id: 'h4', name: 'Нора', side: 'hero', kind: 'priest', stats: { maxHp: 150, atk: 12, def: 6, spd: 9 }, hp: 150, cd: 0, skill: null, alive: true, heroId: 'h4' },
          { id: 'e1', name: 'Страж гробницы', side: 'enemy', kind: 'guardian', stats: { maxHp: 600, atk: 24, def: 12, spd: 8 }, hp: 280, cd: 1, skill: { id: 'groundSlam', name: 'Удар по площади', cooldown: 3, target: 'allEnemies', mult: 0.7 }, alive: true, boss: true },
          { id: 'e2', name: 'Гоблин-лучник', side: 'enemy', kind: 'goblin', stats: { maxHp: 60, atk: 14, def: 2, spd: 13 }, hp: 0, cd: 1, skill: null, alive: false },
        ],
        round: 3, queue: ['h4', 'e1'], current: 'h1',
        rng: { __gosRngState: new RNG(7).snapshot() },
        log: [], result: 'ongoing', mods: { skillDamageMult: 1, phoenix: false },
      },
    };
    const save = legacySave({ activeRun: JSON.stringify(legacyRun) });
    const r = deserialize(JSON.stringify(save), T0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const migrated = deserializeRun(r.state.activeRun);
    expect(migrated).not.toBeNull();
    const b = migrated!.battle!;
    const units = Object.fromEntries(b.units.map((u) => [u.id, u]));
    expect(units.h1).toMatchObject({ kind: 'defender', identity: 'bran', hp: 150 });
    expect(units.h1!.skill?.id).toBe('cover');
    expect(units.h3).toMatchObject({ kind: 'shooter', identity: 'rook', hp: 90 });
    expect(units.h3!.skill?.id).toBe('aimedShot');
    expect(units.h4!.skill?.id).toBe('healingLight');
    expect(units.e1).toMatchObject({ kind: 'boneKing', boss: true, hp: 280 });
    expect(units.e2).toMatchObject({ kind: 'goblinRaider', alive: false });
    expect(migrated!.heroes.h1).toMatchObject({ identity: 'bran', cls: 'defender' });
    // Бой продолжается с того же места и завершается без ошибок; фаза II восстанавливается (280/600 < 50%).
    expect(b.current).toBe('h1');
    advance(b);
    expect(units.e1!.bossPhase).toBe(2);
    expect(['victory', 'defeat']).toContain(runAuto(b));
  });
});

describe('награды не выдаются повторно', () => {
  it('итоги забега применяются один раз, даже после сериализации и повторного вызова', () => {
    const s = newGame(T0);
    for (const h of s.heroes) h.level = 15;
    s.posts.barracks = 30;
    const run = startRun(s, T0, 1);
    run.stage = 'ended';
    run.result = 'victory';
    run.goldEarned = 30;
    const first = finishRun(run, s, T0);
    const gold = s.gold;
    const essence = s.essence;
    const restored = deserializeRun(serializeRun(run))!;
    const again = finishRun(restored, s, T0);
    expect(again).toEqual(first);
    expect(s.gold).toBe(gold);
    expect(s.essence).toBe(essence);
    expect(first.gold).toBeGreaterThanOrEqual(30);
  });

  it('флаг удвоения золота за рекламу переживает перезагрузку', () => {
    const s = newGame(T0);
    const run = startRun(s, T0, 1);
    run.stage = 'ended';
    run.result = 'defeat';
    const sum = finishRun(run, s, T0);
    sum.doubled = true;
    const restored = deserializeRun(serializeRun(run))!;
    expect(finishRun(restored, s, T0).doubled).toBe(true);
  });

  it('сохранение после каждого действия боя восстанавливает тот же бой (RNG, очередь, телеграфы)', () => {
    for (const tier of [1, 2]) {
      const s2 = newGame(T0);
      s2.maxTier = 2;
      const r2 = startRun(s2, T0, tier);
      enterNode(r2, (availableNodes(r2).find((n) => n.type === 'battle') ?? availableNodes(r2)[0])!.id);
      expect(r2.battle).not.toBeNull();
      for (let i = 0; i < 6; i++) {
        const actor = advance(r2.battle!);
        if (!actor) break;
        applyAction(r2.battle!, autoAction(r2.battle!, actor));
      }
      const copy = deserializeRun(serializeRun(r2))!;
      runAuto(r2.battle!);
      runAuto(copy.battle!);
      expect(copy.battle!.log).toEqual(r2.battle!.log);
    }
  });
});
