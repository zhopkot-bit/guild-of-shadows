import { LocalPlatform } from './local';
import type { Platform } from './platform';
import { YandexPlatform } from './yandex';
import { SaveLoadError } from './platform';

export type { Platform };
export { SaveLoadError };

const PLATFORM_KEY = 'gos.platform';

function loadScript(src: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement('script');
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(t);
      el.onload = null;
      el.onerror = null;
      if (!ok) el.remove();
      resolve(ok);
    };
    const t = window.setTimeout(() => done(false), timeoutMs);
    el.src = src;
    el.onload = () => done(true);
    el.onerror = () => done(false);
    document.head.append(el);
  });
}

/**
 * Выбирает площадку: на Яндекс.Играх по адресу /sdk.js отдаётся SDK, локально его нет —
 * тогда обычная сборка работает локально. Релизная сборка Яндекса и ранее подключённая
 * к нему игра требуют SDK, чтобы ошибка сети не запускала новую локальную игру.
 */
export async function createPlatform(): Promise<Platform> {
  let requireSdk = import.meta.env.VITE_REQUIRE_YANDEX_SDK === 'true';
  try { requireSdk ||= window.localStorage.getItem(PLATFORM_KEY) === 'yandex'; } catch { /* storage unavailable */ }
  if (!window.YaGames) await loadScript('/sdk.js', 3000);
  if (window.YaGames) {
    try {
      const p = new YandexPlatform();
      await p.init();
      try { window.localStorage.setItem(PLATFORM_KEY, 'yandex'); } catch { /* storage unavailable */ }
      return p;
    } catch (e) {
      console.warn('Яндекс SDK временно недоступен', e);
      throw new SaveLoadError();
    }
  }
  if (requireSdk) throw new SaveLoadError();
  const local = new LocalPlatform();
  await local.init();
  return local;
}
