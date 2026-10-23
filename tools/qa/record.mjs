// Запись реального игрового процесса: node tools/qa/record.mjs <url> <save.json> <outDir> [seconds] [w] [h]
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [url, savePath, outDir, secs = '90', W = '1280', H = '720'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: +W, height: +H } });
const obj = JSON.parse(readFileSync(savePath, 'utf8'));
obj.lastSeen = Date.now();
await ctx.addInitScript((s) => { if (!sessionStorage.getItem('qa')) { localStorage.setItem('gos.save', s); sessionStorage.setItem('qa', '1'); } }, JSON.stringify(obj));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// Запись через CDP-скринкаст: кадры настоящего рендера браузера с метками времени.
const frames = [];
const cdp = await ctx.newCDPSession(page);
cdp.on('Page.screencastFrame', async (f) => {
  frames.push({ t: f.metadata.timestamp, data: f.data });
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await page.goto(url, { waitUntil: 'networkidle' });
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: +W, maxHeight: +H, everyNthFrame: 1 });
const end = Date.now() + +secs * 1000;
const log = [];
while (Date.now() < end) {
  if (await page.locator('.hud__result:not([hidden])').count()) { log.push('result'); await page.waitForTimeout(3000); break; }
  const atk = page.locator('.action--attack:not([disabled])');
  if (!(await atk.count())) { await page.waitForTimeout(150); continue; }
  const who = (await page.locator('.action-bar__who strong').textContent())?.trim();
  const skill = page.locator('.action--skill.is-ready');
  await page.waitForTimeout(500); // пауза «на решение», чтобы на видео был виден выбор
  if (await skill.count()) {
    await skill.click();
    await page.waitForTimeout(450);
    // Защитник прикрывает героя под угрозой, целительница лечит самого раненого, стрелок — по королю.
    let target = page.locator('.hero-card.is-target').filter({ has: page.locator('.tag-ico--cover') }).first();
    const threatened = page.locator('.plate--hero.is-target:has(.tag-ico--danger)');
    if (await threatened.count()) target = threatened.first();
    else if (await page.locator('.hero-card.is-target').count()) {
      const lows = page.locator('.hero-card.is-target.is-low');
      target = (await lows.count()) ? lows.first() : page.locator('.hero-card.is-target').first();
    } else if (await page.locator('.plate--enemy.is-target').count()) target = page.locator('.plate--enemy.is-target').first();
    else target = page.locator('.arena__canvas');
    if ((await target.getAttribute('class'))?.includes('arena__canvas')) {
      const box = await page.locator('.arena__canvas').boundingBox();
      await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.55);
    } else await target.click();
    log.push(`${who}: умение`);
  } else {
    await atk.click();
    await page.waitForTimeout(450);
    const plates = page.locator('.plate--enemy.is-target');
    if (await plates.count()) await plates.first().click();
    else {
      // У босса нет плашки: клик прямо по фигуре на арене (hit-test WebGL-сцены).
      const box = await page.locator('.arena__canvas').boundingBox();
      await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.55);
    }
    log.push(`${who}: атака`);
  }
  await page.waitForTimeout(300);
}
await cdp.send('Page.stopScreencast').catch(() => {});
mkdirSync(`${outDir}/frames`, { recursive: true });
const lines = [];
frames.forEach((f, i) => {
  const name = `frames/${String(i).padStart(6, '0')}.jpg`;
  writeFileSync(`${outDir}/${name}`, Buffer.from(f.data, 'base64'));
  const next = frames[i + 1];
  lines.push(`file '${name}'`, `duration ${Math.max(0.005, (next ? next.t : f.t + 0.04) - f.t).toFixed(4)}`);
});
writeFileSync(`${outDir}/frames.txt`, lines.join('\n'));
const video = `${outDir}/gameplay.mp4`;
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', `${outDir}/frames.txt`, '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', video], { cwd: outDir });
await ctx.close();
await browser.close();
console.log(JSON.stringify({ video, frames: frames.length, actions: log.length, tail: log.slice(-8), errors }, null, 1));
