import { describe, expect, it } from 'vitest';
import { resolveSave } from '../src/platform/save-resolution';
import { newGame } from '../src/core/state';

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);

function save(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...newGame(T0), ...overrides });
}

describe('разрешение конфликта локального и облачного сохранения', () => {
  it('возвращает единственную доступную копию', () => {
    const local = save();
    expect(resolveSave(local, null)).toBe(local);
    expect(resolveSave(null, local)).toBe(local);
    expect(resolveSave(null, null)).toBeNull();
  });

  it('игнорирует повреждённую облачную копию при наличии валидной локальной', () => {
    const local = save();
    expect(resolveSave(local, '{broken')).toBe(local);
  });

  it('предпочитает новую схему, чтобы старый клиент не затёр неизвестные поля', () => {
    const local = save({ version: 1, lastSeen: T0 + 10_000, expeditionsCompleted: 9 });
    const cloud = save({ version: 2, lastSeen: T0, expeditionsCompleted: 1 });
    expect(resolveSave(local, cloud)).toBe(cloud);
  });

  it('предпочитает более свежее сохранение, если версии одинаковы', () => {
    const local = save({ version: 1, lastSeen: T0 + 10_000, expeditionsCompleted: 2 });
    const cloud = save({ version: 1, lastSeen: T0, expeditionsCompleted: 8 });
    expect(resolveSave(local, cloud)).toBe(local);
  });

  it('при одинаковой метке времени выбирает копию с большим игровым прогрессом', () => {
    const local = save({ version: 1, lastSeen: T0, expeditionsCompleted: 2 });
    const cloud = save({ version: 1, lastSeen: T0, expeditionsCompleted: 5 });
    expect(resolveSave(local, cloud)).toBe(cloud);
  });

  it('при полностью равных кандидатах предпочитает локальную копию', () => {
    const local = save();
    const cloud = save();
    expect(resolveSave(local, cloud)).toBe(local);
  });
});
