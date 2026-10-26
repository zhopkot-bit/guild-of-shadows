/** Developer-only pose inspection using the live game's ArenaScene and renderer.
 * CHROME=/usr/bin/chromium node tools/qa/bran-poses.mjs [base] [save] [out]
 * Forces poses for visual inspection; does not prove combat event sequencing.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const [base = 'http://127.0.0.1:5173/', savePath = 'qa-saves/battle.json', out = 'qa-out/bran-poses'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript(serial => {
    const save = JSON.parse(serial);
    save.lastSeen = Date.now();
    localStorage.setItem('gos.save', JSON.stringify(save));
  }, readFileSync(savePath, 'utf8'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}?qa=1`);
  await page.waitForFunction(() => window.__gosArena?.stats().units.some(u => u.id === 'h1' && u.rig));
  // Acquire the existing battle scene without adding a production debug API.
  await page.evaluate(async () => {
    const { ArenaScene } = await import('/src/ui/arena/scene.ts');
    const original = ArenaScene.prototype.stats;
    ArenaScene.prototype.stats = function () {
      window.__branPoseScene = this;
      return original.call(this);
    };
    try { window.__gosArena.stats(); }
    finally { ArenaScene.prototype.stats = original; }
    window.__branPoseScene.paused = true;
  });
  const rows = [];
  for (const clip of ['idle', 'attack', 'cast', 'hit', 'death', 'victory']) {
    for (const fraction of [0, 0.5, 0.999]) {
      const row = await page.evaluate(({ clip, fraction }) => {
        const scene = window.__branPoseScene;
        const actor = scene.actors.get('h1');
        const info = actor.rig.rig.info(clip);
        scene.play('h1', clip);
        actor.clip.start = scene.time - info.duration * fraction / scene.speed;
        scene.render();
        const box = scene.canvas.getBoundingClientRect();
        const x = Math.max(0, box.x + actor.x - actor.w * 0.65);
        const y = Math.max(0, box.y + actor.y - actor.h * 1.15);
        return { clip, fraction, backend: scene.stats().backend, errors: scene.errors, crop: { x, y, width: Math.min(actor.w * 1.3, innerWidth - x), height: Math.min(actor.h * 1.25, innerHeight - y) } };
      }, { clip, fraction });
      await page.screenshot({ path: `${out}/${clip}-${fraction}.png`, clip: row.crop });
      rows.push(row);
    }
  }
  const result = { ok: errors.length === 0 && rows.every(r => r.errors.length === 0), method: 'Forced poses in live battle renderer; not natural combat sequencing', errors, rows };
  writeFileSync(`${out}/poses.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: result.ok, captures: rows.length, errors }));
  if (!result.ok) process.exitCode = 1;
} finally { await browser.close(); }
