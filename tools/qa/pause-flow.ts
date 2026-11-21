/** Browser contract test with an SDK double. This does not test the real Yandex-hosted runtime. */
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright-core';
import type { SDK } from 'ysdk';
import { newGame } from '../../src/core/state';
import { serialize } from '../../src/core/save';
import { availableNodes, enterNode, serializeRun, startRun } from '../../src/expedition/run';

declare global {
  interface Window {
    __t1SDK: { emit(event: 'game_api_pause' | 'game_api_resume'): void; calls: string[] };
  }
}
const base = process.argv[2] ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors: string[] = [];
async function setup(offline = false, pauseAtInit = true) {
  const state = newGame(Date.now());
  for (const hero of state.heroes) hero.level = 15;
  const run = startRun(state, Date.now(), 1);
  enterNode(run, availableNodes(run).find((n) => n.type === 'battle')!.id);
  state.activeRun = serializeRun(run);
  if (offline) state.lastSeen -= 120_000;
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.route('**/sdk.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* SDK contract double, injected before boot */' }));
  await context.addInitScript(({ raw, pauseAtInit }) => {
    // tsx may preserve nested function names with this helper when serializing browser code.
    Reflect.set(globalThis, '__name', Function('target', 'return target'));
    if (!sessionStorage.getItem('t1.pause')) {
      localStorage.setItem('gos.save', raw);
      sessionStorage.setItem('t1.pause', 'seeded');
    }
    const events = new Map<string, () => void>();
    const calls: string[] = [];
    window.__t1SDK = { calls, emit: (event) => events.get(event)!() };
    const sdk = {
      on: (event: string, listener: () => void) => { events.set(event, listener); return () => events.delete(event); },
      getPlayer: async () => {
        if (pauseAtInit) window.__t1SDK.emit('game_api_pause'); // must be captured before the player resolves
        return { getData: async () => ({ save: localStorage.getItem('gos.save') }), setData: async () => undefined };
      },
      serverTime: () => Date.now(), environment: { i18n: { lang: 'ru' } },
      features: { LoadingAPI: { ready: () => calls.push('ready') }, GameplayAPI: { start: () => calls.push('start'), stop: () => calls.push('stop') } },
    } as unknown as SDK;
    window.YaGames = { init: async () => sdk };
  }, { raw: serialize(state), pauseAtInit });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}?qa=1`, { waitUntil: 'networkidle' });
  await page.locator('.stage--battle').waitFor();
  return { context, page, initial: run.battle! };
}
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const battle = window.__gosArena!.battle()!;
    return { hp: battle.units.map((u) => u.hp), round: battle.round, current: battle.current,
      queue: [...battle.queue], rng: battle.rng.snapshot(), log: battle.log.length };
  });
}
const emit = (page: Page, paused: boolean) => page.evaluate((value) => window.__t1SDK.emit(value ? 'game_api_pause' : 'game_api_resume'), paused);
async function unchanged(page: Page) {
  const before = await snapshot(page);
  await page.waitForTimeout(400);
  assert.deepEqual(await snapshot(page), before);
  assert.equal(await page.locator('.stage--battle').evaluate((el) => el instanceof HTMLElement && el.inert), true,
    JSON.stringify(await page.evaluate(() => ({ calls: window.__t1SDK?.calls, inert: document.querySelector<HTMLElement>('.stage--battle')?.inert }))));
}

try {
  const { page, context, initial } = await setup();
  try {
    await unchanged(page);
    assert.deepEqual((await snapshot(page)).hp, initial.units.map((u) => u.hp));
    assert.equal(await page.evaluate(() => window.__t1SDK.calls.includes('start')), false);
    await emit(page, false);
    await page.locator('.action--attack').waitFor();
    // Cancelling a view while its attack winds up must not apply a deferred model action.
    await page.locator('.action--attack').click();
    await page.locator('.plate--enemy.is-target').first().click();
    const beforeLeaving = await snapshot(page);
    // Battle hides navigation. Invoke the existing handler to exercise view cancellation directly.
    await page.locator('.tab', { hasText: 'Гильдия' }).evaluate((el) => { if (el instanceof HTMLElement) el.click(); });
    await page.waitForTimeout(600);
    await emit(page, true);
    await page.locator('.tab', { hasText: 'Экспедиция' }).click();
    assert.deepEqual(await snapshot(page), beforeLeaving);
    await unchanged(page);
    console.log('OK: startup SDK pause, input lock and cancellation of an unfinished view');

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.__t1SDK.emit('game_api_resume');
    });
    await unchanged(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.locator('.action--attack').waitFor();
    await page.evaluate(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('.battle-controls button')].find((el) => el.textContent === 'Досчитать')!;
      button.click();
      setTimeout(() => window.__t1SDK.emit('game_api_pause'), 0);
    });
    await page.waitForFunction(() => document.querySelector<HTMLElement>('.stage--battle')?.inert);
    assert.equal(await page.evaluate(() => window.__gosArena!.battle()!.result), 'ongoing');
    await unchanged(page);
    await emit(page, false);
    await page.locator('.hud__result:not([hidden]) .btn').waitFor();
    assert.equal(await page.evaluate(() => window.__gosArena!.battle()!.result), 'victory');
    console.log('OK: visibility ownership and fast-forward obey the same pause');
  } finally { await context.close(); }

  const offline = await setup(true);
  try {
    await offline.page.getByRole('heading', { name: 'С возвращением', exact: true }).waitFor();
    await unchanged(offline.page);
    await offline.page.getByRole('button', { name: 'Забрать', exact: true }).click();
    await unchanged(offline.page); // closing the modal must not release the platform's pause
    await emit(offline.page, false);
    await offline.page.locator('.action--attack').waitFor();
    console.log('OK: offline modal and SDK pause resume independently');
  } finally { await offline.context.close(); }
  const restored = await setup(false, false);
  try {
    await restored.page.locator('.action--attack').waitFor();
    const calls = await restored.page.evaluate(() => window.__t1SDK.calls);
    assert(calls.indexOf('ready') >= 0 && calls.indexOf('start') > calls.indexOf('ready'));
    console.log('OK: restored gameplay starts after LoadingAPI.ready');
  } finally { await restored.context.close(); }
  assert.deepEqual(errors, []);
  console.log('PASS: browser pause contract, no page errors; real SDK runtime remains unverified');
} finally { await browser.close(); }
