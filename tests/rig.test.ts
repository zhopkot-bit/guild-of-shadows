import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rig, apply, localMatrix, mul, sampleTimeline, type DbAtlas, type DbSkeleton } from '../src/ui/arena/rig';
import { isAnimPack } from '../src/content/artpack';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('математика скелета DragonBones', () => {
  it('localMatrix: поворот на 90° переводит ось X в ось Y (экранные координаты)', () => {
    const m = localMatrix({ skX: 90, skY: 90 });
    const [x, y] = apply(m, 1, 0);
    close(x, 0);
    close(y, 1);
  });

  it('mul: родитель со смещением и масштабом применяется после ребёнка', () => {
    const parent = localMatrix({ x: 10, y: 20, scX: 2, scY: 2 });
    const child = localMatrix({ x: 5 });
    const [x, y] = apply(mul(parent, child), 1, 0);
    close(x, 10 + 2 * 6);
    close(y, 20);
  });

  it('sampleTimeline: линейная интерполяция и ступенька без tweenEasing', () => {
    const frames = [{ duration: 10, tweenEasing: 0, rotate: 0 }, { duration: 0, rotate: 90 }];
    const pick = (f: { rotate?: number }) => f.rotate ?? 0;
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    close(sampleTimeline(frames, 5, pick, lerp, 0), 45);
    close(sampleTimeline(frames, 20, pick, lerp, 0), 90);
    const step = [{ duration: 10, rotate: 0 }, { duration: 0, rotate: 90 }];
    close(sampleTimeline(step, 5, pick, lerp, 0), 0);
    close(sampleTimeline(undefined, 5, pick, lerp, 7), 7);
  });
});

describe('Rig на тестовом манекене', () => {
  const dir = 'qa-fixtures/artpack-demo/';
  const ske = JSON.parse(readFileSync(dir + 'mannequin_ske.json', 'utf8')) as DbSkeleton;
  const atlas = JSON.parse(readFileSync(dir + 'mannequin_tex.json', 'utf8')) as DbAtlas;
  const rig = new Rig(ske, atlas);

  it('анимации и событие удара читаются', () => {
    expect(rig.animations()).toEqual(expect.arrayContaining(['idle', 'attack', 'hit', 'death']));
    const idle = rig.info('idle');
    expect(idle?.loop).toBe(true);
    const attack = rig.info('attack');
    expect(attack?.loop).toBe(false);
    const impact = attack?.events.find((e) => e.name === 'impact');
    expect(impact).toBeDefined();
    expect(impact!.time).toBeGreaterThan(0);
    expect(impact!.time).toBeLessThan(attack!.duration);
    expect(rig.info('nope')).toBeNull();
  });

  it('поза: все части в атласе, ноги у y≈0, атака двигает части', () => {
    const rest = rig.pose('idle', 0);
    expect(rest.length).toBeGreaterThan(3);
    for (const p of rest) {
      for (const v of p.uv) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(p.alpha).toBeGreaterThan(0);
    }
    expect(rig.aabb.y + rig.aabb.height).toBeGreaterThan(-5);
    expect(rig.aabb.y + rig.aabb.height).toBeLessThan(40);
    const hit = rig.info('attack')!.events.find((e) => e.name === 'impact')!.time;
    const swing = rig.pose('attack', hit);
    const moved = swing.some((p, i) => Math.hypot(p.m[4] - rest[i]!.m[4], p.m[5] - rest[i]!.m[5]) > 5);
    expect(moved).toBe(true);
  });

  it('без анимации — исходная поза, неизвестная арматура — первая', () => {
    expect(new Rig(ske, atlas, 'missing').armature.name).toBe(ske.armature[0]!.name);
    expect(rig.pose(null, 3).length).toBe(rig.pose('idle', 0).length);
  });
});

describe('DragonBones standing bounds vs swept bounds', () => {
  const dir = 'qa-fixtures/artpack-demo/';
  const fixture = JSON.parse(readFileSync(dir + 'mannequin_ske.json', 'utf8')) as DbSkeleton;
  const atlas = JSON.parse(readFileSync(dir + 'mannequin_tex.json', 'utf8')) as DbAtlas;

  it('keeps existing rigs backwards compatible without layoutAabb', () => {
    const rig = new Rig(fixture, atlas);
    expect(rig.layoutAabb).toEqual(rig.aabb);
  });

  it('uses independent standing size without clipping the full render bounds', () => {
    const ske = structuredClone(fixture);
    ske.armature[0]!.layoutAabb = { x: -40, y: -100, width: 80, height: 100 };
    const rig = new Rig(ske, atlas);
    expect(rig.layoutAabb).toEqual({ x: -40, y: -100, width: 80, height: 100 });
    expect(rig.aabb).not.toEqual(rig.layoutAabb);
    expect(rig.pose('attack', 0.1).length).toBeGreaterThan(0);
  });

  it('rejects zero or invalid standing bounds', () => {
    const ske = structuredClone(fixture);
    ske.armature[0]!.layoutAabb = { x: 0, y: -100, width: 0, height: 100 };
    expect(() => new Rig(ske, atlas)).toThrow(/layoutAabb/);
  });
});

describe('пакет кадровой анимации', () => {
  const base = { version: 1, frameWidth: 100, frameHeight: 200, pivot: [0.5, 0.95], clips: { idle: { frames: [0, 1], fps: 8 } } };
  it('принимает image или pages', () => {
    expect(isAnimPack({ ...base, image: 'a.webp' })).toBe(true);
    expect(isAnimPack({ ...base, pages: ['a.webp', 'b.webp'] })).toBe(true);
  });
  it('отклоняет неполные пакеты', () => {
    expect(isAnimPack({ ...base })).toBe(false);
    expect(isAnimPack({ ...base, image: 'a.webp', version: 2 })).toBe(false);
    expect(isAnimPack({ ...base, image: 'a.webp', clips: {} })).toBe(false);
    expect(isAnimPack({ ...base, image: 'a.webp', clips: { idle: { frames: [], fps: 8 } } })).toBe(false);
    expect(isAnimPack(null)).toBe(false);
  });
});
