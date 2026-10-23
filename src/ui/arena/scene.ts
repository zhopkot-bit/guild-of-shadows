import type { Backend, QuadDraw, Rgb, Tex } from './backend';
import { coverTransform } from './backend';
import { Canvas2DBackend } from './canvas2d';
import { computeLayout, type Slot } from './layout';
import { buildAtlas, buildNoise, type Atlas, type FxRegion } from './textures';
import { WebGLBackend } from './webgl';

/**
 * Живая боевая сцена. Каждый боец — отдельный слой со своим состоянием и анимациями;
 * окружение, свет, туман, эффекты и интерфейс — отдельные слои. Сцена ничего не знает о правилах боя:
 * контроллер (battleView.ts) вызывает анимации и в точке удара применяет действие к модели.
 */

export type AttackStyle = 'melee' | 'bow' | 'crossbow' | 'staff' | 'pounce' | 'spell';

export interface ActorSpec {
  id: string;
  side: 'hero' | 'enemy';
  sprite: string;
  emissive?: string;
  flip: boolean;
  style: AttackStyle;
  boss: boolean;
  /** Широкий силуэт (волк) — ниже ростом. */
  wide: boolean;
  /** Индивидуальная пластика простоя. */
  idle: { breath: number; sway: number; bob: number; hover: number; speed: number };
  /** Номер экземпляра среди одинаковых врагов: лёгкие различия роста, тона и ритма, чтобы не было «клонов». */
  variant?: number;
  /** Уже выбыл (восстановление боя из сохранения). */
  dead?: boolean;
  phase2?: boolean;
}

export interface ArenaSetup {
  background: string;
  /** Свечи и факелы на фоне (доли текстуры фона). */
  lights: Array<{ u: number; v: number; size: number; warm: boolean }>;
  wetFloor: boolean;
  mood: 'crypt' | 'boss';
}

export interface ActorScreen {
  id: string;
  /** Координаты в CSS-пикселях относительно контейнера арены. */
  x: number;
  y: number;
  top: number;
  w: number;
  h: number;
  alive: boolean;
}

interface Params {
  offX: number;
  offY: number;
  lean: number;
  sx: number;
  sy: number;
  rot: number;
  flash: number;
  alpha: number;
  dissolve: number;
  desat: number;
  emissive: number;
}

export interface ActorStatus {
  active: boolean;
  targetable: 'foe' | 'ally' | null;
  hovered: boolean;
  cover: boolean;
  /** Цель подготовленного удара: одиночного или по площади. */
  threatened: 'single' | 'aoe' | null;
  /** Готовит удар (красный — одиночный, синий — волна, оранжевый — пепельный заряд). */
  charging: Rgb | null;
}

class Actor {
  tex: Tex | null = null;
  emi: Tex | null = null;
  slot: Slot = { x: 0.5, y: 0.9, h: 0.4, z: 1 };
  x = 0;
  y = 0;
  w = 1;
  h = 1;
  phase = Math.random() * 10;
  p: Params = { offX: 0, offY: 0, lean: 0, sx: 1, sy: 1, rot: 0, flash: 0, alpha: 1, dissolve: 0, desat: 0, emissive: 0 };
  flashColor: Rgb = [1, 1, 1];
  dead = false;
  fallen = false;
  phase2 = false;
  status: ActorStatus = { active: false, targetable: null, hovered: false, cover: false, threatened: null, charging: null };
  constructor(public spec: ActorSpec) {
    this.dead = !!spec.dead;
    this.phase2 = !!spec.phase2;
    if (this.dead && spec.side === 'enemy') this.p.dissolve = 1;
    if (this.dead && spec.side === 'hero') this.setFallenPose();
    if (this.phase2) this.p.emissive = 1;
  }
  setFallenPose(): void {
    this.fallen = true;
    this.p.sy = 0.82;
    this.p.lean = -0.05;
    this.p.desat = 0.85;
    this.p.alpha = 0.5;
  }
  /** Центр корпуса (для попаданий и эффектов). */
  chest(): { x: number; y: number } {
    return { x: this.x + this.p.offX, y: this.y + this.p.offY - this.h * (this.spec.wide ? 0.42 : 0.58) * this.p.sy };
  }
  dir(): number {
    return this.spec.side === 'hero' ? 1 : -1;
  }
}

interface Tween {
  start: number;
  dur: number;
  fn: (t: number) => void;
  ease: (t: number) => number;
  resolve: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  rot: number;
  vr: number;
  gravity: number;
  drag: number;
  color: Rgb;
  alpha: number;
  region: FxRegion;
  additive: boolean;
  stretch?: number;
  /** Осколок брони босса: рисуется текстурой босса. */
  shard?: { tex: Tex; uv: [number, number, number, number] };
}

interface Fx {
  t: number;
  max: number;
  draw: (k: number, out: QuadDraw[], atlas: Atlas) => void;
  front?: boolean;
}

interface Projectile {
  from: { x: number; y: number };
  to: { x: number; y: number };
  t: number;
  dur: number;
  arc: number;
  region: FxRegion;
  color: Rgb;
  size: number;
  trail: Rgb;
  resolve: () => void;
}

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number) => t * t * t,
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

const WARM: Rgb = [1.0, 0.62, 0.28];
const COLD: Rgb = [0.45, 0.68, 1.0];
export const DANGER: Rgb = [1.0, 0.24, 0.16];
export const SPECTRAL: Rgb = [0.35, 0.7, 1.0];
export const ASH: Rgb = [1.0, 0.5, 0.15];
const HEAL: Rgb = [0.75, 1.0, 0.7];
const GOLD: Rgb = [1.0, 0.82, 0.45];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Не загрузилось изображение: ${src}`));
    img.src = src;
  });
}

/** Заглушка на случай сбоя загрузки: тёмный силуэт, а не «битая картинка». */
function placeholderSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 360;
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  x.fillStyle = 'rgba(30,34,44,0.95)';
  x.beginPath();
  x.ellipse(80, 60, 34, 40, 0, 0, Math.PI * 2);
  x.fill();
  x.beginPath();
  x.moveTo(30, 350);
  x.lineTo(42, 120);
  x.lineTo(118, 120);
  x.lineTo(130, 350);
  x.closePath();
  x.fill();
  return c;
}

export class ArenaScene {
  canvas: HTMLCanvasElement;
  readonly backend: Backend;
  readonly ready: Promise<void>;
  /** Сбои загрузки ассетов (для QA и журнала). */
  readonly errors: string[] = [];
  speed = 1;
  fast = false;
  paused = false;

  private actors = new Map<string, Actor>();
  private order: Actor[] = [];
  private atlas: Atlas;
  private atlasTex: Tex;
  private bgTex: Tex | null = null;
  private tweens: Tween[] = [];
  private particles: Particle[] = [];
  private fx: Fx[] = [];
  private projectiles: Projectile[] = [];
  private time = 0;
  private last = 0;
  private raf = 0;
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  private shakeAmp = 0;
  private overlayFlash = { a: 0, color: [1, 1, 1] as Rgb };
  private grade = { tint: [1, 1, 1] as Rgb, contrast: 1.08, saturation: 0.95, brightness: 1.0, fog: 0.32, fogColor: [0.32, 0.38, 0.48] as Rgb, vignette: 0.85 };
  private gradeTarget = { ...this.grade };
  private darken = 0;
  private emberClock = 0;
  private shards: Array<{ a: number; r: number; y: number; s: number; uv: [number, number, number, number]; spin: number }> = [];
  /** Атлас осколков брони: рваные многоугольники с призрачной кромкой (не прямоугольные вырезки). */
  private shardTex: Tex | null = null;
  private shardCells: Array<[number, number, number, number]> = [];
  private resizeObs: ResizeObserver | null = null;
  private frameListeners: Array<(list: ActorScreen[]) => void> = [];
  private destroyed = false;

  constructor(private container: HTMLElement, private setup: ArenaSetup, specs: ActorSpec[]) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'arena__canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    container.prepend(this.canvas);
    this.atlas = buildAtlas();
    const noise = buildNoise();
    let backend: Backend;
    try {
      backend = new WebGLBackend(this.canvas, noise);
    } catch (e) {
      // Без WebGL сцена остаётся анимированной, но проще: см. Canvas2DBackend.
      console.warn('Арена: WebGL недоступен, используется Canvas 2D', e);
      // Канвас, на котором уже пытались создать WebGL-контекст, не отдаст 2D-контекст: нужен новый.
      const fresh = document.createElement('canvas');
      fresh.className = this.canvas.className;
      fresh.setAttribute('aria-hidden', 'true');
      this.canvas.replaceWith(fresh);
      this.canvas = fresh;
      backend = new Canvas2DBackend(this.canvas);
    }
    this.backend = backend;
    this.atlasTex = backend.createTexture(this.atlas.canvas, this.atlas.canvas.width, this.atlas.canvas.height);
    if (setup.mood === 'boss') {
      this.grade = { ...this.grade, tint: [0.92, 0.96, 1.08], fog: 0.4, fogColor: [0.28, 0.34, 0.46] };
      this.gradeTarget = { ...this.grade };
    }
    for (const s of specs) {
      const a = new Actor(s);
      this.actors.set(s.id, a);
    }
    this.ready = this.load();
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(container);
    }
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private async load(): Promise<void> {
    const want = new Map<string, Promise<HTMLImageElement | HTMLCanvasElement>>();
    const get = (src: string) => {
      if (!src) return Promise.resolve(placeholderSprite());
      if (!want.has(src)) {
        want.set(src, loadImage(src).catch((e: Error) => {
          this.errors.push(e.message);
          console.error(e.message);
          return placeholderSprite();
        }));
      }
      return want.get(src) as Promise<HTMLImageElement | HTMLCanvasElement>;
    };
    const bg = get(this.setup.background);
    const jobs = [...this.actors.values()].map(async (a) => {
      const img = await get(a.spec.sprite);
      a.tex = this.texFrom(img);
      if (a.spec.emissive) a.emi = this.texFrom(await get(a.spec.emissive));
    });
    this.bgTex = this.texFrom(await bg);
    await Promise.all(jobs);
    this.layout();
    const boss = [...this.actors.values()].find((a) => a.spec.boss && a.phase2);
    if (boss) this.enterPhase2Visuals(boss, true);
  }

  private texFrom(img: HTMLImageElement | HTMLCanvasElement): Tex {
    const w = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
    const h = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
    return this.backend.createTexture(img, w, h);
  }

  get backendKind(): 'webgl' | 'canvas2d' {
    return this.backend.kind;
  }

  onFrame(fn: (list: ActorScreen[]) => void): void {
    this.frameListeners.push(fn);
  }

  resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.backend.resize(Math.round(this.cssW * this.dpr), Math.round(this.cssH * this.dpr));
    this.layout();
  }

  private layout(): void {
    const heroes = [...this.actors.values()].filter((a) => a.spec.side === 'hero');
    const foes = [...this.actors.values()].filter((a) => a.spec.side === 'enemy');
    const L = computeLayout({ width: this.cssW, height: this.cssH, heroes: heroes.length, enemies: foes.map((f) => ({ boss: f.spec.boss, wide: f.spec.wide })) });
    const W = this.cssW * this.dpr;
    const H = this.cssH * this.dpr;
    const place = (a: Actor, s: Slot | undefined) => {
      if (!s) return;
      a.slot = s;
      a.x = s.x * W;
      a.y = s.y * H;
      const v = a.spec.variant ?? 0;
      a.h = s.h * H * (v === 1 ? 0.93 : v === 2 ? 0.97 : 1);
      a.w = a.tex ? (a.h * a.tex.w) / a.tex.h : a.h * 0.45;
    };
    heroes.forEach((a, i) => place(a, L.heroes[i]));
    foes.forEach((a, i) => place(a, L.enemies[i]));
    this.order = [...this.actors.values()].sort((a, b) => a.slot.z - b.slot.z || a.y - b.y);
    this.container.classList.toggle('arena--portrait', L.portrait);
  }

  // ---------- Время и твины ----------

  private frame = (now: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dtReal = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.paused) return;
    const dt = dtReal * this.speed;
    this.time += dtReal;
    this.update(dt, dtReal);
    this.render();
  };

  /** Твин: при fast-режиме мгновенно завершается (досчёт боя). */
  tween(ms: number, fn: (t: number) => void, e: (t: number) => number = ease.outCubic): Promise<void> {
    if (this.fast || ms <= 0) {
      fn(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.tweens.push({ start: this.time * 1000, dur: ms / this.speed, fn, ease: e, resolve });
    });
  }

  wait(ms: number): Promise<void> {
    return this.tween(ms, () => undefined, ease.linear);
  }

  private update(dt: number, dtReal: number): void {
    const nowMs = this.time * 1000;
    const done: Tween[] = [];
    for (const tw of this.tweens) {
      const k = Math.min(1, (nowMs - tw.start) / tw.dur);
      tw.fn(tw.ease(Math.max(0, k)));
      if (k >= 1) done.push(tw);
    }
    if (done.length) {
      this.tweens = this.tweens.filter((t) => !done.includes(t));
      for (const t of done) t.resolve();
    }
    // Плавный переход цветокоррекции (смена фазы).
    const g = this.grade;
    const gt = this.gradeTarget;
    const k = Math.min(1, dtReal * 1.6);
    g.tint = g.tint.map((v, i) => v + ((gt.tint[i] as number) - v) * k) as Rgb;
    g.fogColor = g.fogColor.map((v, i) => v + ((gt.fogColor[i] as number) - v) * k) as Rgb;
    g.fog += (gt.fog - g.fog) * k;
    g.brightness += (gt.brightness - g.brightness) * k;
    g.saturation += (gt.saturation - g.saturation) * k;
    for (const a of this.actors.values()) a.p.flash = Math.max(0, a.p.flash - dtReal * 3.2);
    this.shakeAmp = Math.max(0, this.shakeAmp - dtReal * 26 * this.dpr);
    this.overlayFlash.a = Math.max(0, this.overlayFlash.a - dtReal * 2.4);

    // Проджектайлы.
    for (const pr of this.projectiles) {
      pr.t += dt;
      const k2 = Math.min(1, pr.t / pr.dur);
      const pos = this.projPos(pr, k2);
      if (Math.random() < 0.9) this.spawn({ x: pos.x, y: pos.y, vx: 0, vy: -10 * this.dpr, life: 0.35, size: pr.size * 0.6, grow: -0.6, color: pr.trail, alpha: 0.55, region: 'glow', additive: true });
      if (k2 >= 1) pr.resolve();
    }
    this.projectiles = this.projectiles.filter((p) => p.t < p.dur);

    // Частицы.
    for (const p of this.particles) {
      p.life += dt;
      p.vy += p.gravity * dt;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.size = Math.max(0, p.size + p.grow * dt * this.dpr * 10);
    }
    this.particles = this.particles.filter((p) => p.life < p.max && p.size > 0.2);
    for (const f of this.fx) f.t += dt;
    this.fx = this.fx.filter((f) => f.t < f.max);

    this.ambient(dt);
  }

  private ambient(dt: number): void {
    if (!this.bgTex) return;
    const W = this.cssW * this.dpr;
    const H = this.cssH * this.dpr;
    this.emberClock += dt;
    // Пылинки в луче света и искры от свечей.
    while (this.emberClock > 0.07) {
      this.emberClock -= 0.07;
      if (this.particles.length > 520) break;
      const light = this.setup.lights[Math.floor(Math.random() * this.setup.lights.length)];
      if (light && Math.random() < 0.55) {
        const p = this.lightPos(light.u, light.v);
        this.spawn({ x: p.x + (Math.random() - 0.5) * 8 * this.dpr, y: p.y, vx: (Math.random() - 0.5) * 14 * this.dpr, vy: -(18 + Math.random() * 40) * this.dpr, life: 1.6 + Math.random() * 2, size: (1.6 + Math.random() * 2.2) * this.dpr, grow: -0.05, color: light.warm ? WARM : COLD, alpha: 0.85, region: 'spark', additive: true, drag: 0.995 });
      } else {
        this.spawn({ x: Math.random() * W, y: H * (0.3 + Math.random() * 0.6), vx: (Math.random() - 0.3) * 8 * this.dpr, vy: -(2 + Math.random() * 6) * this.dpr, life: 4 + Math.random() * 3, size: (1.2 + Math.random() * 1.6) * this.dpr, grow: 0, color: [0.8, 0.82, 0.9], alpha: 0.35, region: 'glow', additive: true });
      }
    }
    // Фаза II: призрачное пламя над костяным королём.
    for (const a of this.actors.values()) {
      if (!a.spec.boss || !a.phase2 || a.dead) continue;
      if (Math.random() < 0.85) {
        const c = a.chest();
        this.spawn({ x: c.x + (Math.random() - 0.5) * a.w * 0.5, y: c.y + (Math.random() - 0.2) * a.h * 0.45, vx: (Math.random() - 0.5) * 10 * this.dpr, vy: -(30 + Math.random() * 60) * this.dpr, life: 0.8 + Math.random() * 0.8, size: (10 + Math.random() * 18) * this.dpr, grow: 0.6, color: SPECTRAL, alpha: 0.32, region: 'smoke', additive: true, vr: (Math.random() - 0.5) * 2 });
      }
    }
    // Пепельный чародей: тлеющий огонёк в руке.
    for (const a of this.actors.values()) {
      if (a.spec.style !== 'spell' || a.dead || Math.random() > 0.5) continue;
      const hx = a.x + a.p.offX - a.w * 0.37;
      const hy = a.y + a.p.offY - a.h * 0.6;
      this.spawn({ x: hx, y: hy, vx: (Math.random() - 0.5) * 12 * this.dpr, vy: -(20 + Math.random() * 30) * this.dpr, life: 0.5 + Math.random() * 0.5, size: (5 + Math.random() * 7) * this.dpr, grow: -0.4, color: ASH, alpha: 0.7, region: 'glow', additive: true });
    }
  }

  private lightPos(u: number, v: number): { x: number; y: number } {
    const tex = this.bgTex as Tex;
    const W = this.cssW * this.dpr;
    const H = this.cssH * this.dpr;
    return coverTransform(W, H, tex.w, tex.h, 1.04, this.camX(), 0).toScreen(u, v);
  }

  private camX(): number {
    return Math.sin(this.time * 0.11) * 0.006;
  }

  spawn(p: Partial<Particle> & Pick<Particle, 'x' | 'y' | 'color' | 'region'>): void {
    // В описании частицы life — это длительность жизни; счётчик возраста начинается с нуля.
    const duration = p.life ?? 1;
    this.particles.push({ vx: 0, vy: 0, size: 8, grow: 0, rot: Math.random() * Math.PI, vr: 0, gravity: 0, drag: 1, alpha: 1, additive: true, ...p, life: 0, max: duration });
  }

  // ---------- Отрисовка ----------

  private render(): void {
    const b = this.backend;
    const W = this.cssW * this.dpr;
    const H = this.cssH * this.dpr;
    b.begin();
    const shakeX = (Math.random() - 0.5) * this.shakeAmp;
    const shakeY = (Math.random() - 0.5) * this.shakeAmp;
    if (this.bgTex) {
      b.drawBackground(this.bgTex, {
        time: this.time,
        offsetX: this.camX() + shakeX / Math.max(1, W) * 0.5,
        offsetY: shakeY / Math.max(1, H) * 0.5,
        zoom: 1.04,
        tint: this.grade.tint,
        contrast: this.grade.contrast,
        saturation: this.grade.saturation,
        brightness: this.grade.brightness * (1 - this.darken * 0.5),
        fog: this.grade.fog,
        fogColor: this.grade.fogColor,
        vignette: this.grade.vignette + this.darken,
      });
    }
    const quads: QuadDraw[] = [];
    const R = this.atlas.regions;
    // Свет свечей и факелов (мерцание).
    if (this.bgTex) {
      for (const [i, l] of this.setup.lights.entries()) {
        const p = this.lightPos(l.u, l.v);
        const fl = 0.75 + 0.18 * Math.sin(this.time * 9 + i * 1.7) + 0.1 * Math.sin(this.time * 23 + i);
        const s = l.size * H * fl;
        const c = l.warm ? WARM : COLD;
        quads.push({ x: p.x, y: p.y, w: s, h: s, rot: 0, r: c[0], g: c[1], b: c[2], a: 0.32 * fl, uv: R.glow, additive: true });
        quads.push({ x: p.x, y: p.y, w: s * 0.18, h: s * 0.26, rot: 0, r: 1, g: 0.9, b: 0.7, a: 0.7, uv: R.glow, additive: true });
      }
    }
    // Напольные маркеры: телеграф цели, зона волны, прикрытие, активный герой.
    const heroesAlive = this.order.filter((a) => a.spec.side === 'hero' && !a.dead);
    const aoe = this.order.some((a) => a.status.threatened === 'aoe');
    if (aoe && heroesAlive.length) {
      const xs = heroesAlive.map((a) => a.x);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = heroesAlive.reduce((s, a) => s + a.y, 0) / heroesAlive.length;
      const w = Math.max(...xs) - Math.min(...xs) + heroesAlive[0]!.w * 1.6;
      const pulse = 0.55 + 0.35 * Math.sin(this.time * 5);
      quads.push({ x: cx, y: cy, w, h: w * 0.24, rot: 0, r: DANGER[0], g: DANGER[1], b: DANGER[2], a: 0.55 * pulse, uv: R.ellipse, additive: true });
      quads.push({ x: cx, y: cy, w: w * 0.96, h: w * 0.22, rot: 0, r: SPECTRAL[0], g: SPECTRAL[1], b: SPECTRAL[2], a: 0.35, uv: R.ring, additive: true });
    }
    for (const a of this.order) {
      if (a.dead && a.spec.side === 'enemy') continue;
      const fw = a.w * (a.spec.boss ? 0.62 : 0.9);
      if (a.status.threatened === 'single') {
        const pulse = 0.6 + 0.4 * Math.sin(this.time * 6);
        quads.push({ x: a.x, y: a.y, w: fw * 1.25, h: fw * 0.32, rot: 0, r: DANGER[0], g: DANGER[1], b: DANGER[2], a: 0.8 * pulse, uv: R.ellipse, additive: true });
        quads.push({ x: a.x, y: a.y, w: fw * 1.45, h: fw * 0.37, rot: 0, r: DANGER[0], g: DANGER[1], b: DANGER[2], a: 0.5, uv: R.ring, additive: true });
      }
      if (a.status.active) {
        quads.push({ x: a.x, y: a.y, w: fw * 1.1, h: fw * 0.28, rot: 0, r: GOLD[0], g: GOLD[1], b: GOLD[2], a: 0.7 + 0.2 * Math.sin(this.time * 4), uv: R.ring, additive: true });
      }
      if (a.status.targetable) {
        const c = a.status.targetable === 'foe' ? DANGER : HEAL;
        quads.push({ x: a.x, y: a.y, w: fw * 1.15, h: fw * 0.3, rot: 0, r: c[0], g: c[1], b: c[2], a: a.status.hovered ? 0.95 : 0.45, uv: R.ellipse, additive: true });
      }
      if (a.status.charging && !a.dead) {
        const c = a.status.charging;
        const pulse = 0.6 + 0.4 * Math.sin(this.time * 7);
        const ch = a.chest();
        quads.push({ x: ch.x, y: ch.y, w: a.w * 1.5, h: a.h * 1.1, rot: 0, r: c[0], g: c[1], b: c[2], a: 0.28 * pulse, uv: R.glow, additive: true });
      }
    }
    b.drawQuads(this.atlasTex, quads);

    // Контактные тени: тёмные пятна под ногами связывают фигуры с полом.
    const contact: QuadDraw[] = [];
    for (const a of this.order) {
      if (a.dead && a.spec.side === 'enemy' && a.p.dissolve >= 1) continue;
      const fw = a.w * (a.spec.boss ? 0.7 : a.spec.wide ? 1.0 : 0.95);
      const lift = Math.max(0, -a.p.offY) / Math.max(1, a.h);
      contact.push({ x: a.x + a.p.offX, y: a.y + Math.max(0, a.p.offY) * 0.3, w: fw * (1 - lift * 0.5), h: fw * 0.22, rot: 0, r: 0, g: 0, b: 0, a: 0.75 * (1 - lift) * (1 - a.p.dissolve), uv: R.glow, additive: false });
    }
    b.drawQuads(this.atlasTex, contact);

    // Отражения и тени, затем фигуры (по глубине).
    for (const a of this.order) {
      if (!a.tex) continue;
      if (this.setup.wetFloor) this.drawActor(a, 1, shakeX, shakeY);
      this.drawActor(a, 2, shakeX, shakeY);
    }
    for (const a of this.order) if (a.tex) this.drawActor(a, 0, shakeX, shakeY);

    // Осколки брони вокруг пробуждённого короля.
    const boss = this.order.find((a) => a.spec.boss);
    if (boss && this.shardTex && boss.phase2 && !boss.dead && this.shards.length) {
      const sq: QuadDraw[] = [];
      const c = boss.chest();
      for (const s of this.shards) {
        const ang = s.a + this.time * s.spin;
        sq.push({ x: c.x + Math.cos(ang) * boss.w * s.r, y: c.y + s.y * boss.h + Math.sin(ang) * boss.h * 0.05 + Math.sin(this.time * 2 + s.a) * 6 * this.dpr, w: s.s * boss.w, h: s.s * boss.w, rot: ang * 0.7, r: 0.8, g: 0.85, b: 1, a: 1 - boss.p.dissolve, uv: s.uv, additive: false });
      }
      b.drawQuads(this.shardTex, sq);
    }

    // Эффекты, снаряды, частицы.
    const fxq: QuadDraw[] = [];
    for (const f of this.fx) f.draw(f.t / f.max, fxq, this.atlas);
    for (const pr of this.projectiles) {
      const k = Math.min(1, pr.t / pr.dur);
      const pos = this.projPos(pr, k);
      const ahead = this.projPos(pr, Math.min(1, k + 0.02));
      const ang = Math.atan2(ahead.y - pos.y, ahead.x - pos.x);
      fxq.push({ x: pos.x, y: pos.y, w: pr.size * 3.2, h: pr.size * 1.1, rot: ang, r: pr.color[0], g: pr.color[1], b: pr.color[2], a: 1, uv: R[pr.region], additive: true });
      fxq.push({ x: pos.x, y: pos.y, w: pr.size * 2, h: pr.size * 2, rot: 0, r: pr.trail[0], g: pr.trail[1], b: pr.trail[2], a: 0.6, uv: R.glow, additive: true });
    }
    const shardQ = new Map<Tex, QuadDraw[]>();
    for (const p of this.particles) {
      const k = p.life / p.max;
      const fade = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      const q: QuadDraw = { x: p.x, y: p.y, w: p.size * (p.stretch ?? 1), h: p.size, rot: p.stretch ? Math.atan2(p.vy, p.vx) : p.rot, r: p.color[0], g: p.color[1], b: p.color[2], a: p.alpha * Math.max(0, fade), uv: p.shard ? p.shard.uv : R[p.region], additive: p.additive };
      if (p.shard) {
        const list = shardQ.get(p.shard.tex) ?? [];
        list.push(q);
        shardQ.set(p.shard.tex, list);
      } else fxq.push(q);
    }
    for (const [tex, list] of shardQ) b.drawQuads(tex, list);
    b.drawQuads(this.atlasTex, fxq);

    // Передний туман у пола: даёт глубину и прячет стык фигур с фоном.
    const fog: QuadDraw[] = [];
    for (let i = 0; i < 7; i++) {
      const x = ((i / 6) * 1.3 - 0.15 + ((this.time * 0.008 * (1 + (i % 3) * 0.4)) % 1.3)) % 1.3;
      fog.push({ x: (x - 0.1) * W, y: H * (0.9 + (i % 2) * 0.06), w: W * 0.55, h: H * 0.22, rot: 0, r: this.grade.fogColor[0] * 1.4, g: this.grade.fogColor[1] * 1.4, b: this.grade.fogColor[2] * 1.4, a: 0.2, uv: R.smoke, additive: true });
    }
    b.drawQuads(this.atlasTex, fog);
    if (this.overlayFlash.a > 0) b.overlay(this.overlayFlash.color[0], this.overlayFlash.color[1], this.overlayFlash.color[2], this.overlayFlash.a * 0.55, true);
    if (this.darken > 0) b.overlay(0, 0, 0, this.darken * 0.45, false);
    b.end();

    const list: ActorScreen[] = [];
    for (const a of this.actors.values()) {
      list.push({
        id: a.spec.id,
        x: (a.x + a.p.offX) / this.dpr,
        y: (a.y + a.p.offY) / this.dpr,
        top: (a.y + a.p.offY - a.h * a.p.sy * (a.spec.boss ? 0.93 : 0.98)) / this.dpr,
        w: a.w / this.dpr,
        h: a.h / this.dpr,
        alive: !a.dead,
      });
    }
    for (const fn of this.frameListeners) fn(list);
  }

  private drawActor(a: Actor, mode: 0 | 1 | 2, shakeX: number, shakeY: number): void {
    if (!a.tex) return;
    const idle = a.spec.idle;
    const dead = a.dead && a.spec.side === 'enemy' && a.p.dissolve >= 1;
    if (dead) return;
    const hover = idle.hover ? Math.sin((this.time + a.phase) * 1.3) * idle.hover * this.dpr : 0;
    const charging = a.status.charging;
    const outline = a.status.targetable ? (a.status.hovered ? 1 : 0.55) : a.status.threatened ? 0.75 + 0.25 * Math.sin(this.time * 6) : a.status.active ? 0.55 : 0;
    const outlineColor: Rgb = a.status.targetable === 'ally' ? HEAL : a.status.targetable === 'foe' || a.status.threatened ? DANGER : GOLD;
    const breath = a.fallen ? idle.breath * 0.3 : idle.breath;
    const chargeLean = charging ? -0.04 - 0.015 * Math.sin(this.time * 5) : 0;
    this.backend.drawSprite({
      tex: a.tex,
      emissive: a.emi,
      x: a.x + a.p.offX + shakeX,
      y: a.y + a.p.offY + shakeY + (mode === 0 ? hover : 0),
      w: a.w,
      h: a.h,
      flip: a.spec.flip,
      time: this.time * idle.speed * (1 + (a.spec.variant ?? 0) * 0.13),
      phase: a.phase,
      breath,
      sway: a.fallen ? 0.2 : idle.sway,
      bob: idle.bob,
      lean: a.p.lean + chargeLean,
      sx: a.p.sx,
      sy: a.p.sy,
      rot: a.p.rot,
      // Цветокоррекция под свет крипты: холодная заливка, тёплый контровой свет от свечей.
      tint: a.phase2 ? [0.62, 0.72, 0.95] : a.spec.side === 'hero' ? [0.86, 0.86, 0.92] : (a.spec.variant ?? 0) === 1 ? [0.74, 0.8, 0.84] : (a.spec.variant ?? 0) === 2 ? [0.84, 0.78, 0.8] : [0.8, 0.82, 0.92],
      alpha: a.p.alpha,
      flash: a.p.flash,
      flashColor: a.flashColor,
      dissolve: a.p.dissolve,
      desat: a.p.desat,
      emissiveStrength: a.p.emissive * 1.6,
      emissiveColor: charging && a.spec.boss && !a.phase2 ? DANGER : SPECTRAL,
      rim: charging ? 1.1 + 0.5 * Math.sin(this.time * 7) : a.phase2 ? 0.9 : 0.75,
      rimColor: charging ?? (a.phase2 ? SPECTRAL : a.spec.side === 'hero' ? WARM : [0.55, 0.65, 0.85]),
      outline: mode === 0 ? outline : 0,
      outlineColor,
      mode,
    });
  }

  // ---------- Взаимодействие ----------

  hitTest(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * this.dpr;
    const y = (clientY - rect.top) * this.dpr;
    const sorted = [...this.order].reverse();
    for (const a of sorted) {
      if (a.dead && a.spec.side === 'enemy') continue;
      const ax = a.x + a.p.offX;
      const ay = a.y + a.p.offY;
      const hw = a.w * (a.spec.boss ? 0.32 : 0.38);
      if (x >= ax - hw && x <= ax + hw && y >= ay - a.h * 0.96 && y <= ay + a.h * 0.03) return a.spec.id;
    }
    return null;
  }

  setStatus(id: string, s: Partial<ActorStatus>): void {
    const a = this.actors.get(id);
    if (a) Object.assign(a.status, s);
  }

  clearStatuses(keys: Array<keyof ActorStatus>): void {
    for (const a of this.actors.values()) {
      for (const k of keys) {
        if (k === 'active' || k === 'hovered' || k === 'cover') a.status[k] = false;
        else (a.status as unknown as Record<string, null>)[k] = null;
      }
    }
  }

  private actor(id: string): Actor {
    const a = this.actors.get(id);
    if (!a) throw new Error(`Нет актёра ${id}`);
    return a;
  }

  private projPos(p: Projectile, k: number): { x: number; y: number } {
    return { x: p.from.x + (p.to.x - p.from.x) * k, y: p.from.y + (p.to.y - p.from.y) * k - Math.sin(Math.PI * k) * p.arc };
  }

  shake(px: number): void {
    if (this.fast) return;
    this.shakeAmp = Math.max(this.shakeAmp, px * this.dpr);
  }

  flashScreen(color: Rgb, a: number): void {
    if (this.fast) return;
    this.overlayFlash = { a, color };
  }

  // ---------- Эффекты ----------

  private ringFx(x: number, y: number, size: number, color: Rgb, dur: number, flat = 0.32, region: FxRegion = 'ring'): void {
    if (this.fast) return;
    this.fx.push({
      t: 0,
      max: dur,
      draw: (k, out, at) => {
        const s = size * (0.3 + ease.outCubic(k) * 0.9);
        out.push({ x, y, w: s, h: s * flat, rot: 0, r: color[0], g: color[1], b: color[2], a: (1 - k) * 0.9, uv: at.regions[region], additive: true });
      },
    });
  }

  private slashFx(x: number, y: number, size: number, color: Rgb, dir: number, rot: number): void {
    if (this.fast) return;
    this.fx.push({
      t: 0,
      max: 0.32,
      draw: (k, out, at) => {
        const s = size * (0.8 + k * 0.35);
        out.push({ x, y, w: s * dir, h: s * 0.55, rot: rot + k * 0.5 * dir, r: color[0], g: color[1], b: color[2], a: (1 - k) * 1.1, uv: at.regions.slash, additive: true });
        out.push({ x, y, w: s * 0.9 * dir, h: s * 0.45, rot: rot + k * 0.5 * dir, r: 1, g: 1, b: 1, a: (1 - k) * 0.6, uv: at.regions.slash, additive: true });
      },
    });
  }

  private glowFx(x: number, y: number, size: number, color: Rgb, dur: number, a = 0.9): void {
    if (this.fast) return;
    this.fx.push({ t: 0, max: dur, draw: (k, out, at) => out.push({ x, y, w: size * (0.6 + k * 0.6), h: size * (0.6 + k * 0.6), rot: 0, r: color[0], g: color[1], b: color[2], a: a * (1 - k), uv: at.regions.glow, additive: true }) });
  }

  private sparks(x: number, y: number, color: Rgb, n: number, power: number): void {
    if (this.fast) return;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (120 + Math.random() * 380) * power * this.dpr;
      this.spawn({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 80 * this.dpr, life: 0.25 + Math.random() * 0.45, size: (3 + Math.random() * 4) * this.dpr, grow: -0.3, color, alpha: 1, region: 'spark', additive: true, gravity: 900 * this.dpr, drag: 0.92, stretch: 3 });
    }
  }

  // ---------- Хореография ----------

  /** Ближняя атака: замах, рывок, удар (impact), возврат. */
  async melee(actorId: string, targetId: string, impact: () => void, opts: { heavy?: boolean; color?: Rgb; double?: boolean } = {}): Promise<void> {
    const a = this.actor(actorId);
    const t = this.actor(targetId);
    const dir = a.dir();
    const reach = Math.abs(t.x - a.x) - (t.w * (t.spec.boss ? 0.28 : 0.42) + a.w * 0.25);
    // Огромный король не перебегает арену: короткий шаг, длина клинка делает остальное.
    const dx = Math.max(0, reach) * dir * (a.spec.boss ? 0.32 : 1);
    const dy = (t.y - a.y) * (a.spec.boss ? 0.2 : 0.85);
    const color = opts.color ?? (a.spec.side === 'hero' ? [1, 0.85, 0.6] as Rgb : [1, 0.5, 0.35] as Rgb);
    const heavy = !!opts.heavy;
    await this.tween(heavy ? 420 : 240, (k) => {
      a.p.lean = -0.1 * k * dir;
      a.p.sx = 1 - 0.05 * k;
      a.p.sy = 1 + 0.04 * k;
      a.p.offX = -14 * this.dpr * k * dir;
    }, ease.outCubic);
    await this.tween(heavy ? 200 : 160, (k) => {
      a.p.offX = -14 * this.dpr * dir * (1 - k) + dx * k;
      a.p.offY = dy * k;
      a.p.lean = (-0.1 + 0.26 * k) * dir;
      a.p.sx = 0.95 + 0.1 * k;
      a.p.sy = 1.04 - 0.08 * k;
    }, ease.inCubic);
    const c = t.chest();
    this.slashFx(c.x, c.y, (t.spec.boss ? t.w * 0.55 : t.w * 1.05) * (heavy ? 1.4 : 1), color, -dir, -0.4);
    if (opts.double) this.slashFx(c.x, c.y - t.h * 0.08, t.w * 1.0, [1, 1, 1], dir, 0.6);
    impact();
    await this.wait(heavy ? 120 : 70);
    await this.tween(300, (k) => {
      a.p.offX = dx * (1 - k);
      a.p.offY = dy * (1 - k);
      a.p.lean = 0.16 * dir * (1 - k);
      a.p.sx = 1.05 - 0.05 * k;
      a.p.sy = 0.96 + 0.04 * k;
    }, ease.outCubic);
    a.p.lean = 0;
    a.p.sx = 1;
    a.p.sy = 1;
  }

  /** Прыжок волка: дуга к цели и обратно. */
  async pounce(actorId: string, targetId: string, impact: () => void): Promise<void> {
    const a = this.actor(actorId);
    const t = this.actor(targetId);
    const dir = a.dir();
    const dx = (t.x - a.x) + t.w * 0.45 * -dir;
    const dy = t.y - a.y;
    await this.tween(260, (k) => {
      a.p.sy = 1 - 0.12 * k;
      a.p.sx = 1 + 0.06 * k;
      a.p.offX = -10 * this.dpr * k * dir;
    });
    await this.tween(260, (k) => {
      a.p.offX = -10 * this.dpr * dir * (1 - k) + dx * k;
      a.p.offY = dy * k - Math.sin(Math.PI * k) * a.h * 0.6;
      a.p.sy = 0.88 + 0.2 * Math.sin(Math.PI * k);
      a.p.rot = -0.25 * dir * Math.sin(Math.PI * k);
    }, ease.linear);
    const c = t.chest();
    this.slashFx(c.x, c.y, t.w * 0.9, [1, 0.6, 0.4], dir, 0.2);
    impact();
    await this.tween(340, (k) => {
      a.p.offX = dx * (1 - k);
      a.p.offY = dy * (1 - k) - Math.sin(Math.PI * k) * a.h * 0.25;
      a.p.sy = 1;
      a.p.rot = 0;
    }, ease.outCubic);
  }

  /** Выстрел: натяжение, снаряд по дуге, попадание (impact). */
  async shoot(actorId: string, targetId: string, kind: 'arrow' | 'bolt' | 'ash' | 'light', impact: () => void, empowered = false): Promise<void> {
    const a = this.actor(actorId);
    const t = this.actor(targetId);
    const dir = a.dir();
    const color: Rgb = kind === 'ash' ? ASH : kind === 'light' ? [0.7, 0.85, 1] : empowered ? GOLD : [1, 0.95, 0.85];
    if (empowered) {
      const c = a.chest();
      this.glowFx(c.x + a.w * 0.3 * dir, c.y, a.w * 1.2, GOLD, 0.6);
    }
    await this.tween(empowered ? 520 : 300, (k) => {
      a.p.lean = -0.05 * k * dir;
      a.p.offX = -6 * this.dpr * k * dir;
    });
    const from = a.chest();
    from.x += a.w * 0.32 * dir;
    from.y -= a.h * 0.05;
    const to = t.chest();
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const speed = (kind === 'bolt' ? 2600 : kind === 'arrow' ? 1900 : 1100) * this.dpr;
    const arc = kind === 'arrow' ? dist * 0.12 : kind === 'ash' ? dist * 0.06 : dist * 0.02;
    // Отдача после выстрела.
    void this.tween(220, (k) => {
      a.p.offX = -6 * this.dpr * dir - 8 * this.dpr * dir * Math.sin(Math.PI * k);
      a.p.lean = -0.05 * dir * (1 - k);
    });
    if (!this.fast) {
      await new Promise<void>((resolve) => {
        this.projectiles.push({
          from, to, t: 0, dur: Math.max(0.12, dist / speed), arc,
          region: kind === 'arrow' || kind === 'bolt' ? 'arrow' : 'glow',
          color, size: (kind === 'ash' ? 22 : kind === 'light' ? 16 : empowered ? 22 : 16) * this.dpr,
          trail: kind === 'ash' ? ASH : kind === 'light' ? [0.6, 0.8, 1] : empowered ? GOLD : [0.9, 0.8, 0.6],
          resolve,
        });
      });
      if (empowered || kind === 'bolt') {
        this.fx.push({ t: 0, max: 0.25, draw: (k, out, at) => {
          const ang = Math.atan2(to.y - from.y, to.x - from.x);
          out.push({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, w: dist, h: (empowered ? 10 : 4) * this.dpr, rot: ang, r: color[0], g: color[1], b: color[2], a: (1 - k) * 0.7, uv: at.regions.streak, additive: true });
        } });
      }
    }
    this.sparks(to.x, to.y, color, empowered ? 26 : 14, empowered ? 1.4 : 1);
    if (kind === 'ash') this.glowFx(to.x, to.y, t.w * 1.6, ASH, 0.5);
    impact();
    await this.tween(200, (k) => {
      a.p.offX = -6 * this.dpr * dir * (1 - k);
    });
    a.p.offX = 0;
    a.p.lean = 0;
  }

  /** Попадание: отдача, вспышка, искры. */
  hit(targetId: string, opts: { heavy?: boolean; color?: Rgb; covered?: boolean; fromDir?: number; magic?: Rgb }): void {
    const t = this.actors.get(targetId);
    if (!t || this.fast) return;
    const dir = opts.fromDir ?? -t.dir();
    const heavy = !!opts.heavy;
    const c = t.chest();
    t.p.flash = heavy ? 0.5 : 0.35;
    t.flashColor = opts.magic ?? [1, 0.92, 0.85];
    this.sparks(c.x, c.y, opts.color ?? [1, 0.75, 0.45], heavy ? 22 : 10, heavy ? 1.3 : 0.9);
    if (opts.covered) {
      this.ringFx(c.x, c.y, t.w * 1.4, COLD, 0.5, 1, 'shield');
      this.sparks(c.x, c.y, COLD, 16, 1.1);
    }
    const kb = (heavy ? 30 : 16) * this.dpr * (t.spec.boss ? 0.35 : 1) * dir;
    void this.tween(90, (k) => {
      t.p.offX = kb * k;
      t.p.lean = 0.06 * dir * k;
    }, ease.outCubic).then(() =>
      this.tween(320, (k) => {
        t.p.offX = kb * (1 - k);
        t.p.lean = 0.06 * dir * (1 - k);
      }, ease.outCubic),
    );
    this.shake(heavy ? 10 : 3);
  }

  async die(targetId: string): Promise<void> {
    const t = this.actors.get(targetId);
    if (!t) return;
    t.dead = true;
    t.status.charging = null;
    t.status.threatened = null;
    t.status.targetable = null;
    if (t.spec.side === 'hero') {
      t.fallen = true;
      await this.tween(600, (k) => {
        t.p.sy = 1 - 0.18 * k;
        t.p.lean = -0.05 * k;
        t.p.desat = 0.85 * k;
        t.p.alpha = 1 - 0.5 * k;
      });
      return;
    }
    const c = t.chest();
    if (t.spec.boss) {
      this.flashScreen([1, 0.9, 0.8], 0.8);
      this.shake(18);
      this.burstShards(t, 26);
    }
    if (!this.fast) {
      for (let i = 0; i < (t.spec.boss ? 90 : 36); i++) {
        this.spawn({ x: c.x + (Math.random() - 0.5) * t.w * 0.6, y: c.y + (Math.random() - 0.3) * t.h * 0.7, vx: (Math.random() - 0.5) * 60 * this.dpr, vy: -(40 + Math.random() * 120) * this.dpr, life: 0.9 + Math.random() * 1.2, size: (2 + Math.random() * 3) * this.dpr, grow: -0.05, color: t.phase2 ? SPECTRAL : WARM, alpha: 1, region: 'spark', additive: true, drag: 0.985 });
      }
    }
    await this.tween(t.spec.boss ? 1600 : 1000, (k) => {
      t.p.offX = -t.dir() * 18 * this.dpr * k;
      t.p.lean = -0.08 * t.dir() * k;
      t.p.dissolve = k;
    }, ease.inOutSine);
  }

  async revive(targetId: string): Promise<void> {
    const t = this.actors.get(targetId);
    if (!t) return;
    t.dead = false;
    t.fallen = false;
    const c = t.chest();
    this.glowFx(c.x, c.y, t.w * 2.4, GOLD, 0.9);
    await this.tween(500, (k) => {
      t.p.sy = 0.82 + 0.18 * k;
      t.p.lean = -0.05 * (1 - k);
      t.p.desat = 0.85 * (1 - k);
      t.p.alpha = 0.5 + 0.5 * k;
    });
  }

  /** Жест умения на месте (Прикрытие, лечение): подъём, свечение. */
  async gesture(actorId: string, color: Rgb): Promise<void> {
    const a = this.actor(actorId);
    const c = a.chest();
    this.glowFx(c.x, c.y - a.h * 0.15, a.w * 1.8, color, 0.7, 0.8);
    if (!this.fast) {
      for (let i = 0; i < 18; i++) {
        const ang = (i / 18) * Math.PI * 2;
        this.spawn({ x: c.x + Math.cos(ang) * a.w * 0.6, y: c.y + Math.sin(ang) * a.h * 0.25, vx: -Math.cos(ang) * 60 * this.dpr, vy: -Math.sin(ang) * 30 * this.dpr - 30 * this.dpr, life: 0.5, size: 4 * this.dpr, grow: -0.2, color, alpha: 0.9, region: 'spark', additive: true });
      }
    }
    await this.tween(300, (k) => {
      a.p.sy = 1 + 0.05 * k;
      a.p.lean = -0.03 * a.dir() * k;
    });
    await this.tween(240, (k) => {
      a.p.sy = 1.05 - 0.05 * k;
      a.p.lean = -0.03 * a.dir() * (1 - k);
    });
  }

  async heal(fromId: string, targetId: string, amount: number): Promise<void> {
    const from = this.actor(fromId);
    const t = this.actor(targetId);
    if (fromId !== targetId) {
      const a = from.chest();
      const b = t.chest();
      if (!this.fast) {
        await new Promise<void>((resolve) => {
          this.projectiles.push({ from: { x: a.x + from.w * 0.3, y: a.y - from.h * 0.25 }, to: b, t: 0, dur: 0.35, arc: 40 * this.dpr, region: 'glow', color: HEAL, size: 18 * this.dpr, trail: HEAL, resolve });
        });
      }
    }
    const c = t.chest();
    if (!this.fast) {
      this.fx.push({ t: 0, max: 1.0, draw: (k, out, at) => {
        out.push({ x: c.x, y: t.y - t.h * 0.5, w: t.w * 0.9, h: t.h * 1.3, rot: 0, r: HEAL[0], g: HEAL[1], b: HEAL[2], a: Math.sin(Math.PI * k) * 0.55, uv: at.regions.beam, additive: true });
      } });
      for (let i = 0; i < 26; i++) {
        this.spawn({ x: c.x + (Math.random() - 0.5) * t.w * 0.7, y: t.y - Math.random() * t.h * 0.3, vx: (Math.random() - 0.5) * 20 * this.dpr, vy: -(60 + Math.random() * 90) * this.dpr, life: 0.9 + Math.random() * 0.6, size: (3 + Math.random() * 4) * this.dpr, grow: -0.1, color: HEAL, alpha: 0.95, region: 'spark', additive: true });
      }
      t.flashColor = HEAL;
      t.p.flash = 0.22;
    }
    void amount;
    await this.wait(300);
  }

  async coverFx(fromId: string, targetId: string): Promise<void> {
    const t = this.actor(targetId);
    const a = this.actor(fromId);
    const from = a.chest();
    const to = t.chest();
    if (!this.fast && fromId !== targetId) {
      await new Promise<void>((resolve) => {
        this.projectiles.push({ from, to, t: 0, dur: 0.32, arc: 30 * this.dpr, region: 'glow', color: COLD, size: 20 * this.dpr, trail: GOLD, resolve });
      });
    }
    this.ringFx(to.x, to.y, t.w * 1.6, COLD, 0.7, 1, 'shield');
    t.status.cover = true;
  }

  /** Подготовка телеграфа: стойка с удержанием и цветное свечение; держится до удара. */
  async prepare(actorId: string, color: Rgb): Promise<void> {
    const a = this.actor(actorId);
    a.status.charging = color;
    const c = a.chest();
    this.glowFx(c.x, c.y, a.w * 1.6, color, 0.8, 0.7);
    if (a.spec.boss) this.shake(4);
    await this.tween(a.spec.boss ? 700 : 420, (k) => {
      a.p.lean = -0.07 * a.dir() * k;
      a.p.sy = 1 + 0.03 * k;
    }, ease.outBack);
    await this.tween(260, (k) => {
      a.p.lean = -0.07 * a.dir() * (1 - k);
      a.p.sy = 1.03 - 0.03 * k;
    });
  }

  /** Призрачная волна: кольцо идёт от короля по полу через весь отряд. */
  async wave(actorId: string, targets: string[], impactAt: (id: string) => void): Promise<void> {
    const a = this.actor(actorId);
    a.status.charging = null;
    const c = a.chest();
    this.flashScreen(SPECTRAL, 0.6);
    this.shake(14);
    await this.tween(360, (k) => {
      a.p.sy = 1 + 0.06 * k;
      a.p.lean = 0.08 * a.dir() * -k;
    }, ease.outBack);
    const reach = Math.abs(c.x - Math.min(...targets.map((id) => this.actor(id).x))) + 200 * this.dpr;
    if (!this.fast) {
      this.fx.push({ t: 0, max: 0.75, draw: (k, out, at) => {
        const r = reach * 2 * ease.outCubic(k);
        out.push({ x: a.x, y: a.y, w: r, h: r * 0.24, rot: 0, r: SPECTRAL[0], g: SPECTRAL[1], b: SPECTRAL[2], a: (1 - k) * 1.2, uv: at.regions.ring, additive: true });
        out.push({ x: a.x, y: a.y - a.h * 0.1, w: r * 0.85, h: r * 0.5, rot: 0, r: SPECTRAL[0], g: SPECTRAL[1], b: SPECTRAL[2], a: (1 - k) * 0.4, uv: at.regions.glow, additive: true });
      } });
    }
    const sorted = targets.map((id) => this.actor(id)).sort((p, q) => Math.abs(q.x - a.x) - Math.abs(p.x - a.x)).reverse();
    for (const t of sorted) {
      const delay = (Math.abs(a.x - t.x) / reach) * 750;
      void this.wait(delay).then(() => {
        impactAt(t.spec.id);
      });
    }
    await this.wait(800);
    await this.tween(300, (k) => {
      a.p.sy = 1.06 - 0.06 * k;
      a.p.lean = -0.08 * a.dir() * (1 - k);
    });
  }

  private ensureShards(a: Actor): void {
    if (this.shardTex || !a.tex) return;
    const cell = 96;
    const count = 10;
    const c = document.createElement('canvas');
    c.width = cell * count;
    c.height = cell;
    const x = c.getContext('2d') as CanvasRenderingContext2D;
    const src = a.tex.source;
    const sw = a.tex.w;
    const sh = a.tex.h;
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < count; i++) {
      const pts: Array<[number, number]> = [];
      const k = 5 + Math.floor(rnd() * 3);
      for (let j = 0; j < k; j++) {
        const ang = (j / k) * Math.PI * 2 + rnd() * 0.5;
        const r = cell * (0.28 + rnd() * 0.2);
        pts.push([cell * i + cell / 2 + Math.cos(ang) * r, cell / 2 + Math.sin(ang) * r * (0.7 + rnd() * 0.5)]);
      }
      x.save();
      x.beginPath();
      pts.forEach(([px, py], j) => (j === 0 ? x.moveTo(px, py) : x.lineTo(px, py)));
      x.closePath();
      x.clip();
      // Фрагмент брони из области доспеха (плечи, грудь, щит).
      const u = 0.3 + rnd() * 0.4;
      const v = 0.18 + rnd() * 0.42;
      const s = 0.07 + rnd() * 0.05;
      x.drawImage(src, u * sw, v * sh, s * sw, s * sw, cell * i, 0, cell, cell);
      x.restore();
      x.strokeStyle = 'rgba(140, 190, 255, 0.95)';
      x.lineWidth = 2;
      x.shadowColor = 'rgba(90, 160, 255, 1)';
      x.shadowBlur = 6;
      x.beginPath();
      pts.forEach(([px, py], j) => (j === 0 ? x.moveTo(px, py) : x.lineTo(px, py)));
      x.closePath();
      x.stroke();
      this.shardCells.push([(cell * i + 1) / c.width, 1 / cell, (cell * (i + 1) - 1) / c.width, (cell - 1) / cell]);
    }
    this.shardTex = this.backend.createTexture(c, c.width, c.height);
  }

  private burstShards(a: Actor, n: number): void {
    if (this.fast || !a.tex) return;
    this.ensureShards(a);
    const c = a.chest();
    for (let i = 0; i < n; i++) {
      const s = 0.04 + Math.random() * 0.05;
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
      const sp = (200 + Math.random() * 380) * this.dpr;
      const cellUv = this.shardCells[i % this.shardCells.length] as [number, number, number, number];
      this.particles.push({ x: c.x, y: c.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0, max: 1.2 + Math.random() * 0.6, size: a.w * s * 1.4, grow: 0, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, gravity: 1100 * this.dpr, drag: 0.985, color: [1, 1, 1], alpha: 1, region: 'glow', additive: false, shard: { tex: this.shardTex as Tex, uv: cellUv } });
    }
  }

  private enterPhase2Visuals(a: Actor, instant: boolean): void {
    a.phase2 = true;
    a.spec.idle = { ...a.spec.idle, hover: 6, breath: a.spec.idle.breath * 1.3, sway: a.spec.idle.sway * 1.6 };
    this.ensureShards(a);
    this.shards = Array.from({ length: 9 }, (_, i) => {
      const s = 0.06 + ((i * 17) % 4) / 100;
      return { a: (i / 9) * Math.PI * 2, r: 0.42 + ((i * 7) % 5) / 30, y: -0.2 + ((i * 11) % 7) / 20, s, uv: this.shardCells[i % Math.max(1, this.shardCells.length)] ?? [0, 0, 1, 1], spin: 0.25 + ((i * 3) % 5) / 20 };
    });
    this.gradeTarget = { ...this.gradeTarget, tint: [0.78, 0.9, 1.15], fog: 0.52, fogColor: [0.2, 0.32, 0.55], brightness: 0.86, saturation: 0.85 };
    if (instant) {
      a.p.emissive = 1;
      this.grade = { ...this.grade, ...this.gradeTarget };
    }
  }

  /** Пробуждение короля: доспехи трескаются, проявляется призрачное ядро, свет меняется. */
  async bossPhase2(actorId: string): Promise<void> {
    const a = this.actor(actorId);
    a.status.charging = null;
    this.shake(20);
    this.flashScreen([0.8, 0.9, 1], 0.9);
    a.flashColor = [0.7, 0.85, 1];
    a.p.flash = 1;
    this.burstShards(a, 34);
    await this.tween(380, (k) => {
      a.p.lean = -0.1 * a.dir() * Math.sin(Math.PI * k);
      a.p.sy = 1 - 0.06 * Math.sin(Math.PI * k);
    });
    this.enterPhase2Visuals(a, false);
    const c = a.chest();
    this.ringFx(a.x, a.y, a.w * 3.2, SPECTRAL, 1.1, 0.26);
    this.glowFx(c.x, c.y, a.w * 2.2, SPECTRAL, 1.2, 1);
    await this.tween(1200, (k) => {
      a.p.emissive = k;
      a.p.sy = 1 + 0.05 * Math.sin(Math.PI * k);
    }, ease.inOutSine);
    a.p.emissive = 1;
  }

  async victory(heroIds: string[]): Promise<void> {
    await Promise.all(heroIds.map((id, i) => {
      const a = this.actors.get(id);
      if (!a || a.dead) return Promise.resolve();
      return this.wait(i * 90).then(() => this.tween(520, (k) => {
        a.p.offY = -Math.sin(Math.PI * k) * 22 * this.dpr;
        a.p.sy = 1 + 0.04 * Math.sin(Math.PI * k);
      }));
    }));
  }

  async defeat(): Promise<void> {
    await this.tween(900, (k) => {
      this.darken = 0.6 * k;
    });
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    for (const t of this.tweens) t.resolve();
    for (const p of this.projectiles) p.resolve();
    this.tweens = [];
    this.projectiles = [];
    this.backend.destroy();
    this.canvas.remove();
  }

  /** Досчёт боя: все текущие анимации мгновенно завершаются. */
  finishAll(): void {
    this.fast = true;
    for (const tw of this.tweens) {
      tw.fn(1);
      tw.resolve();
    }
    this.tweens = [];
    for (const p of this.projectiles) p.resolve();
    this.projectiles = [];
  }

  /** Восстанавливает видимое состояние после досчёта/загрузки: поза павших, выбывшие враги. */
  syncAlive(id: string, alive: boolean): void {
    const a = this.actors.get(id);
    if (!a) return;
    if (!alive && !a.dead) {
      a.dead = true;
      if (a.spec.side === 'enemy') a.p.dissolve = 1;
      else a.setFallenPose();
    }
  }

  setPhase2(id: string): void {
    const a = this.actors.get(id);
    if (a && !a.phase2) this.enterPhase2Visuals(a, true);
  }

  stats(): { backend: string; actors: number; particles: number; errors: string[] } {
    return { backend: this.backend.kind, actors: this.actors.size, particles: this.particles.length, errors: [...this.errors] };
  }
}
