import type { Platform } from './platform';
import { resolveSave } from './save-resolution';
import { deserialize } from '../core/save';
import { SaveLoadError } from './platform';
import { withTimeout } from './timeout';

/* Минимальное описание SDK Яндекс.Игр: только то, чем пользуемся. Сверено с документацией:
   https://yandex.ru/dev/games/doc/ru/sdk/sdk-about */
interface AdCallbacks {
  onOpen?: () => void;
  onRewarded?: () => void;
  onClose?: (wasShown: boolean) => void;
  onError?: (error: unknown) => void;
}
interface YaPlayer {
  getData(keys?: string[]): Promise<Record<string, unknown>>;
  setData(data: Record<string, unknown>, flush?: boolean): Promise<void>;
}
export interface Ysdk {
  getPlayer(): Promise<YaPlayer>;
  adv: {
    showFullscreenAdv(opts: { callbacks: AdCallbacks }): void;
    showRewardedVideo(opts: { callbacks: AdCallbacks }): void;
  };
  features?: {
    LoadingAPI?: { ready(): void };
    GameplayAPI?: { start(): void; stop(): void };
  };
  on(event: string, listener: () => void): void;
  serverTime(): number;
  environment: { i18n: { lang: string } };
}
declare global {
  interface Window {
    YaGames?: { init(): Promise<Ysdk> };
    /** Set only when Metrika is loaded and matching goals are configured in the release build. */
    __GOS_METRIKA_ID__?: number;
    __GOS_ANALYTICS_DEBUG__?: boolean;
    ym?: (counterId: number, method: string, goal: string, params?: Record<string, string | number | boolean>) => void;
  }
}

const LOCAL_KEY = 'gos.save';
const CLOUD_KEY = 'save';
/** Лимит SDK: setData — 100 запросов за 5 минут и 200 КБ. Отправляем не чаще раза в 15 секунд. */
const MIN_SAVE_INTERVAL_MS = 15_000;

export class YandexPlatform implements Platform {
  readonly name = 'yandex' as const;
  get savesLocallyOnly(): boolean { return !this.cloudLoaded; }
  private ysdk!: Ysdk;
  private player: YaPlayer | null = null;
  private paused = false;
  private sdkPaused = false;
  private adActive = false;
  private pauseCbs: Array<(p: boolean) => void> = [];
  private pending: string | null = null;
  private lastSent = 0;
  private timer: number | null = null;
  private sending: Promise<void> | null = null;
  private flushRequested = false;
  private cloudLoaded = false;

  async init(): Promise<void> {
    if (!window.YaGames) throw new Error('Яндекс SDK не загружен');
    this.ysdk = await withTimeout(() => window.YaGames!.init(), 8000);
    // Listen before getPlayer(): an ad can pause the game while player data is loading.
    this.ysdk.on('game_api_pause', () => { this.sdkPaused = true; this.updatePause(); });
    this.ysdk.on('game_api_resume', () => { this.sdkPaused = false; this.updatePause(); });
    try {
      this.player = await withTimeout(() => this.ysdk.getPlayer(), 5000);
    } catch {
      this.player = null; // игра работает на локальном хранилище
    }
  }

  now(): number {
    return this.ysdk.serverTime();
  }

  async load(): Promise<string | null> {
    let local: string | null = null;
    try {
      local = window.localStorage.getItem(LOCAL_KEY);
    } catch {
      /* нет доступа к localStorage */
    }
    let cloud: string | null = null;
    this.cloudLoaded = false;
    if (this.player) {
      try {
        const data = await withTimeout(() => this.player!.getData([CLOUD_KEY]), 5000);
        const v = data[CLOUD_KEY];
        cloud = typeof v === 'string' ? v : null;
        this.cloudLoaded = true;
      } catch {
        /* нет сети или игрок без доступа к данным */
        this.track('cloud_load_failed');
      }
    }
    // An unknown cloud copy must not be replaced by a fresh game or a background save.
    // An existing local save can be played offline; cloud writes stay disabled this session.
    if (!this.cloudLoaded) {
      const fallback = deserialize(local, this.now());
      if (!fallback.ok && fallback.reason !== 'newer') throw new SaveLoadError();
    }
    // Prefer the newest/most progressed valid candidate; don't decide by timestamp alone on a tie.
    const selected = resolveSave(local, cloud);
    if (selected && selected !== cloud && cloud !== null) this.track('save_conflict_resolved', { selected: 'local' });
    else if (selected && selected === cloud && local !== null && cloud !== local) this.track('save_conflict_resolved', { selected: 'cloud' });
    return selected;
  }

  save(data: string): void {
    this.pending = data;
    try {
      window.localStorage.setItem(LOCAL_KEY, data); // локальная копия — мгновенно и без лимитов
    } catch {
      /* ignore */
    }
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.timer !== null || this.sending || !this.player || !this.cloudLoaded || this.pending === null) return;
    const wait = Math.max(0, this.lastSent + MIN_SAVE_INTERVAL_MS - Date.now());
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.send(false);
    }, wait);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    await this.send(true);
  }

  private send(immediate: boolean): Promise<void> {
    this.flushRequested ||= immediate;
    if (this.sending) return this.sending;
    if (this.pending === null || !this.player || !this.cloudLoaded) {
      this.flushRequested = false;
      return Promise.resolve();
    }
    const player = this.player;
    const drain = async () => {
      do {
        const data = this.pending;
        const force = this.flushRequested;
        this.flushRequested = false;
        this.lastSent = Date.now();
        try {
          await player.setData({ [CLOUD_KEY]: data }, force);
          if (this.pending === data) this.pending = null;
          this.track('cloud_save_success', { immediate: force });
        } catch {
          // Keep the latest local snapshot and retry with the normal rate limit.
          this.track('cloud_save_failed', { immediate: force });
          break;
        }
        // A flush during an active request must also drain the newer snapshot.
      } while (this.pending !== null && this.flushRequested);
    };
    this.sending = drain().finally(() => {
      this.sending = null;
      this.flushRequested = false;
      this.scheduleSave();
    });
    return this.sending;
  }

  showRewarded(placement: string): Promise<boolean> {
    if (this.adActive) return Promise.resolve(false);
    this.adActive = true;
    this.updatePause();
    const safePlacement = this.safeText(placement, 40) || 'unknown';
    this.track('rewarded_start', { placement: safePlacement });
    return new Promise((resolve) => {
      let rewarded = false;
      let settled = false;
      const timeout = window.setTimeout(() => finish(false, 'timeout'), 120_000);
      const finish = (success: boolean, reason: string) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        this.adActive = false;
        this.updatePause();
        this.track(success ? 'rewarded_complete' : 'rewarded_failed', { placement: safePlacement, reason });
        resolve(success);
      };
      try {
        this.ysdk.adv.showRewardedVideo({
          callbacks: {
            onRewarded: () => { rewarded = true; }, // eligibility comes from this callback, not onClose
            onClose: () => finish(rewarded, rewarded ? 'rewarded' : 'closed_without_reward'),
            onError: () => finish(false, 'sdk_error'),
          },
        });
      } catch {
        finish(false, 'sdk_exception');
      }
    });
  }

  showInterstitial(): Promise<void> {
    if (this.adActive) return Promise.resolve();
    this.adActive = true;
    this.updatePause();
    this.track('interstitial_start');
    return new Promise((resolve) => {
      let settled = false;
      const timeout = window.setTimeout(() => finish('timeout'), 45_000);
      const finish = (reason: string) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        this.adActive = false;
        this.updatePause();
        this.track(reason === 'closed' ? 'interstitial_complete' : 'interstitial_failed', { reason });
        resolve();
      };
      try {
        this.ysdk.adv.showFullscreenAdv({
          callbacks: {
            onClose: (wasShown) => finish(wasShown ? 'closed' : 'not_shown'),
            onError: () => finish('sdk_error'),
          },
        });
      } catch {
        finish('sdk_exception');
      }
    });
  }

  gameReady(): void {
    this.ysdk.features?.LoadingAPI?.ready();
  }

  gameplayStart(): void {
    this.ysdk.features?.GameplayAPI?.start();
  }

  gameplayStop(): void {
    this.ysdk.features?.GameplayAPI?.stop();
  }

  onPauseChange(cb: (paused: boolean) => void): void {
    this.pauseCbs.push(cb);
  }

  isPaused(): boolean {
    return this.paused;
  }

  getLang(): string {
    return this.ysdk.environment.i18n.lang || 'ru';
  }

  /**
   * Typed telemetry adapter. Configure window.__GOS_METRIKA_ID__ and load the site's
   * Metrika script in the release build to send goals. A CustomEvent is always emitted
   * for QA/integration tests. No player IDs or free-form personal data are sent.
   */
  track(event: string, params?: Record<string, unknown>): void {
    const name = event.trim().replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64);
    if (!name) return;
    const safeParams: Record<string, string | number | boolean> = {};
    const allowedKeys = new Set(['platform', 'save_status', 'tier', 'result', 'nodes', 'placement', 'reason', 'immediate', 'selected']);
    for (const [key, value] of Object.entries(params ?? {}).slice(0, 16)) {
      if (!allowedKeys.has(key)) continue; // fail closed: never send arbitrary/free-form properties
      const safeKey = key.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40);
      if (!safeKey) continue;
      if (typeof value === 'boolean') safeParams[safeKey] = value;
      else if (typeof value === 'number' && Number.isFinite(value)) safeParams[safeKey] = value;
      else if (typeof value === 'string') safeParams[safeKey] = this.safeText(value, 80);
    }
    if (window.__GOS_ANALYTICS_DEBUG__) console.debug('[analytics:yandex]', name, safeParams);
    window.dispatchEvent(new CustomEvent('gos:analytics', { detail: { event: name, params: safeParams, platform: 'yandex' } }));
    const counterId = window.__GOS_METRIKA_ID__;
    if (typeof counterId === 'number' && Number.isFinite(counterId) && counterId > 0 && typeof window.ym === 'function') {
      try {
        window.ym(counterId, 'reachGoal', name, safeParams);
      } catch (error) {
        if (window.__GOS_ANALYTICS_DEBUG__) console.warn('[analytics:yandex] goal failed', name, error);
      }
    }
  }

  private safeText(value: string, maxLength: number): string {
    return value.replace(/[\r\n\t]/g, ' ').slice(0, maxLength);
  }

  private setPaused(p: boolean): void {
    if (this.paused === p) return;
    this.paused = p;
    for (const cb of this.pauseCbs) cb(p);
  }

  private updatePause(): void {
    this.setPaused(this.sdkPaused || this.adActive);
  }
}
