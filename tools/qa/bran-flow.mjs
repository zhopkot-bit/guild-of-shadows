// Check the A-01 attack and cover from the uploaded build's default art registry.
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright-core';

const [base = 'https://localhost:8080/draft/', saves = 'qa-saves', out = 'qa-out/bran/report.json'] = process.argv.slice(2);
const entry = new URL(base);
assert(!entry.searchParams.has('artpack'), 'This check requires the default art registry');
entry.searchParams.set('qa', '1');
const registry = new URL('art/v17/art-pack.json', entry);
const assets = new URL('poses/bran/', registry);
const manifest = new URL('poses.json', assets);
const names = ['idle', 'windup', 'strike', 'cast', 'hit', 'down', 'victory'];
const files = ['poses.json', ...names.map(name => name + '.webp')].sort();
const save = JSON.parse(readFileSync(join(saves, 'boss.json'), 'utf8'));
const hero = save.heroes.find(h => h.identity === 'bran');
assert(hero && JSON.parse(save.activeRun).battle.units.some(u => u.id === hero.id && u.identity === 'bran'), 'Boss fixture must include Bran');
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
if (entry.protocol === 'https:' && ['localhost', '127.0.0.1', '[::1]'].includes(entry.hostname)) {
  const cert = new X509Certificate(readFileSync(process.env.YANDEX_QA_CERT ?? 'work/yandex-sdk/localhost.crt'));
  const pin = createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  args.push('--ignore-certificate-errors-spki-list=' + pin);
}
const report = { ok: false, registry: registry.href, rows: [] };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args });
try {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 667, height: 375 }]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    await ctx.addInitScript(({ save, id }) => {
      if (window.top !== window || sessionStorage.getItem('bran-seeded')) return;
      save.lastSeen = Date.now();
      localStorage.setItem('gos.save', JSON.stringify(save));
      sessionStorage.setItem('bran-seeded', '1');
      window.__branPoses = new Set();
      const sample = () => {
        const pose = window.__gosArena?.stats().units.find(unit => unit.id === id)?.pose;
        if (pose) window.__branPoses.add(pose);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, { save, id: hero.id });
    const page = await ctx.newPage();
    page.setDefaultTimeout(45_000);
    const received = new Set(), errors = [];
    const row = { viewport, ok: false, files: [], poses: [], errors };
    report.rows.push(row);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (!response.url().startsWith(assets.href)) return;
      if (!response.ok()) errors.push(response.status() + ' ' + response.url());
      received.add(response.url().slice(assets.href.length));
    });
    const [pack, poses] = await Promise.all([
      page.waitForResponse(registry.href),
      page.waitForResponse(manifest.href),
      page.goto(entry.href),
    ]);
    assert(pack.ok() && poses.ok(), 'Default registry and Bran manifest must load');
    assert.equal((await pack.json()).heroes.bran.poses, 'poses/bran/poses.json');
    assert.deepEqual((await poses.json()).poses, Object.fromEntries(names.map(n => [n, n + '.webp'])));
    await page.locator('.action--attack').waitFor();
    row.files = [...received].sort();
    assert.deepEqual(row.files, files);
    assert.deepEqual(await page.evaluate(() => window.__gosArena.stats().errors), []);
    const coach = page.locator('.coach:not([hidden]) button');
    if (await coach.count()) await coach.click();

    const actions = [];
    for (let turn = 0; turn < 15 && actions.length < 2; turn++) {
      await page.locator('.action--attack').waitFor();
      const bran = (await page.locator('.action-bar__who strong').innerText()) === 'Бран';
      const action = bran && actions.length === 1 ? 'skill' : 'attack';
      await page.locator('.action--' + action).click();
      if (action === 'skill') {
        await page.locator('.hero-card.is-target').first().click();
      } else {
        const x = await page.evaluate(() => {
          const boss = window.__gosArena.battle().units.find(unit => unit.boss);
          return window.__gosArena.stats().units.find(unit => unit.id === boss.id).x;
        });
        const canvas = await page.locator('.arena canvas').boundingBox();
        await page.mouse.click(canvas.x + x, canvas.y + canvas.height * 0.55);
      }
      if (bran) {
        await page.waitForFunction(pose => window.__branPoses.has(pose), action === 'skill' ? 'cast' : 'strike');
        actions.push(action);
      }
    }
    assert.deepEqual(actions, ['attack', 'skill']);
    await page.waitForFunction(id => window.__gosArena.battle().log.some(e => e.t === 'cover' && e.actor === id), hero.id);
    row.poses = await page.evaluate(() => [...window.__branPoses]);
    for (const pose of ['idle', 'windup', 'strike', 'cast']) assert(row.poses.includes(pose), 'Missing on-screen pose ' + pose);
    assert.deepEqual(errors, []);
    row.ok = true;
    await ctx.close();
  }
  report.ok = true;
} catch (error) {
  report.error = String(error.stack ?? error);
  throw error;
} finally {
  await browser.close();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
