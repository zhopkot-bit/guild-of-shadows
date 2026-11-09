// Startup failures, cloud protection, retry, and real rewarded UI. SDK is simulated.
// node tools/qa/reliability.mjs <base> <save-directory> <out> [yandex-build-base]
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const [base = 'http://127.0.0.1:4173/', saves = 'qa-saves', out = 'qa-out/reliability', strictBase] = process.argv.slice(2);
const guild = JSON.parse(readFileSync(join(saves, 'guild.json'), 'utf8'));
const summary = JSON.parse(readFileSync(join(saves, 'summary.json'), 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium' });
const rows = [];
let expectedRows = 0;
mkdirSync(out, { recursive: true });

async function open(config, url = base, viewport = { width: 667, height: 375 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route('**/sdk.js', route => route.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript(({ config }) => {
    const first = !sessionStorage.getItem('seeded');
    if (first) {
      if (config.local !== null) {
        const value = typeof config.local === 'string' ? config.local : JSON.stringify({ ...config.local, lastSeen: Date.now() });
        localStorage.setItem('gos.save', value);
      }
      if (config.knownYandex) localStorage.setItem('gos.platform', 'yandex');
      sessionStorage.setItem('seeded', '1');
    }
    window.__initialLocalRaw = localStorage.getItem('gos.save');
    window.__cloudWrites = [];
    window.__adRequests = 0;
    window.__sdkHandlers = {};
    const recovered = !!sessionStorage.getItem('networkRecovered');
    const hang = () => new Promise(() => {});
    const fail = () => Promise.reject(new Error('simulated offline'));
    const data = () => {
      if (!recovered && config.cloudMode === 'error') return fail();
      if (!recovered && config.cloudMode === 'timeout') return hang();
      return Promise.resolve({ save: config.cloud ? JSON.stringify(config.cloud) : null });
    };
    const player = {
      getData: data,
      setData: async value => { window.__cloudWrites.push(value.save); },
    };
    if (config.sdk !== 'absent') window.YaGames = { init: async () => {
      if (!recovered && config.sdk === 'error') return fail();
      if (!recovered && config.sdk === 'timeout') return hang();
      return {
        on: (name, callback) => { window.__sdkHandlers[name] = callback; },
        getPlayer: () => {
          if (!recovered && config.playerMode === 'error') return fail();
          if (!recovered && config.playerMode === 'timeout') return hang();
          return Promise.resolve(player);
        },
        serverTime: () => Date.now(),
        environment: { i18n: { lang: 'ru' } },
        features: { LoadingAPI: { ready() {} }, GameplayAPI: { start() {}, stop() {} } },
        adv: {
          showRewardedVideo: ({ callbacks }) => { window.__adRequests++; window.__adCallbacks = callbacks; },
          showFullscreenAdv: ({ callbacks }) => callbacks.onClose?.(true),
        },
      };
    } };
  }, { config });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  return { ctx, page, errors };
}

const raw = page => page.evaluate(() => localStorage.getItem('gos.save'));
const state = async page => JSON.parse(await raw(page));
const flushHidden = page => page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});
const cloudCalls = page => page.evaluate(() => window.__cloudWrites.length);

try {
  const future = { ...guild, version: 999 };
  const cases = [
    { name: 'ordinary-without-sdk', sdk: 'absent', local: guild, expected: 'guild' },
    { name: 'known-yandex-without-sdk', sdk: 'absent', knownYandex: true, local: null, expected: 'error' },
    { name: 'sdk-init-error', sdk: 'error', local: guild, expected: 'error' },
    { name: 'sdk-init-timeout', sdk: 'timeout', local: null, expected: 'error' },
    { name: 'player-error-with-local', playerMode: 'error', local: guild, expected: 'guild', offline: true },
    { name: 'player-error-without-local', playerMode: 'error', local: null, expected: 'error' },
    { name: 'player-timeout-with-local', playerMode: 'timeout', local: guild, expected: 'guild', offline: true },
    { name: 'cloud-error-with-local', cloudMode: 'error', local: guild, expected: 'guild', offline: true },
    { name: 'cloud-error-local-retry', cloudMode: 'error', local: guild, cloud: { ...guild, gold: 99_000, lastSeen: Date.now() + 60_000 }, expected: 'guild', offline: true, retry: true },
    { name: 'cloud-error-without-local-and-retry', cloudMode: 'error', local: null, cloud: guild, expected: 'error', retry: true },
    { name: 'cloud-error-corrupt-local', cloudMode: 'error', local: '{broken', expected: 'error' },
    { name: 'cloud-timeout-with-local', cloudMode: 'timeout', local: guild, expected: 'guild', offline: true },
    { name: 'future-cloud-save', local: guild, cloud: future, expected: 'newer' },
    { name: 'future-local-offline', local: future, cloudMode: 'error', expected: 'newer' },
  ];
  if (strictBase) cases.push(
    { name: 'yandex-build-without-sdk', sdk: 'absent', local: null, expected: 'error', url: strictBase },
    { name: 'yandex-build-with-sdk', local: guild, expected: 'guild', url: strictBase },
  );
  expectedRows = cases.length + 4;
  for (const config of cases) {
    const { ctx, page, errors } = await open(config, config.url ?? base);
    if (config.expected === 'error') {
      await page.waitForSelector('.boot-error');
      const saved = await raw(page);
      assert.equal(saved, await page.evaluate(() => window.__initialLocalRaw), 'Changed a save during failed startup');
      if (config.local === null) assert.equal(saved, null, 'Created a save before reading cloud');
      else if (typeof config.local === 'string') assert.equal(saved, config.local);
      else assert.equal(JSON.parse(saved).gold, config.local.gold);
      assert.equal(await cloudCalls(page), 0);
      assert.ok((await page.locator('.boot-error').innerText()).includes('Прогресс пока недоступен'));
      const fit = await page.locator('.boot-error .btn').boundingBox();
      assert.ok(fit && fit.x >= 0 && fit.y >= 0 && fit.x + fit.width <= 668 && fit.y + fit.height <= 376);
      if (config.retry) {
        await page.screenshot({ path: join(out, 'retry-before.png') });
        await page.evaluate(() => sessionStorage.setItem('networkRecovered', '1'));
        await Promise.all([
          page.waitForNavigation(),
          page.getByRole('button', { name: 'Повторить попытку', exact: true }).click(),
        ]);
        await page.waitForSelector('.screen--guild');
        const restored = await state(page);
        assert.equal(restored.createdAt, guild.createdAt);
        assert.ok(restored.gold >= guild.gold);
        await page.screenshot({ path: join(out, 'retry-restored.png') });
      }
    } else if (config.expected === 'newer') {
      await page.waitForSelector('.modal');
      assert.ok((await page.locator('.modal').innerText()).includes('Сохранение от новой версии'));
      await flushHidden(page);
      await page.waitForTimeout(100);
      assert.equal(await cloudCalls(page), 0, 'Overwrote a future save in cloud');
      assert.equal(await raw(page), await page.evaluate(() => window.__initialLocalRaw));
      assert.equal((await state(page)).version, config.local.version);
      assert.equal((await state(page)).gold, config.local.gold);
    } else {
      await page.waitForSelector('.screen--guild');
      if (config.offline) {
        await page.waitForSelector('.modal');
        assert.equal(await raw(page), await page.evaluate(() => window.__initialLocalRaw), 'Changed local timestamp before offline-play choice');
        if (config.retry) {
          await page.evaluate(() => sessionStorage.setItem('networkRecovered', '1'));
          await Promise.all([
            page.waitForNavigation(),
            page.getByRole('button', { name: 'Повторить попытку', exact: true }).click(),
          ]);
          await page.waitForSelector('.screen--guild');
          assert.ok((await state(page)).gold >= config.cloud.gold, 'Retry failed to recover newer cloud progress');
        } else await page.getByRole('button', { name: 'Продолжить игру', exact: true }).click();
      }
      const restored = await state(page);
      assert.equal(restored.createdAt, guild.createdAt);
      assert.ok(restored.gold >= guild.gold);
      if (config.offline && !config.retry) {
        await flushHidden(page);
        await page.waitForTimeout(100);
        assert.equal(await cloudCalls(page), 0, 'Uploaded without first reading cloud');
      }
    }
    assert.deepEqual(errors, []);
    rows.push({ name: config.name, expected: config.expected, retry: !!config.retry, ok: true, errors });
    console.log(JSON.stringify(rows.at(-1)));
    await ctx.close();
  }

  for (const mode of ['rewarded', 'closed', 'sdk-error', 'local']) {
    const { ctx, page, errors } = await open({ local: summary, sdk: mode === 'local' ? 'absent' : 'ready' });
    await page.waitForSelector('.summary');
    const reward = page.getByRole('button', { name: 'Удвоить золото за рекламу', exact: true });
    await reward.evaluate(button => { button.click(); button.click(); });
    const paused = await state(page);
    const extra = JSON.parse(paused.activeRun).summary.gold;
    assert.ok(extra > 0);
    if (mode === 'local') {
      assert.equal(await page.locator('.fake-ad').count(), 1);
      await page.waitForTimeout(2200);
      assert.equal((await state(page)).gold, paused.gold, 'Economy advanced during fake ad');
      await page.locator('.fake-ad .btn:not([disabled])').click();
    } else {
      assert.equal(await page.evaluate(() => window.__adRequests), 1);
      await page.evaluate(mode => {
        const callbacks = window.__adCallbacks;
        if (mode === 'rewarded') callbacks.onRewarded();
        if (mode === 'sdk-error') callbacks.onError(new Error('no ad'));
        else callbacks.onClose(true);
        callbacks.onClose(true);
        callbacks.onRewarded(); // A late reward must not change an already closed request.
      }, mode);
    }
    if (mode === 'rewarded' || mode === 'local') {
      await page.waitForFunction(() => JSON.parse(JSON.parse(localStorage.getItem('gos.save')).activeRun).summary.doubled);
      const after = await state(page);
      assert.equal(after.gold, paused.gold + extra, 'Reward was not granted exactly once');
      const completed = after.expeditionsCompleted;
      await page.reload();
      await page.waitForSelector('.summary');
      assert.equal(await reward.count(), 0, 'Reward became available again after reload');
      assert.equal((await state(page)).expeditionsCompleted, completed);
      assert.equal(JSON.parse((await state(page)).activeRun).summary.doubled, true);
    } else {
      await page.waitForTimeout(100);
      assert.equal((await state(page)).gold, paused.gold);
      assert.ok(!JSON.parse((await state(page)).activeRun).summary.doubled);
      assert.equal(await reward.count(), 1);
    }
    assert.deepEqual(errors, []);
    rows.push({ name: `reward-ui-${mode}`, ok: true, extraGold: mode === 'rewarded' || mode === 'local' ? extra : 0, errors });
    console.log(JSON.stringify(rows.at(-1)));
    await ctx.close();
  }
} finally {
  await browser.close();
  writeFileSync(join(out, 'report.json'), JSON.stringify({ ok: expectedRows > 0 && rows.length === expectedRows, rows }, null, 2));
}
