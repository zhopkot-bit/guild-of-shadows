import { coverTransform, type AffinePart, type Backend, type BackgroundParams, type QuadDraw, type RenderTarget, type SpriteDraw, type Tex } from './backend';

/**
 * Запасной рендерер для устройств без WebGL. Сцена, анимации и эффекты те же; вместо деформации
 * сетки — аффинные преобразования (наклон, сжатие, поворот), вспышки — режим «lighter».
 */
export class Canvas2DBackend implements Backend {
  readonly kind = 'canvas2d' as const;
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private scratch = document.createElement('canvas');

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D недоступен');
    this.ctx = ctx;
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  createTexture(source: TexImageSource & CanvasImageSource, w: number, h: number): Tex {
    return { w, h, handle: source, source };
  }

  begin(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = '#080a0d';
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  drawBackground(tex: Tex, p: BackgroundParams): void {
    const c = this.ctx;
    const t = coverTransform(this.w, this.h, tex.w, tex.h, p.zoom, p.offsetX, p.offsetY);
    c.filter = `contrast(${p.contrast}) saturate(${p.saturation}) brightness(${p.brightness * (p.tint[0] + p.tint[1] + p.tint[2]) / 3})`;
    c.drawImage(tex.source, t.x0, t.y0, t.drawW, t.drawH);
    c.filter = 'none';
    const fog = c.createLinearGradient(0, this.h * 0.45, 0, this.h);
    const [fr, fg, fb] = p.fogColor.map((v) => Math.round(v * 255)) as [number, number, number];
    fog.addColorStop(0, `rgba(${fr},${fg},${fb},0)`);
    fog.addColorStop(1, `rgba(${fr},${fg},${fb},${Math.min(0.6, p.fog * 0.6)})`);
    c.fillStyle = fog;
    c.fillRect(0, 0, this.w, this.h);
    const v = c.createRadialGradient(this.w / 2, this.h * 0.55, this.h * 0.3, this.w / 2, this.h * 0.55, Math.max(this.w, this.h) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${Math.min(0.85, p.vignette * 0.7)})`);
    c.fillStyle = v;
    c.fillRect(0, 0, this.w, this.h);
  }

  drawSprite(d: SpriteDraw): void {
    const c = this.ctx;
    const breath = 1 + d.breath * Math.sin((d.time + d.phase) * 1.9);
    c.save();
    c.translate(d.x, d.y);
    c.rotate(d.rot);
    if (d.mode === 1) {
      c.scale(d.flip ? -d.sx : d.sx, -d.sy * 0.85 * breath);
      c.globalAlpha = Math.max(0, d.alpha * 0.18);
    } else if (d.mode === 2) {
      c.transform(1, 0, -0.42, -0.13, 0, 0);
      c.scale(d.flip ? -d.sx : d.sx, d.sy);
      c.globalAlpha = Math.max(0, d.alpha * 0.45);
      c.filter = 'brightness(0)';
    } else {
      c.transform(1, 0, -d.lean, 1, 0, 0);
      c.scale(d.flip ? -d.sx : d.sx, d.sy * breath);
      c.globalAlpha = Math.max(0, d.alpha * (1 - d.dissolve));
      if (d.desat > 0) c.filter = `grayscale(${d.desat})`;
      if (d.outline > 0.02) {
        // Обводка цели — свечение по контуру силуэта, а не заливка фигуры.
        c.shadowColor = `rgba(${d.outlineColor.map((v) => Math.round(Math.min(1, v) * 255)).join(',')},${Math.min(1, d.outline)})`;
        c.shadowBlur = 14;
      }
    }
    const [u0, v0, u1, v1] = d.uv;
    c.drawImage(d.tex.source, u0 * d.tex.w, v0 * d.tex.h, (u1 - u0) * d.tex.w, (v1 - v0) * d.tex.h, -d.w / 2, -d.h, d.w, d.h);
    c.shadowBlur = 0;
    c.shadowColor = 'transparent';
    c.filter = 'none';
    if (d.mode === 0 && (d.flash > 0.02 || d.emissiveStrength > 0.02)) {
      // Вспышка/свечение: цветной силуэт через scratch-канвас, добавленный режимом lighter.
      const s = this.scratch;
      s.width = Math.max(1, Math.round(d.w));
      s.height = Math.max(1, Math.round(d.h));
      const sc = s.getContext('2d') as CanvasRenderingContext2D;
      sc.clearRect(0, 0, s.width, s.height);
      const src = d.emissive && d.emissiveStrength > 0.02 && d.flash < 0.02 ? d.emissive : d.tex;
      sc.drawImage(src.source, d.uv[0] * src.w, d.uv[1] * src.h, (d.uv[2] - d.uv[0]) * src.w, (d.uv[3] - d.uv[1]) * src.h, 0, 0, s.width, s.height);
      sc.globalCompositeOperation = 'source-in';
      const col = d.flash > 0.02 ? d.flashColor : d.emissiveColor;
      sc.fillStyle = `rgb(${col.map((v) => Math.round(Math.min(1, v) * 255)).join(',')})`;
      sc.fillRect(0, 0, s.width, s.height);
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = Math.min(1, Math.max(d.flash, d.emissiveStrength * 0.6));
      c.drawImage(s, -d.w / 2, -d.h, d.w, d.h);
    }
    c.restore();
  }

  drawQuads(tex: Tex, quads: QuadDraw[]): void {
    const c = this.ctx;
    const sw = tex.w;
    const sh = tex.h;
    for (const q of quads) {
      c.save();
      c.globalCompositeOperation = q.additive ? 'lighter' : 'source-over';
      c.globalAlpha = Math.max(0, Math.min(1, q.a));
      c.translate(q.x, q.y);
      c.rotate(q.rot);
      const [u0, v0, u1, v1] = q.uv;
      c.drawImage(tex.source, u0 * sw, v0 * sh, (u1 - u0) * sw, (v1 - v0) * sh, -q.w / 2, -q.h / 2, q.w, q.h);
      c.restore();
    }
  }

  createTarget(w: number, h: number): RenderTarget {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return { tex: { w, h, handle: c, source: c }, w, h };
  }

  drawRig(target: RenderTarget, atlas: Tex, parts: AffinePart[]): void {
    const c = (target.tex.source as HTMLCanvasElement).getContext('2d');
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, target.w, target.h);
    for (const p of parts) {
      c.setTransform(p.m[0], p.m[1], p.m[2], p.m[3], p.m[4], p.m[5]);
      c.globalAlpha = p.alpha;
      const [u0, v0, u1, v1] = p.uv;
      c.drawImage(atlas.source, u0 * atlas.w, v0 * atlas.h, (u1 - u0) * atlas.w, (v1 - v0) * atlas.h, p.x0, p.y0, p.w, p.h);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
  }

  disposeTarget(): void {}

  overlay(r: number, g: number, b: number, a: number, additive: boolean): void {
    if (a <= 0) return;
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = additive ? 'lighter' : 'source-over';
    c.fillStyle = `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
    c.fillRect(0, 0, this.w, this.h);
    c.restore();
  }

  end(): void {}

  destroy(): void {}
}
