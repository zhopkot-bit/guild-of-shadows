import { describe, expect, it } from 'vitest';
import { autoPlayRun } from '../src/expedition/autoplay';
import {
  availableNodes,
  canRevive,
  canStartRun,
  enterNode,
  finishRun,
  reviveFallen,
  startRun,
  serializeRun,
  deserializeRun,
} from '../src/expedition/run';
import { FIRST_RUN_SEED, HERO_LEVEL_CAPS, MAX_TICKETS, SAFE_EXPEDITIONS, TUTORIAL_ENEMY_SCALE } from '../src/core/config';
import { heroLevelCap, postEffect, upgradeHero } from '../src/core/economy';
import { newGame } from '../src/core/state';
import type { GameState } from '../src/core/types';

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);

function strongGame(): GameState {
  const s = newGame(T0);
  s.tickets.count = 99;
  for (const h of s.heroes) h.level = 15;
  s.posts.barracks = 30;
  s.posts.forge = 10;
  return s;
}

describe('запуск забега', () => {
  it('не расходует жетоны, считает старт и первый забег идёт на фиксированной карте', () => {
    const s = newGame(T0);
    const run = startRun(s, T0, 1);
    expect(s.tickets.count).toBe(MAX_TICKETS);
    expect(s.stats.expeditionsStarted).toBe(1);
    expect(run.seed).toBe(FIRST_RUN_SEED);
    expect(run.safe).toBe(true);
    expect(run.members).toHaveLength(3);
  });

  it('жетоны не блокируют запуск; закрытое подземелье и неполный отряд блокируют', () => {
    const s = newGame(T0);
    s.tickets.count = 0;
    expect(canStartRun(s, T0, 1).ok).toBe(true);
    s.tickets.count = 3;
    expect(canStartRun(s, T0, 2).ok).toBe(false); // подземелье 2 закрыто
    s.heroes[0]!.status = 'wounded';
    s.heroes[0]!.woundedUntil = T0 + 1e9;
    expect(canStartRun(s, T0, 1).ok).toBe(false); // раненый в отряде
    expect(() => startRun(s, T0, 1)).toThrow();
  });

  it('раненый герой возвращается в строй по таймеру', () => {
    const s = newGame(T0);
    const h = s.heroes[0]!;
    h.status = 'wounded';
    h.woundedUntil = T0 + 1000;
    expect(canStartRun(s, T0 + 999, 1).ok).toBe(false);
    expect(canStartRun(s, T0 + 1000, 1).ok).toBe(true);
  });
});

describe('прохождение', () => {
  it('бот проходит забег до конца и итоги применяются один раз', () => {
    const s = strongGame();
    const goldBefore = s.gold;
    const run = startRun(s, T0, 1);
    autoPlayRun(run);
    expect(run.stage).toBe('ended');
    const summary = finishRun(run, s, T0);
    expect(summary.essence).toBeGreaterThan(0);
    expect(s.gold).toBeGreaterThan(goldBefore);
    expect(s.expeditionsCompleted).toBe(1);
    const goldAfter = s.gold;
    expect(finishRun(run, s, T0)).toEqual(summary);
    expect(s.gold).toBe(goldAfter); // повторный вызов не начисляет награды второй раз
  });

  it('первый забег воспроизводим: тот же сид и тот же выбор дают тот же итог', () => {
    const play = () => {
      const s = newGame(T0);
      const run = startRun(s, T0, 1);
      autoPlayRun(run);
      return { visited: run.visited, result: run.result, relics: run.relics, essence: run.essenceEarned };
    };
    expect(play()).toEqual(play());
  });

  it('на 200 забегах бот никогда не зависает и не нарушает инвариантов', () => {
    let wins = 0;
    for (let i = 0; i < 200; i++) {
      const s = strongGame();
      s.createdAt = 1000 + i * 7919;
      s.expeditionsCompleted = SAFE_EXPEDITIONS; // обычный режим, не обучающий
      const run = startRun(s, T0, 1);
      autoPlayRun(run);
      const summary = finishRun(run, s, T0);
      if (summary.result === 'victory') wins++;
      // инварианты
      for (const h of s.heroes) expect(['ready', 'wounded', 'lost']).toContain(h.status);
      for (const id of s.party) expect(s.heroes.find((h) => h.id === id)!.status).not.toBe('lost');
      expect(summary.survivors.length + summary.lost.length).toBeLessThanOrEqual(3);
      for (const m of run.members) expect(m.frac).toBeGreaterThanOrEqual(0);
    }
    expect(wins).toBeGreaterThan(0);
  });

  it('карта идёт от слоя 1 к боссу, переход на недоступный узел запрещён', () => {
    const s = newGame(T0);
    const run = startRun(s, T0, 1);
    const start = availableNodes(run);
    expect(start.every((n) => n.layer === 1)).toBe(true);
    const bossId = run.map.find((n) => n.type === 'boss')!.id;
    expect(() => enterNode(run, bossId)).toThrow();
  });
});

describe('судьба павших', () => {
  function endedRunWithFallen(s: GameState, safe: boolean) {
    const run = startRun(s, T0, 1);
    run.safe = safe;
    run.stage = 'ended';
    run.result = 'defeat';
    for (const m of run.members) {
      m.alive = false;
      m.frac = 0;
    }
    run.fallen = run.members.map((m) => m.heroId);
    return run;
  }

  it('в первых забегах павшие ничего не теряют', () => {
    const s = newGame(T0);
    const run = endedRunWithFallen(s, true);
    const summary = finishRun(run, s, T0);
    expect(summary.lost).toHaveLength(0);
    expect(s.heroes.every((h) => h.status === 'ready')).toBe(true);
  });

  it('после безопасных первых забегов павшие получают временную травму, но не теряются навсегда', () => {
    for (let i = 0; i < 20; i++) {
      const s = newGame(T0);
      s.expeditionsCompleted = SAFE_EXPEDITIONS;
      const run = endedRunWithFallen(s, false);
      const summary = finishRun(run, s, T0);
      expect(summary.lost).toHaveLength(0);
      expect(summary.survivors).toHaveLength(3);
      for (const h of summary.survivors) {
        expect(h.status).toBe('wounded');
        expect(h.woundedUntil).toBeGreaterThan(T0);
        expect(s.heroes).toContainEqual(expect.objectContaining({ id: h.id }));
      }
      expect(s.party).toHaveLength(3);
    }
  });

  it('сохранение и восстановление активного забега сохраняет RNG и фазу игры', () => {
    const s = newGame(T0);
    const run = startRun(s, T0, 1);
    const restored = deserializeRun(serializeRun(run));
    expect(restored).not.toBeNull();
    expect(restored!.stage).toBe(run.stage);
    expect(restored!.map).toEqual(run.map);
    expect(restored!.rng.next()).toBe(run.rng.next());
    const battleNode = availableNodes(run).find((node) => node.type === 'battle')!;
    enterNode(run, battleNode.id);
    // Проверяем и новые поля фазы босса: они сохраняются вместе с остальным снимком боя.
    const persistedEnemy = run.battle!.units.find((u) => u.side === 'enemy')!;
    persistedEnemy.boss = true;
    persistedEnemy.bossPhase = 2;
    persistedEnemy.name = 'Страж гробницы — пробуждённый';
    const restoredBattle = deserializeRun(serializeRun(run));
    expect(restoredBattle?.battle?.rng).toBeDefined();
    expect(restoredBattle?.battle?.rng.next()).toBe(run.battle!.rng.next());
    const restoredBoss = restoredBattle?.battle?.units.find((u) => u.id === persistedEnemy.id);
    expect(restoredBoss?.bossPhase).toBe(2);
    expect(restoredBoss?.name).toContain('пробуждённый');
  });

  it('Библиотека усиливает HP отряда вместо устаревшего шанса избежать гибели', () => {
    const s = newGame(T0);
    const base = postEffect(s, 'hpPct');
    s.posts.library = 20;
    expect(postEffect(s, 'hpPct')).toBeGreaterThan(base);
  });

  it('воскрешение за рекламу срабатывает один раз и снимает с героя бросок судьбы', () => {
    const s = newGame(T0);
    const run = startRun(s, T0, 1);
    expect(canRevive(run)).toBe(false); // некого воскрешать
    const dead = run.members[0]!;
    dead.alive = false;
    dead.frac = 0;
    run.fallen = [dead.heroId];
    expect(canRevive(run)).toBe(true);
    expect(reviveFallen(run)).not.toBeNull();
    expect(dead.alive).toBe(true);
    expect(dead.frac).toBe(0.3);
    expect(run.fallen).not.toContain(dead.heroId);
    dead.alive = false;
    expect(canRevive(run)).toBe(false); // лимит исчерпан
  });
});

describe('обучение и прогрессия', () => {
  it('первые забеги идут со слабыми врагами, затем обычная сила', () => {
    const s = newGame(T0);
    s.tickets.count = 99;
    const seen: number[] = [];
    for (let k = 0; k < SAFE_EXPEDITIONS + 1; k++) {
      s.expeditionsCompleted = k;
      seen.push(startRun(s, T0, 1).enemyMult);
    }
    expect(seen).toEqual([...TUTORIAL_ENEMY_SCALE, 1]);
  });

  it('уровень героев упирается в потолок, который растёт после победы в глубоком подземелье', () => {
    const s = newGame(T0);
    s.gold = 1e15;
    const hero = s.heroes[0]!;
    expect(heroLevelCap(s)).toBe(HERO_LEVEL_CAPS[0]);
    while (upgradeHero(s, hero.id)) {
      /* качаем до потолка */
    }
    expect(hero.level).toBe(HERO_LEVEL_CAPS[0]);

    // победа в подземелье 1 открывает подземелье 2 и поднимает потолок
    s.tickets.count = 99;
    for (const h of s.heroes) h.level = 8;
    let unlocked = false;
    for (let i = 0; i < 50 && !unlocked; i++) {
      s.createdAt = 77 + i * 31;
      s.expeditionsCompleted = SAFE_EXPEDITIONS;
      const run = startRun(s, T0, 1);
      autoPlayRun(run);
      unlocked = finishRun(run, s, T0).unlockedTier === 2;
      for (const h of s.heroes) h.status = 'ready';
    }
    expect(unlocked).toBe(true);
    expect(s.maxTier).toBe(2);
    expect(heroLevelCap(s)).toBe(HERO_LEVEL_CAPS[1]);
  });
});
