// Замер раскладки боя (зоны героев, врагов, плашек, HUD) на 4 разрешениях:
// node tools/qa/layout-probe.mjs <save.json> <outDir> [baseUrl]
// Нужен для ТЗ художнику: передний план арены не должен перекрывать эти зоны.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [savePath, outDir, base = 'http://127.0.0.1:5173/'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const save = readFileSync(savePath, 'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = {};
// Альбомная ориентация — единственная поддерживаемая (решение заказчика); VIEWPORTS="1920x1080,844x390" — свой набор.
const VIEWPORTS = (process.env.VIEWPORTS ?? '1920x1080,1366x768,1024x768,844x390,667x375').split(',').map((v) => v.split('x').map(Number));
for (const [w, h] of VIEWPORTS) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript((s) => { if (!sessionStorage.getItem('probe')) { localStorage.setItem('gos.save', s); sessionStorage.setItem('probe', '1'); } }, save);
  const p = await ctx.newPage();
  await p.goto(`${base}?qa=1`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  const r = await p.evaluate(() => {
    const box = (e) => { const q = e.getBoundingClientRect(); return [Math.round(q.x), Math.round(q.y), Math.round(q.width), Math.round(q.height)]; };
    const all = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent).map(box);
    const c = document.querySelector('.arena canvas, canvas');
    return { canvas: c ? box(c) : null, units: window.__gosArena?.stats?.()?.units?.map((u) => [u.id, Math.round(u.x)]) ?? [], plates: all('.plate'), intents: all('.intents'), turns: all('.turns'), title: all('.hud__top, .battle-title') };
  });
  report[`${w}x${h}`] = r;
  await p.screenshot({ path: `${outDir}/battle_${w}x${h}.png` });
  await ctx.close();
}
writeFileSync(`${outDir}/layout.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
await b.close();
