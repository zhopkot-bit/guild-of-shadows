/** Общий контракт двух рендереров арены (WebGL и запасной Canvas 2D). */

export interface Tex {
  w: number;
  h: number;
  /** Нативный объект бэкенда (WebGLTexture или источник изображения). */
  handle: unknown;
  source: TexImageSource & CanvasImageSource;
}

export type Rgb = [number, number, number];

export interface SpriteDraw {
  tex: Tex;
  emissive: Tex | null;
  /** Точка опоры — ноги, в пикселях канваса. */
  x: number;
  y: number;
  w: number;
  h: number;
  flip: boolean;
  time: number;
  phase: number;
  breath: number;
  sway: number;
  bob: number;
  lean: number;
  sx: number;
  sy: number;
  rot: number;
  tint: Rgb;
  alpha: number;
  flash: number;
  flashColor: Rgb;
  dissolve: number;
  desat: number;
  emissiveStrength: number;
  emissiveColor: Rgb;
  rim: number;
  rimColor: Rgb;
  outline: number;
  outlineColor: Rgb;
  /** 0 — фигура, 1 — отражение на мокром полу, 2 — тень-силуэт. */
  mode: 0 | 1 | 2;
}

export interface QuadDraw {
  /** Центр квада. */
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  /** Цвет с альфой 0..1 (умножается на текстуру). */
  r: number;
  g: number;
  b: number;
  a: number;
  uv: [number, number, number, number];
  additive: boolean;
}

export interface BackgroundParams {
  time: number;
  offsetX: number;
  offsetY: number;
  zoom: number;
  tint: Rgb;
  contrast: number;
  saturation: number;
  brightness: number;
  fog: number;
  fogColor: Rgb;
  vignette: number;
}

export interface Backend {
  readonly kind: 'webgl' | 'canvas2d';
  resize(width: number, height: number): void;
  createTexture(source: TexImageSource & CanvasImageSource, w: number, h: number): Tex;
  begin(): void;
  drawBackground(tex: Tex, p: BackgroundParams): void;
  drawSprite(d: SpriteDraw): void;
  drawQuads(tex: Tex, quads: QuadDraw[]): void;
  /** Полноэкранная заливка (вспышки фазы, затемнение поражения). */
  overlay(r: number, g: number, b: number, a: number, additive: boolean): void;
  end(): void;
  destroy(): void;
}

/** Как фон вписывается в канвас (cover); нужен, чтобы ставить огни точно на свечи фона. */
export function coverTransform(canvasW: number, canvasH: number, texW: number, texH: number, zoom: number, offX: number, offY: number) {
  const scale = Math.max(canvasW / texW, canvasH / texH) * zoom;
  const drawW = texW * scale;
  const drawH = texH * scale;
  const x0 = (canvasW - drawW) / 2 - offX * drawW;
  const y0 = (canvasH - drawH) / 2 - offY * drawH;
  return { scale, x0, y0, drawW, drawH, toScreen: (u: number, v: number) => ({ x: x0 + u * drawW, y: y0 + v * drawH }) };
}
