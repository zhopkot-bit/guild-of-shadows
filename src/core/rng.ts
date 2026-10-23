/**
 * Детерминированный генератор (mulberry32). Один сид — одна и та же последовательность.
 * Нужен для карты, боёв и событий: так их можно воспроизвести в тесте или по жалобе игрока.
 */
export class RNG {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Снимок внутреннего состояния для точного продолжения сохранённой экспедиции. */
  snapshot(): number {
    return this.s >>> 0;
  }

  static restore(state: number): RNG {
    const rng = new RNG(0);
    rng.s = state >>> 0;
    return rng;
  }

  /** Число в диапазоне [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Целое в диапазоне [min, max] включительно. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** true с вероятностью p (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('RNG.pick: пустой массив');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Выбор с весами. Веса не обязаны давать в сумме 1. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    if (items.length === 0) throw new Error('RNG.weighted: пустой массив');
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return items[0] as T;
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r < 0) return it;
    }
    return items[items.length - 1] as T;
  }

  /** Перемешивание (Фишер — Йейтс), исходный массив не меняется. */
  shuffle<T>(items: readonly T[]): T[] {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = a[i] as T;
      a[i] = a[j] as T;
      a[j] = tmp;
    }
    return a;
  }
}

/** Строка → 32-битный сид (FNV-1a). */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
