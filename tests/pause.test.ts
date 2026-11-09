import { describe, expect, it, vi } from 'vitest';
import { GamePause } from '../src/ui/pause';

describe('общая пауза игры', () => {
  it('возобновляет игру только после снятия всех причин', () => {
    const pause = new GamePause();
    const listener = vi.fn();
    const unsubscribe = pause.subscribe(listener);
    pause.set('platform', true);
    pause.set('modal', true);
    pause.set('hidden', true);
    pause.set('platform', false);
    pause.set('modal', false);
    expect(pause.paused).toBe(true);
    expect(listener.mock.calls).toEqual([[false], [true]]);
    pause.set('hidden', false);
    expect(listener.mock.calls).toEqual([[false], [true], [false]]);
    unsubscribe();
    pause.set('modal', true);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('сообщает новому экрану уже действующую паузу', () => {
    const pause = new GamePause();
    pause.set('platform', true);
    const listener = vi.fn();
    pause.subscribe(listener);
    expect(listener).toHaveBeenCalledWith(true);
  });

  it('держит ход до снятия последней причины', async () => {
    const pause = new GamePause();
    pause.set('platform', true);
    pause.set('hidden', true);
    const nextTurn = vi.fn();
    const wait = pause.waitUntilResumed(new AbortController().signal).then(nextTurn);
    pause.set('platform', false);
    await Promise.resolve();
    expect(nextTurn).not.toHaveBeenCalled();
    pause.set('hidden', false);
    await wait;
    expect(nextTurn).toHaveBeenCalledWith(true);
  });

  it('отменяет ожидающий ход при уничтожении экрана', async () => {
    const pause = new GamePause();
    pause.set('modal', true);
    const lifetime = new AbortController();
    const wait = pause.waitUntilResumed(lifetime.signal);
    lifetime.abort();
    expect(await wait).toBe(false);
    pause.set('modal', false);
    expect(await pause.waitUntilResumed(lifetime.signal)).toBe(false);
    expect(await pause.waitUntilResumed(new AbortController().signal)).toBe(true);
  });
});
