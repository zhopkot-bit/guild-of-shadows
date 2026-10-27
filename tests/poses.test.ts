import { describe, expect, it } from 'vitest';
import { POSE_NAMES, REQUIRED_POSES, isPosePack, resolvePose, type PoseName } from '../src/content/artpack';

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
