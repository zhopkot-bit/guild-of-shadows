// Скриншоты из запущенной игры: node tools/qa/shot.mjs <url> <save.json|-> <out.png> <w> <h> [waitMs] [tab]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const [url, savePath, out, w = '1920', h = '1080', waitMs = '3500', tab = ''] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium', args: process.env.NO_WEBGL ? ['--disable-webgl', '--disable-3d-apis'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
if (savePath && savePath !== '-') {
  // Время сейва сдвигается на «сейчас», чтобы окно офлайн-дохода не перекрывало кадр.
  const obj = JSON.parse(readFileSync(savePath, 'utf8'));
  obj.lastSeen = Date.now();
  const save = JSON.stringify(obj);
  await page.addInitScript((s) => { if (!sessionStorage.getItem('qa-init')) { localStorage.setItem('gos.save', s); sessionStorage.setItem('qa-init', '1'); } }, save);
}
await page.goto(url, { waitUntil: 'networkidle' });
if (tab) await page.getByRole('button', { name: tab, exact: true }).click();
await page.waitForTimeout(+waitMs);
await page.screenshot({ path: out });
const stats = await page.evaluate(() => window.__gosArena?.stats?.() ?? null);
// Аудит вёрстки: горизонтальная прокрутка, выход элементов за карточки, обрезанный текст кнопок.
const layout = await page.evaluate(() => {
  const out = { hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, overflow: [] };
  const cards = document.querySelectorAll('.hero-card-lg, .hero-card, .entry--post, .boss-bar, .intent, .action, .slot, .result-card, .topbar');
  for (const card of cards) {
    const r = card.getBoundingClientRect();
    if (r.width === 0) continue;
    for (const el of card.querySelectorAll('*')) {
      const e = el.getBoundingClientRect();
      if (e.width === 0 || getComputedStyle(el).position === 'absolute') continue;
      if (e.right > r.right + 1.5 || e.left < r.left - 1.5) out.overflow.push(`${card.className.split(' ')[0]} > ${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} (${Math.round(e.left)}–${Math.round(e.right)} vs ${Math.round(r.left)}–${Math.round(r.right)})`);
    }
  }
  for (const b of document.querySelectorAll('button')) {
    if (b.scrollWidth > b.clientWidth + 2 && getComputedStyle(b).overflow !== 'visible') out.overflow.push(`button clipped: ${b.textContent.trim().slice(0, 30)}`);
  }
  out.overflow = [...new Set(out.overflow)].slice(0, 20);
  return out;
});
console.log(JSON.stringify({ out, stats, layout, logs }, null, 1));
await browser.close();
