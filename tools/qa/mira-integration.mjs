// Real arena/renderer checks. Prepare saves with QA_PARTY=mira,rook,nora make-saves.ts.
// CHROME=/usr/bin/chromium node tools/qa/mira-integration.mjs [base] [save] [out]
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [base = 'http://127.0.0.1:5173/', savePath = 'qa-saves/mira/battle.json', out = 'qa-out/mira-integration'] = process.argv.slice(2);
const save = JSON.parse(readFileSync(savePath, 'utf8'));
const heroId = save.heroes.find(h => h.identity === 'mira').id;
const poses = ['idle', 'aim', 'shoot', 'windup', 'strike', 'hit', 'down', 'victory'];
const viewports = (process.env.VIEWPORTS ?? '1920x1080,1366x768,1024x768,844x390,667x375').split(',').map(v => v.split('x').map(Number));
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: process.env.NO_WEBGL ? ['--disable-webgl', '--disable-3d-apis'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const rows = [];
mkdirSync(out, { recursive: true });
try {
  for (const [width, height] of viewports) {
    const dir = `${out}/${width}x${height}`;
    mkdirSync(dir, { recursive: true });
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await ctx.addInitScript(s => { s.lastSeen = Date.now(); localStorage.setItem('gos.save', JSON.stringify(s)); }, save);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/sdk.js')) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`${base}?qa=1`);
    await page.waitForSelector('.action--attack', { timeout: 60000 });
    await page.waitForFunction(() => window.__gosArena?.stats().units.length > 0);
    const info = await page.evaluate(async heroId => {
      const sceneUrl = performance.getEntriesByType('resource').map(e => e.name).findLast(url => /\/src\/ui\/arena\/scene\.ts(?:\?|$)/.test(url));
      const { ArenaScene } = await import(sceneUrl ?? '/src/ui/arena/scene.ts');
      const original = ArenaScene.prototype.stats;
      ArenaScene.prototype.stats = function () { window.__scene = this; return original.call(this); };
      try { window.__gosArena.stats(); } finally { ArenaScene.prototype.stats = original; }
      const s = window.__scene;
      s.paused = true;
      await Promise.all(document.querySelector('#screen > section').getAnimations().filter(a => Number.isFinite(a.effect.getTiming().iterations)).map(a => a.finished.catch(() => {})));
      const a = s.actors.get(heroId);
      if (!a?.posePack) throw new Error('Mira production pose pack not loaded');
      for (const actor of s.actors.values()) { actor.status.active = false; actor.status.charging = null; }
      document.querySelectorAll('.coach').forEach(e => e.style.visibility = 'hidden');
      // Sample the alpha silhouette (not the transparent canvas) and transform it
      // with the same deformation/camera equations as the active renderer.
      const samples = new Map();
      for (const [pose, textures] of Object.entries(a.poseTex)) {
        for (const tex of textures) {
          const c = document.createElement('canvas'); c.width = tex.w; c.height = tex.h;
          const context = c.getContext('2d'); context.drawImage(tex.source, 0, 0);
          const rgba = context.getImageData(0, 0, tex.w, tex.h).data;
          const points = [];
          for (let y = 0; y < tex.h; y += 2) {
            let left = tex.w, right = -1;
            for (let x = 0; x < tex.w; x++) if (rgba[(y * tex.w + x) * 4 + 3] > 24) { left = Math.min(left, x); right = x; }
            if (right >= 0) points.push([left / tex.w, y / tex.h], [(right + 1) / tex.w, (y + 1) / tex.h]);
          }
          samples.set(tex, { pose, points });
        }
      }
      const smooth = (l, h, v) => { const t = Math.max(0, Math.min(1, (v - l) / (h - l))); return t * t * (3 - 2 * t); };
      const draw = s.backend.drawSprite.bind(s.backend);
      s.backend.drawSprite = d => {
        const sample = samples.get(d.tex);
        if (d.mode === 0 && sample && d.tex === s.poseFrame(a, s.shownPose(a)).tex && d.alpha > 0.05) {
          const v = s.view(); const t = d.time + d.phase; const br = Math.sin(t * 1.9);
          const points = sample.points.map(([u, vv]) => {
            const hf = 1 - vv; let x = (u - 0.5) * d.w; let y = -hf * d.h;
            if (s.backend.kind === 'canvas2d') {
              x *= (d.flip ? -1 : 1) * d.sx; y *= d.sy * (1 + d.breath * br); x -= d.lean * y;
            } else {
              x *= 1 + d.breath * 0.55 * br * Math.exp(-Math.pow((hf - 0.62) / 0.22, 2));
              y *= 1 + d.breath * br * smooth(0.1, 0.9, hf);
              x += d.sway * d.w * 0.035 * Math.sin(t * 1.35 + vv * 4.5 + u * 2.3) * smooth(0.1, 0.48, Math.abs(u - 0.5)) * smooth(0.02, 0.14, hf) * (1 - smooth(0.42, 0.8, hf));
              x += d.sway * d.w * 0.012 * Math.sin(t * 0.9 + vv * 2) * smooth(0.3, 0.9, hf);
              y += d.bob * d.h * 0.007 * Math.sin(t * 1.9 - 0.6) * smooth(0.65, 0.95, hf);
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
      window.__reset = () => {
        s.tweens = []; s.projectiles = []; s.particles = []; s.fx = []; s.freezeUntil = 0; s.camPunch = 0; s.shakeAmp = 0;
        a.dead = false; a.fallen = false; a.p.offX = 0; a.p.offY = 0; a.p.lean = 0; a.p.rot = 0; a.p.sx = 1; a.p.sy = 1; a.p.alpha = 1; a.p.dissolve = 0;
        s.setPose(heroId, 'idle'); s.releaseCam(); s.cam = { ...s.camGoal }; s.time += 1;
      };
      return { backend: s.backendKind, errors: s.stats().errors, poses: Object.keys(a.poseTex), canvas: [s.cssW, s.cssH], heroId, scroll: [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight], dockBottom: document.querySelector('.battle-dock').getBoundingClientRect().bottom };
    }, heroId);
    const staticRows = [];
    for (const pose of poses) {
      const result = await page.evaluate(({ heroId, pose }) => { window.__reset(); const s = window.__scene; s.setPose(heroId, pose); s.time += 1; s.render(); return window.__bounds; }, { heroId, pose });
      staticRows.push({ requested: pose, ...result });
      if (width === 667 || width === 1920) await page.screenshot({ path: `${dir}/${pose}.png` });
    }
    const actions = [];
    for (const kind of ['shoot', 'melee', 'hit', 'victory', 'die']) {
      await page.evaluate(({ heroId, kind }) => {
        window.__reset(); const s = window.__scene;
        const target = [...s.actors.values()].find(a => a.spec.side === 'enemy').spec.id;
        window.__finished = false;
        const action = { shoot: () => s.shoot(heroId, target, 'arrow', () => {}), melee: () => s.melee(heroId, target, () => {}, { double: true }), hit: () => { s.hit(heroId, { heavy: true }); return s.wait(650); }, victory: () => s.victory([heroId]), die: () => s.die(heroId) }[kind];
        action().then(() => { window.__finished = true; });
      }, { heroId, kind });
      const frames = await page.evaluate(async () => {
        const s = window.__scene; const rows = [];
        for (let frame = 0; frame < 240; frame++) {
          s.time += 1 / 60; s.update(1 / 60, 1 / 60); s.shakeAmp = 0;
          await new Promise(r => setTimeout(r, 0));
          s.render(); rows.push({ frame, ...window.__bounds });
          if (window.__finished && frame > 3) break;
        }
        return { completed: window.__finished, frames: rows };
      });
      actions.push({ kind, ...frames });
    }
    const ok = !errors.length && !info.errors.length && poses.every(n => info.poses.includes(n)) && staticRows.every(r => r.requested === r.pose && r.fits) && actions.every(a => a.completed && a.frames.every(f => f.fits)) && info.scroll.every(v => v <= 1) && info.dockBottom <= height + 1;
    rows.push({ viewport: [width, height], ok, errors, ...info, static: staticRows, actions });
    console.log(JSON.stringify({ viewport: [width, height], ok, errors, clipped: staticRows.filter(r => !r.fits), actions: actions.map(a => ({ kind: a.kind, completed: a.completed, clipped: a.frames.filter(f => !f.fits).length, poses: [...new Set(a.frames.map(f => f.pose))] })) }));
    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${out}/report.json`, JSON.stringify({ ok: rows.every(r => r.ok), rows }, null, 2));
if (rows.some(r => !r.ok)) process.exitCode = 1;
