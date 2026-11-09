import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YandexPlatform, type Ysdk } from '../src/platform/yandex';
import { SaveLoadError } from '../src/platform/platform';
import { newGame } from '../src/core/state';

type Callbacks = Parameters<Ysdk['adv']['showRewardedVideo']>[0]['callbacks'];

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const storage = new Map<string, string>();
  const handlers = new Map<string, () => void>();
  const player = { getData: vi.fn(async (): Promise<Record<string, unknown>> => ({})), setData: vi.fn(async () => {}) };
  const sdk: Ysdk = {
    getPlayer: vi.fn(async () => player),
    on: vi.fn((event, listener) => { handlers.set(event, listener); }),
    serverTime: () => Date.now(),
    environment: { i18n: { lang: 'ru' } },
    adv: { showRewardedVideo: vi.fn(), showFullscreenAdv: vi.fn() },
    features: { GameplayAPI: { start: vi.fn(), stop: vi.fn() }, LoadingAPI: { ready: vi.fn() } },
  };
  const win = {
    YaGames: { init: vi.fn(async () => sdk) },
    localStorage: {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, data: string) => { storage.set(key, data); }),
    },
    setTimeout, clearTimeout,
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal('window', win);
  const platform = new YandexPlatform();
  return { platform, player, sdk, win, storage, emit: (name: string) => handlers.get(name)?.() };
}

async function start(platform: YandexPlatform) {
  await platform.init();
  await platform.load();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Яндекс: очередь сохранений', () => {
  it('последовательно отправляет старый и последний снимки при повторных flush', async () => {
    const { platform, player, storage } = fixture();
    await start(platform);
    const first = deferred(), second = deferred();
    player.setData.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    platform.save('old');
    const flush1 = platform.flush();
    platform.save('intermediate');
    const flush2 = platform.flush();
    platform.save('latest');
    const flush3 = platform.flush();
    expect(player.setData.mock.calls).toEqual([[{ save: 'old' }, true]]);
    expect(storage.get('gos.save')).toBe('latest');
    first.resolve();
    await Promise.resolve();
    expect(player.setData.mock.calls).toEqual([[{ save: 'old' }, true], [{ save: 'latest' }, true]]);
    second.resolve();
    await Promise.all([flush1, flush2, flush3]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(player.setData).toHaveBeenCalledTimes(2);
  });

  it('не дублирует один снимок при одновременных flush', async () => {
    const { platform, player } = fixture();
    await start(platform);
    const request = deferred();
    player.setData.mockReturnValueOnce(request.promise);
    platform.save('save');
    const flushes = [platform.flush(), platform.flush(), platform.flush()];
    request.resolve();
    await Promise.all(flushes);
    expect(player.setData).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('сохраняет новые данные, появившиеся во время обычной отправки, с интервалом 15 секунд', async () => {
    const { platform, player } = fixture();
    await start(platform);
    const first = deferred();
    player.setData.mockReturnValueOnce(first.promise);
    platform.save('first');
    await vi.advanceTimersByTimeAsync(0);
    platform.save('latest');
    first.resolve();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(player.setData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(player.setData).toHaveBeenLastCalledWith({ save: 'latest' }, false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('не запускает вторую отправку, даже если первая длится дольше интервала', async () => {
    const { platform, player } = fixture();
    await start(platform);
    const first = deferred();
    player.setData.mockReturnValueOnce(first.promise);
    platform.save('first');
    await vi.advanceTimersByTimeAsync(0);
    platform.save('latest');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(player.setData).toHaveBeenCalledTimes(1);
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.setData).toHaveBeenLastCalledWith({ save: 'latest' }, false);
  });

  it('повторяет неудачную отправку с последними данными без нового save', async () => {
    const { platform, player, storage } = fixture();
    await start(platform);
    const first = deferred();
    player.setData.mockReturnValueOnce(first.promise);
    platform.save('old');
    const flush = platform.flush();
    platform.save('latest');
    first.reject(new Error('offline'));
    await flush;
    expect(storage.get('gos.save')).toBe('latest');
    await vi.advanceTimersByTimeAsync(14_999);
    expect(player.setData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(player.setData).toHaveBeenLastCalledWith({ save: 'latest' }, false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('не теряет очередь при синхронной ошибке SDK и недоступном localStorage', async () => {
    const { platform, player, win } = fixture();
    await start(platform);
    win.localStorage.setItem.mockImplementation(() => { throw new Error('quota'); });
    player.setData.mockImplementationOnce(() => { throw new Error('SDK'); });
    platform.save('latest');
    await platform.flush();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(player.setData).toHaveBeenLastCalledWith({ save: 'latest' }, false);
    expect(player.setData).toHaveBeenCalledTimes(2);
  });

  it('работает локально без лишних таймеров при недоступности игрока', async () => {
    const { platform, sdk, player, storage } = fixture();
    const local = JSON.stringify(newGame(Date.now()));
    storage.set('gos.save', local);
    vi.mocked(sdk.getPlayer).mockRejectedValue(new Error('guest'));
    await start(platform);
    platform.save(local);
    await platform.flush();
    expect(await platform.load()).toBe(local);
    expect(storage.get('gos.save')).toBe(local);
    expect(player.setData).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('выбирает свежую локальную копию и переживает ошибку чтения облака', async () => {
    const { platform, player, storage } = fixture();
    await start(platform);
    const local = JSON.stringify(newGame(Date.now()));
    storage.set('gos.save', local);
    player.getData.mockResolvedValueOnce({ save: JSON.stringify(newGame(Date.now() - 1000)) });
    expect(await platform.load()).toBe(local);
    player.getData.mockRejectedValueOnce(new Error('offline'));
    expect(await platform.load()).toBe(local);
  });
});

describe('Яндекс: недоступное облако', () => {
  it.each([null, '{broken', '{"version":"unknown"}'])('не создаёт новую игру поверх непрочитанного облака: %s', async local => {
    const { platform, player, storage } = fixture();
    if (local !== null) storage.set('gos.save', local);
    await platform.init();
    player.getData.mockRejectedValue(new Error('offline'));
    await expect(platform.load()).rejects.toBeInstanceOf(SaveLoadError);
    expect(storage.get('gos.save') ?? null).toBe(local);
    expect(player.setData).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('продолжает локальную игру, но не отправляет данные в непрочитанное облако', async () => {
    const { platform, player, storage } = fixture();
    const local = JSON.stringify(newGame(Date.now()));
    storage.set('gos.save', local);
    await platform.init();
    player.getData.mockRejectedValue(new Error('offline'));
    expect(await platform.load()).toBe(local);
    const latest = JSON.stringify({ ...newGame(Date.now()), gold: 1234 });
    platform.save(latest);
    await platform.flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(storage.get('gos.save')).toBe(latest);
    expect(player.setData).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('завершает зависшее чтение за 5 секунд и игнорирует поздний ответ', async () => {
    const { platform, player, storage } = fixture();
    const local = JSON.stringify(newGame(Date.now()));
    storage.set('gos.save', local);
    await platform.init();
    const cloud = deferred<Record<string, unknown>>();
    player.getData.mockReturnValue(cloud.promise);
    const loading = platform.load();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await loading).toBe(local);
    cloud.resolve({ save: JSON.stringify({ ...newGame(Date.now()), gold: 9999 }) });
    await vi.advanceTimersByTimeAsync(0);
    platform.save(local);
    await platform.flush();
    expect(player.setData).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('не перезаписывает локальный сейв будущей версии при недоступном облаке', async () => {
    const { platform, player, storage } = fixture();
    const future = JSON.stringify({ ...newGame(Date.now()), version: 999 });
    storage.set('gos.save', future);
    await platform.init();
    player.getData.mockRejectedValue(new Error('offline'));
    expect(await platform.load()).toBe(future);
    expect(storage.get('gos.save')).toBe(future);
    expect(player.setData).not.toHaveBeenCalled();
  });

  it('не зависает на получении игрока и не подключает поздний результат к текущей игре', async () => {
    const { platform, sdk, player, storage } = fixture();
    const local = JSON.stringify(newGame(Date.now()));
    storage.set('gos.save', local);
    const delayed = deferred<typeof player>();
    vi.mocked(sdk.getPlayer).mockReturnValue(delayed.promise);
    const init = platform.init();
    await vi.advanceTimersByTimeAsync(5000);
    await init;
    expect(await platform.load()).toBe(local);
    delayed.resolve(player);
    await vi.advanceTimersByTimeAsync(0);
    platform.save(local);
    await platform.flush();
    expect(player.getData).not.toHaveBeenCalled();
    expect(player.setData).not.toHaveBeenCalled();
  });

  it('отказывает в запуске новой игры, если игрок SDK недоступен и локальной копии нет', async () => {
    const { platform, sdk, player } = fixture();
    vi.mocked(sdk.getPlayer).mockRejectedValue(new Error('offline'));
    await platform.init();
    await expect(platform.load()).rejects.toBeInstanceOf(SaveLoadError);
    expect(player.setData).not.toHaveBeenCalled();
  });

  it('после успешного чтения пустого облака разрешает новое сохранение', async () => {
    const { platform, player } = fixture();
    await platform.init();
    expect(await platform.load()).toBeNull();
    platform.save('new');
    await platform.flush();
    expect(player.setData).toHaveBeenCalledWith({ save: 'new' }, true);
  });
});

describe('Яндекс: реклама и пауза', () => {
  it('слушает паузу до завершения загрузки игрока', async () => {
    const { platform, sdk, player, emit } = fixture();
    const loading = deferred<typeof player>();
    vi.mocked(sdk.getPlayer).mockReturnValue(loading.promise);
    const init = platform.init();
    await vi.advanceTimersByTimeAsync(0);
    emit('game_api_pause');
    loading.resolve(player);
    await init;
    expect(platform.isPaused()).toBe(true);
  });

  it('не снимает паузу SDK при закрытии рекламы и блокирует параллельный ролик', async () => {
    const { platform, sdk, emit } = fixture();
    await start(platform);
    const listener = vi.fn();
    platform.onPauseChange(listener);
    let callbacks!: Callbacks;
    vi.mocked(sdk.adv.showRewardedVideo).mockImplementation(opts => { callbacks = opts.callbacks; });
    const reward = platform.showRewarded('double_gold');
    expect(platform.isPaused()).toBe(true);
    expect(await platform.showRewarded('revive')).toBe(false);
    await platform.showInterstitial();
    expect(sdk.adv.showFullscreenAdv).not.toHaveBeenCalled();
    emit('game_api_pause');
    callbacks.onRewarded?.();
    callbacks.onClose?.(true);
    callbacks.onClose?.(true);
    expect(await reward).toBe(true);
    expect(platform.isPaused()).toBe(true);
    emit('game_api_resume');
    expect(listener.mock.calls).toEqual([[true], [false]]);
  });

  it('не возобновляет игру по SDK resume до завершения ролика и не выдаёт награду за один onClose', async () => {
    const { platform, sdk, emit } = fixture();
    await start(platform);
    let callbacks!: Callbacks;
    vi.mocked(sdk.adv.showRewardedVideo).mockImplementation(opts => { callbacks = opts.callbacks; });
    const reward = platform.showRewarded('revive');
    emit('game_api_pause');
    emit('game_api_resume');
    expect(platform.isPaused()).toBe(true);
    callbacks.onClose?.(true);
    expect(await reward).toBe(false);
    expect(platform.isPaused()).toBe(false);
    callbacks.onRewarded?.();
    expect(await reward).toBe(false);
  });

  it.each(['error', 'exception', 'timeout'] as const)('снимает собственную паузу без награды: %s', async (mode) => {
    const { platform, sdk } = fixture();
    await start(platform);
    vi.mocked(sdk.adv.showRewardedVideo).mockImplementation(({ callbacks }) => {
      if (mode === 'exception') throw new Error('SDK');
      if (mode === 'error') callbacks.onError?.(new Error('no ad'));
    });
    const result = platform.showRewarded('revive');
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(120_000);
    expect(await result).toBe(false);
    expect(platform.isPaused()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['close', 'error', 'exception', 'timeout'] as const)('завершает полноэкранную рекламу: %s', async (mode) => {
    const { platform, sdk } = fixture();
    await start(platform);
    vi.mocked(sdk.adv.showFullscreenAdv).mockImplementation(({ callbacks }) => {
      if (mode === 'close') callbacks.onClose?.(true);
      if (mode === 'error') callbacks.onError?.(new Error('no ad'));
      if (mode === 'exception') throw new Error('SDK');
    });
    const result = platform.showInterstitial();
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(45_000);
    await result;
    expect(platform.isPaused()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
