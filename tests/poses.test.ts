import { describe, expect, it } from 'vitest';
import { POSE_NAMES, REQUIRED_POSES, WOUNDED_HP, isPosePack, isVfxPack, resolvePose, type PoseName } from '../src/content/artpack';

const base = { version: 1, frameWidth: 1200, frameHeight: 1000, pivot: [0.24, 0.98], figureHeight: 0.9, poses: { idle: 'idle.webp' } };

describe('набор поз', () => {
  it('принимает корректный пакет и отклоняет неполный', () => {
    expect(isPosePack(base)).toBe(true);
    expect(isPosePack({ ...base, figureHeight: 0 })).toBe(false);
    expect(isPosePack({ ...base, figureHeight: 1.2 })).toBe(false);
    expect(isPosePack({ ...base, poses: {} })).toBe(false);
    expect(isPosePack({ ...base, version: 2 })).toBe(false);
    expect(isPosePack(null)).toBe(false);
  });

  it('поза может быть серией картинок; скорость серий — в разумных пределах', () => {
    expect(isPosePack({ ...base, poses: { idle: ['a.webp', 'b.webp'], strike: ['s1.webp', 's2.webp', 's3.webp'] }, fps: 12 })).toBe(true);
    expect(isPosePack({ ...base, poses: { idle: [] } })).toBe(false);
    expect(isPosePack({ ...base, fps: 60 })).toBe(false);
    expect(isPosePack({ ...base, fps: 1 })).toBe(false);
  });

  it('отсутствующая поза заменяется по цепочке, в конце — стойка', () => {
    const have = (list: PoseName[]) => (n: PoseName) => list.includes(n);
    expect(resolvePose(have(['idle', 'windup', 'strike']), 'aim')).toBe('windup');
    expect(resolvePose(have(['idle', 'windup', 'strike']), 'shoot')).toBe('strike');
    expect(resolvePose(have(['idle', 'hit']), 'down')).toBe('hit');
    expect(resolvePose(have(['idle']), 'down')).toBe('idle');
    expect(resolvePose(have(['idle']), 'victory')).toBe('idle');
    expect(resolvePose(have(['idle', 'cast']), 'cast')).toBe('cast');
  });

  it('у каждой позы есть путь к стойке (нет циклов замен)', () => {
    for (const n of POSE_NAMES) expect(resolvePose((x) => x === 'idle', n)).toBe('idle');
    expect(REQUIRED_POSES).toContain('idle');
  });
});

describe('доработки поз (свечение, варианты, раненая стойка, эффекты)', () => {
  it('раненая стойка заменяется обычной, порог — 30% здоровья', () => {
    expect(resolvePose((n) => n === 'idle', 'wounded')).toBe('idle');
    expect(resolvePose((n) => n === 'idle' || n === 'wounded', 'wounded')).toBe('wounded');
    expect(WOUNDED_HP).toBe(0.3);
  });

  it('маски свечения и варианты не ломают проверку пакета; цвет и сила — в пределах', () => {
    expect(isPosePack({ ...base, glow: { strike: 'strike_glow.webp' }, glowColor: [1, 0.6, 0.2], glowStrength: 1.2, alternatives: { hit: ['hit_b.webp', ['hit_c1.webp', 'hit_c2.webp']] } })).toBe(true);
    expect(isPosePack({ ...base, glowColor: [1, 0.5] })).toBe(false);
    expect(isPosePack({ ...base, glowColor: [5, 0, 0] })).toBe(false);
    expect(isPosePack({ ...base, glowStrength: 9 })).toBe(false);
  });

  it('лист эффекта: страницы, число кадров и скорость', () => {
    const vfx = { version: 1, image: 'slash.webp', frameWidth: 256, frameHeight: 256, frames: 8, fps: 24 };
    expect(isVfxPack(vfx)).toBe(true);
    expect(isVfxPack({ ...vfx, image: undefined, pages: ['a.webp', 'b.webp'] })).toBe(true);
    expect(isVfxPack({ ...vfx, frames: 0 })).toBe(false);
    expect(isVfxPack({ ...vfx, fps: 120 })).toBe(false);
    expect(isVfxPack({ ...vfx, scale: 0 })).toBe(false);
    expect(isVfxPack({ ...vfx, image: undefined })).toBe(false);
  });
});
