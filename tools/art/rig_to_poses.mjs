// Плейсхолдер-позы из рига DragonBones: рендерит выбранные моменты анимаций в отдельные PNG
// (тот же рантайм, что в игре). Нужен запущенный `npm run dev`.
// node tools/art/rig_to_poses.mjs <baseUrl> <ske.json url> <tex.json url> <outDir> '<json: {"pose": ["anim", seconds], ...}>' [height]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base, skeUrl, texUrl, outDir, specJson, height = '1024'] = process.argv.slice(2);
const spec = JSON.parse(specJson);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.goto(base);
const out = await page.evaluate(async ({ skeUrl, texUrl, spec, height }) => {
  const { Rig } = await import('/src/ui/arena/rig.ts');
  const ske = await (await fetch(skeUrl)).json();
  const atlas = await (await fetch(texUrl)).json();
  const img = new Image();
  img.src = new URL(atlas.imagePath, new URL(texUrl, location.href)).href;
  await img.decode();
  const rig = new Rig(ske, atlas);
  const box = rig.aabb;
  const H = height;
  const s = H / box.height;
  const W = Math.round(box.width * s);
  const res = {};
  for (const [pose, [anim, t]] of Object.entries(spec)) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    for (const p of rig.pose(anim, t)) {
      const m = p.m;
      g.setTransform(s * m[0], s * m[1], s * m[2], s * m[3], s * (m[4] - box.x), s * (m[5] - box.y));
      g.globalAlpha = p.alpha;
      const [u0, v0, u1, v1] = p.uv;
      g.drawImage(img, u0 * img.width, v0 * img.height, (u1 - u0) * img.width, (v1 - v0) * img.height, p.x0, p.y0, p.w, p.h);
    }
    res[pose] = c.toDataURL('image/png');
  }
  const lb = ske.armature?.find((a) => a.name === rig.armature.name)?.layoutAabb ?? box;
  return { res, W, H, pivot: [-box.x / box.width, -box.y / box.height], figureHeight: lb.height / box.height, figureWidth: lb.width / box.width };
}, { skeUrl, texUrl, spec, height: +height });
for (const [pose, url] of Object.entries(out.res)) writeFileSync(`${outDir}/${pose}.png`, Buffer.from(url.split(',')[1], 'base64'));
writeFileSync(`${outDir}/meta.json`, JSON.stringify({ frameWidth: out.W, frameHeight: out.H, pivot: out.pivot, figureHeight: out.figureHeight, figureWidth: out.figureWidth }, null, 1));
console.log(JSON.stringify({ W: out.W, H: out.H, pivot: out.pivot, figureHeight: out.figureHeight, figureWidth: out.figureWidth }));
await browser.close();
