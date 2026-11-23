import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [backend, widthText, heightText, mode] = process.argv.slice(2);
assert([undefined, '--baseline-preview', '--integration'].includes(mode), 'Unknown artwork test mode');
const integrated = mode === '--integration';
const testedSha = integrated ? process.env.GITHUB_SHA : '8307ef7910f3bd80fc05a51939a034aa8bd3fbd2';
const baseline = mode === '--baseline-preview';
assert(['webgl', 'canvas2d'].includes(backend));
const width = Number(widthText), height = Number(heightText);
assert([[1920, 1080], [667, 375]].some(([w, h]) => w === width && h === height));
const chromium = createRequire(resolve('package.json'))('playwright-core').chromium;
const out = resolve('qa-out/u01', baseline ? 'unchanged-reference' : 'candidate');
const base = 'http://127.0.0.1:5173/';
mkdirSync(out, { recursive: true });
const actualSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(actualSha, testedSha);
const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
const testedTree = execFileSync('git', ['write-tree'], { encoding: 'utf8' }).trim();
assert.equal(baseline || integrated, sourceTree === testedTree, 'Unexpected changes to the tested Git tree');
const patches = baseline || integrated ? [] : ['boss-hud.patch', 'boss-phase.patch', 'canvas-emissive.patch'].map(file => ({
  file, sha256: createHash('sha256').update(readFileSync(new URL('./rehearsal/' + file, import.meta.url))).digest('hex'),
}));
const report = { testedSha, testedTree, patches, baseline, integrated, harnessSha: process.env.GITHUB_SHA, backend, width, height, errors: [] };
const serverLog = openSync(resolve(out, 'vite.log'), 'w');
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { stdio: ['ignore', serverLog, serverLog] });
closeSync(serverLog);

async function emitPreview(browser, file, label) {
  const page = await browser.newPage();
  try {
    const jpeg = await page.evaluate(async raw => {
      const im = new Image();
      im.src = 'data:image/png;base64,' + raw;
      await im.decode();
      const c = document.createElement('canvas');
      c.width = Math.min(560, im.naturalWidth);
      c.height = Math.round(im.naturalHeight * c.width / im.naturalWidth);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.72).split(',')[1];
    }, readFileSync(file).toString('base64'));
    const chunks = jpeg.match(/.{1,1800}/g);
    chunks.forEach((data, i) => console.log(['U01_PREVIEW', label, i, chunks.length, data].join('|')));
  } finally { await page.close(); }
}

// Compare the same two real phase-II texels on opaque swatches. Each backend is compared
// to its own unlit reference: their normal grading and camera presentation may differ.
async function checkEmission() {
  const browser = await chromium.launch({
    args: backend === 'canvas2d' ? ['--disable-webgl', '--disable-3d-apis'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await browser.newPage();
    await page.goto(base);
    report.emission = await page.evaluate(async kind => {
      const { Canvas2DBackend } = await import('/src/ui/arena/canvas2d.ts');
      const { WebGLBackend } = await import('/src/ui/arena/webgl.ts');
      const canvas = (w,h) => { const c = document.createElement('canvas'); c.width=w; c.height=h; return c; };
      const art = new Image();
      art.src = new URL('art/v17/poses/bone_king_p2/idle.webp', location.href).href;
      await art.decode();
      const source = canvas(art.naturalWidth, art.naturalHeight);
      const gc = source.getContext('2d');
      gc.drawImage(art,0,0);
      const rgba = gc.getImageData(0,0,source.width,source.height).data;
      let armour, glow, armourScore=Infinity, glowScore=-Infinity;
      for (let y=Math.floor(source.height*.22); y<source.height*.72; y++) {
        for (let x=Math.floor(source.width*.3); x<source.width*.72; x++) {
          const i = 4*(y*source.width+x), r=rgba[i], g=rgba[i+1], b=rgba[i+2];
          if (rgba[i+3] !== 255) continue;
          const greyCost = Math.abs(r-57)+Math.abs(g-50)+Math.abs(b-48);
          if (greyCost < armourScore) { armourScore=greyCost; armour={ xy:[x,y], rgb:[r,g,b] }; }
          const blueScore=b-r + (g-r)*.25;
          if (b>65 && b<195 && blueScore>glowScore) { glowScore=blueScore; glow={ xy:[x,y], rgb:[r,g,b] }; }
        }
      }
      if (!armour || !glow || glowScore < 20) throw Error('Missing opaque armour / baked-blue texels in boss II artwork');
      const swatch = canvas(32,16), maskCanvas = canvas(32,16);
      const paint = swatch.getContext('2d');
      [armour,glow].forEach((p,i) => { paint.fillStyle='rgb('+p.rgb.join(',')+')'; paint.fillRect(i*16,0,16,16); });
      const mc=maskCanvas.getContext('2d'); mc.fillStyle='#fff'; mc.fillRect(0,0,16,16);
      const target=canvas(32,16), noise=canvas(2,2);
      const renderer=kind==='webgl' ? new WebGLBackend(target,noise) : new Canvas2DBackend(target);
      renderer.resize(32,16);
      renderer.setView(1,0,0);
      const tex=renderer.createTexture(swatch,32,16), mask=renderer.createTexture(maskCanvas,32,16);
      const readback=canvas(32,16).getContext('2d',{willReadFrequently:true});
      const d={ tex, emissive:null, uv:[0,0,1,1], x:16,y:16,w:32,h:16, flip:false,time:0,phase:0,
        breath:0,sway:0,bob:0,lean:0,sx:1,sy:1,rot:0,tint:[1,1,1],alpha:1,flash:0,flashColor:[1,.55,.25],
        dissolve:0,desat:0,emissiveStrength:0,emissiveColor:[0,.65,1], rim:0,rimColor:[0,0,0],outline:0,outlineColor:[0,0,0],mode:0 };
      function pixels(extra) {
        renderer.begin();
        renderer.drawSprite({...d,...extra});
        renderer.end();
        readback.clearRect(0,0,32,16); readback.drawImage(target,0,0);
        return [8,24].map(x => [...readback.getImageData(x,8,1,1).data].slice(0,3));
      }
      return { source: 'public/art/v17/poses/bone_king_p2/idle.webp', armour, glow, backend:renderer.kind,
        plain:pixels({}), noMask:pixels({emissiveStrength:1.6}), zeroMask:pixels({emissive:mask}),
        masked:pixels({emissive:mask,emissiveStrength:.45}), flash:pixels({flash:.25}),
        unmaskedFlash:pixels({flash:.25,emissiveStrength:1.6}),
        maskedFlash:pixels({flash:.25,emissive:mask,emissiveStrength:.45}) };
    }, backend);
    const p=report.emission;
    assert.equal(p.backend,backend);
    assert(p.plain.flat().some(x=>x>25), 'Actual sprite must be drawn');
    const diff = (a,b) => Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
    p.unmaskedDelta=p.plain.map((rgb,i)=>diff(rgb,p.noMask[i]));
    p.flashWeightDelta=p.flash.map((rgb,i)=>diff(rgb,p.unmaskedFlash[i]));
    if (baseline && backend === 'canvas2d') {
      assert(p.unmaskedDelta.every(d=>d>20), 'Original fallback must reproduce the full-body emission regression');
      return;
    }
    assert(p.unmaskedDelta.every(d=>d<=1), 'Baked artwork without a mask must preserve both original texels at strength 1.6');
    assert(p.flashWeightDelta.every(d=>d<=1), 'Unused emission strength must not amplify a hit flash');
    assert(p.plain.every((rgb,i)=>diff(rgb,p.zeroMask[i])<=1), 'An explicit mask with zero strength must be inert');
    assert(diff(p.plain[0],p.masked[0])>8 && diff(p.plain[1],p.masked[1])<=1, 'An explicit mask must brighten only its opaque part');
    assert(p.plain.every((rgb,i)=>diff(rgb,p.flash[i])>8), 'Hit flash must affect both opaque body texels');
    assert(diff(p.flash[0],p.maskedFlash[0])>5 && diff(p.flash[1],p.maskedFlash[1])<=1, 'Combined flash and mask must retain emission locality');
  } finally { await browser.close(); }
}

async function checkStatic() {
  const env = { ...process.env, CHROME: chromium.executablePath(), VIEWPORTS: width + 'x' + height };
  if (backend === 'canvas2d') env.NO_WEBGL = '1';
  else delete env.NO_WEBGL;
  const run = spawn(process.execPath, ['tools/qa/approved-pose-integration.mjs', base, 'qa-saves/pose-sets', out], { env, stdio: 'inherit' });
  const [exitCode] = await once(run, 'exit');
  const fixtureReport = JSON.parse(readFileSync(resolve(out, 'report.json'), 'utf8'));
  report.staticCases = fixtureReport.rows.map(row => ({
    scenario: row.scenario, backend: row.backend, viewport: row.viewport, poses: row.poses?.length,
    ok: row.ok, errors: row.errors, clipped: row.clipped,
  }));
  assert.deepEqual(fixtureReport.rows.map(row => row.scenario).sort(), ['boss', 'boss-phase2', 'mage', 'mixed']);
  for (const row of fixtureReport.rows) {
    assert.equal(row.backend, backend, 'Actual backend of ' + row.scenario);
    assert.deepEqual(row.viewport, [width, height]);
    assert(row.poses?.length > 0 && row.ok, 'Static bounds or resources failed in ' + row.scenario);
  }
  assert.equal(exitCode, 0, 'Static pose script failed');
}

// Sample the real game with the combat controls. This observer only reads scene/model state.
async function observeBattle() {
  const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => /\/src\/ui\/arena\/scene\.ts(?:\?|$)/.test(url));
  const { ArenaScene } = await import(moduleUrl ?? '/src/ui/arena/scene.ts');
  const original = ArenaScene.prototype.stats;
  let scene;
  ArenaScene.prototype.stats = function () { scene = this; return original.call(this); };
  try { window.__gosArena.stats(); } finally { ArenaScene.prototype.stats = original; }
  const battle = window.__gosArena.battle();
  const boss = battle.units.find(unit => unit.boss);
  const actor = scene.actors.get(boss.id);
  const canvas = scene.canvas.getBoundingClientRect();
  const bar = document.querySelector('.boss-bar').getBoundingClientRect();
  const poseState = () => ({
    idle: { breath: actor.spec.idle.breath, sway: actor.spec.idle.sway, hover: actor.spec.idle.hover },
    idleArt: actor.posePack.poses.idle, activePose: scene.shownPose(actor), secondPack: actor.posePack === actor.spec.poses2,
  });
  const trace = {
    phaseSwitches: [], initialVisual: poseState(),
    backend: scene.backendKind, initialPhase: boss.bossPhase,
    startsWithFirstPack: actor.posePack === actor.spec.poses,
    heroIds: battle.units.filter(unit => unit.side === 'hero').map(unit => unit.id),
    logStart: battle.log.length, bossId: boss.id, hpStart: boss.hp, hits: [], transition: null,
    firstPackFrames: 0, secondPackFrames: 0, framesWithMotion: 0, sequence: [],
    canvas: [canvas.width, canvas.height],
    hud: [bar.left-canvas.left, bar.top-canvas.top, bar.right-canvas.left, bar.bottom-canvas.top],
  };
  window.__r01ArtTrace = trace;
  // Observe the completion of the game's own animation independently from the model/HUD switch.
  const switchPack = scene.enterPhase2Visuals;
  scene.enterPhase2Visuals = function (unit, instant) {
    trace.phaseSwitches.push({ ms: Math.round(performance.now()), instant, phaseBefore: unit.phase2 });
    return switchPack.call(this, unit, instant);
  };
  const animatePhase = scene.bossPhase2;
  scene.bossPhase2 = async function (id) {
    trace.animationStart = { id, ms: Math.round(performance.now()), visual: poseState() };
    try {
      const result = await animatePhase.call(this, id);
      trace.animationEnd = { id, ms: Math.round(performance.now()), visual: poseState() };
      return result;
    } finally {
      delete this.bossPhase2;
    }
  };
  let previous = '';
  function sample() {
    const live = window.__gosArena.battle();
    if (live !== battle) return;
    const pose = scene.shownPose(actor);
    const phase = actor.phase2 ? 2 : 1;
    if (actor.posePack === actor.spec.poses && !actor.phase2) trace.firstPackFrames++;
    if (actor.posePack === actor.spec.poses2 && actor.phase2) trace.secondPackFrames++;
    if ([...scene.actors.values()].some(a => Math.abs(a.p.offX) > 1 || Math.abs(a.p.offY) > 1 || Math.abs(a.p.lean) > 0.015)) trace.framesWithMotion++;
    const marker = phase + '/' + pose;
    if (marker !== previous) {
      trace.sequence.push({ ms: Math.round(performance.now()), state: marker });
      previous = marker;
    }
    const log = battle.log.slice(trace.logStart);
    trace.hits = log.filter(e => e.t === 'hit' && e.target === boss.id && e.dmg > 0 && trace.heroIds.includes(e.actor))
      .map(e => ({ actor: e.actor, target: e.target, dmg: e.dmg, via: e.via }));
    if (!trace.transition && log.some(e => e.t === 'bossPhase') && boss.bossPhase === 2 && actor.phase2
        && actor.posePack === actor.spec.poses2 && document.querySelector('.boss-bar.is-phase-two')) {
      trace.transition = { ms: Math.round(performance.now()), hp: boss.hp, pose, round: battle.round };
    }
    requestAnimationFrame(sample);
  }
  sample();
}

function hudTextSnapshot() {
  const boss = window.__gosArena.battle().units.find(unit => unit.boss);
  const rect = el => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
  const el = document.querySelector('.boss-bar');
  const fields = ['.boss-bar__name', '.boss-bar__phase', '.boss-bar__hp'].map(selector => {
    const field = el.querySelector(selector);
    const range = document.createRange();
    range.selectNodeContents(field);
    const lines = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
    const box = el.getBoundingClientRect();
    return {
      selector, text: field.textContent, box: rect(field), lines: lines.length,
      overflowX: field.scrollWidth-field.clientWidth, overflowY: field.scrollHeight-field.clientHeight,
      insidePanel: lines.every(r => r.left >= box.left-1 && r.right <= box.right+1 && r.top >= box.top-1 && r.bottom <= box.bottom+1),
    };
  });
  const intent = document.querySelector('.intent--armed');
  return { phase: boss.bossPhase, expectedName: boss.name, fields, track: rect(el.querySelector('.boss-bar__track')), panel: rect(el),
    turns: rect(document.querySelector('.turns')), intent: intent ? rect(intent) : null,
    coachVisible: !document.querySelector('.coach').hidden,
    bannerOpacity: Number(getComputedStyle(document.querySelector('.hud__banner')).opacity) };
}

function assertReadableHud(snap) {
  assert.equal(snap.fields[0].text, snap.expectedName, 'Show the full canonical boss name');
  assert(snap.fields.every(f => f.text.trim() && f.insidePanel && f.overflowX <= 1 && f.overflowY <= 1), 'Full boss name, phase and HP must remain readable in phase ' + snap.phase);
  if (width === 667) {
    const overlap = (a, b) => Math.min(a[2],b[2])-Math.max(a[0],b[0]) > 1 && Math.min(a[3],b[3])-Math.max(a[1],b[1]) > 1;
    const contents = [...snap.fields.map(f => f.box), snap.track];
    for (let i = 0; i < contents.length; i++) {
      for (const other of contents.slice(i+1)) assert(!overlap(contents[i], other), 'Boss name, phase, health and track must not overlap');
    }
    assert(!overlap(snap.panel, snap.turns) && (!snap.intent || (!overlap(snap.panel, snap.intent) && !overlap(snap.turns, snap.intent))), 'Boss HUD, queue and telegraph must stay separate');
  }
}

async function checkLive() {
  const save = JSON.parse(readFileSync('qa-saves/mira/boss.json', 'utf8'));
  save.lastSeen = Date.now();
  const browser = await chromium.launch({
    args: backend === 'canvas2d' ? ['--disable-webgl', '--disable-3d-apis'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  report.browser = browser.version();
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1,
    storageState: { cookies: [], origins: [{ origin: new URL(base).origin, localStorage: [{ name: 'gos.save', value: JSON.stringify(save) }] }] },
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push('Live page: ' + error.message));
  page.on('response', response => {
    if (response.status() >= 400 && !(response.url() === new URL('/sdk.js', base).href && response.status() === 404)) {
      report.errors.push('HTTP ' + response.status() + ' ' + response.url());
    }
  });
  try {
    await page.goto(base + '?qa=1', { waitUntil: 'networkidle' });
    await page.locator('.action--attack').waitFor();
    await page.evaluate(observeBattle);
    const first = await page.evaluate(() => window.__r01ArtTrace);
    assert.equal(first.backend, backend, 'Live renderer');
    assert(first.initialPhase === 1 && first.startsWithFirstPack, 'Live run must start in phase I');
    report.phaseHud = { first: await page.evaluate(hudTextSnapshot) };
    await page.screenshot({ path: resolve(out, 'live-phase-I.png') });
    const coach = page.locator('.coach:not([hidden]) button');
    if (await coach.count()) await coach.first().click();
    await page.getByRole('button', { name: '×2', exact: true }).click();
    await page.getByRole('button', { name: 'Авто', exact: true }).click();
    await page.waitForFunction(() => window.__r01ArtTrace.hits.length > 0, null, { timeout: 60000 });
    await page.screenshot({ path: resolve(out, 'live-after-hit.png') });
    await page.waitForFunction(() => window.__r01ArtTrace.transition && window.__r01ArtTrace.animationEnd && window.__r01ArtTrace.secondPackFrames > 1, null, { timeout: 150000 });
    report.phaseHud.transition = await page.evaluate(hudTextSnapshot);
    await page.screenshot({ path: resolve(out, 'live-phase-II.png') });
    await page.getByRole('button', { name: 'Вручную', exact: true }).click();
    await page.locator('.action-bar:not(.is-targeting) .action--attack').waitFor({ timeout: 60000 });
    const tutorial = page.locator('.coach:not([hidden]) button');
    if (await tutorial.count()) await tutorial.first().click();
    await page.waitForFunction(() => document.querySelector('.coach').hidden
      && !document.querySelector('.hud__banner.is-on')
      && Number(getComputedStyle(document.querySelector('.hud__banner')).opacity) < 0.02, null, { timeout: 10000 });
    report.phaseHud.settled = await page.evaluate(hudTextSnapshot);
    await page.screenshot({ path: resolve(out, 'live-phase-II-settled.png') });
    await emitPreview(browser, resolve(out, 'live-phase-II.png'), 'live-phase-II');
    await emitPreview(browser, resolve(out, 'live-phase-II-settled.png'), 'settled-phase-II');
    assert.equal(report.phaseHud.settled.phase, 2, 'Settled screenshot must remain in the same phase-II battle');
    assertReadableHud(report.phaseHud.first);
    assertReadableHud(report.phaseHud.settled);
    const trace = await page.evaluate(() => window.__r01ArtTrace);
    assert(trace.firstPackFrames > 0 && trace.secondPackFrames > 0 && trace.framesWithMotion > 0);
    assert(trace.hits.length && trace.transition.hp < trace.hpStart);
    assert(trace.animationStart.id === trace.bossId && trace.animationEnd.id === trace.bossId && trace.animationEnd.ms > trace.animationStart.ms);
    assert(!trace.animationStart.visual.secondPack, 'Phase I art must last until the transformation starts');
    assert(trace.animationEnd.visual.secondPack, 'Phase II art must appear by the end of the animation');
    assert.equal(trace.phaseSwitches.length, 1, 'The live encounter must activate phase-II visuals once');
    assert(!trace.phaseSwitches[0].instant && trace.phaseSwitches[0].ms > trace.animationStart.ms, 'The change of art belongs to the animated transition');
  } finally {
    report.live = await page.evaluate(() => window.__r01ArtTrace ?? null).catch(() => null);
    if (!report.live?.transition) await page.screenshot({ path: resolve(out, 'live-failure.png') }).catch(() => {});
    await browser.close();
  }
}

async function checkRestoredPhase() {
  const save = JSON.parse(readFileSync('qa-saves/mira/boss-phase2.json', 'utf8'));
  save.lastSeen = Date.now();
  const browser = await chromium.launch({
    args: backend === 'canvas2d' ? ['--disable-webgl', '--disable-3d-apis'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await browser.newPage({
      viewport: { width, height }, deviceScaleFactor: 1,
      storageState: { cookies: [], origins: [{ origin: new URL(base).origin, localStorage: [{ name: 'gos.save', value: JSON.stringify(save) }] }] },
    });
    await page.goto(base + '?qa=1', { waitUntil: 'networkidle' });
    await page.locator('.action--attack').waitFor();
    report.restored = await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map(e => e.name).findLast(v => /\/src\/ui\/arena\/scene\.ts(?:\?|$)/.test(v));
      const { ArenaScene } = await import(url ?? '/src/ui/arena/scene.ts');
      let scene;
      const original = ArenaScene.prototype.stats;
      ArenaScene.prototype.stats = function () { scene = this; return original.call(this); };
      try { window.__gosArena.stats(); } finally { ArenaScene.prototype.stats = original; }
      const actor = [...scene.actors.values()].find(a => a.spec.boss);
      const state = () => ({
        secondPack: actor.phase2 && actor.posePack === actor.spec.poses2, idleArt: actor.posePack.poses.idle,
        activePose: scene.shownPose(actor), idle: { breath: actor.spec.idle.breath, sway: actor.spec.idle.sway, hover: actor.spec.idle.hover },
      });
      const before = state();
      const shards = scene.shards;
      // This explicit duplicate notification is a separate idempotence test in a restored scene.
      await scene.bossPhase2(actor.spec.id);
      return { backend: scene.backendKind, before, afterDuplicate: state(), sameShards: shards === scene.shards };
    });
    report.restored.hud = await page.evaluate(hudTextSnapshot);
    await page.screenshot({ path: resolve(out, 'restored-phase-II.png') });
    assertReadableHud(report.restored.hud);
    assert.equal(report.restored.backend, backend);
    assert(report.restored.before.secondPack && report.restored.sameShards, 'Restoring/replaying a phase must reuse its visuals');
    assert.deepEqual(report.restored.before, report.restored.afterDuplicate, 'A duplicate phase notification must preserve the restored visuals');
    const live = report.live?.animationEnd?.visual;
    assert(live?.secondPack && live.activePose && report.restored.before.activePose);
    assert.deepEqual(live.idleArt, report.restored.before.idleArt, 'Both paths must select the same phase-II idle artwork');
    assert.deepEqual(live.idle, report.restored.before.idle, 'Live and restored idle motion must match');
    assert(Math.abs(live.idle.breath - 0.013) < 1e-8 && Math.abs(live.idle.sway - 1.44) < 1e-8 && live.idle.hover === 6, 'Apply phase-II motion multipliers exactly once');
  } finally { await browser.close(); }
}

// In a separate scene, pin the phase-I overhead pose and inspect three points on the blade.
// Test actual upper-blade pixels from the loaded WebP against the browser's painted hit regions.
async function checkBossHud() {
  const browser = await chromium.launch({
    args: backend === 'canvas2d' ? ['--disable-webgl', '--disable-3d-apis'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const save = JSON.parse(readFileSync('qa-saves/mira/boss-telegraph.json', 'utf8'));
    save.lastSeen = Date.now();
    const page = await browser.newPage({
      viewport: { width, height }, deviceScaleFactor: 1,
      storageState: { cookies: [], origins: [{ origin: new URL(base).origin, localStorage: [{ name: 'gos.save', value: JSON.stringify(save) }] }] },
    });
    await page.goto(base + '?qa=1', { waitUntil: 'networkidle' });
    await page.locator('.action--attack').waitFor();
    const coach = page.locator('.coach:not([hidden]) button');
    if (await coach.count()) await coach.first().click();
    report.sword = await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map(e => e.name).findLast(v => /\/src\/ui\/arena\/scene\.ts(?:\?|$)/.test(v));
      const { ArenaScene } = await import(url ?? '/src/ui/arena/scene.ts');
      let scene;
      const original = ArenaScene.prototype.stats;
      ArenaScene.prototype.stats = function () { scene = this; return original.call(this); };
      try { window.__gosArena.stats(); } finally { ArenaScene.prototype.stats = original; }
      const actor = [...scene.actors.values()].find(a => a.spec.boss);
      if (!actor || actor.phase2 || actor.posePack !== actor.spec.poses) throw Error('Expected phase I pack');
      scene.paused = true;
      scene.setPose(actor.spec.id, 'prepare');
      scene.time += 1;
      const tex = scene.poseFrame(actor, 'prepare').tex;
      const canvas = document.createElement('canvas');
      canvas.width = tex.w; canvas.height = tex.h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(tex.source, 0, 0);
      const rgba = ctx.getImageData(0, 0, tex.w, tex.h).data;
      let top = -1;
      const rows = [];
      for (let y = 0; y < tex.h && rows.length < 3; y++) {
        if (top >= 0 && (y - top) % 4 !== 0) continue;
        const xs = [];
        for (let x = 0; x < tex.w; x++) if (rgba[(y * tex.w + x) * 4 + 3] >= 128) xs.push(x);
        if (!xs.length) continue;
        if (top === -1) top = y;
        rows.push([xs[Math.floor(xs.length / 2)] + 0.5, y + 0.5]);
      }
      if (rows.length !== 3 || top > tex.h * 0.04 || rows.at(-1)[1] > top + 10) throw Error('Expected three solid upper sword samples');
      let d;
      const draw = scene.backend.drawSprite;
      scene.backend.drawSprite = function (sprite) {
        if (sprite.mode === 0 && sprite.tex === tex && sprite.alpha > 0.95) d = sprite;
        return draw.call(this, sprite);
      };
      try { scene.render(); } finally { scene.backend.drawSprite = draw; }
      if (!d) throw Error('Expected real draw of the phase-I prepare texture');
      const frame = scene.canvas.getBoundingClientRect(), v = scene.view();
      const bar = document.querySelector('.boss-bar').getBoundingClientRect();
      const smooth = (lo, hi, n) => { const k = Math.max(0, Math.min(1, (n-lo)/(hi-lo))); return k*k*(3-2*k); };
      const t = d.time+d.phase, br = Math.sin(t*1.9);
      const rect = el => { const r = el.getBoundingClientRect(); return [r.left,r.top,r.right,r.bottom]; };
      const box = selector => rect(document.querySelector(selector));
      const panels = Object.fromEntries(['.boss-bar','.turns','.intent--armed'].map(sel => [sel, box(sel)]));
      const portraits = [...document.querySelectorAll('.turns__chip .portrait')].map(rect);
      const labels = ['.boss-bar__name','.boss-bar__phase','.boss-bar__hp'].map(selector => {
        const e = document.querySelector(selector);
        return { selector, text: e.textContent, overflowX: e.scrollWidth - e.clientWidth };
      });
      const controls = [...document.querySelectorAll('.action--attack,.hero-card')].map(e => {
        const r = e.getBoundingClientRect(), top = document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);
        return { box: rect(e), accessible: e.contains(top) };
      });
      const samples = rows.map(([px, py]) => {
        const u = px/tex.w, vv = py/tex.h, hf = 1-vv;
        let x = (u-0.5)*d.w, y = -hf*d.h;
        if (scene.backendKind === 'canvas2d') {
          x *= (d.flip ? -1 : 1)*d.sx; y *= d.sy*(1+d.breath*br); x -= d.lean*y;
        } else {
          x *= 1+d.breath*.55*br*Math.exp(-Math.pow((hf-.62)/.22, 2));
          y *= 1+d.breath*br*smooth(.1,.9,hf);
          x += d.sway*d.w*.035*Math.sin(t*1.35+vv*4.5+u*2.3)*smooth(.1,.48,Math.abs(u-.5))*smooth(.02,.14,hf)*(1-smooth(.42,.8,hf));
          x += d.sway*d.w*.012*Math.sin(t*.9+vv*2)*smooth(.3,.9,hf);
          y += d.bob*d.h*.007*Math.sin(t*1.9-.6)*smooth(.65,.95,hf);
          x += d.lean*hf*d.h; x *= (d.flip ? -1 : 1)*d.sx; y *= d.sy;
        }
        const wx = Math.cos(d.rot)*x-Math.sin(d.rot)*y+d.x, wy = Math.sin(d.rot)*x+Math.cos(d.rot)*y+d.y;
        const screenX = frame.left+((wx-v.x)*v.z+v.x)/scene.dpr, screenY = frame.top+((wy-v.y)*v.z+v.y)/scene.dpr;
        const elements = document.elementsFromPoint(screenX, screenY);
        const front = document.elementFromPoint(screenX, screenY);
        return { texture: [px, py], screen: [screenX, screenY], topElement: front?.className,
          underBossHud: elements.some(el => el.closest('.boss-bar')), underPanel: elements.some(el => el.closest('.boss-bar,.turns,.intent--armed')) };
      });
      return { source: 'separate phase-I telegraph scene, pinned prepare', backend: scene.backendKind, samples, arena: rect(scene.canvas), panels, portraits, labels, controls,
        feet: actor.y / scene.dpr, figureHeight: actor.h / scene.dpr,
        hud: [bar.left, bar.top, bar.right, bar.bottom], swordTipUnderHud: samples.some(p => p.underBossHud) };
    });
    await page.screenshot({ path: resolve(out, 'pinned-sword-and-hud.png') });
    await emitPreview(browser, resolve(out, 'pinned-sword-and-hud.png'), baseline ? 'baseline-sword' : 'candidate-sword');
    assert.equal(report.sword.backend, backend);
    if (!baseline) assert(!report.sword.samples.some(p => p.underPanel), 'Upper pixels of the raised sword fall behind a tactical HUD panel');
    if (!baseline && width === 667) {
      const result = report.sword;
      const within = (a, b) => a[2] > a[0] && a[3] > a[1] && a[0] >= b[0]-1 && a[1] >= b[1]-1 && a[2] <= b[2]+1 && a[3] <= b[3]+1;
      const overlap = (a, b) => Math.min(a[2], b[2])-Math.max(a[0], b[0]) > 1 && Math.min(a[3], b[3])-Math.max(a[1], b[1]) > 1;
      if (integrated) {
        assert(result.figureHeight > 0 && within(result.arena, [0, 0, width, height]), 'Visible mobile arena and boss');
      } else {
        const reference = JSON.parse(readFileSync(resolve('qa-out/u01/unchanged-reference/rehearsal.json'), 'utf8')).sword;
        assert.deepEqual(result.arena, reference.arena, 'Preserve mobile canvas');
        assert.equal(result.feet, reference.feet, 'Preserve floor position');
        assert.equal(result.figureHeight, reference.figureHeight, 'Preserve boss scale');
      }
      const panels = Object.values(result.panels);
      for (let i = 0; i < panels.length; i++) {
        assert(within(panels[i], result.arena), 'A tactical panel is outside the mobile arena');
        for (const other of panels.slice(i+1)) assert(!overlap(panels[i], other), 'Tactical panels overlap each other');
      }
      assert(result.portraits.length && result.portraits.every(p => within(p, result.panels['.turns'])), 'Turn order portraits must fit');
      assert(result.labels.every(l => l.text.trim() && l.overflowX <= 1), 'Boss name, phase and HP must fit');
      assert(result.controls.length >= 4 && result.controls.every(c => c.accessible), 'Manual attack and party cards must be reachable');
    }
  } finally { await browser.close(); }
}

try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error('Vite exited before startup');
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
    await delay(150);
  }
  assert(ready, 'Vite failed to start');
  const checks = baseline ? [['reference HUD', checkBossHud], ['reference emission', checkEmission]]
    : [['static', checkStatic], ['live', checkLive], ['restored phase II', checkRestoredPhase], ['HUD', checkBossHud], ['emission controls', checkEmission]];
  for (const [name, check] of checks) {
    try { await check(); }
    catch (error) { report.errors.push(name + ': ' + (error.stack ?? error.message)); }
  }
} catch (error) {
  report.errors.push(error.stack ?? error.message);
} finally {
  server.kill('SIGTERM');
  report.ok = report.errors.length === 0;
  writeFileSync(resolve(out, 'rehearsal.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, testedSha, testedTree, baseline, integrated, patches, backend, width, height, errors: report.errors, sword: report.sword, live: report.live, restored: report.restored, phaseHud: report.phaseHud, emission: report.emission }));
  if (!report.ok) process.exitCode = 1;
}
