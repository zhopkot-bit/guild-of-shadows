#!/usr/bin/env node
// Bran v0.5 structural acceptance gate. Does not replace human art direction review.
// Usage: node tools/qa/bran-v05-gate.mjs . docs/qa/bran-v05-contract.json --strict
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const args = process.argv.slice(2).filter(a => a !== '--strict');
const root = resolve(args[0] || '.');
const configPath = resolve(args[1] || 'docs/qa/bran-v05-contract.json');
const strict = process.argv.includes('--strict');
const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
const failures = [], passed = [], manual = [];
const check = (ok, code, detail) => (ok ? passed : failures).push({ code, detail });
const file = (path, label) => { const ok = existsSync(resolve(root, path)); check(ok, 'FILE', label + ': ' + path); return ok; };
const json = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const packPath = cfg.rig.registry;
if (!file(packPath, 'Registry')) process.exit(2);
const pack = json(packPath), entry = pack.heroes?.bran;
check(!!entry?.rig && !!entry?.rigAtlas, 'REGISTRY', 'Bran rig and atlas declared');
const base = dirname(packPath);
if (entry?.rig && entry?.rigAtlas && file(base + '/' + entry.rig, 'Skeleton') && file(base + '/' + entry.rigAtlas, 'Atlas')) {
  const ske = json(base + '/' + entry.rig);
  const arm = ske.armature?.find(x => x.name === cfg.rig.armature);
  check(!!arm, 'ARMATURE', 'Named Bran armature exists');
  if (arm) {
    const full = arm.aabb, rest = arm.layoutAabb;
    check(!!full && !!rest, 'LAYOUT', 'Separate render aabb and rest-pose layoutAabb');
    if (full && rest) {
      check(rest.height >= cfg.rig.min_standing_height, 'STANDING_HEIGHT', 'Body size is not miniature');
      check(rest.width / rest.height <= cfg.rig.max_standing_width_ratio, 'STANDING_WIDTH', 'Weapon arc is not included in body bounds');
      check(Math.abs(rest.y + rest.height) <= cfg.rig.feet_y_tolerance, 'GROUND', 'Feet stand on local y=0');
      check(full.x <= rest.x && full.y <= rest.y && full.x+full.width >= rest.x+rest.width &&
        full.y+full.height >= rest.y+rest.height, 'SWEEP', 'Swept render bounds enclose standing bounds');
    }
    const bones = new Map((arm.bone||[]).map(x => [x.name,x]));
    const rootBone = bones.get('root');
    check(!!rootBone && !rootBone.parent && (arm.bone||[]).filter(x => !x.parent).length === 1,
      'ROOT', 'Exactly one root bone');
    if (rootBone) check(Math.abs(rootBone.transform?.x || 0) <= 3 && Math.abs(rootBone.transform?.y || 0) <= 3,
      'ROOT_AT_ORIGIN', 'Root transform anchored at (0,0)');
    const slots = new Set((arm.slot||[]).map(x => x.parent));
    for (const [limb, names] of Object.entries(cfg.rig.bone_chains)) {
      for (let i=0; i<names.length; i++) {
        const bone = bones.get(names[i]);
        check(!!bone, 'BONE', limb + ': ' + names[i] + ' exists');
        if (bone && i>0) check(bone.parent===names[i-1], 'PARENT', names[i] + ' parent is ' + names[i-1]);
        if (bone) check(slots.has(names[i]), 'ARTICULATED_SLOT', names[i] + ' has its own visual slot');
      }
    }
    check((arm.frameRate ?? ske.frameRate)===cfg.rig.required_frame_rate, 'FPS', 'Rig is 24 fps');
    const clips = new Map((arm.animation||[]).map(a => [a.name,a]));
    for (const [name, frameCount] of Object.entries(cfg.rig.required_clips)) {
      check(clips.get(name)?.duration===frameCount, 'CLIP', name + ' duration ' + frameCount + ' frames');
    }
    for (const [name, target] of Object.entries(cfg.rig.impact_frames)) {
      let at=0, impacts=[];
      for (const frame of clips.get(name)?.frame || []) {
        if (frame.event==='impact' || frame.events?.some(x => x.name==='impact')) impacts.push(at);
        at += frame.duration ?? 1;
      }
      check(impacts.length===1 && Math.abs(impacts[0]-target)<=1, 'IMPACT', name + ' at frame ' + target);
    }
  }
}
for (const [name,path] of Object.entries(cfg.masters)) file(path,name + ' authentic master');
const layers = pack.arenas?.crypt?.layers || [];
check(layers.length===4, 'LAYERS', 'Crypt has four layers');
if (layers.length===4) {
  check(layers.filter(l => l.front).length===1, 'FRONT', 'Exactly one front layer');
  check(layers.every((l,i) => i===0 || l.parallax > layers[i-1].parallax), 'PARALLAX', 'Parallax increases');
}
manual.push('Verify exact approved Bran identity against sprite.webp, portrait.webp and hero-lineup.webp.');
manual.push('Check true isolated far/mid/floor/front parallax and absence of double floor at all viewports.');
manual.push('View full 24fps attack, hit, death (lying end frame), plus alpha halos at moving joints.');
const report = { ok: failures.length===0, passed:passed.length, failures, manual };
console.log(JSON.stringify(report,null,2));
if (strict && failures.length) process.exit(1);
