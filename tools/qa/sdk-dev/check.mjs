// Official Yandex development SDK, production build. No SDK mocks or response interception.
// node tools/qa/sdk-dev/check.mjs [base] [save-directory] [report.json]
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build } from 'vite';

const [base = 'https://localhost:8080/', saves = 'qa-saves', out = 'qa-out/sdk-dev/report.json'] = process.argv.slice(2);
const certificate = new X509Certificate(readFileSync(process.env.YANDEX_QA_CERT ?? 'work/yandex-sdk/localhost.crt'));
const pin = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
const report = {
  status: 'failed', scope: 'official-dev-adapter', platformAcceptance: 'not_run',
  limitations: ['Development storage uses localStorage, not Yandex cloud',
    'Development ads are test windows, not live ads', 'SDK on() only logs; real platform pause/resume is not exercised'],
  checks: [], sdk: [], pageErrors: [],
};
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: [
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--ignore-certificate-errors-spki-list=${pin}`,
] });
const pending = [];
const ad = '#ADV_BANNER';
const closeAd = `${ad} img.webgames-adv-cross`;
const rawState = page => page.evaluate(() => JSON.parse(localStorage.getItem('gos.save')));
const telemetry = page => page.evaluate(() => window.__t2Events);
async function open(name, prepare = () => {}) {
  const seed = JSON.parse(readFileSync(join(saves, `${name}.json`), 'utf8'));
  seed.lastSeen = Date.now();
  for (const post of Object.keys(seed.posts)) seed.posts[post] = 0; // isolate rewards from passive income
  prepare(seed);
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript(seed => {
    if (!sessionStorage.getItem('t2.seeded')) {
      localStorage.setItem('gos.save', JSON.stringify(seed));
      sessionStorage.setItem('t2.seeded', '1');
    }
    if (sessionStorage.getItem('t2.clearLocal')) {
      localStorage.removeItem('gos.save');
      sessionStorage.removeItem('t2.clearLocal');
    }
    window.__t2Events = [];
    window.addEventListener('gos:analytics', event => window.__t2Events.push(event.detail));
  }, seed);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const features = [];
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => {
    const feature = message.text().match(/(?:LoadingAPI\.ready|GameplayAPI\.(?:start|stop))\(\)/)?.[0];
    if (feature) features.push(feature);
  });
  page.on('response', response => {
    if (new URL(response.url()).pathname !== '/sdk.js') return;
    // Catch immediately, so a failed response cannot become an unhandled rejection.
    pending.push(response.body().then(body => {
      assert.equal(response.status(), 200);
      assert(body.includes(Buffer.from('webgames-dev-adapter')), 'Expected official development SDK');
      report.sdk.push({ url: response.url(), status: response.status(), sha256: createHash('sha256').update(body).digest('hex') });
    }).catch(error => { report.pageErrors.push(error.message); }));
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.tab').first().waitFor();
  assert.equal((await telemetry(page)).find(event => event.event === 'game_start')?.params.platform, 'yandex');
  return { page, features };
}

try {
  // An active run makes the LoadingAPI/GameplayAPI order observable.
  const { page: map, features } = await open('event', seed => {
    seed.posts.barracks = 10; // make paused income observable through the real UI
    const run = JSON.parse(seed.activeRun);
    run.members[0].alive = false;
    run.members[0].frac = 0;
    run.fallen = [run.members[0].heroId];
    seed.activeRun = JSON.stringify(run);
  });
  await map.locator('.screen--stage-map').waitFor();
  assert(features.includes('LoadingAPI.ready()'));
  assert(features.indexOf('GameplayAPI.start()') > features.indexOf('LoadingAPI.ready()'));
  report.checks.push({ name: 'strict-build-sdk-startup', ok: true, features: [...features] });

  await map.getByRole('button', { name: 'Воскресить павшего за рекламу', exact: true }).click();
  await map.locator(`${ad} .webgames-adv-timer`).waitFor();
  const gold = await map.locator('.topbar__gold strong').innerText();
  assert.equal(features.at(-1), 'GameplayAPI.stop()');
  await map.waitForTimeout(1300);
  assert.equal(await map.locator('.topbar__gold strong').innerText(), gold, 'Income advanced during official test ad');
  await map.locator(closeAd).click();
  await map.locator(ad).waitFor({ state: 'detached' });
  assert.equal(features.at(-1), 'GameplayAPI.start()');
  await map.waitForFunction(before => document.querySelector('.topbar__gold strong').textContent !== before, gold);
  const cancelled = JSON.parse((await rawState(map)).activeRun);
  assert.equal(cancelled.members[0].alive, false);
  assert.equal(cancelled.reviveLeft, 1);
  report.checks.push({ name: 'official-rewarded-pauses-income-and-gameplay-then-resumes', ok: true, features: [...features] });

  const { page } = await open('summary');
  await page.locator('.summary').waitFor();
  const before = await rawState(page);
  const extra = JSON.parse(before.activeRun).summary.gold;
  assert(extra > 0);
  const reward = page.getByRole('button', { name: 'Удвоить золото за рекламу', exact: true });
  await reward.click();
  await page.locator(`${ad} .webgames-adv-timer`).waitFor();
  // A second UI click while the real SDK window is open must not start another request.
  await reward.evaluate(button => button.click());
  assert.equal(await page.locator(ad).count(), 1);
  await page.locator(closeAd).click();
  await page.locator(ad).waitFor({ state: 'detached' });
  assert.equal((await rawState(page)).gold, before.gold);
  assert(!JSON.parse((await rawState(page)).activeRun).summary.doubled);
  assert.equal((await telemetry(page)).filter(event => event.event === 'rewarded_start').length, 1);
  report.checks.push({ name: 'rewarded-close-without-reward-and-overlap', ok: true, extraGold: 0 });

  await reward.click();
  await page.locator(`${ad} .webgames-adv-timer`).waitFor();
  await page.locator(`${ad} .webgames-adv-timer`).waitFor({ state: 'detached' });
  await page.locator(closeAd).click();
  await reward.waitFor({ state: 'detached' });
  const after = await rawState(page);
  assert.equal(after.gold, before.gold + extra);
  assert.equal(JSON.parse(after.activeRun).summary.doubled, true);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.summary').waitFor();
  assert.equal((await rawState(page)).gold, after.gold);
  assert.equal(JSON.parse((await rawState(page)).activeRun).summary.doubled, true);
  assert.equal(await reward.count(), 0);
  report.checks.push({ name: 'rewarded-complete-once-and-reload', ok: true, extraGold: extra });

  await page.waitForFunction(() => {
    const raw = JSON.parse(localStorage.getItem('webgames-dev-adapter') ?? '{}')?.data?.save;
    return raw && JSON.parse(JSON.parse(raw).activeRun).summary.doubled;
  }, undefined, { timeout: 25_000 });
  await page.evaluate(() => sessionStorage.setItem('t2.clearLocal', '1'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.summary').waitFor();
  const restored = await rawState(page);
  assert.equal(restored.createdAt, before.createdAt);
  assert.equal(restored.gold, after.gold);
  assert.equal(restored.expeditionsCompleted, after.expeditionsCompleted);
  assert.equal(restored.activeRun, after.activeRun);
  assert.equal(await reward.count(), 0);
  report.checks.push({ name: 'official-setData-getData-without-game-local-save', ok: true, storage: 'development-localStorage' });

  // Fullscreen has no UI caller. Build the real adapter source, with no SDK replacement.
  const built = await build({ configFile: false, logLevel: 'silent', build: {
    write: false, minify: false,
    lib: { entry: fileURLToPath(new URL('../../../src/platform/yandex.ts', import.meta.url)), name: 'T2YandexAdapter', formats: ['iife'] },
  } });
  const bundle = (Array.isArray(built) ? built : [built]).flatMap(result => 'output' in result ? result.output : [])
    .find(entry => entry.type === 'chunk');
  assert(bundle?.type === 'chunk');
  await map.addScriptTag({ content: bundle.code });
  await map.evaluate(async () => {
    const adapter = new window.T2YandexAdapter.YandexPlatform();
    await adapter.init();
    window.__t2Adapter = adapter;
    window.__t2Fullscreen = adapter.showInterstitial();
  });
  await map.locator(ad).waitFor();
  assert.equal(await map.evaluate(() => window.__t2Adapter.isPaused()), true);
  assert.equal(await map.evaluate(() => window.__t2Adapter.showRewarded('double_gold')), false);
  await map.locator(closeAd).click();
  await map.evaluate(() => window.__t2Fullscreen);
  assert.equal(await map.evaluate(() => window.__t2Adapter.isPaused()), false);
  report.checks.push({ name: 'official-fullscreen-close-pause-and-overlap', ok: true, scope: 'source-built-adapter' });

  await Promise.all(pending);
  assert(report.sdk.length > 0);
  assert.deepEqual(report.pageErrors, []);
  report.status = 'passed';
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
} finally {
  await browser.close();
  await Promise.all(pending);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'passed' ? 0 : 1;
