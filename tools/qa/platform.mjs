// Production integration with a simulated SDK; no live Yandex account or ads.
// node tools/qa/platform.mjs <baseUrl> <battle-save.json> <outDir>
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [base = 'http://127.0.0.1:4173/', savePath = 'qa-saves/battle.json', out = 'qa-out/platform'] = process.argv.slice(2);
const save = JSON.parse(readFileSync(savePath, 'utf8'));
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const rows = [];
mkdirSync(out, { recursive: true });

const battle = page => page.evaluate(() => JSON.stringify(window.__gosArena.battle()));
const emit = (page, name) => page.evaluate(name => window.__sdkHandlers[name]?.(), name);
const inert = page => page.locator('.stage--battle').evaluate(el => el.inert);
const closeCoach = async page => {
  const button = page.locator('.coach:not([hidden]) button');
  if (await button.count()) await button.click();
};
const unchanged = async page => {
  const before = await battle(page);
  await page.waitForTimeout(700);
  assert.equal(await battle(page), before, 'Battle advanced during pause');
};

try {
  for (const [width, height] of [[1920, 1080], [667, 375]]) {
    for (const scenario of ['sdk', 'offline']) {
      const context = await browser.newContext({ viewport: { width, height } });
      const errors = [];
      await context.route('**/sdk.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
      await context.addInitScript(({ save, scenario, noWebgl }) => {
        if (noWebgl) {
          const original = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (type, ...args) {
            return /webgl/i.test(type) ? null : original.call(this, type, ...args);
          };
        }
        const NativeAudio = window.AudioContext;
        window.__audioContexts = [];
        if (NativeAudio) window.AudioContext = class extends NativeAudio {
          constructor(...args) { super(...args); window.__audioContexts.push(this); }
        };
        window.__sdkHandlers = {};
        window.__gameplayCalls = [];
        window.__loadingReady = false;
        window.__cloudWrites = [];
        window.YaGames = { init: async () => ({
          on: (name, handler) => { window.__sdkHandlers[name] = handler; },
          getPlayer: async () => {
            if (scenario === 'sdk') window.__sdkHandlers.game_api_pause();
            return {
              getData: async () => ({}),
              setData: async data => { window.__cloudWrites.push(data.save); },
            };
          },
          serverTime: () => Date.now(),
          environment: { i18n: { lang: 'ru' } },
          features: {
            LoadingAPI: { ready: () => { window.__loadingReady = true; } },
            GameplayAPI: {
              start: () => {
                if (!window.__loadingReady) throw new Error('Gameplay started before LoadingAPI.ready');
                window.__gameplayCalls.push('start');
              },
              stop: () => window.__gameplayCalls.push('stop'),
            },
          },
          adv: { showRewardedVideo: () => {}, showFullscreenAdv: () => {} },
        }) };
        save.lastSeen = Date.now() - (scenario === 'offline' ? 7_200_000 : 0);
        save.tipsSeen = ['turn', 'telegraph', 'cover', 'heal', 'wave'];
        localStorage.setItem('gos.save', JSON.stringify(save));
      }, { save, scenario, noWebgl: process.env.NO_WEBGL === '1' });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
      });
      await page.goto(`${base}?qa=1`);
      await page.waitForFunction(() => window.__gosArena?.stats().units.length > 0);
      const backend = await page.evaluate(() => window.__gosArena.stats().backend);
      assert.equal(backend, process.env.NO_WEBGL === '1' ? 'canvas2d' : 'webgl');
      assert.equal(await inert(page), true);
      await unchanged(page);
      await page.evaluate(() => {
        window.__sdkHandlers.game_api_resume();
        window.__sdkHandlers.game_api_pause();
      });
      await unchanged(page);

      if (scenario === 'offline') {
        await page.waitForSelector('.modal');
        await emit(page, 'game_api_pause');
        await page.locator('.modal .btn').click();
        assert.equal(await inert(page), true, 'Closing modal cleared SDK pause');
        await unchanged(page);
      }
      await emit(page, 'game_api_resume');
      await page.waitForSelector('.action--attack');
      assert.equal(await inert(page), false);
      await closeCoach(page);
      await page.locator('.segmented button', { hasText: '×4' }).click();

      // A real user action must still work after resuming.
      const beforeAction = await battle(page);
      await page.locator('.action--attack').click();
      await page.locator('.plate--enemy.is-target').first().click();
      await page.waitForFunction(before => JSON.stringify(window.__gosArena.battle()) !== before, beforeAction);
      await page.waitForSelector('.action--attack');
      await emit(page, 'game_api_pause');
      assert.equal(await inert(page), true);
      // Programmatic controls and keyboard input must not bypass a pause.
      await page.getByRole('button', { name: 'Досчитать', exact: true }).evaluate(el => el.click());
      await page.keyboard.press('1');
      await unchanged(page);
      const audioStates = await page.evaluate(() => window.__audioContexts.map(ctx => ctx.state));
      assert.ok(audioStates.length > 0, 'No real audio context was exercised');
      assert.ok(audioStates.every(state => state === 'suspended'), `Audio during pause: ${audioStates}`);

      // SDK resume cannot clear a separate hidden-tab pause.
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await emit(page, 'game_api_resume');
      assert.equal(await inert(page), true);
      await unchanged(page);
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      assert.equal(await inert(page), false);
      await page.waitForFunction(() => window.__audioContexts.every(ctx => ctx.state === 'running'));

      // Pause while autoplay is running, then confirm it resumes.
      await page.locator('.segmented button', { hasText: 'Авто' }).click();
      await page.waitForTimeout(100);
      await emit(page, 'game_api_pause');
      await unchanged(page);
      const beforeResume = await battle(page);
      await emit(page, 'game_api_resume');
      await page.waitForFunction(before => {
        const current = window.__gosArena.battle();
        return JSON.stringify(current) !== before || current.result !== 'ongoing';
      }, beforeResume);
      // Replacing a paused battle screen must cancel its pending turn and animations.
      await emit(page, 'game_api_pause');
      const beforeTabChange = await battle(page);
      // Battle layout hides navigation; invoke its handler to exercise teardown directly.
      await page.locator('.tab', { hasText: 'Отряд' }).evaluate(el => el.click());
      await page.waitForTimeout(300);
      await page.locator('.tab', { hasText: 'Экспедиция' }).click();
      await page.waitForFunction(() => window.__gosArena?.stats().units.length > 0);
      assert.equal(await battle(page), beforeTabChange, 'Destroyed battle screen applied a late action');
      await unchanged(page);
      await emit(page, 'game_api_resume');
      await page.waitForFunction(before => {
        const current = window.__gosArena.battle();
        return JSON.stringify(current) !== before || current.result !== 'ongoing';
      }, beforeTabChange);
      const gameplay = await page.evaluate(() => window.__gameplayCalls);
      assert.ok(gameplay.includes('start') && gameplay.includes('stop'));
      assert.ok(gameplay.every((value, index) => index === 0 || gameplay[index - 1] !== value), 'Repeated GameplayAPI state');
      assert.deepEqual(errors, []);
      await emit(page, 'game_api_pause');
      await page.screenshot({ path: `${out}/${width}x${height}-${scenario}.png` });
      rows.push({ viewport: [width, height], scenario, backend, ok: true, audioStates, gameplay, errors });
      console.log(JSON.stringify(rows.at(-1)));
      await context.close();
    }
  }
} finally {
  await browser.close();
  writeFileSync(`${out}/report.json`, JSON.stringify({ ok: rows.length === 4, rows }, null, 2));
}
