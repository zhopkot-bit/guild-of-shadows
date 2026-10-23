import { describe, expect, it } from 'vitest';
import { LAYERS, generateMap } from '../src/expedition/map';

describe('карта забега', () => {
  it('детерминирована по сиду', () => {
    expect(generateMap(123)).toEqual(generateMap(123));
    expect(generateMap(123)).not.toEqual(generateMap(124));
  });

  it('гарантии структуры выполняются на 500 сидах', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const map = generateMap(seed);
      const byId = new Map(map.map((n) => [n.id, n]));
      const layers = new Map<number, typeof map>();
      for (const n of map) layers.set(n.layer, [...(layers.get(n.layer) ?? []), n]);

      expect(layers.size).toBe(LAYERS + 1);
      for (let l = 1; l <= LAYERS; l++) {
        const count = layers.get(l)!.length;
        expect(count).toBeGreaterThanOrEqual(2);
        expect(count).toBeLessThanOrEqual(3);
      }
      const boss = layers.get(LAYERS + 1)!;
      expect(boss).toHaveLength(1);
      expect(boss[0]!.type).toBe('boss');

      // правила типов
      for (const n of layers.get(1)!) expect(['battle', 'event']).toContain(n.type);
      for (const n of map) {
        if (n.layer < 3) expect(n.type).not.toBe('elite');
        if (n.layer < LAYERS + 1) expect(n.type).not.toBe('boss');
      }
      expect(layers.get(LAYERS)!.some((n) => n.type === 'camp')).toBe(true);

      // слои 2 и 4 боевые: путь без боёв невозможен
      for (const n of layers.get(2)!) expect(n.type).toBe('battle');
      for (const n of layers.get(4)!) expect(['battle', 'elite']).toContain(n.type);

      // нет тупиков, рёбра идут строго на следующий слой
      for (const n of map) {
        if (n.type === 'boss') {
          expect(n.next).toHaveLength(0);
          continue;
        }
        expect(n.next.length).toBeGreaterThanOrEqual(1);
        expect(n.next.length).toBeLessThanOrEqual(2);
        for (const id of n.next) expect(byId.get(id)!.layer).toBe(n.layer + 1);
      }

      // все узлы достижимы из слоя 1
      const seen = new Set<string>(layers.get(1)!.map((n) => n.id));
      const stack = [...seen];
      while (stack.length) {
        for (const id of byId.get(stack.pop()!)!.next) {
          if (!seen.has(id)) {
            seen.add(id);
            stack.push(id);
          }
        }
      }
      expect(seen.size).toBe(map.length);
    }
  });
});
