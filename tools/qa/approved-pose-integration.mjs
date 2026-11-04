// Inspect every registered pose in the real battle renderer at desktop/mobile.
// Prepare fixtures with tools/qa/pose-set-saves.ts; run with a Vite dev server.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const saveDir = process.argv[3] ?? 'qa-saves/pose-sets';
const out = process.argv[4] ?? 'qa-out/pose-sets';
const layout = JSON.parse(readFileSync('art-sources/poses/technical-layout.json', 'utf8')).characters;
const mira = ['idle', 'aim', 'shoot', 'windup', 'strike', 'hit', 'down', 'victory'];
const viewports = (process.env.VIEWPORTS ?? '1920x1080,667x375').split(',').map(v => v.split('x').map(Number));
const scenarios = ['mixed', 'mage', 'boss', 'boss-phase2'];
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium',
  args: process.env.NO_WEBGL ? ['--disable-webgl', '--disable-3d-apis'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const rows = [];
mkdirSync(out, { recursive: true });
try {
  for (const [width, height] of viewports) for (const scenario of scenarios) {
    const save = JSON.parse(readFileSync(`${saveDir}/${scenario}.json`, 'utf8'));
    const run = JSON.parse(save.activeRun);
    const units = run.battle.units.map(u => ({ id: u.id, key: u.side === 'hero' ? u.identity : (u.kind === 'boneKing' && u.bossPhase === 2 ? 'boneKingPhase2' : u.kind) }));
    const expected = Object.fromEntries(units.map(u => [u.id, u.key === 'mira' ? mira : layout[u.key]?.poses ?? []]));
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await context.addInitScript(s => { s.lastSeen = Date.now(); localStorage.setItem('gos.save', JSON.stringify(s)); }, save);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/sdk.js')) errors.push(`${r.status()} ${r.url()}`); });
    try {
      await page.goto(`${base}?qa=1`);
      await page.waitForSelector('.action--attack', { timeout: 60000 });
      await page.waitForFunction(ids => {
        const s = window.__gosArena?.stats();
        return s && ids.every(id => s.units.some(u => u.id === id && u.pose));
      }, units.map(u => u.id), { timeout: 60000 });
      const info = await page.evaluate(async units => {
        const sceneUrl = performance.getEntriesByType('resource').map(e => e.name).findLast(url => /\/src\/ui\/arena\/scene\.ts(?:\?|$)/.test(url));
        const { ArenaScene } = await import(sceneUrl ?? '/src/ui/arena/scene.ts');
        const original = ArenaScene.prototype.stats;
        ArenaScene.prototype.stats = function () { window.__scene = this; return original.call(this); };
        try { window.__gosArena.stats(); } finally { ArenaScene.prototype.stats = original; }
        const s = window.__scene;
        s.paused = true;
        await Promise.all(document.querySelector('#screen > section').getAnimations().filter(a => Number.isFinite(a.effect.getTiming().iterations)).map(a => a.finished.catch(() => {})));
        for (const actor of s.actors.values()) { actor.status.active = false; actor.status.charging = null; }
        document.querySelectorAll('.coach').forEach(e => e.style.visibility = 'hidden');
        const samples = new Map();
        for (const u of units) {
          const a = s.actors.get(u.id);
          if (!a?.posePack) throw new Error(`${u.id} (${u.key}): pose pack not loaded`);
          for (const [pose, textures] of Object.entries(a.poseTex)) for (const tex of textures) {
            const c = document.createElement('canvas'); c.width = tex.w; c.height = tex.h;
            const gc = c.getContext('2d'); gc.drawImage(tex.source, 0, 0);
            const rgba = gc.getImageData(0, 0, tex.w, tex.h).data;
            const points = [];
            for (let y = 0; y < tex.h; y += 2) {
              let left = tex.w, right = -1;
              for (let x = 0; x < tex.w; x++) if (rgba[(y * tex.w + x) * 4 + 3] > 24) { left = Math.min(left, x); right = x; }
              if (right >= 0) points.push([left / tex.w, y / tex.h], [(right + 1) / tex.w, (y + 1) / tex.h]);
            }
            samples.set(tex, { id: u.id, pose, points });
          }
        }
        const smooth = (l, h, v) => { const t = Math.max(0, Math.min(1, (v - l) / (h - l))); return t * t * (3 - 2 * t); };
        const draw = s.backend.drawSprite.bind(s.backend);
        s.backend.drawSprite = d => {
          const sample = samples.get(d.tex); const a = sample && s.actors.get(sample.id);
          if (d.mode === 0 && sample && sample.id === window.__target && d.tex === s.poseFrame(a, s.shownPose(a)).tex && d.alpha > 0.05) {
            const v = s.view(); const t = d.time + d.phase; const br = Math.sin(t * 1.9);
            const points = sample.points.map(([u, vv]) => {
              const hf = 1 - vv; let x = (u - .5) * d.w; let y = -hf * d.h;
              if (s.backend.kind === 'canvas2d') {
                x *= (d.flip ? -1 : 1) * d.sx; y *= d.sy * (1 + d.breath * br); x -= d.lean * y;
              } else {
                x *= 1 + d.breath * .55 * br * Math.exp(-Math.pow((hf - .62) / .22, 2));
                y *= 1 + d.breath * br * smooth(.1, .9, hf);
                x += d.sway * d.w * .035 * Math.sin(t * 1.35 + vv * 4.5 + u * 2.3) * smooth(.1, .48, Math.abs(u - .5)) * smooth(.02, .14, hf) * (1 - smooth(.42, .8, hf));
                x += d.sway * d.w * .012 * Math.sin(t * .9 + vv * 2) * smooth(.3, .9, hf);
                y += d.bob * d.h * .007 * Math.sin(t * 1.9 - .6) * smooth(.65, .95, hf);
                x += d.lean * hf * d.h; x *= (d.flip ? -1 : 1) * d.sx; y *= d.sy;
              }
              const wx = Math.cos(d.rot) * x - Math.sin(d.rot) * y + d.x;
              const wy = Math.sin(d.rot) * x + Math.cos(d.rot) * y + d.y;
              return [((wx - v.x) * v.z + v.x) / s.dpr, ((wy - v.y) * v.z + v.y) / s.dpr];
            });
            const bounds = [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
            window.__bounds = { pose: sample.pose, bounds: bounds.map(n => Math.round(n * 10) / 10), fits: bounds[0] >= -2 && bounds[1] >= -2 && bounds[2] <= s.cssW + 2 && bounds[3] <= s.cssH + 2 };
          }
          draw(d);
        };
        return { backend: s.backendKind, errors: s.stats().errors, canvas: [s.cssW, s.cssH],
          units: units.map(u => ({ ...u, poses: Object.keys(s.actors.get(u.id).poseTex) })),
          scroll: [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight],
          dockBottom: document.querySelector('.battle-dock').getBoundingClientRect().bottom };
      }, units);
      const poses = [];
      for (const unit of units) {
        for (const pose of expected[unit.id]) {
          const row = await page.evaluate(({ id, pose }) => {
            const s = window.__scene; const a = s.actors.get(id);
            window.__target = id; window.__bounds = null;
            a.dead = false; a.fallen = false; a.p.offX = 0; a.p.offY = 0; a.p.lean = 0; a.p.rot = 0; a.p.sx = 1; a.p.sy = 1; a.p.alpha = 1; a.p.dissolve = 0;
            s.setPose(id, pose); s.time += 1; s.render();
            return window.__bounds;
          }, { id: unit.id, pose });
          poses.push({ id: unit.id, character: unit.key, requested: pose, ...row });
          if ((unit.key === 'boneKing' && pose === 'prepare') || (unit.key === 'boneGuard' && pose === 'hit') || (unit.key === 'nora' && pose === 'cast') || (unit.key === 'ashWolf' && pose === 'windup')) {
            await page.screenshot({ path: `${out}/${scenario}-${width}x${height}-${unit.key}-${pose}.png` });
          }
        }
        await page.evaluate(id => { const s = window.__scene; s.setPose(id, 'idle'); s.time += 1; s.render(); }, unit.id);
      }
      const missing = info.units.flatMap(u => expected[u.id].filter(p => !u.poses.includes(p)).map(p => `${u.key}.${p}`));
      const clipped = poses.filter(p => !p.fits || p.pose !== p.requested);
      const ok = !errors.length && !info.errors.length && !missing.length && !clipped.length && info.scroll.every(v => v <= 1) && info.dockBottom <= height + 1;
      rows.push({ scenario, viewport: [width, height], ok, errors, missing, clipped, ...info, poses });
      console.log(JSON.stringify({ scenario, viewport: [width, height], ok, errors, missing, clipped: clipped.map(p => `${p.character}.${p.requested}:${p.bounds}`) }));
    } catch (e) {
      rows.push({ scenario, viewport: [width, height], ok: false, errors: [...errors, String(e)] });
      console.error(`${scenario} ${width}x${height}: ${e}`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
writeFileSync(`${out}/report.json`, JSON.stringify({ ok: rows.every(r => r.ok), rows }, null, 2));
if (rows.some(r => !r.ok)) process.exitCode = 1;
