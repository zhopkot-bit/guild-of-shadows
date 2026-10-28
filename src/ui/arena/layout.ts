/**
 * Композиция арены. Ориентир — концепт-арты: отряд на переднем плане слева, отдельная линия
 * противников справа, босс доминирует и занимает значительную часть кадра.
 * Координаты — доли размеров канваса; высота — доля высоты канваса.
 */

export interface Slot {
  x: number;
  y: number;
  /** Высота фигуры в долях высоты арены. */
  h: number;
  /** Порядок отрисовки: больше — ближе к камере. */
  z: number;
}

export interface LayoutInput {
  width: number;
  height: number;
  heroes: number;
  enemies: Array<{ boss: boolean; wide: boolean }>;
}

export interface ArenaLayout {
  heroes: Slot[];
  enemies: Slot[];
  /** Портретная (мобильная) композиция: враги сверху, отряд снизу. */
  portrait: boolean;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function computeLayout(inp: LayoutInput): ArenaLayout {
  const aspect = inp.width / Math.max(1, inp.height);
  const portrait = aspect < 1.05;
  const hasBoss = inp.enemies.some((e) => e.boss);
  const heroes: Slot[] = [];
  const enemies: Slot[] = [];

  // Невысокая арена (ноутбуки 1366×768, планшеты): фигуры ниже, чтобы верхний HUD их не закрывал.
  const short = inp.height < 620 ? Math.max(0.82, inp.height / 620) : 1;

  if (portrait) {
    // Мобильный кадр: отряд — нижняя полоса, противники — средний план, босс по центру выше.
    const n = inp.heroes;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      heroes.push({ x: lerp(0.2, 0.8, t), y: 0.97 - (i % 2) * 0.03, h: 0.36, z: 10 + (i % 2 === 0 ? 2 : 1) });
    }
    const m = inp.enemies.length;
    inp.enemies.forEach((e, i) => {
      if (e.boss) {
        enemies.push({ x: 0.52, y: 0.78, h: 0.56, z: 3 });
        return;
      }
      const t = m === 1 ? 0.5 : i / (m - 1);
      enemies.push({ x: lerp(0.22, 0.78, t), y: 0.6 - (i % 2) * 0.03, h: e.wide ? 0.21 : 0.27, z: 4 + i });
    });
    return { heroes, enemies, portrait };
  }

  // Ширина кадра определяет, насколько широко разнесены линии.
  const wide = Math.min(1, Math.max(0, (aspect - 1.05) / (1.8 - 1.05)));
  const n = inp.heroes;
  // Отряд: передний план, слева; ступенчатая глубина, чтобы силуэты не сливались.
  const heroX = hasBoss ? [0.11, 0.25, 0.39] : [0.1, 0.23, 0.36];
  // Узкая арена (телефон горизонтально, справа колонка управления): отряд расставлен шире, иначе плашки над головами слипаются.
  const heroXNarrow = [0.08, 0.245, 0.41];
  const heroY = [0.95, 0.9, 0.97];
  for (let i = 0; i < n; i++) {
    const x = lerp(heroXNarrow[i] ?? 0.12 + i * 0.13, heroX[i] ?? 0.12 + i * 0.13, wide);
    heroes.push({ x, y: heroY[i] ?? 0.95, h: lerp(0.5, 0.55, wide) * (i === 1 ? 0.95 : 1) * short, z: 10 + (i === 1 ? 0 : 2) });
  }
  const m = inp.enemies.length;
  inp.enemies.forEach((e, i) => {
    if (e.boss) {
      enemies.push({ x: lerp(0.72, 0.7, wide), y: 0.985, h: lerp(0.84, 0.92, wide) * (short < 1 ? 0.92 : 1), z: 5 });
      return;
    }
    const xs = m === 1 ? [0.72] : m === 2 ? [0.64, 0.82] : [0.6, 0.74, 0.88];
    const ys = m === 1 ? [0.82] : m === 2 ? [0.8, 0.86] : [0.79, 0.86, 0.8];
    enemies.push({ x: xs[i] ?? 0.75, y: ys[i] ?? 0.82, h: (e.wide ? 0.34 : 0.44) * lerp(0.92, 1, wide) * short, z: 4 + (ys[i] ?? 0) * 2 });
  });
  return { heroes, enemies, portrait };
}
