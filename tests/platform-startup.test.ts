import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlatform, SaveLoadError } from '../src/platform';
import { withTimeout } from '../src/platform/timeout';

beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('VITE_REQUIRE_YANDEX_SDK', 'false'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function page() {
  const storage = new Map<string, string>();
  const script = { src: '', onload: null as (() => void) | null, onerror: null as (() => void) | null, remove: vi.fn() };
  const append = vi.fn(() => script.onerror?.());
  vi.stubGlobal('document', { createElement: () => script, head: { append }, addEventListener: vi.fn(), hidden: false });
  const win = {
    setTimeout, clearTimeout,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    YaGames: undefined as undefined | { init: () => Promise<never> },
  };
  vi.stubGlobal('window', win);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  return { storage, script, append, win };
}

describe('выбор платформы и восстановление запуска', () => {
  it('работает локально при отсутствии SDK в обычной сборке и убирает обработчики скрипта', async () => {
    const { script } = page();
    const platform = await createPlatform();
    expect(platform.name).toBe('local');
    expect(script.remove).toHaveBeenCalledOnce();
    expect(script.onload).toBeNull();
    expect(script.onerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('завершает зависшее скачивание SDK через 3 секунды', async () => {
    const { append, script } = page();
    append.mockImplementation(() => {});
    const loading = createPlatform();
    await vi.advanceTimersByTimeAsync(3000);
    expect((await loading).name).toBe('local');
    expect(script.remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['release', 'returning'] as const)('требует повторной загрузки SDK: %s', async mode => {
    const { storage } = page();
    if (mode === 'release') vi.stubEnv('VITE_REQUIRE_YANDEX_SDK', 'true');
    else storage.set('gos.platform', 'yandex');
    await expect(createPlatform()).rejects.toBeInstanceOf(SaveLoadError);
    expect(storage.get('gos.save')).toBeUndefined();
  });

  it('не скачивает SDK повторно и не начинает локальную игру при ошибке готового SDK', async () => {
    const { win, append } = page();
    win.YaGames = { init: vi.fn(async () => { throw new Error('offline'); }) };
    await expect(createPlatform()).rejects.toBeInstanceOf(SaveLoadError);
    expect(append).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('завершает зависшую инициализацию SDK за 8 секунд без создания нового сейва', async () => {
    const { win, storage } = page();
    win.YaGames = { init: () => new Promise(() => {}) };
    const error = expect(createPlatform()).rejects.toBeInstanceOf(SaveLoadError);
    await vi.advanceTimersByTimeAsync(8000);
    await error;
    expect(storage.get('gos.save')).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ограничение времени чтения SDK', () => {
  it('убирает таймер после успешного ответа', async () => {
    page();
    expect(await withTimeout(async () => 42, 5000)).toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('убирает таймер после синхронной ошибки', async () => {
    page();
    await expect(withTimeout(() => { throw new Error('SDK'); }, 5000)).rejects.toThrow('SDK');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('не оставляет необработанную ошибку при позднем отказе после таймаута', async () => {
    page();
    let reject!: (reason: unknown) => void;
    const response = new Promise<never>((_, no) => { reject = no; });
    const error = expect(withTimeout(() => response, 5000)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(5000);
    await error;
    reject(new Error('late rejection'));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
