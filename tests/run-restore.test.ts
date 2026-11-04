import { describe, expect, it, vi } from 'vitest';
import { newGame } from '../src/core/state';
import { serialize } from '../src/core/save';
import { restoreActiveRun } from '../src/expedition/restore';
import { serializeRun, startRun } from '../src/expedition/run';

describe('восстановление повреждённой экспедиции', () => {
  it('при отсутствии забега не создаёт резервную копию', () => {
    const preserve = vi.fn();
    expect(restoreActiveRun(newGame(1000), preserve)).toEqual({ status: 'empty', run: null });
    expect(preserve).not.toHaveBeenCalled();
  });

  it('валидный забег восстанавливается без изменения состояния', () => {
    const state = newGame(1000);
    const run = startRun(state, 1000, 1);
    state.activeRun = serializeRun(run);
    const before = serialize(state);
    const preserve = vi.fn();
    const restored = restoreActiveRun(state, preserve);
    expect(restored.status).toBe('loaded');
    expect(serializeRun(restored.run!)).toBe(serializeRun(run));
    expect(serialize(state)).toBe(before);
    expect(preserve).not.toHaveBeenCalled();
  });

  it('создаёт копию до очистки забега и не меняет накопленный прогресс', () => {
    const state = newGame(1000);
    state.gold = 456;
    state.activeRun = '{broken';
    const before = serialize(state);
    const preserve = vi.fn(() => { expect(serialize(state)).toBe(before); });
    expect(restoreActiveRun(state, preserve)).toEqual({ status: 'recovered', run: null });
    expect(preserve).toHaveBeenCalledOnce();
    expect(serialize(state)).toBe(serialize({ ...JSON.parse(before), activeRun: null }));
  });

  it('при отказе резервного хранилища сохраняет исходный activeRun', () => {
    const state = newGame(1000);
    state.activeRun = '{broken';
    const before = serialize(state);
    const preserve = () => { throw new Error('quota'); };
    expect(restoreActiveRun(state, preserve)).toEqual({ status: 'blocked', run: null });
    expect(serialize(state)).toBe(before);
  });

  it('не принимает участников, отсутствующих в гильдии', () => {
    const state = newGame(1000);
    state.activeRun = serializeRun(startRun(state, 1000, 1));
    state.heroes = [];
    expect(restoreActiveRun(state, vi.fn()).status).toBe('recovered');
  });
});
