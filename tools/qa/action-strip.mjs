// Покадровая раскадровка действия в живой сцене боя (шаг 1/30 с, без зависимости от скорости машины).
// node tools/qa/action-strip.mjs <url> <save.json> <out.png> <actorId> <targetId> [kind=melee|hit|gesture|die] [frames=26] [w=1280] [h=720]
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const [url, savePath, out, actorId, targetId, kind = 'melee', frames = '26', W = '1280', H = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: +W, height: +H } });
await ctx.addInitScript((s) => { const v = JSON.parse(s); v.lastSeen = Date.now(); localStorage.setItem('gos.save', JSON.stringify(v)); }, readFileSync(savePath, 'utf8'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.__gosArena?.stats().units.length > 0);
// Ход игрока: бой ждёт ввода, посторонних анимаций нет.
await page.waitForSelector('.action--attack', { timeout: 60000 });
await page.waitForTimeout(600);
// Доступ к сцене без отладочного API в продукте; бой останавливается, время двигаем вручную.
await page.evaluate(async () => {
  const { ArenaScene } = await import('/src/ui/arena/scene.ts');
  const orig = ArenaScene.prototype.stats;
  ArenaScene.prototype.stats = function () { window.__s = this; return orig.call(this); };
  try { window.__gosArena.stats(); } finally { ArenaScene.prototype.stats = orig; }
  const s = window.__s;
  s.paused = true;
  for (const a of s.actors.values()) { a.status.active = false; a.status.threatened = null; a.status.targetable = null; a.status.charging = null; }
  document.querySelectorAll('.coach, .hud__plates, .plates, .intents').forEach((e) => (e.style.visibility = 'hidden'));
});
await page.evaluate(({ actorId, targetId, kind }) => {
  const s = window.__s;
  const run = { melee: () => s.melee(actorId, targetId, () => s.hit(targetId, { fromDir: 1 })), hit: () => { s.hit(actorId, { heavy: true }); return s.wait(500); }, gesture: () => s.gesture(actorId, [0.6, 0.8, 1]), die: () => s.die(actorId) }[kind];
  window.__done = false;
  run().then(() => (window.__done = true));
}, { actorId, targetId, kind });
const shots = [];
for (let i = 0; i < +frames; i++) {
  // Шаг 1/30 с; стоп-кадр удара воспроизводим так же, как в игре: пока он длится, время мира стоит.
  const frozen = await page.evaluate(async () => {
    const s = window.__s;
    const dt = 1 / 30;
    if ((s.__hold ?? 0) > 0) {
      s.__hold -= 1;
      s.render();
      return true;
    }
    const before = s.freezeUntil;
    s.time += dt;
    s.update(dt * s.speed, dt);
    // Продолжения хореографии (impact) выполняются микрозадачами — дождаться их до проверки.
    await new Promise((r) => setTimeout(r, 0));
    s.render();
    if (s.freezeUntil > before) s.__hold = Math.max(1, Math.round((s.freezeUntil - performance.now()) / (1000 / 30)));
    return false;
  });
  shots.push({ buf: await page.screenshot({ type: 'png' }), frozen });
}
writeFileSync(out + '.json', JSON.stringify({ errors, frozen: shots.map((s) => s.frozen) }));
for (const [i, s] of shots.entries()) writeFileSync(`${out}-${String(i).padStart(2, '0')}.png`, s.buf);
console.log(JSON.stringify({ errors, frames: shots.length }));
await browser.close();
