// Проверка приёма арта художника: бой с тестовым пакетом (?artpack=...), серия кадров атаки.
// node tools/qa/artpack-shot.mjs <baseUrl dev-сервера> <save.json> <outDir>
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [base, savePath, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const save = readFileSync(savePath, 'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript((s) => { if (!sessionStorage.getItem('p')) { localStorage.setItem('gos.save', s); sessionStorage.setItem('p', '1'); } }, save);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/sdk.js')) errors.push(`http ${r.status()} ${r.url()}`); });
await p.goto(`${base}?qa=1&artpack=${process.env.ARTPACK ?? '/qa-fixtures/artpack-demo/art-pack.json'}`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const claim = p.getByRole('button', { name: 'Забрать' });
if (await claim.count()) await claim.click();
await p.waitForTimeout(1500);
await p.screenshot({ path: `${outDir}/artpack-demo-battle.png` });
const frames = [];
for (let i = 0; i < 6; i++) {
  await p.waitForTimeout(350);
  await p.screenshot({ path: `${outDir}/artpack-demo-${i}.png` });
  frames.push(await p.evaluate(() => window.__gosArena?.stats?.()?.units?.filter((u) => u.id.startsWith('h')).map((u) => `${u.id}:${u.clip}`)));
}
writeFileSync(`${outDir}/artpack-demo.json`, JSON.stringify({ errors, frames }, null, 1));
console.log(JSON.stringify({ errors, frames }));
await b.close();
