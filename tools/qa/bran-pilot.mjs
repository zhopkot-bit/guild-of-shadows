/**
 * Real game integration smoke-test; NOT a standalone HTML player test.
 * npm run qa:saves
 * node tools/qa/bran-pilot.mjs http://127.0.0.1:5173/ qa-saves/battle.json qa-out/bran-pilot
 * CHROME=/absolute/path/to/chrome node ... (optional browser override)
 */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [base = 'http://127.0.0.1:5173/', savePath = 'qa-saves/battle.json', outDir = 'qa-out/bran-pilot'] = process.argv.slice(2);
const viewports = [[1920, 1080], [1366, 768], [1024, 768], [390, 844]];
const out = resolve(outDir);
mkdirSync(out, { recursive: true });
const save = readFileSync(resolve(savePath), 'utf8');
const executablePath = process.env.CHROME || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const rows = [];
let failed = false;
try {
  for (const [width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height } });
    if (process.env.QA_FORCE_CANVAS === '1') {
      await context.addInitScript(() => {
        const native = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
          if (typeof kind === 'string' && kind.startsWith('webgl')) return null;
          return native.call(this, kind, ...args);
        };
      });
    }
    await context.addInitScript((serial) => {
      if (!sessionStorage.getItem('bran-pilot-qa')) {
        // Keep an old QA fixture from opening the offline-income modal over the battle.
        const fixture = JSON.parse(serial);
        fixture.lastSeen = Date.now();
        localStorage.setItem('gos.save', JSON.stringify(fixture));
        sessionStorage.setItem('bran-pilot-qa', '1');
      }
    }, save);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`JavaScript: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 400 && !r.url().endsWith('/sdk.js')) errors.push(`HTTP ${r.status()}: ${r.url()}`);
    });
    const record = { viewport: `${width}x${height}`, ok: false, errors, branId: null, rig: false, portrait: false, sceneErrors: [], backend: null };
    try {
      const u = new URL(base);
      u.searchParams.set('qa', '1');
      await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      const claim = page.getByRole('button', { name: 'Забрать' });
      if (await claim.count()) await claim.first().click();
      await page.waitForFunction(() => !!window.__gosArena?.stats()?.units?.length, null, { timeout: 25000 });
      await page.waitForFunction(() => {
        const b = window.__gosArena?.battle?.();
        const s = window.__gosArena?.stats?.();
        const id = b?.units?.find((u) => u.side === 'hero' && u.identity === 'bran')?.id;
        return !!id && !!s?.units?.find((u) => u.id === id && u.rig);
      }, null, { timeout: 25000 });
      await page.waitForFunction(() => {
        const img = document.querySelector('.portrait[data-identity="bran"] img[src*="portrait_pilot_v04.webp"]');
        return !!img && img.complete && img.naturalWidth > 0;
      }, null, { timeout: 15000 });
      const proof = await page.evaluate(() => {
        const battle = window.__gosArena.battle();
        const stats = window.__gosArena.stats();
        const branId = battle.units.find((u) => u.side === 'hero' && u.identity === 'bran')?.id;
        const hero = stats.units.find((u) => u.id === branId);
        const image = document.querySelector('.portrait[data-identity="bran"] img[src*="portrait_pilot_v04.webp"]');
        return { branId, rig: !!hero?.rig, portrait: !!image?.naturalWidth, sceneErrors: stats.errors, backend: stats.backend };
      });
      Object.assign(record, proof);
      record.ok = !!record.rig && !!record.portrait && record.sceneErrors.length === 0 && errors.length === 0
        && (process.env.QA_FORCE_CANVAS !== '1' || record.backend === 'canvas2d');
      await page.screenshot({ path: `${out}/bran-game-${width}x${height}.png`, fullPage: true });
    } catch (e) {
      errors.push(String(e));
    }
    if (!record.ok) failed = true;
    rows.push(record);
    await context.close();
  }
} finally {
  await browser.close();
}
const result = { ok: !failed, check: 'ACTUAL GAME v1.8', viewportCount: viewports.length, rows };
writeFileSync(`${out}/bran-pilot-integration-report.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (failed) process.exitCode = 1;
