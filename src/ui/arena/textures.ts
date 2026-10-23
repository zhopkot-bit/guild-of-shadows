/**
 * Процедурные текстуры эффектов. Рисуются один раз на старте в 2D-канвас:
 * никакой внешней графики для вспышек, колец и следов не требуется, а значит, нечему «не загрузиться».
 */

export type FxRegion = 'glow' | 'ring' | 'slash' | 'spark' | 'streak' | 'smoke' | 'beam' | 'shield' | 'arrow' | 'ellipse' | 'dash';

export interface Atlas {
  canvas: HTMLCanvasElement;
  regions: Record<FxRegion, [number, number, number, number]>;
}

const CELL = 128;

export function buildAtlas(): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * 4;
  canvas.height = CELL * 3;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const regions = {} as Atlas['regions'];
  let slot = 0;
  const cell = (name: FxRegion, draw: (c: CanvasRenderingContext2D, s: number) => void) => {
    const x = (slot % 4) * CELL;
    const y = Math.floor(slot / 4) * CELL;
    slot += 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, CELL, CELL);
    ctx.clip();
    ctx.translate(x, y);
    draw(ctx, CELL);
    ctx.restore();
    // Отступ в 1px от краёв ячейки, чтобы фильтрация не тянула соседей.
    regions[name] = [(x + 1) / canvas.width, (y + 1) / canvas.height, (x + CELL - 1) / canvas.width, (y + CELL - 1) / canvas.height];
  };

  cell('glow', (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });
  cell('ring', (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.72, 'rgba(255,255,255,0.0)');
    g.addColorStop(0.86, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });
  cell('slash', (c, s) => {
    // Серп удара: толстая дуга, сходящая на нет к концам.
    for (let i = 0; i < 40; i++) {
      const t = i / 39;
      const a0 = Math.PI * (1.05 + 0.9 * t);
      const w = Math.sin(t * Math.PI) * 12 + 1;
      c.strokeStyle = `rgba(255,255,255,${0.12 + 0.88 * Math.sin(t * Math.PI)})`;
      c.lineWidth = w;
      c.beginPath();
      c.arc(s / 2, s * 0.78, s * 0.42, a0, a0 + 0.06);
      c.stroke();
    }
  });
  cell('spark', (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.15, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.15)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.fillRect(s * 0.1, s / 2 - 1.5, s * 0.8, 3);
    c.fillRect(s / 2 - 1.5, s * 0.1, 3, s * 0.8);
  });
  cell('streak', (c, s) => {
    const g = c.createLinearGradient(0, 0, s, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.85, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    const v = c.createLinearGradient(0, s / 2 - 10, 0, s / 2 + 10);
    c.fillRect(0, s / 2 - 6, s, 12);
    c.globalCompositeOperation = 'destination-in';
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.5, 'rgba(0,0,0,1)');
    v.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = v;
    c.fillRect(0, 0, s, s);
  });
  cell('smoke', (c, s) => {
    for (let i = 0; i < 14; i++) {
      const x = s / 2 + Math.cos(i * 2.4) * s * 0.16;
      const y = s / 2 + Math.sin(i * 1.7) * s * 0.12;
      const r = s * (0.18 + 0.1 * ((i * 37) % 5) / 5);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
    }
  });
  cell('beam', (c, s) => {
    const g = c.createLinearGradient(0, 0, s, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    c.globalCompositeOperation = 'destination-in';
    const v = c.createLinearGradient(0, 0, 0, s);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.3, 'rgba(0,0,0,1)');
    v.addColorStop(1, 'rgba(0,0,0,1)');
    c.fillStyle = v;
    c.fillRect(0, 0, s, s);
  });
  cell('shield', (c, s) => {
    // Защитная сфера: простая геометрия без символов.
    const g = c.createRadialGradient(s / 2, s / 2, s * 0.2, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.18)');
    g.addColorStop(0.92, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      const px = s / 2 + Math.cos(a) * s * 0.49;
      const py = s / 2 + Math.sin(a) * s * 0.49;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
    c.fill();
  });
  cell('arrow', (c, s) => {
    c.strokeStyle = 'rgba(255,255,255,1)';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(s * 0.08, s / 2);
    c.lineTo(s * 0.86, s / 2);
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,1)';
    c.beginPath();
    c.moveTo(s * 0.96, s / 2);
    c.lineTo(s * 0.8, s / 2 - 7);
    c.lineTo(s * 0.8, s / 2 + 7);
    c.closePath();
    c.fill();
    c.fillRect(s * 0.06, s / 2 - 6, s * 0.1, 3);
    c.fillRect(s * 0.06, s / 2 + 3, s * 0.1, 3);
  });
  cell('ellipse', (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.62, 'rgba(255,255,255,0.18)');
    g.addColorStop(0.8, 'rgba(255,255,255,1)');
    g.addColorStop(0.9, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });
  cell('dash', (c, s) => {
    // Кольцо из штрихов для зоны поражения (вращается шейдерно через rot квада).
    c.strokeStyle = 'rgba(255,255,255,1)';
    c.lineWidth = 5;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      c.beginPath();
      c.arc(s / 2, s / 2, s * 0.44, a, a + 0.22);
      c.stroke();
    }
  });
  return { canvas, regions };
}

/** Тайлящийся value-noise (для тумана и растворения). */
export function buildNoise(size = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  const octaves = [8, 16, 32, 64];
  const grids = octaves.map((n) => {
    const g = new Float32Array(n * n);
    let seed = n * 7919;
    for (let i = 0; i < g.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      g[i] = seed / 0x7fffffff;
    }
    return { n, g };
  });
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 0.5;
      let total = 0;
      for (const { n, g } of grids) {
        const fx = (x / size) * n;
        const fy = (y / size) * n;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const at = (i: number, j: number) => g[((j % n) * n + (i % n)) % (n * n)] as number;
        const a = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
        const b = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
        v += (a * (1 - ty) + b * ty) * amp;
        total += amp;
        amp *= 0.5;
      }
      const c = Math.round((v / total) * 255);
      const i = (y * size + x) * 4;
      img.data[i] = c;
      img.data[i + 1] = c;
      img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
