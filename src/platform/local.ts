import type { Platform } from './platform';
import { PauseController } from '../core/pause';

const KEY = 'gos.save';

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null; // приватный режим, запрет на хранение
  }
}

/** Локальная разработка и запуск вне Яндекса: сохранения в localStorage, реклама — заглушка. */
export class LocalPlatform implements Platform {
  readonly name = 'local' as const;
  private readonly pause = new PauseController();
  private pending: string | null = null;
  private debug = false;

  async init(): Promise<void> {
    this.debug = typeof location !== 'undefined' && location.search.includes('debug');
    this.pause.set('hidden', document.hidden);
    document.addEventListener('visibilitychange', () => this.pause.set('hidden', document.hidden));
  }

  now(): number {
    return Date.now();
  }

  async load(): Promise<string | null> {
    return readStorage();
  }

  save(data: string): void {
    this.pending = data;
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.pending === null) return;
    try {
      window.localStorage.setItem(KEY, this.pending);
      this.pending = null;
    } catch {
      /* квота или запрет: игра продолжает работать, прогресс этой сессии может не сохраниться */
    }
  }

  showRewarded(placement: string): Promise<boolean> {
    if (this.adOpen) return Promise.resolve(false);
    return this.fakeAd(`Реклама за награду («${placement}»)`, true);
  }

  async showInterstitial(): Promise<void> {
    if (this.debug) console.debug('[ad] interstitial (заглушка)');
  }

  gameReady(): void {
    if (this.debug) console.debug('[platform] gameReady');
  }

  gameplayStart(): void {}
  gameplayStop(): void {}

  onPauseChange(cb: (paused: boolean) => void): void {
    this.pause.subscribe(cb);
  }

  isPaused(): boolean {
    return this.pause.active;
  }

  getLang(): string {
    return (navigator.language || 'ru').slice(0, 2);
  }

  track(event: string, params?: Record<string, unknown>): void {
    if (this.debug) console.debug('[track]', event, params ?? {});
  }

  private adOpen = false;

  /** Окошко-имитация ролика: 2 секунды, затем можно закрыть и получить награду. */
  private fakeAd(title: string, reward: boolean): Promise<boolean> {
    this.adOpen = true;
    this.pause.set('ad', true);
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'fake-ad';
      const box = document.createElement('div');
      box.className = 'fake-ad__box';
      const text = document.createElement('div');
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.disabled = true;
      box.append(text, btn);
      overlay.append(box);
      document.body.append(overlay);

      let left = 2;
      const render = () => {
        text.textContent = `${title}: заглушка локальной сборки`;
        btn.textContent = left > 0 ? `Подождите ${left}…` : 'Закрыть';
      };
      render();
      const timer = window.setInterval(() => {
        left -= 1;
        render();
        if (left <= 0) {
          window.clearInterval(timer);
          btn.disabled = false;
        }
      }, 1000);
      btn.addEventListener('click', () => {
        overlay.remove();
        this.adOpen = false;
        this.pause.set('ad', false);
        resolve(reward);
      });
    });
  }
}
