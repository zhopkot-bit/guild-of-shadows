import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apply, Rig, type DbAtlas, type DbSkeleton } from '../src/ui/arena/rig';

// Contract/integration tests against the real files, not a synthetic mannequin fixture.
const root = resolve(process.cwd(), 'public/art/v17');
const pack = JSON.parse(readFileSync(resolve(root, 'art-pack.json'), 'utf8')) as {
  version: number;
  heroes: Record<string, { rig?: string; rigAtlas?: string; rigArmature?: string; portrait?: string }>;
  arenas: Record<string, { layers: Array<{ src: string; parallax: number; front?: boolean }> }>;
};
const bran = pack.heroes.bran!;
const rig = new Rig(
  JSON.parse(readFileSync(resolve(root, bran.rig!), 'utf8')) as DbSkeleton,
  JSON.parse(readFileSync(resolve(root, bran.rigAtlas!), 'utf8')) as DbAtlas,
  bran.rigArmature,
);

function boundsOK(clip: string) {
  const info = rig.info(clip)!;
  const box = rig.aabb;
  const epsilon = 1.5;
  // Half-frame sampling catches between-keyframe clipping in the game's own rig evaluator.
  for (let t = 0; t <= info.duration + 1e-7; t += 0.5 / rig.frameRate) {
    for (const part of rig.pose(clip, Math.min(t, info.duration))) {
      for (const x of [part.x0, part.x0 + part.w]) {
        for (const y of [part.y0, part.y0 + part.h]) {
          const [worldX, worldY] = apply(part.m, x, y);
          expect(worldX).toBeGreaterThanOrEqual(box.x - epsilon);
          expect(worldX).toBeLessThanOrEqual(box.x + box.width + epsilon);
          expect(worldY).toBeGreaterThanOrEqual(box.y - epsilon);
          expect(worldY).toBeLessThanOrEqual(box.y + box.height + epsilon);
        }
      }
    }
  }
}

describe('Bran v0.4 real art-pack', () => {
  it('retains registry v1 and references all pilot resources', () => {
    expect(pack.version).toBe(1);
    expect(bran.portrait).toBe('heroes/bran/portrait_pilot_v04.webp');
    for (const path of [bran.rig!, bran.rigAtlas!, bran.portrait!, 'rigs/bran/bran_tex.webp']) {
      expect(existsSync(resolve(root, path)), path).toBe(true);
    }
    expect(rig.armature.name).toBe('bran');
    expect(rig.frameRate).toBe(24);
    const crypt = pack.arenas.crypt;
    expect(crypt).toBeDefined();
    if (!crypt) throw new Error('Missing crypt arena in art-pack registry');
    expect(crypt.layers).toHaveLength(4);
    expect(crypt.layers.filter((l) => l.front)).toHaveLength(1);
    for (const layer of crypt.layers) {
      expect(existsSync(resolve(root, layer.src)), layer.src).toBe(true);
      expect(layer.parallax).toBeGreaterThanOrEqual(0);
      expect(layer.parallax).toBeLessThanOrEqual(2);
    }
  });

  it('includes six DragonBones clips and correctly timed impact events', () => {
    expect(rig.animations()).toEqual(expect.arrayContaining(['idle', 'attack', 'cast', 'hit', 'death', 'victory']));
    expect(rig.info('idle')?.loop).toBe(true);
    for (const [clip, frame] of [['attack', 10], ['cast', 7]] as const) {
      const info = rig.info(clip)!;
      const impacts = info.events.filter((e) => e.name === 'impact');
      expect(impacts).toHaveLength(1);
      expect(impacts[0]!.time).toBeCloseTo(frame / 24, 6);
      expect(info.loop).toBe(false);
    }
  });

  it('keeps animated atlas geometry inside the declared aabb at half-frame intervals', () => {
    for (const clip of rig.animations()) boundsOK(clip);
  });
});
