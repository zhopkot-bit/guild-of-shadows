import { describe, expect, it, vi } from 'vitest';
import { PauseController } from '../src/core/pause';

describe('общая пауза', () => {
  it('одна причина не снимает другую и уведомления отражают общий статус', () => {
    const pause = new PauseController();
    const listener = vi.fn();
    const off = pause.subscribe(listener);
    pause.set('platform', true);
    pause.set('modal', true);
    pause.set('platform', false);
    expect(pause.active).toBe(true);
    pause.set('modal', false);
    expect(listener.mock.calls.map(([value]) => value)).toEqual([false, true, false]);
    off();
    pause.set('hidden', true);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('не продолжает ожидание, пока осталась хотя бы одна причина', async () => {
    const pause = new PauseController();
    pause.set('platform', true);
    let resumed = false;
    const waiting = pause.wait(new AbortController().signal).then((value) => { resumed = value; });
    pause.set('hidden', true);
    pause.set('platform', false);
    await Promise.resolve();
    expect(resumed).toBe(false);
    pause.set('hidden', false);
    await waiting;
    expect(resumed).toBe(true);
  });

  it('повторно проверяет паузу при замене причины в том же стеке', async () => {
    const pause = new PauseController();
    pause.set('platform', true);
    let resumed = false;
    const waiting = pause.wait(new AbortController().signal).then((value) => { resumed = value; });
    pause.set('platform', false);
    pause.set('modal', true);
    await Promise.resolve();
    expect(resumed).toBe(false);
    pause.set('modal', false);
    await waiting;
    expect(resumed).toBe(true);
  });

  it('уничтоженный View освобождает ожидание без продолжения действий', async () => {
    const pause = new PauseController();
    const controller = new AbortController();
    pause.set('platform', true);
    const waiting = pause.wait(controller.signal);
    controller.abort();
    expect(await waiting).toBe(false);
    pause.set('platform', false);
    expect(await pause.wait(controller.signal)).toBe(false);
  });
});
