import { LocalPlatform } from './local';
import type { Platform } from './platform';
import { YandexPlatform } from './yandex';

export type { Platform };

function loadScript(src: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement('script');
    const done = (ok: boolean) => {
      window.clearTimeout(t);
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
 * тогда работает LocalPlatform. Так одна и та же сборка идёт и в разработке, и в продакшене.
 */
export async function createPlatform(): Promise<Platform> {
  await loadScript('/sdk.js', 3000);
  if (window.YaGames) {
    try {
      const p = new YandexPlatform();
      await p.init();
      return p;
    } catch (e) {
      console.warn('Яндекс SDK не поднялся, работаем локально', e);
    }
  }
  const local = new LocalPlatform();
  await local.init();
  return local;
}
