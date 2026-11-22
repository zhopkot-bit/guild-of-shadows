import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { identity, withPreview } from './preview.mjs';

const [directory = 'qa-out/release/smoke', width = '1920', height = '1080', backend = 'webgl'] = process.argv.slice(2);
assert(['webgl', 'canvas2d'].includes(backend), 'Expected webgl or canvas2d');
const viewport = { width: Number(width), height: Number(height) };
assert(Number.isInteger(viewport.width) && viewport.width > 0 && Number.isInteger(viewport.height) && viewport.height > 0, 'Invalid viewport');
const out = resolve(directory);
mkdirSync(out, { recursive: true });
const report = { ...identity(), viewport, backend, ok: false, cases: [], errors: [], platformAcceptance: 'not_run' };
try {
  await withPreview(out, async (base) => {
    const browser = await chromium.launch({
      ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
      args: backend === 'canvas2d' ? ['--disable-webgl', '--disable-3d-apis'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    report.browser = browser.version();
    try {
      for (const name of ['new-game', 'battle', 'boss', 'boss-phase2']) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const current = { name, errors: [] };
        report.cases.push(current);
        const isSdk = (url) => new URL(url).origin === new URL(base).origin && new URL(url).pathname === '/sdk.js';
        page.on('pageerror', (error) => current.errors.push(`pageerror: ${error.message}`));
        // A local Vite preview has no platform SDK. Chromium can mark its 404 as
        // ERR_ABORTED; only that exact endpoint is outside this local smoke.
        page.on('requestfailed', (request) => {
          if (!isSdk(request.url())) current.errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`);
        });
        page.on('response', (response) => {
          if (response.status() >= 400 && !(isSdk(response.url()) && response.status() === 404)) current.errors.push(`HTTP ${response.status()}: ${response.url()}`);
        });
        page.on('console', (message) => {
          if (message.type() === 'error' && !message.text().includes('404')) current.errors.push(`console: ${message.text()}`);
        });
        try {
          if (name !== 'new-game') {
            const save = JSON.parse(readFileSync(`qa-saves/release/${name}.json`, 'utf8'));
            // Refresh only the idle timestamp; game state comes from T5's real generator.
            save.lastSeen = Date.now();
            await context.addInitScript((data) => {
              if (!localStorage.getItem('gos.save')) localStorage.setItem('gos.save', data);
            }, JSON.stringify(save));
          }
          await page.goto(`${base}?qa=1`, { waitUntil: 'networkidle' });
          // The game intentionally hides navigation during combat.
          await page.locator('.tabbar').waitFor({ state: 'attached' });
          if (name === 'new-game') {
            await page.locator('.tab', { hasText: 'Отряд' }).click();
            await page.locator('.hero-card-lg[data-hero="mira"] .hero-card-lg__open').click();
            await page.locator('.hero-sheet canvas').waitFor();
            await page.screenshot({ path: resolve(out, 'hero-sheet.png') });
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('.hero-sheet').count(), 0, 'Hero sheet must close');
            await page.setViewportSize({ width: 390, height: 844 });
            assert(await page.locator('.rotate-hint').isVisible(), 'Portrait rotation hint must be visible');
            await page.setViewportSize(viewport);
            assert(!(await page.locator('.rotate-hint').isVisible()), 'Landscape rotation hint must be hidden');
          } else {
            await page.waitForFunction(() => window.__gosArena?.stats().actors > 0);
            const stats = await page.evaluate(() => window.__gosArena.stats());
            current.scene = stats;
            assert.equal(stats.backend, backend, 'Requested renderer must actually be used');
            assert.deepEqual(stats.errors, [], 'Renderer errors');
            if (name === 'boss-phase2') assert(await page.locator('.boss-bar.is-phase-two').count(), 'Boss phase II is missing');
            if (name === 'boss') assert(await page.locator('.boss-bar:not(.is-phase-two)').count(), 'Boss phase I is missing');
            const fit = await page.evaluate(() => {
              const dock = document.querySelector('.battle-dock')?.getBoundingClientRect();
              return { x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight, bottom: dock?.bottom, height: innerHeight };
            });
            current.layout = fit;
            assert(fit.x <= 1 && fit.y <= 1 && fit.bottom <= fit.height + 1, 'Battle must fit without scrolling');
            if (name === 'battle') {
              const coach = page.locator('.coach:not([hidden]) button');
              for (let i = 0; i < 6 && await coach.count(); i++) await coach.first().click();
              await page.locator('.action--attack').waitFor();
              await page.locator('.action--attack').click();
              await page.locator('.plate--enemy.is-target').first().click();
              await page.waitForSelector('.action--attack', { timeout: 30_000 });
              const before = await page.evaluate(() => {
                const battle = window.__gosArena.battle();
                return { round: battle.round, current: battle.current, hp: battle.units.map((unit) => unit.hp) };
              });
              // The fixture is injected only when storage is empty, so reload uses the app's save.
              const persisted = await page.evaluate(() => localStorage.getItem('gos.save'));
              assert(persisted, 'Battle action must persist a save');
              current.afterAction = before;
              await page.reload({ waitUntil: 'networkidle' });
              await page.waitForFunction(() => window.__gosArena?.battle());
              const after = await page.evaluate(() => {
                const battle = window.__gosArena.battle();
                return { round: battle.round, current: battle.current, hp: battle.units.map((unit) => unit.hp) };
              });
              assert.deepEqual(after, before, 'Reload must preserve HP, round and current turn');
            }
          }
          await page.screenshot({ path: resolve(out, `${name}.png`) });
        } catch (error) {
          current.errors.push(error.stack ?? error.message);
          await page.screenshot({ path: resolve(out, `${name}-failure.png`) }).catch(() => {});
        } finally { await context.close(); }
        report.errors.push(...current.errors.map((error) => `${name}: ${error}`));
        console.log(`${backend} ${width}x${height} ${name}: ${current.errors.length ? 'FAIL' : 'OK'}`);
      }
    } finally { await browser.close(); }
  });
} catch (error) { report.errors.push(error.stack ?? error.message); }
report.ok = report.errors.length === 0 && report.cases.length === 4;
writeFileSync(resolve(out, 'smoke-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.ok, viewport, backend, errors: report.errors }, null, 2));
if (!report.ok) process.exitCode = 1;
