// A-01: real Bran attack/cover, reload, boss completion and hero sheet.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [base = 'http://127.0.0.1:5173/', out = 'work/t3-bran/flow'] = process.argv.slice(2);
const save = JSON.parse(readFileSync('qa-saves/bran/boss.json', 'utf8'));
const heroId = save.heroes.find(h => h.identity === 'bran').id;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const rows = [];
mkdirSync(out, { recursive: true });
try {
  for (const [width, height] of [[1920, 1080], [667, 375]]) {
    const dir = `${out}/${width}x${height}`; mkdirSync(dir, { recursive: true });
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await ctx.addInitScript(({ save, heroId }) => {
      if (!sessionStorage.getItem('seeded')) { save.lastSeen = Date.now(); localStorage.setItem('gos.save', JSON.stringify(save)); sessionStorage.setItem('seeded', '1'); }
      window.__seenBranPoses = [];
      const sample = () => { const pose = window.__gosArena?.stats().units.find(u => u.id === heroId)?.pose; if (pose && !window.__seenBranPoses.includes(pose)) window.__seenBranPoses.push(pose); requestAnimationFrame(sample); };
      requestAnimationFrame(sample);
    }, { save, heroId });
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    const errors = [], assets = new Set();
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => {
      if (r.status() >= 400 && !r.url().endsWith('/sdk.js')) errors.push(`${r.status()} ${r.url()}`);
      if (r.url().includes('/art/v17/poses/bran/')) assets.add(new URL(r.url()).pathname.split('/').pop());
    });
    // QA_REGISTRY can point to a temporary merged manifest served from dist/.
    const registry = process.env.QA_REGISTRY ?? '/art-sources/poses/bran/qa-registry.json';
    await page.goto(`${base}?qa=1&artpack=${encodeURIComponent(registry)}`);
    await page.waitForSelector('.action--attack');
    if (await page.locator('.coach:not([hidden]) button').count()) await page.locator('.coach:not([hidden]) button').click();
    await page.screenshot({ path: `${dir}/boss-start.png` });
    const actions = [];
    for (let turn = 0; turn < 15 && actions.length < 2; turn++) {
      await page.waitForSelector('.action--attack');
      const who = await page.locator('.action-bar__who strong').innerText();
      const bran = who === 'Бран';
      const kind = bran && actions.length === 1 ? 'skill' : 'attack';
      await page.locator(`.action--${kind}`).click();
      if (kind === 'skill') {
        await page.locator('.hero-card.is-target').first().click();
      } else {
      // The boss has no floating target plate: select the actual figure on the canvas.
      const target = await page.evaluate(() => {
        const boss = window.__gosArena.battle().units.find(u => u.boss);
        return window.__gosArena.stats().units.find(u => u.id === boss.id).x;
      });
      const canvas = await page.locator('.arena canvas').boundingBox();
      await page.mouse.click(canvas.x + target, canvas.y + canvas.height * 0.55);
      }
      if (bran) {
        const expected = kind === 'skill' ? 'cast' : 'strike';
        await page.waitForFunction(pose => window.__seenBranPoses.includes(pose), expected);
        await page.screenshot({ path: `${dir}/${kind}.png` });
        actions.push(kind);
        console.log(`${width}x${height}: Bran ${kind}`);
      }
      await page.waitForSelector('.action--attack');
    }
    assert.deepEqual(actions, ['attack', 'skill']);
    const seen = await page.evaluate(() => window.__seenBranPoses);
    for (const pose of ['windup', 'strike', 'cast']) assert.ok(seen.includes(pose), `Missing live pose: ${pose}`);
    assert.ok(await page.evaluate(id => window.__gosArena.battle().log.some(e => e.t === 'cover' && e.actor === id), heroId), 'Cover did not reach the combat model');
    const before = await page.evaluate(() => { const b = window.__gosArena.battle(); return { round: b.round, current: b.current, hp: b.units.map(u => [u.id, u.hp]) }; });
    await page.reload();
    await page.waitForSelector('.action--attack');
    const after = await page.evaluate(() => { const b = window.__gosArena.battle(); return { round: b.round, current: b.current, hp: b.units.map(u => [u.id, u.hp]) }; });
    assert.deepEqual(after, before, 'Battle changed on reload at player turn');
    console.log(`${width}x${height}: reload preserved battle`);
    await page.locator('.segmented button', { hasText: 'Авто' }).click();
    await page.locator('.segmented button', { hasText: '×4' }).click();
    await page.waitForFunction(round => window.__gosArena.battle().round > round || window.__gosArena.battle().result !== 'ongoing', after.round, { timeout: 60000 });
    console.log(`${width}x${height}: auto advanced a round`);
    // Exercise the supported fast-finish control after observing a real auto round.
    if (await page.evaluate(() => window.__gosArena.battle().result === 'ongoing')) await page.getByRole('button', { name: 'Досчитать', exact: true }).click();
    await page.waitForSelector('.hud__result:not([hidden]) .btn', { timeout: 60000 });
    const result = await page.evaluate(() => window.__gosArena.battle().result);
    assert.equal(result, 'victory');
    await page.screenshot({ path: `${dir}/victory.png` });
    await page.locator('.hud__result:not([hidden]) .btn').click();
    await page.waitForSelector('.summary');
    await page.getByRole('button', { name: 'В гильдию', exact: true }).click();
    const ended = await page.evaluate(() => JSON.parse(localStorage.getItem('gos.save')).activeRun === null);
    assert.ok(ended, 'Finished run was not cleared');
    await page.locator('.tab', { hasText: 'Отряд' }).click();
    await page.locator('.hero-card-lg[data-hero="bran"] .hero-card-lg__open').click();
    await page.waitForSelector('.hero-sheet canvas');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${dir}/hero-sheet.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.hero-sheet').count(), 0);
    assert.deepEqual([...assets].sort(), ['poses.json', ...['idle', 'windup', 'strike', 'cast', 'hit', 'down', 'victory'].map(n => `${n}.webp`)].sort(), 'Expected poses.json and all seven runtime WebP files');
    assert.deepEqual(errors, []);
    rows.push({ viewport: [width, height], ok: true, actions, livePoses: seen, reloadPreservedBattle: true, autoAdvancedRound: true, finishControl: 'Досчитать', result, returnedToGuild: ended, heroSheet: true, assets: [...assets].sort(), errors });
    console.log(JSON.stringify(rows.at(-1)));
    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${out}/report.json`, JSON.stringify({ ok: true, rows }, null, 2));
