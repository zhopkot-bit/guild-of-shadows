import { describe, expect, it } from 'vitest';
import { runAuto } from '../src/combat/ai';
import { deserialize, serialize } from '../src/core/save';
import { newGame } from '../src/core/state';
import type { RescueRoute } from '../src/core/types';
import { autoPlayRun } from '../src/expedition/autoplay';
import { generateMap } from '../src/expedition/map';
import { moduleEffects, RESCUE_MODULE } from '../src/expedition/modules';
import {
  availableNodes, chooseEventOption, continueFromEvent, deserializeRun, enterNode,
  finishBattle, finishRun, serializeRun, startRun, type Run,
} from '../src/expedition/run';
import { resolveSave } from '../src/platform/save-resolution';

const now = 1000;
const story = { rescue: true };
function reload(run: Run): Run {
  const copy = deserializeRun(serializeRun(run));
  if (!copy) throw new Error('Active chapter failed to restore');
  return copy;
}

describe('Три удара', () => {
  it('на фиксированной карте сохраняет исходную развилку, на других меняет не более одного входа', () => {
    const state = newGame(now);
    expect(startRun(state, now, 1, story).map).toEqual(startRun(state, now, 1).map);
    state.expeditionsCompleted = 5;
    let repaired = 0;
    for (let i = 0; i < 64; i++) {
      const run = startRun(state, now, 1, story);
      const original = generateMap(run.seed);
      expect(new Set(availableNodes(run).map(n => n.type))).toEqual(new Set(['battle', 'event']));
      const changed = run.map.filter((node, index) => node.type !== original[index]!.type);
      expect(changed.length).toBeLessThanOrEqual(1);
      if (changed.length) {
        expect(changed[0]!.layer).toBe(1);
        repaired++;
      }
      expect(run.map.map(({ id, next }) => ({ id, next }))).toEqual(original.map(({ id, next }) => ({ id, next })));
    }
    expect(repaired).toBeGreaterThan(0);
  });

  it.each(['stairs', 'winch'] as const)('путь %s переживает перезагрузку, отход и повторный спуск', (route: RescueRoute) => {
    const state = newGame(now);
    for (const hero of state.heroes) hero.level = 15;
    let first = startRun(state, now, 1, story);
    const node = availableNodes(first).find(n => n.type === (route === 'stairs' ? 'battle' : 'event'))!;
    enterNode(first, node.id);
    expect(reload(first).rescue).toEqual({ stage: 'search' });
    if (route === 'stairs') {
      expect(runAuto(first.battle!)).toBe('victory');
      finishBattle(first);
    } else {
      expect(first.event?.id).toBe('EV06');
      chooseEventOption(first, 'B');
      expect(first.essenceEarned).toBe(3);
      first = reload(first);
      expect(first.rescue).toEqual({ stage: 'search' });
      continueFromEvent(first);
    }
    first = reload(first);
    expect(first.rescue).toEqual({ stage: 'search', outcome: route });
    expect(state.rescue).toEqual({ stage: 'search' });
    if (route === 'stairs') {
      autoPlayRun(first);
      expect(first.result).toBe('victory');
    } else {
      first.stage = 'ended';
      first.result = 'defeat';
    }
    const summary = finishRun(first, state, now);
    expect(state.rescue).toEqual({ stage: 'trail', route });
    const paid = serialize(state);
    expect(finishRun(reload(first), state, now)).toEqual(summary);
    expect(serialize(state)).toBe(paid);
    const restored = deserialize(paid, now);
    if (!restored.ok) throw new Error('Guild save failed to restore');

    const attempt = startRun(restored.state, now, 1, story);
    expect(reload(attempt).rescue).toEqual({ stage: 'trail', route });
    expect(attempt.relics).toEqual([RESCUE_MODULE[route]]);
    expect(moduleEffects(attempt.relics)).toMatchObject(route === 'stairs' ? { wardenFlat: 8 } : { revealEncounters: true });
    attempt.stage = 'ended';
    attempt.result = 'defeat';
    finishRun(attempt, restored.state, now);
    expect(restored.state.rescue).toEqual({ stage: 'trail', route });
    const final = startRun(restored.state, now, 1, story);
    expect(final.relics).toEqual([RESCUE_MODULE[route]]);
    autoPlayRun(final);
    expect(finishRun(final, restored.state, now).result).toBe('victory');
    expect(restored.state.rescue).toEqual({ stage: 'home', route });
    const next = startRun(restored.state, now, 1, story);
    expect(next.rescue).toBeUndefined();
    expect(next.relics).toEqual([]);
  });

  it('поражение в первом бою не выдаёт след; подложенный исход незавершённого узла отбрасывается', () => {
    const state = newGame(now);
    const run = startRun(state, now, 1, story);
    enterNode(run, availableNodes(run).find(n => n.type === 'battle')!.id);
    expect(deserializeRun(JSON.stringify({ ...JSON.parse(serializeRun(run)), rescue: { stage: 'search', outcome: 'stairs' } }))).toBeNull();
    for (const unit of run.battle!.units) if (unit.side === 'hero') { unit.hp = 0; unit.alive = false; }
    run.battle!.result = 'defeat';
    run.battle!.current = null;
    finishBattle(run);
    finishRun(reload(run), state, now);
    expect(state.rescue).toEqual({ stage: 'search' });
  });

  it('v2 сохраняет прежний активный поход и прогресс; сюжет начинается только со следующего выхода', () => {
    const state = newGame(now);
    for (const hero of state.heroes) hero.level = 15;
    state.stats.expeditionsWon = 4;
    state.expeditionsCompleted = 6;
    state.maxTier = 2;
    const old = startRun(state, now, 1);
    const legacy: Record<string, unknown> = { ...state, version: 2, activeRun: serializeRun(old) };
    delete legacy.rescue;
    const loaded = deserialize(JSON.stringify(legacy), now);
    if (!loaded.ok) throw new Error('v2 load failed');
    expect(loaded.state).toMatchObject({ version: 3, stats: { expeditionsWon: 4 }, maxTier: 2, rescue: { stage: 'search' }, activeRun: legacy.activeRun });
    const active = deserializeRun(loaded.state.activeRun)!;
    expect(active.rescue).toBeUndefined();
    autoPlayRun(active);
    finishRun(active, loaded.state, now);
    expect(loaded.state.rescue).toEqual({ stage: 'search' });
    expect(startRun(loaded.state, now, 1, story).rescue).toEqual({ stage: 'search' });
  });

  it('разрешает конфликт облака и устройства с учётом главы и защищает сохранение будущей версии', () => {
    const state = newGame(now);
    const initial = serialize(state);
    state.rescue = { stage: 'trail', route: 'stairs' };
    const trail = serialize(state);
    state.rescue = { stage: 'home', route: 'stairs' };
    const home = serialize(state);
    expect(resolveSave(initial, trail)).toBe(trail);
    expect(resolveSave(trail, home)).toBe(home);
    expect(resolveSave(JSON.stringify({ ...state, version: 2, lastSeen: now + 1 }), home)).toBe(home);
    const future = JSON.stringify({ ...state, version: 4 });
    expect(resolveSave(home, future)).toBe(future);
    expect(deserialize(future, now)).toEqual({ ok: false, reason: 'newer' });
  });
});
