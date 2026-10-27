// Run against Vite dev: CHROME=/usr/bin/chromium node tools/qa/portrait-overrides.mjs
// Exercises real portrait components in Chromium, including failed image requests.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const [base = 'http://127.0.0.1:5173/', out = 'qa-out/portrait-overrides'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
const rows = [];
try {
  for (const group of ['heroes', 'enemies']) {
    for (const mode of ['none', 'override', 'missing-override', 'missing-both']) {
      const context = await browser.newContext();
      try {
        const id = group === 'heroes' ? 'bran' : 'goblinRaider';
        const standard = group === 'heroes' ? '/art/v17/heroes/bran/portrait.webp' : '/art/v17/enemies/goblin_raider/portrait.webp';
        const requested = [];
        await context.route(url => url.pathname === '/qa-portraits/pack.json', route => route.fulfill({ json: {
          version: 1, heroes: {}, enemies: {}, arenas: {},
          [group]: { [id]: mode === 'none' ? {} : { portrait: './face.webp' } },
        } }));
        await context.route('**/qa-portraits/face.webp', route => {
          requested.push('override');
          return mode === 'override'
            ? route.fulfill({ contentType: 'image/webp', body: readFileSync('public/art/v17/heroes/nora/portrait.webp') })
            : route.fulfill({ status: 404, body: '' });
        });
        if (mode === 'missing-both') await context.route(`**${standard}`, route => route.fulfill({ status: 404, body: '' }));
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(`${base}?qa=1&artpack=/qa-portraits/pack.json`);
        await page.waitForSelector('.tab', { state: 'attached' });
        await page.evaluate(async ({ group, id }) => {
          const { loadArtPack } = await import('/src/content/artpack.ts');
          const { heroPortrait, enemyPortrait } = await import('/src/ui/portrait.ts');
          await loadArtPack();
          const portrait = group === 'heroes'
            ? heroPortrait({ identity: 'bran', cls: 'defender', name: 'Бран' }, 96)
            : enemyPortrait(id, 'Гоблин', 96);
          portrait.id = 'qa-portrait';
          document.body.append(portrait);
        }, { group, id });
        const expected = mode === 'override' ? '/qa-portraits/face.webp' : standard;
        await page.waitForFunction(({ mode, expected }) => {
          const el = document.querySelector('#qa-portrait');
          const img = el?.querySelector('img');
          return mode === 'missing-both' ? !!el?.querySelector('svg') && !img
            : !!img && new URL(img.src).pathname === expected && img.complete && img.naturalWidth > 0;
        }, { mode, expected });
        assert.deepEqual(errors, []);
        assert.equal(requested.length > 0, mode !== 'none');
        rows.push({ group, mode, ok: true });
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); }
writeFileSync(`${out}/report.json`, JSON.stringify({ ok: true, rows }, null, 2));
console.log(JSON.stringify({ ok: true, checks: rows.length, rows }, null, 2));
