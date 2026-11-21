/** Running game server required. Run: node --import tsx tools/qa/run-integrity.ts [baseUrl] */
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright-core';
import { newGame } from '../../src/core/state';
import { serialize } from '../../src/core/save';
import type { GameState } from '../../src/core/types';
import { availableNodes, serializeRun, startRun } from '../../src/expedition/run';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors: string[] = [];

async function withSave(state: GameState, check: (page: Page, original: string) => Promise<void>, blockBackup = false): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  try {
    const original = serialize(state);
    // Seed before boot: writing storage in a live app would be overwritten by pagehide's save.
    await context.addInitScript((raw) => {
      if (sessionStorage.getItem('t1.fixture') === 'loaded') return;
      localStorage.clear();
      localStorage.setItem('gos.save', raw);
      sessionStorage.setItem('t1.fixture', 'loaded');
    }, original);
    if (blockBackup) await context.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string): void {
        if (key === 'gos_corrupt_run_backup') throw new Error('QA: backup unavailable');
        original.call(this, key, value);
      };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}?qa=1`, { waitUntil: 'networkidle' });
    await page.locator('.tab').first().waitFor();
    try {
      await check(page, original);
    } catch (error) {
      console.error('Page errors:', errors);
      console.error('Page text:', (await page.locator('body').innerText()).slice(0, 2000));
      throw error;
    }
  } finally {
    await context.close();
  }
}

async function savedRun(page: Page): Promise<ReturnType<typeof JSON.parse>> {
  return page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('gos.save')!).activeRun));
}

try {
  {
    const state = newGame(Date.now());
    const run = startRun(state, Date.now(), 1);
    availableNodes(run)[0]!.type = 'event';
    state.activeRun = serializeRun(run);
    await withSave(state, async (page) => {
      await page.locator('.node.is-reachable').first().click();
      assert.equal((await savedRun(page)).stage, 'event');
      await page.locator('.choice-list button:enabled').first().click();
      const outcome = await savedRun(page);
      assert.equal(outcome.stage, 'eventResult');
      await page.reload({ waitUntil: 'networkidle' });
      assert.deepEqual(await savedRun(page), outcome);
      await page.getByRole('button', { name: 'Дальше', exact: true }).click();
      assert.equal((await savedRun(page)).stage, 'map');
    });
    console.log('OK: node entry, event outcome and continuation persist immediately; reload preserves outcome and RNG');
  }
  {
    const state = newGame(Date.now());
    const run = startRun(state, Date.now(), 1);
    run.members[0]!.alive = false;
    run.members[0]!.frac = 0;
    run.fallen = [run.members[0]!.heroId];
    state.activeRun = serializeRun(run);
    await withSave(state, async (page) => {
      await page.getByRole('button', { name: 'Воскресить павшего за рекламу', exact: true }).click();
      await page.locator('.fake-ad button').click();
      const revived = await savedRun(page);
      assert.equal(revived.reviveLeft, 0);
      assert.equal(revived.members[0].alive, true);
      assert.equal(revived.members[0].frac, 0.3);
      assert.deepEqual(revived.fallen, []);
      await page.reload({ waitUntil: 'networkidle' });
      assert.deepEqual(await savedRun(page), revived);
      assert.equal(await page.getByRole('button', { name: 'Воскресить павшего за рекламу', exact: true }).count(), 0);
    });
    console.log('OK: rewarded revive and its limit survive reload');
  }
  {
    const state = newGame(Date.now());
    state.gold = 1234;
    state.activeRun = '{broken';
    await withSave(state, async (page, original) => {
      await page.getByRole('heading', { name: 'Экспедиция не восстановлена', exact: true }).waitFor();
      const saved = await page.evaluate(() => ({
        backup: localStorage.getItem('gos_corrupt_run_backup'),
        state: JSON.parse(localStorage.getItem('gos.save')!),
      }));
      assert.equal(saved.backup, original);
      assert.equal(saved.state.activeRun, null);
      assert(saved.state.gold >= state.gold);
      assert.deepEqual(saved.state.heroes, state.heroes);
    });
    console.log('OK: corrupt expedition preserves the original save and guild progress');
    await withSave(state, async (page, original) => {
      await page.getByText('Сохранение в этой сессии отключено', { exact: false }).waitFor();
      await page.getByRole('button', { name: 'Понятно', exact: true }).click();
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      assert.equal(await page.evaluate(() => localStorage.getItem('gos.save')), original);
    }, true);
    console.log('OK: backup failure prevents overwriting the original save');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: gameplay integrity checks; no page errors');
} finally {
  await browser.close();
}
