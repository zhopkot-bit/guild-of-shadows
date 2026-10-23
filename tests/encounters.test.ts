import { describe, expect, it } from 'vitest';
import { newGame } from '../src/core/state';
import { EVENTS } from '../src/expedition/events';
import { availableNodes, chooseBossPrep, chooseEventOption, enterNode, eventChoices, startRun, type Run } from '../src/expedition/run';
import { generateMap } from '../src/expedition/map';

const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);

function runWith(seedBump: number, tier = 1): Run {
  const s = newGame(T0);
  s.expeditionsCompleted = 5;
  s.seedCounter = seedBump;
  s.maxTier = 3;
  return startRun(s, T0, tier);
}

function forceNode(run: Run, type: 'battle' | 'elite' | 'boss' | 'event', layer: number): void {
  const node = run.map.find((n) => n.layer === layer) ?? run.map[0]!;
  node.type = type;
  run.currentNodeId = null;
  run.stage = 'map';
  // Узел становится доступным, как если бы отряд пришёл к нему по карте.
  run.map.filter((n) => n.layer === layer - 1).forEach((n) => (n.next = [node.id]));
  if (layer > 1) run.currentNodeId = run.map.find((n) => n.layer === layer - 1)!.id;
  enterNode(run, node.id);
}

describe('составы встреч (Combat Spec v0.3)', () => {
  it('бой с боссом — только Костяной король, без прислужников', () => {
    for (let i = 0; i < 20; i++) {
      const run = runWith(i);
      forceNode(run, 'boss', 7);
      expect(run.stage).toBe('prep');
      chooseBossPrep(run, i % 2 ? 'heal' : 'ward');
      expect(run.battle!.units.filter((u) => u.side === 'enemy').map((u) => u.kind)).toEqual(['boneKing']);
    }
  });

  it('обычные бои: слои 1–2 — 2 врага; не больше одного волка и одного врага с телеграфом', () => {
    for (let i = 0; i < 200; i++) {
      const layer = 1 + (i % 6);
      const run = runWith(i, 1 + (i % 3));
      forceNode(run, 'battle', layer);
      const kinds = run.battle!.units.filter((u) => u.side === 'enemy').map((u) => u.kind);
      if (layer <= 2) expect(kinds).toHaveLength(2);
      else expect(kinds.length).toBeGreaterThanOrEqual(2);
      expect(kinds.length).toBeLessThanOrEqual(3);
      expect(kinds.filter((k) => k === 'ashWolf').length).toBeLessThanOrEqual(1);
      expect(kinds.filter((k) => k === 'boneGuard' || k === 'ashMage').length).toBeLessThanOrEqual(1);
      if (layer === 1) expect(kinds.every((k) => k === 'goblinRaider')).toBe(true);
    }
  });

  it('элита — усиленный Костяной страж (HP ×1.35, ATK ×1.15) и один обычный противник', () => {
    const run = runWith(3);
    forceNode(run, 'elite', 4);
    const foes = run.battle!.units.filter((u) => u.side === 'enemy');
    expect(foes).toHaveLength(2);
    expect(foes[0]).toMatchObject({ kind: 'boneGuard', elite: true });
    expect(foes[1]!.kind).not.toBe('boneGuard');
  });
});

describe('события Content Bible', () => {
  it('шесть событий EV01–EV06 без реальной оккультной тематики', () => {
    expect(EVENTS.map((e) => e.id)).toEqual(['EV01', 'EV02', 'EV03', 'EV04', 'EV05', 'EV06']);
    const text = JSON.stringify(EVENTS).toLowerCase();
    for (const banned of ['кров', 'молит', 'жертв', 'гадан', 'привор']) expect(text).not.toContain(banned);
  });

  it('варианты разведки доступны только с Мирой в отряде', () => {
    const run = runWith(1);
    // Стартовый отряд — Бран, Рук, Нора (без Миры).
    run.stage = 'event';
    run.event = EVENTS[0]!;
    const choices = eventChoices(run);
    expect(choices.find((c) => c.choice.id === 'A')!.available).toBe(false);
    expect(() => chooseEventOption(run, 'A')).toThrow();
    chooseEventOption(run, 'B');
    expect(run.goldEarned).toBe(20);
  });

  it('урон событий не выводит героя из строя (минимум 1 HP)', () => {
    const run = runWith(2);
    for (const m of run.members) m.frac = 0.01;
    run.stage = 'event';
    run.event = EVENTS[3]!;
    chooseEventOption(run, 'B');
    expect(run.members.every((m) => m.alive && m.frac > 0)).toBe(true);
  });

  it('карта по-прежнему без тупиков (регрессия)', () => {
    for (let seed = 1; seed < 50; seed++) {
      const map = generateMap(seed);
      expect(map.filter((n) => n.type === 'boss')).toHaveLength(1);
    }
    expect(availableNodes(runWith(9)).length).toBeGreaterThan(0);
  });
});
