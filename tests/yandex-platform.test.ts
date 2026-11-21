import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player, SDK } from 'ysdk';
import { YandexPlatform } from '../src/platform/yandex';

type RewardedCallbacks = NonNullable<NonNullable<Parameters<SDK['adv']['showRewardedVideo']>[0]>['callbacks']>;
type FullscreenCallbacks = NonNullable<NonNullable<Parameters<SDK['adv']['showFullscreenAdv']>[0]>['callbacks']>;

/** Contract doubles test our adapter; they do not establish that the real hosted SDK works. */
function fixture() {
  const events = new Map<string, () => void>();
  const player = { getData: vi.fn(async () => ({})), setData: vi.fn(async () => undefined) } as unknown as Player;
  let rewarded: RewardedCallbacks = {};
  let fullscreen: FullscreenCallbacks = {};
  const sdk = {
    getPlayer: vi.fn(async () => player),
    on: vi.fn((event: string, listener: () => void) => { events.set(event, listener); return () => events.delete(event); }),
    adv: {
      showRewardedVideo: vi.fn((opts: { callbacks: RewardedCallbacks }) => { rewarded = opts.callbacks; }),
      showFullscreenAdv: vi.fn((opts: { callbacks: FullscreenCallbacks }) => { fullscreen = opts.callbacks; }),
    },
    features: { LoadingAPI: { ready: vi.fn() }, GameplayAPI: { start: vi.fn(), stop: vi.fn() } },
    serverTime: () => 1234,
    environment: { i18n: { lang: 'ru' } },
  };
  vi.stubGlobal('window', {
    YaGames: { init: async () => sdk },
    setTimeout, clearTimeout,
    localStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
    dispatchEvent: vi.fn(),
  });
  return { sdk, player, emit: (event: string) => events.get(event)!(), rewarded: () => rewarded, fullscreen: () => fullscreen };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('контракт адаптера Яндекс SDK', () => {
  it('подписывается на паузу до ожидания getPlayer', async () => {
    const f = fixture();
    let release!: (player: Player) => void;
    f.sdk.getPlayer.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const platform = new YandexPlatform();
    const init = platform.init();
    await Promise.resolve();
    f.emit('game_api_pause');
    expect(platform.isPaused()).toBe(true);
    release(f.player);
    await init;
    expect(platform.isPaused()).toBe(true);
    f.emit('game_api_resume');
    expect(platform.isPaused()).toBe(false);
  });

  it('закрытие рекламы без onRewarded не выдаёт награду и не снимает паузу SDK', async () => {
    const f = fixture();
    const platform = new YandexPlatform();
    await platform.init();
    const result = platform.showRewarded('revive');
    f.rewarded().onOpen!();
    f.emit('game_api_pause');
    f.rewarded().onClose!();
    expect(await result).toBe(false);
    expect(platform.isPaused()).toBe(true);
    f.emit('game_api_resume');
    expect(platform.isPaused()).toBe(false);
  });

  it('resume SDK не снимает паузу открытой рекламы; повторные callback не дублируют награду', async () => {
    const f = fixture();
    const platform = new YandexPlatform();
    await platform.init();
    const track = vi.spyOn(platform, 'track');
    const result = platform.showRewarded('double_gold');
    f.rewarded().onOpen!();
    f.emit('game_api_pause');
    f.emit('game_api_resume');
    expect(platform.isPaused()).toBe(true);
    f.rewarded().onRewarded!();
    f.rewarded().onClose!();
    f.rewarded().onClose!();
    f.rewarded().onError!(new Error('late'));
    expect(await result).toBe(true);
    expect(track.mock.calls.filter(([event]) => event === 'rewarded_complete')).toHaveLength(1);
    expect(platform.isPaused()).toBe(false);
  });

  it('таймаут снимает только рекламную паузу и игнорирует позднее открытие', async () => {
    const f = fixture();
    const platform = new YandexPlatform();
    await platform.init();
    const result = platform.showRewarded('revive');
    f.rewarded().onOpen!();
    f.emit('game_api_pause');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await result).toBe(false);
    f.emit('game_api_resume');
    f.rewarded().onOpen!();
    expect(platform.isPaused()).toBe(false);
  });

  it('не запускает два показа одновременно', async () => {
    const f = fixture();
    const platform = new YandexPlatform();
    await platform.init();
    const first = platform.showRewarded('revive');
    expect(await platform.showRewarded('revive')).toBe(false);
    await platform.showInterstitial();
    expect(f.sdk.adv.showRewardedVideo).toHaveBeenCalledOnce();
    expect(f.sdk.adv.showFullscreenAdv).not.toHaveBeenCalled();
    f.rewarded().onClose!();
    expect(await first).toBe(false);
  });

  it.each(['onError', 'onOffline'] as const)('завершение полноэкранной рекламы через %s снимает её паузу', async (callback) => {
    const f = fixture();
    const platform = new YandexPlatform();
    await platform.init();
    const result = platform.showInterstitial();
    f.fullscreen().onOpen!();
    expect(platform.isPaused()).toBe(true);
    if (callback === 'onError') f.fullscreen().onError!(new Error('ad failure'));
    else f.fullscreen().onOffline!();
    await result;
    expect(platform.isPaused()).toBe(false);
  });
});
