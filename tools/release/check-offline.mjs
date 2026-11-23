// Exercise the downloaded standalone file the way a player opens it on Windows.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const [html, saves = 'qa-saves'] = process.argv.slice(2);
assert(html, 'Usage: node tools/release/check-offline.mjs <standalone.html> [qa-saves]');
const boss = JSON.parse(readFileSync(join(saves, 'boss.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'guild-offline-'));
const folder = join(work, 'Проверка локальной игры');
const entry = join(folder, 'Гильдия Теней.html');
const url = pathToFileURL(entry);
const problems = new Set();
const edge = process.platform === 'win32' && [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
  .some(dir => dir && existsSync(join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe')));
const channel = process.env.OFFLINE_BROWSER_CHANNEL ?? (edge ? 'msedge' : 'chromium');
let context;

async function openBrowser() {
  context = await chromium.launchPersistentContext(join(work, 'profile'), {
    channel, viewport: { width: 1280, height: 720 }, locale: 'ru-RU', serviceWorkers: 'block',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  context.setDefaultTimeout(45_000);
  context.on('request', request => {
    const address = request.url();
    if (/^https?:/i.test(address)) problems.add('Network ' + address.slice(0, 240));
    if (/^file:/i.test(address) && resolve(fileURLToPath(address)) !== entry)
      problems.add('Additional local file ' + address.slice(0, 240));
  });
  await context.route(/^https?:/i, route => {
    problems.add('Network ' + route.request().url().slice(0, 240));
    return route.abort();
  });
  await context.routeWebSocket(/.*/, socket => {
    problems.add('WebSocket ' + socket.url().slice(0, 240));
    socket.close();
  });
  const page = context.pages()[0] ?? await context.newPage();
  page.on('pageerror', error => problems.add(error.message.slice(0, 300)));
  page.on('console', msg => {
    if (msg.type() === 'error') problems.add(msg.text().slice(0, 300));
  });
  await page.goto(url.href);
  return page;
}

// Wait for the game to persist its own manual turn. The autosave interval is 15 s.
async function checkpoint(page) {
  await page.locator('.action-bar:not(.is-targeting) .action--attack').waitFor();
  const handle = await page.waitForFunction(() => {
    const state = JSON.parse(localStorage.getItem('gos.save'));
    const run = state?.activeRun && JSON.parse(state.activeRun);
    const b = run?.battle;
    const who = document.querySelector('.action-bar__who strong')?.textContent;
    if (!b || !b.current || !who || b.units.find(u => u.id === b.current)?.name !== who) return false;
    return { seed: run.seed, node: run.currentNodeId, round: b.round, current: b.current,
      hp: b.units.map(u => [u.id, u.hp]), log: b.log.length, party: state.party };
  });
  return handle.jsonValue();
}

try {
  mkdirSync(folder);
  copyFileSync(html, entry);
  let page = await openBrowser();
  await page.getByRole('heading', { name: 'Гильдия Теней', exact: true }).waitFor();
  const art = await page.locator('.guild-hero__art').evaluate(async img => {
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  });
  assert(art.every(n => n > 100), 'Missing guild artwork');
  await page.locator('.tab', { hasText: 'Экспедиция' }).click();
  await page.getByRole('button', { name: 'Начать экспедицию' }).click();
  await page.locator('.node--battle.is-reachable').first().click();
  const before = await checkpoint(page);
  await page.goto('about:blank');
  await context.close();
  context = undefined;

  page = await openBrowser();
  assert.deepEqual(await checkpoint(page), before, 'The same battle must restore after closing the browser');

  // The extra QA visit checks the default renderer and embedded poses in a known boss encounter.
  await context.addInitScript(save => {
    if (location.protocol === 'file:' && location.search === '?qa=1') {
      save.lastSeen = Date.now();
      localStorage.setItem('gos.save', JSON.stringify(save));
    }
  }, boss);
  const qa = new URL(url);
  qa.searchParams.set('qa', '1');
  await page.goto(qa.href);
  await page.locator('.action--attack').waitFor();
  await page.waitForFunction(() => {
    const stats = window.__gosArena?.stats();
    return stats?.units.length >= 4 && stats.units.every(u => u.pose);
  });
  const state = await page.evaluate(() => ({ stats: window.__gosArena.stats(),
    boss: window.__gosArena.battle().units.some(u => u.boss) }));
  assert(state.boss, 'Expected the boss encounter');
  assert(['webgl', 'canvas2d'].includes(state.stats.backend));
  assert.deepEqual(state.stats.errors, []);
  assert.deepEqual([...problems], []);
  console.log(JSON.stringify({ ok: true, channel, platform: process.platform,
    guildArtwork: art, restored: before, backend: state.stats.backend,
    actorsWithPoses: state.stats.units.length, externalRequests: 0 }));
} finally {
  await context?.close();
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
