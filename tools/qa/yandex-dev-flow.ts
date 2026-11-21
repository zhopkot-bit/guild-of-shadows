/** Official Yandex dev-adapter integration. No SDK doubles or response interception.
 * This verifies local development only; Yandex backend and platform events require a draft game.
 */
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';
import { build } from 'vite';
import { newGame } from '../../src/core/state';
import { serialize } from '../../src/core/save';
import { finishRun, serializeRun, startRun } from '../../src/expedition/run';

const base = process.argv[2] ?? 'https://localhost:8080/';
const out = process.argv[3] ?? 'qa-out/yandex-dev-flow.json';
const args = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
if (process.env.YANDEX_QA_CERT) {
  const cert = new X509Certificate(readFileSync(process.env.YANDEX_QA_CERT));
  const pin = createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  args.push(`--ignore-certificate-errors-spki-list=${pin}`);
}
const report = {
  status: 'failed', scope: 'official-dev-adapter', platformAcceptance: 'not_run',
  limitations: ['SDK storage is localStorage, not Yandex cloud', 'SDK on() is a logging stub; platform pause/resume is not exercised',
    'Advertising windows are official development simulations, not live ads'],
  checks: [] as string[], sdk: [] as Array<{ url: string; status: number; sha256: string }>,
  features: [] as string[], pageErrors: [] as string[], error: undefined as string | undefined,
};
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args });
const pending: Promise<void>[] = [];
const savedRun = (page: Page) => page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('gos.save')!).activeRun));
const ad = '#ADV_BANNER';
const closeAd = `${ad} img.webgames-adv-cross`;
const revive = 'Воскресить павшего за рекламу';
try {
  const state = newGame(Date.now());
  state.posts.barracks = 10; // visible income makes a paused economy observable
  const run = startRun(state, Date.now(), 1);
  run.members[0]!.alive = false;
  run.members[0]!.frac = 0;
  run.fallen = [run.members[0]!.heroId];
  state.activeRun = serializeRun(run);
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript((raw) => {
    if (!sessionStorage.getItem('t1.dev.seeded')) {
      localStorage.setItem('gos.save', raw);
      sessionStorage.setItem('t1.dev.seeded', '1');
    }
    if (sessionStorage.getItem('t1.dev.clearLocal')) {
      localStorage.removeItem('gos.save');
      sessionStorage.removeItem('t1.dev.clearLocal');
    }
    Reflect.set(window, '__t1DevEvents', []);
    window.addEventListener('gos:analytics', (event) => {
      Reflect.get(window, '__t1DevEvents').push((event as CustomEvent).detail);
    });
  }, serialize(state));
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  page.on('console', (message) => {
    const feature = message.text().match(/(?:LoadingAPI\.ready|GameplayAPI\.(?:start|stop))\(\)/)?.[0];
    if (feature) report.features.push(feature);
  });
  page.on('response', (response) => {
    if (!/\/sdk\.js(?:\?|$)/.test(response.url())) return;
    pending.push((async () => {
      const body = await response.body();
      report.sdk.push({ url: response.url(), status: response.status(), sha256: createHash('sha256').update(body).digest('hex') });
      assert.equal(response.status(), 200);
      assert(body.includes(Buffer.from('webgames-dev-adapter')), 'This test requires the official dev-adapter');
    })());
  });
  await page.goto(`${base}?qa=1`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: revive, exact: true }).waitFor();
  assert.equal(await page.evaluate(() => Reflect.get(window, '__t1DevEvents').find((e: { event: string }) => e.event === 'game_start')?.params.platform), 'yandex');
  const ready = report.features.indexOf('LoadingAPI.ready()');
  assert(ready >= 0 && report.features.indexOf('GameplayAPI.start()') > ready);
  report.checks.push('Production app uses YandexPlatform; LoadingAPI.ready precedes GameplayAPI.start');

  // The official development ad's close button cancels a rewarded ad during its countdown.
  await page.getByRole('button', { name: revive, exact: true }).click();
  await page.locator(ad).waitFor();
  const gold = await page.locator('.topbar__gold strong').innerText();
  const featureCount = report.features.length;
  assert.equal(report.features.at(-1), 'GameplayAPI.stop()');
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.topbar__gold strong').innerText(), gold);
  await page.locator(closeAd).click();
  await page.locator(ad).waitFor({ state: 'detached' });
  assert.equal((await savedRun(page)).reviveLeft, 1);
  assert.equal((await savedRun(page)).members[0].alive, false);
  assert(report.features.slice(featureCount).includes('GameplayAPI.start()'));
  report.checks.push('Early official rewarded close gives no revive; ad pauses income and GameplayAPI, then resumes');

  // Finishing the SDK's own countdown must grant exactly one revive and persist its limit.
  await page.getByRole('button', { name: revive, exact: true }).click();
  await page.locator(`${ad} .webgames-adv-timer`).waitFor();
  await page.locator(`${ad} .webgames-adv-timer`).waitFor({ state: 'detached' });
  await page.locator(closeAd).click();
  await page.getByRole('button', { name: revive, exact: true }).waitFor({ state: 'detached' });
  const revived = await savedRun(page);
  assert.equal(revived.reviveLeft, 0);
  assert.equal(revived.members[0].alive, true);
  assert.equal(revived.members[0].frac, 0.3);
  assert.deepEqual(revived.fallen, []);
  report.checks.push('Official rewarded onRewarded/onClose revives at 30% HP once and saves immediately');

  // Wait for the adapter's actual setData queue, then restore without the app's local copy.
  await page.waitForFunction(() => {
    const raw = JSON.parse(localStorage.getItem('webgames-dev-adapter') ?? '{}')?.data?.save;
    return raw && JSON.parse(JSON.parse(raw).activeRun).reviveLeft === 0;
  }, undefined, { timeout: 25_000 });
  await page.evaluate(() => sessionStorage.setItem('t1.dev.clearLocal', '1'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.screen--stage-map').waitFor();
  assert.deepEqual(await savedRun(page), revived);
  assert.equal(await page.getByRole('button', { name: revive, exact: true }).count(), 0);
  report.checks.push('setData/getData roundtrip restores run and reward limit with gos.save removed (development storage only)');

  await context.close();
  const endedState = newGame(Date.now());
  endedState.posts.barracks = 10;
  const endedRun = startRun(endedState, Date.now(), 1);
  endedRun.stage = 'ended';
  endedRun.result = 'defeat';
  const summary = finishRun(endedRun, endedState, Date.now());
  assert(summary.gold > 0);
  endedState.posts.barracks = 0; // isolate the reward from passive income
  endedState.activeRun = serializeRun(endedRun);
  const endedContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await endedContext.addInitScript((raw) => {
    if (sessionStorage.getItem('t1.dev.summary')) return;
    localStorage.setItem('gos.save', raw);
    sessionStorage.setItem('t1.dev.summary', '1');
  }, serialize(endedState));
  const endedPage = await endedContext.newPage();
  endedPage.on('pageerror', (error) => report.pageErrors.push(error.message));
  await endedPage.goto(base, { waitUntil: 'networkidle' });
  const doubleGold = endedPage.getByRole('button', { name: 'Удвоить золото за рекламу', exact: true });
  await doubleGold.click();
  await endedPage.locator(`${ad} .webgames-adv-timer`).waitFor();
  await endedPage.locator(`${ad} .webgames-adv-timer`).waitFor({ state: 'detached' });
  await endedPage.locator(closeAd).click();
  await doubleGold.waitFor({ state: 'detached' });
  const readSummary = () => endedPage.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('gos.save')!);
    return { gold: state.gold, run: JSON.parse(state.activeRun) };
  });
  const doubled = await readSummary();
  assert.equal(doubled.gold, endedState.gold + summary.gold);
  assert.equal(doubled.run.summary.doubled, true);
  await endedPage.reload({ waitUntil: 'networkidle' });
  await endedPage.locator('.summary').waitFor();
  assert.deepEqual(await readSummary(), doubled);
  assert.equal(await doubleGold.count(), 0);
  report.checks.push('Official rewarded doubles summary gold once; reload preserves the flag and does not grant it again');

  // Fullscreen ads have no UI caller yet. Exercise the actual adapter source in isolation
  // with the same official SDK; no methods or callbacks are replaced.
  const built = await build({ configFile: false, logLevel: 'silent', build: {
    write: false, minify: false,
    lib: { entry: fileURLToPath(new URL('../../src/platform/yandex.ts', import.meta.url)), name: 'T1YandexAdapter', formats: ['iife'] },
  } });
  const bundle = (Array.isArray(built) ? built : [built]).flatMap((result) => 'output' in result ? result.output : [])
    .find((entry) => entry.type === 'chunk');
  assert(bundle?.type === 'chunk');
  await endedPage.addScriptTag({ content: bundle.code });
  await endedPage.evaluate(async () => {
    const adapter = new (Reflect.get(window, 'T1YandexAdapter').YandexPlatform)();
    await adapter.init();
    Reflect.set(window, '__t1Adapter', adapter);
    Reflect.set(window, '__t1Fullscreen', adapter.showInterstitial());
  });
  await endedPage.locator(ad).waitFor();
  assert.equal(await endedPage.evaluate(() => Reflect.get(window, '__t1Adapter').isPaused()), true);
  assert.equal(await endedPage.evaluate(() => Reflect.get(window, '__t1Adapter').showRewarded('revive')), false);
  assert.equal(await endedPage.locator(ad).count(), 1);
  await endedPage.locator(closeAd).click();
  await endedPage.evaluate(() => Reflect.get(window, '__t1Fullscreen'));
  assert.equal(await endedPage.evaluate(() => Reflect.get(window, '__t1Adapter').isPaused()), false);
  report.checks.push('Source-built YandexPlatform: official fullscreen callbacks pause/resume; overlapping rewarded is rejected');

  await Promise.all(pending);
  assert(report.sdk.length > 0);
  assert.deepEqual(report.pageErrors, []);
  report.status = 'passed';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await browser.close();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'passed' ? 0 : 1;
