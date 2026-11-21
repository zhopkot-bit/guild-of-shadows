// node tools/qa/yandex-draft.mjs <draft URL> <report.json> [dist directory]
// Launch a fresh guest session. Observe the game's normal startup in its own frame.
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [address, reportPath, dist = 'dist'] = process.argv.slice(2);
if (!address || !reportPath) throw new Error('Укажите URL черновика и путь к JSON-отчёту.');
const target = new URL(address);
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
if (target.protocol !== 'https:' && !(loopback && target.protocol === 'http:')) {
  throw new Error('Нужна ссылка HTTPS на черновик или локальный HTTP для проверки отказа.');
}
const html = await readFile(resolve(dist, 'index.html'), 'utf8');
const entryTag = html.match(/<script\b[^>]*type="module"[^>]*>/)?.[0];
const entryPath = entryTag?.match(/\bsrc="([^"]+)"/)?.[1];
if (!entryPath) throw new Error('В dist/index.html не найден игровой модуль.');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const expected = hash(await readFile(resolve(dist, entryPath.replace(/^\//, ''))));
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium' });
const report = {
  checkedAt: new Date().toISOString(), startupObserved: false, expectedEntrySha256: expected, actualEntrySha256: null,
  gameOrigin: null, sdkScriptHttpStatus: null, sdkInitAvailable: false,
  yandexGameStart: false, gameUiVisible: false, problems: [],
};
try {
  const page = await browser.newPage();
  const scripts = new Map();
  page.on('response', (response) => {
    if (response.request().resourceType() !== 'script' || response.request().serviceWorker()) return;
    const frame = response.frame();
    if (!scripts.has(frame)) scripts.set(frame, new Map());
    // Associate the final response with the script URL requested by the game, including redirects.
    for (let request = response.request(); request; request = request.redirectedFrom()) {
      scripts.get(frame).set(request.url(), response);
    }
  });
  await page.addInitScript(() => {
    window.addEventListener('gos:analytics', ({ detail }) => {
      if (detail?.event === 'game_start' && detail.platform === 'yandex') window.__t4YandexStart = true;
    });
  });
  await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  // The platform may embed the game after its own shell has finished loading.
  const deadline = Date.now() + 60_000;
  let game;
  while (!game && Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (await frame.locator('#app .tabbar .tab').first().isVisible().catch(() => false)) {
        game = frame;
        break;
      }
    }
    if (!game) await page.waitForTimeout(250);
  }
  if (!game) throw new Error('Экран игры не появился за отведённое время.');
  const observed = await game.evaluate(() => ({
    origin: location.origin, entryUrl: document.querySelector('script[type="module"][src]')?.src,
    sdkUrl: new URL('/sdk.js', location.origin).href,
    available: typeof window.YaGames?.init === 'function', started: window.__t4YandexStart === true,
  }));
  report.gameUiVisible = true;
  report.gameOrigin = observed.origin;
  report.sdkInitAvailable = observed.available;
  report.yandexGameStart = observed.started;
  const responses = scripts.get(game);
  const entry = responses?.get(observed.entryUrl);
  const sdk = responses?.get(observed.sdkUrl);
  report.sdkScriptHttpStatus = sdk?.status() ?? null;
  if (entry?.ok()) report.actualEntrySha256 = hash(await entry.body());
  if (report.actualEntrySha256 !== expected) report.problems.push('Версия игрового модуля не подтверждена.');
  if (!sdk?.ok()) report.problems.push('Не подтверждён успешный HTTP-ответ скрипта /sdk.js в кадре игры.');
  if (!observed.available || !observed.started) report.problems.push('Не подтверждён запуск игры через адаптер Яндекса.');
  if (loopback) report.problems.push('Локальный запуск не является проверкой черновика.');
  report.startupObserved = report.problems.length === 0;
} catch (error) {
  // Draft URLs can contain access parameters. Keep them out of saved diagnostics.
  report.problems.push(error instanceof Error ? error.message.split('\n')[0].replace(/https?:\/\/\S+/g, '[URL]') : 'Ошибка запуска.');
} finally {
  await browser.close();
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report));
if (!report.startupObserved) process.exitCode = 1;
