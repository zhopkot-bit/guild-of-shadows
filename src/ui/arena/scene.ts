import type { AnimClip, AnimPack, ArenaLayer, ClipName, LoadedRig, PoseName, PosePack, VfxId, VfxPack } from '../../content/artpack';
import { resolvePose } from '../../content/artpack';
import type { Backend, QuadDraw, RenderTarget, Rgb, SpriteDraw, Tex } from './backend';
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
  /** Покадровая анимация художника (атлас + клипы). Без неё — процедурная деформация спрайта. */
  anim?: AnimPack | null;
  /** Финальный арт II фазы босса: отдельный спрайт и/или анимация. */
  sprite2?: string | null;
  anim2?: AnimPack | null;
  /** Скелетный персонаж DragonBones (основной формат финальной анимации). */
  rig?: LoadedRig | null;
  rig2?: LoadedRig | null;
  /** Набор поз (цельные иллюстрации): переключаются на фазах действия. */
  poses?: PosePack | null;
  /** Набор поз II фазы босса. */
  poses2?: PosePack | null;
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
  /** Витрина одного героя (экран героя): фигура по центру крупным планом. */
  showcase?: boolean;
  /** Слои окружения от художника (дальний/средний план, передний план поверх бойцов). */
  layers?: ArenaLayer[];
  /** Листы эффектов умений от художника. */
  vfx?: Partial<Record<VfxId, VfxPack>>;
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
  /** Атлас покадровой анимации и текущий клип. */
  animTex: Tex[] = [];
  anim: AnimPack | null = null;
  rig: LoadedRig | null = null;
  rigAtlas: Tex | null = null;
  rigTarget: RenderTarget | null = null;
  rigAtlas2: Tex | null = null;
  clip: { name: ClipName; start: number; def: AnimClip } | null = null;
  tex2: Tex | null = null;
  animTex2: Tex[] = [];
  /** Набор поз: загруженные текстуры, текущая и предыдущая поза (для «призрака» при смене). */
  posePack: PosePack | null = null;
  poseTex: Partial<Record<PoseName, Tex[]>> = {};
  poseGlow: Partial<Record<PoseName, Tex[]>> = {};
  poseAlt: Partial<Record<PoseName, Tex[][]>> = {};
  poseTex2: Partial<Record<PoseName, Tex[]>> = {};
  poseGlow2: Partial<Record<PoseName, Tex[]>> = {};
  poseAlt2: Partial<Record<PoseName, Tex[][]>> = {};
  /** Выбранный вариант позы: 0 — основной, 1… — из alternatives. */
  poseChoice: Partial<Record<PoseName, number>> = {};
  /** Последний показанный кадр прежней позы — для «призрака» при смене. */
  prevTex: Tex | null = null;
  /** Здоровье ниже порога: вместо стойки — раненая стойка (если нарисована). */
  wounded = false;
  pose: PoseName = 'idle';
  poseAt = -10;
  /** Размер холста позы на экране (холст больше фигуры: запас под оружие). */
  drawW = 1;
  drawH = 1;
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
    if (this.spec.poses) {
      // Лежачая поза нарисована художником: без процедурного сплющивания.
      this.pose = 'down';
      this.p.desat = 0.55;
      this.p.alpha = 0.85;
      return;
    }
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
/** Сколько секунд тает прежняя поза при смене. */
const POSE_GHOST = 0.13;
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
  private layerTex: Array<{ layer: ArenaLayer; tex: Tex }> = [];
  private frameListeners: Array<(list: ActorScreen[]) => void> = [];
  /** Камера: текущее состояние, цель и «толчок» удара; стоп-кадр удара (по реальному времени). */
  private cam = { z: 1, x: 0, y: 0 };
  /** Листы эффектов художника: текстуры страниц и проигрываемые экземпляры. */
  private vfxTex: Partial<Record<VfxId, Tex[]>> = {};
  private vfxActive: Array<{ id: VfxId; t: number; x: number; y: number; size: number; flip: boolean; rot: number }> = [];
  private camGoal = { z: 1, x: 0, y: 0 };
  private camPunch = 0;
  private freezeUntil = 0;
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
      if (a.spec.anim?.pageUrls?.length) {
        a.animTex = await Promise.all(a.spec.anim.pageUrls.map(async (u) => this.texFrom(await get(u))));
        a.anim = a.spec.anim;
      }
      if (a.spec.sprite2) a.tex2 = this.texFrom(await get(a.spec.sprite2));
      if (a.spec.anim2?.pageUrls?.length) a.animTex2 = await Promise.all(a.spec.anim2.pageUrls.map(async (u) => this.texFrom(await get(u))));
      if (a.spec.rig) {
        a.rigAtlas = this.texFrom(await get(a.spec.rig.atlasUrl));
        a.rig = a.spec.rig;
      }
      if (a.spec.rig2) a.rigAtlas2 = this.texFrom(await get(a.spec.rig2.atlasUrl));
      const loadList = async (urls: Partial<Record<PoseName, string[]>> | undefined, into: Partial<Record<PoseName, Tex[]>>) => {
        await Promise.all((Object.keys(urls ?? {}) as PoseName[]).map(async (n) => {
          into[n] = await Promise.all((urls?.[n] ?? []).map(async (u) => this.texFrom(await get(u))));
        }));
      };
      const loadPoses = async (pack: PosePack | null | undefined, tex: Partial<Record<PoseName, Tex[]>>, glow: Partial<Record<PoseName, Tex[]>>, alt: Partial<Record<PoseName, Tex[][]>>) => {
        await loadList(pack?.poseUrls, tex);
        await loadList(pack?.glowUrls, glow);
        await Promise.all((Object.keys(pack?.altUrls ?? {}) as PoseName[]).map(async (n) => {
          alt[n] = await Promise.all((pack?.altUrls?.[n] ?? []).map((list) => Promise.all(list.map(async (u) => this.texFrom(await get(u))))));
        }));
      };
      await loadPoses(a.spec.poses, a.poseTex, a.poseGlow, a.poseAlt);
      if (a.poseTex.idle?.length) a.posePack = a.spec.poses ?? null;
      await loadPoses(a.spec.poses2, a.poseTex2, a.poseGlow2, a.poseAlt2);
    });
    const layerJobs = (this.setup.layers ?? []).map(async (l) => ({ layer: l, tex: this.texFrom(await get(l.src)) }));
    const vfxJobs = (Object.entries(this.setup.vfx ?? {}) as Array<[VfxId, VfxPack]>).map(async ([id, pack]) => {
      this.vfxTex[id] = await Promise.all((pack.pageUrls ?? []).map(async (u) => this.texFrom(await get(u))));
    });
    this.bgTex = this.texFrom(await bg);
    await Promise.all(jobs);
    this.layerTex = await Promise.all(layerJobs);
    await Promise.all(vfxJobs);
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
      const box = a.rig?.rig.aabb;
      a.w = box ? (a.h * box.width) / box.height : a.anim ? (a.h * a.anim.frameWidth) / a.anim.frameHeight : a.tex ? (a.h * a.tex.w) / a.tex.h : a.h * 0.45;
      const pp = a.posePack;
      if (pp && !a.rig && !a.anim) {
        if (this.setup.showcase) {
          // Экран героя должен вмещать весь холст с поднятым оружием, а не только стойку.
          a.h = Math.min(a.h, H * 0.9 * pp.figureHeight, W * 0.9 * pp.frameHeight / pp.frameWidth * pp.figureHeight);
        }
        // Рост фигуры в стойке = высота слота; холст позы крупнее на запас под замах.
        a.drawH = a.h / pp.figureHeight;
        a.drawW = (a.drawH * pp.frameWidth) / pp.frameHeight;
        a.w = pp.figureWidth ? a.drawW * pp.figureWidth : a.h * 0.48;
      }
    };
    if (this.setup.showcase) {
      heroes.forEach((a) => place(a, { x: 0.5, y: 0.97, h: 0.9, z: 10 }));
    } else {
      heroes.forEach((a, i) => place(a, L.heroes[i]));
      foes.forEach((a, i) => place(a, L.enemies[i]));
      // У цельных поз плащ/оружие шире стойки. Сдвигаем строй вместе, сохраняя
      // расстояния между героями и их плашками, вместо сдвига одного бойца на соседа.
      const posed = heroes.filter((a) => a.posePack && !a.rig && !a.anim);
      const shift = Math.max(0, ...posed.map((a) => a.drawW * a.posePack!.pivot[0] + 8 * this.dpr - a.x));
      if (shift > 0) for (const a of heroes) a.x += shift;
    }
    this.order = [...this.actors.values()].sort((a, b) => a.slot.z - b.slot.z || a.y - b.y);
    this.container.classList.toggle('arena--portrait', L.portrait);
    this.camGoal = this.restCam();
    this.cam = { ...this.camGoal };
  }

  // ---------- Время и твины ----------

  private frame = (now: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dtReal = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.paused) return;
    if (now < this.freezeUntil) {
      // Стоп-кадр удара: мир замер, кадр перерисовывается (дрожание камеры остаётся).
      this.render();
      return;
    }
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
    const ck = Math.min(1, dtReal * 6 * Math.max(1, this.speed * 0.6));
    this.cam.z += (this.camGoal.z - this.cam.z) * ck;
    this.cam.x += (this.camGoal.x - this.cam.x) * ck;
    this.cam.y += (this.camGoal.y - this.cam.y) * ck;
    this.camPunch *= Math.exp(-dtReal * 7 * Math.max(1, this.speed * 0.6));
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
    for (const v of this.vfxActive) v.t += dt;
    this.vfxActive = this.vfxActive.filter((v) => {
      const pack = this.setup.vfx?.[v.id];
      return !!pack && v.t * pack.fps < pack.frames;
    });

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
    const view = this.view();
    b.setView(view.z, view.x, view.y);
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
    this.drawLayers(false, W, H);
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
    this.drawVfx();

    this.drawLayers(true, W, H);
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
    const vx = (x: number) => ((x - view.x) * view.z + view.x) / this.dpr;
    const vy = (y: number) => ((y - view.y) * view.z + view.y) / this.dpr;
    for (const a of this.actors.values()) {
      list.push({
        id: a.spec.id,
        x: vx(a.x + a.p.offX),
        y: vy(a.y + a.p.offY),
        top: vy(a.y + a.p.offY - a.h * a.p.sy * (a.spec.boss ? 0.93 : 0.98)),
        w: (a.w * view.z) / this.dpr,
        h: (a.h * view.z) / this.dpr,
        alive: !a.dead,
      });
    }
    for (const fn of this.frameListeners) fn(list);
  }

  private drawLayers(front: boolean, W: number, H: number): void {
    for (const { layer, tex } of this.layerTex) {
      if (!!layer.front !== front) continue;
      const t = coverTransform(W, H, tex.w, tex.h, 1.04, this.camX() * layer.parallax * 2, 0);
      this.backend.drawQuads(tex, [{ x: t.x0 + t.drawW / 2, y: t.y0 + t.drawH / 2, w: t.drawW, h: t.drawH, rot: 0, r: this.grade.tint[0], g: this.grade.tint[1], b: this.grade.tint[2], a: 1, uv: [0, 0, 1, 1], additive: false }]);
    }
  }

  /** Текущий кадр: для рига — перерисованная цель, для листа кадров — страница и прямоугольник. */
  private frameRect(a: Actor): { tex: Tex; uv: [number, number, number, number]; pivot: [number, number] } | null {
    if (a.rig && a.rigAtlas) return this.rigFrame(a);
    if (a.posePack && !a.anim) return { tex: this.poseFrame(a, this.shownPose(a)).tex, uv: [0, 0, 1, 1], pivot: a.posePack.pivot };
    const pack = a.anim;
    if (!pack || !a.animTex.length) return null;
    if (!a.clip) a.clip = { name: 'idle', start: this.time, def: pack.clips.idle };
    const c = a.clip;
    const n = c.def.frames.length;
    let k = Math.floor((this.time - c.start) * c.def.fps * this.speed);
    if (k >= n) {
      if (c.def.loop || c.name === 'idle' || c.name === 'prepare') k %= n;
      else if (c.name === 'death') k = n - 1;
      else {
        a.clip = { name: 'idle', start: this.time, def: pack.clips.idle };
        k = 0;
      }
    }
    const frame = a.clip.def.frames[Math.max(0, k)] ?? 0;
    const first = a.animTex[0] as Tex;
    const cols = Math.max(1, Math.floor(first.w / pack.frameWidth));
    const rows = Math.max(1, Math.floor(first.h / pack.frameHeight));
    const perPage = cols * rows;
    const tex = a.animTex[Math.min(a.animTex.length - 1, Math.floor(frame / perPage))] as Tex;
    const local = frame % perPage;
    const fx = (local % cols) * pack.frameWidth;
    const fy = Math.floor(local / cols) * pack.frameHeight;
    return { tex, uv: [fx / tex.w, fy / tex.h, (fx + pack.frameWidth) / tex.w, (fy + pack.frameHeight) / tex.h], pivot: pack.pivot };
  }

  /** Поза рига в текущий момент клипа → текстура-цель нужного размера. */
  private rigFrame(a: Actor): { tex: Tex; uv: [number, number, number, number]; pivot: [number, number] } | null {
    const lr = a.rig as LoadedRig;
    const box = lr.rig.aabb;
    const th = Math.round(Math.min(2048, Math.max(128, a.h * 1.05)));
    const tw = Math.round(Math.min(2048, Math.max(64, (th * box.width) / box.height)));
    if (!a.rigTarget || Math.abs(a.rigTarget.h - th) > 24) {
      if (a.rigTarget) this.backend.disposeTarget(a.rigTarget);
      a.rigTarget = this.backend.createTarget(tw, th);
    }
    const target = a.rigTarget;
    const names = lr.rig.animations();
    if (!a.clip || !names.includes(a.clip.name)) a.clip = { name: 'idle', start: this.time, def: { frames: [0], fps: 1 } };
    let name: string | null = names.includes(a.clip.name) ? a.clip.name : names.includes('idle') ? 'idle' : null;
    let t = (this.time - a.clip.start) * this.speed;
    const info = name ? lr.rig.info(name) : null;
    if (info) {
      if (info.loop || name === 'idle' || name === 'prepare') t %= Math.max(0.001, info.duration);
      else if (t >= info.duration) {
        if (name === 'death') t = info.duration;
        else {
          a.clip = { name: 'idle', start: this.time, def: { frames: [0], fps: 1 } };
          name = names.includes('idle') ? 'idle' : null;
          t = 0;
        }
      }
    }
    const s = target.h / box.height;
    const map: [number, number, number, number, number, number] = [s, 0, 0, s, -box.x * s, -box.y * s];
    const parts = lr.rig.pose(name, t).map((p) => ({ ...p, m: mulMat(map, p.m) }));
    this.backend.drawRig(target, a.rigAtlas as Tex, parts);
    return { tex: target.tex, uv: [0, 0, 1, 1], pivot: [-box.x / box.width, -box.y / box.height] };
  }

  private rigPivot(a: Actor): [number, number] {
    const box = a.rig?.rig.aabb;
    return box ? [-box.x / box.width, -box.y / box.height] : [0.5, 1];
  }

  /** Проигрывает клип художника (если он есть); иначе сцена остаётся на процедурной анимации. */
  play(id: string, name: ClipName): void {
    const a = this.actors.get(id);
    if (!a) return;
    const fallback: Partial<Record<ClipName, ClipName>> = { shoot: 'attack', prepare: 'cast', victory: 'idle' };
    if (a.rig) {
      const names = a.rig.rig.animations();
      const pick = names.includes(name) ? name : fallback[name] && names.includes(fallback[name] as string) ? (fallback[name] as ClipName) : null;
      if (pick) a.clip = { name: pick, start: this.time, def: { frames: [0], fps: 1 } };
      return;
    }
    const pack = a.anim;
    if (!pack) return;
    const def = pack.clips[name] ?? (fallback[name] ? pack.clips[fallback[name] as ClipName] : undefined);
    if (def) a.clip = { name, start: this.time, def };
  }

  private drawActor(a: Actor, mode: 0 | 1 | 2, shakeX: number, shakeY: number): void {
    if (!a.tex) return;
    // Риг перерисовывается один раз за кадр (в проходе фигуры), отражение и тень берут ту же текстуру.
    const rect = mode === 0 || !a.rigTarget ? this.frameRect(a) : { tex: a.rigTarget.tex, uv: [0, 0, 1, 1] as [number, number, number, number], pivot: this.rigPivot(a) };
    const baseTex = rect ? rect.tex : a.phase2 && a.tex2 ? a.tex2 : a.tex;
    const posed = !!rect && !!a.posePack && !a.rig && !a.anim;
    const shown = posed ? this.shownPose(a) : 'idle';
    // При покадровой/скелетной анимации процедурная деформация лишь «дышит» поверх;
    // у набора поз стойка живёт как обычный спрайт, остальные позы — почти неподвижны (их держит хореография).
    const animScale = posed ? (shown === 'idle' || shown === 'prepare' ? 0.8 : 0.2) : rect ? 0.25 : 1;
    const pivot = rect ? rect.pivot : [0.5, 1];
    const dw = posed ? a.drawW : a.w;
    const dh = posed ? a.drawH : a.h;
    const glow = posed && mode === 0 ? this.poseGlowFrame(a, shown) : null;
    const idle = a.spec.idle;
    const dead = a.dead && a.spec.side === 'enemy' && a.p.dissolve >= 1;
    if (dead) return;
    const hover = idle.hover ? Math.sin((this.time + a.phase) * 1.3) * idle.hover * this.dpr : 0;
    const charging = a.status.charging;
    const outline = a.status.targetable ? (a.status.hovered ? 1 : 0.55) : a.status.threatened ? 0.75 + 0.25 * Math.sin(this.time * 6) : a.status.active ? 0.55 : 0;
    const outlineColor: Rgb = a.status.targetable === 'ally' ? HEAL : a.status.targetable === 'foe' || a.status.threatened ? DANGER : GOLD;
    const breath = a.fallen ? idle.breath * 0.3 : idle.breath;
    const chargeLean = charging ? -0.04 - 0.015 * Math.sin(this.time * 5) : 0;
    const d: SpriteDraw = {
      tex: baseTex,
      emissive: glow ? glow.tex : rect || (a.phase2 && a.tex2) ? null : a.emi,
      uv: rect ? rect.uv : [0, 0, 1, 1],
      x: a.x + a.p.offX + shakeX + (0.5 - (pivot[0] ?? 0.5)) * dw,
      y: a.y + a.p.offY + shakeY + (mode === 0 ? hover : 0) + (1 - (pivot[1] ?? 1)) * dh,
      w: dw,
      h: dh,
      flip: a.spec.flip,
      time: this.time * idle.speed * (1 + (a.spec.variant ?? 0) * 0.13),
      phase: a.phase,
      breath: breath * animScale,
      sway: (a.fallen ? 0.2 : idle.sway) * animScale,
      bob: idle.bob * animScale,
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
      emissiveStrength: glow ? glow.strength : a.p.emissive * 1.6,
      emissiveColor: glow ? glow.color : charging && a.spec.boss && !a.phase2 ? DANGER : SPECTRAL,
      rim: charging ? 1.1 + 0.5 * Math.sin(this.time * 7) : a.phase2 ? 0.9 : 0.75,
      rimColor: charging ?? (a.phase2 ? SPECTRAL : a.spec.side === 'hero' ? WARM : [0.55, 0.65, 0.85]),
      outline: mode === 0 ? outline : 0,
      outlineColor,
      mode,
    };
    if (posed) this.keepPoseInFrame(d);
    // Смена позы: прежняя поза коротко тает и «отстаёт» по ходу движения — глаз читает рывок, а не подмену.
    const ghostK = (this.time - a.poseAt) * this.speed / POSE_GHOST;
    if (posed && mode === 0 && a.prevTex && ghostK < 1) {
      const gTex = a.prevTex;
      if (gTex !== baseTex) {
        const back = (1 - ghostK) * 0.06 * dw * -a.dir() * (a.spec.flip ? -1 : 1);
        this.backend.drawSprite({ ...d, tex: gTex, x: d.x + back, alpha: d.alpha * 0.55 * (1 - ghostK), outline: 0, rim: 0, flash: 0 });
      }
    }
    this.backend.drawSprite(d);
  }

  /** Камера и отдача не должны обрезать цельную позу у края арены. */
  private keepPoseInFrame(d: SpriteDraw): void {
    const v = this.view();
    const W = this.cssW * this.dpr, H = this.cssH * this.dpr;
    // Консервативная оболочка всего холста, включая дыхание/плащ и наклон.
    const side = Math.abs(d.sway) * d.w * 0.047 + Math.abs(d.breath) * d.w * 0.55;
    const top = d.h * (1 + Math.abs(d.breath) + Math.abs(d.bob) * 0.007);
    const corners = [-d.w / 2 - side, d.w / 2 + side].flatMap((x) => [0, -top].map((y) => {
      const px = (x - d.lean * y) * (d.flip ? -1 : 1) * d.sx;
      const py = y * d.sy;
      return { x: Math.cos(d.rot) * px - Math.sin(d.rot) * py, y: Math.sin(d.rot) * px + Math.cos(d.rot) * py };
    }));
    const margin = 3 * this.dpr;
    const fit = (pos: number, offsets: number[], limit: number, center: number) => {
      const min = center + (margin - center) / v.z - Math.min(...offsets);
      const max = center + (limit - margin - center) / v.z - Math.max(...offsets);
      return min <= max ? Math.max(min, Math.min(max, pos)) : (min + max) / 2;
    };
    d.x = fit(d.x, corners.map((p) => p.x), W, v.x);
    d.y = fit(d.y, corners.map((p) => p.y), H, v.y);
  }

  /** Какую позу показать: заказанную хореографией, «готовлю удар» при заряде, раненую стойку или ближайшую замену. */
  private shownPose(a: Actor): PoseName {
    let want: PoseName = a.pose;
    if (a.pose === 'idle' && !a.dead) {
      if (a.status.charging) want = 'prepare';
      else if (a.wounded) want = 'wounded';
    }
    return resolvePose((n) => !!a.poseTex[n]?.length, want);
  }

  /** Кадры позы с учётом выбранного варианта. */
  private poseFrames(a: Actor, name: PoseName): Tex[] {
    const choice = a.poseChoice[name] ?? 0;
    return (choice > 0 ? a.poseAlt[name]?.[choice - 1] : undefined) ?? (a.poseTex[name] as Tex[]);
  }

  /** Кадр позы: серия действия идёт один раз и держит последний кадр, серия стойки качается туда-обратно. */
  private poseFrame(a: Actor, name: PoseName): { tex: Tex; index: number } {
    const list = this.poseFrames(a, name);
    const n = list.length;
    if (n <= 1) return { tex: list[0] as Tex, index: 0 };
    const fps = a.posePack?.fps ?? 12;
    const t = Math.max(0, (this.time - a.poseAt) * this.speed);
    if (name === 'idle' || name === 'wounded' || name === 'prepare') {
      const period = 2 * (n - 1);
      let k = Math.floor(t * Math.min(fps, 4)) % period;
      if (k >= n) k = period - k;
      return { tex: list[k] as Tex, index: k };
    }
    const k = Math.min(n - 1, Math.floor(t * fps));
    return { tex: list[k] as Tex, index: k };
  }

  /** Маска свечения текущего кадра (только у основного варианта позы); пульсацию добавляет шейдер. */
  private poseGlowFrame(a: Actor, name: PoseName): { tex: Tex; strength: number; color: Rgb } | null {
    if ((a.poseChoice[name] ?? 0) > 0) return null;
    const list = a.poseGlow[name];
    if (!list?.length) return null;
    const { index } = this.poseFrame(a, name);
    const pack = a.posePack;
    const dying = a.dead ? 1 - Math.min(1, a.p.dissolve * 1.5) : 1;
    return {
      tex: list[Math.min(list.length - 1, index)] as Tex,
      strength: (pack?.glowStrength ?? 1) * 1.4 * dying,
      color: (pack?.glowColor as Rgb | undefined) ?? (a.phase2 ? SPECTRAL : ASH),
    };
  }

  /** Сменить позу (если у персонажа есть набор поз). Если у позы есть варианты — выбрать случайный, не повторяя подряд. */
  setPose(id: string, name: PoseName): void {
    const a = this.actors.get(id);
    if (!a || (!a.spec.poses && !a.spec.poses2)) return;
    const posed = !!a.posePack;
    const beforeName = posed ? this.shownPose(a) : a.pose;
    const beforeTex = posed ? this.poseFrame(a, beforeName).tex : null;
    const beforeChoice = a.poseChoice[name] ?? 0;
    a.pose = name;
    const alts = a.poseAlt[name]?.length ?? 0;
    if (alts > 0) {
      let pick = Math.floor(Math.random() * (alts + 1));
      if (pick === beforeChoice) pick = (pick + 1 + Math.floor(Math.random() * alts)) % (alts + 1);
      a.poseChoice[name] = pick;
    }
    const after = posed ? this.shownPose(a) : name;
    if (after !== beforeName || (a.poseChoice[name] ?? 0) !== beforeChoice) {
      a.prevTex = beforeTex;
      a.poseAt = this.time;
    }
  }

  /** Раненая стойка при низком здоровье (смена — с тем же «призраком», что и у остальных поз). */
  setWounded(id: string, wounded: boolean): void {
    const a = this.actors.get(id);
    if (!a || a.wounded === wounded) return;
    if (!a.posePack) {
      a.wounded = wounded;
      return;
    }
    const beforeName = this.shownPose(a);
    const beforeTex = this.poseFrame(a, beforeName).tex;
    a.wounded = wounded;
    if (this.shownPose(a) !== beforeName) {
      a.prevTex = beforeTex;
      a.poseAt = this.time;
    }
  }

  // ---------- Листы эффектов художника ----------

  /** Проиграть лист эффекта (если он есть в поставке): центр в (x, y), высота кадра = size × scale листа. */
  playVfx(id: VfxId, x: number, y: number, size: number, flip = false, rot = 0): void {
    if (this.fast || !this.setup.vfx?.[id] || !this.vfxTex[id]?.length) return;
    this.vfxActive.push({ id, t: 0, x, y, size, flip, rot });
  }

  private drawVfx(): void {
    const byTex = new Map<Tex, { additive: QuadDraw[]; normal: QuadDraw[] }>();
    for (const v of this.vfxActive) {
      const pack = this.setup.vfx?.[v.id];
      const pages = this.vfxTex[v.id];
      if (!pack || !pages?.length) continue;
      const first = pages[0] as Tex;
      const cols = Math.max(1, Math.floor(first.w / pack.frameWidth));
      const rows = Math.max(1, Math.floor(first.h / pack.frameHeight));
      const frame = Math.min(pack.frames - 1, Math.floor(v.t * pack.fps));
      const tex = pages[Math.min(pages.length - 1, Math.floor(frame / (cols * rows)))] as Tex;
      const local = frame % (cols * rows);
      const fx = (local % cols) * pack.frameWidth;
      const fy = Math.floor(local / cols) * pack.frameHeight;
      const h = v.size * (pack.scale ?? 1);
      const w = (h * pack.frameWidth) / pack.frameHeight;
      const u0 = fx / tex.w;
      const u1 = (fx + pack.frameWidth) / tex.w;
      const q: QuadDraw = { x: v.x, y: v.y, w, h, rot: v.rot, r: 1, g: 1, b: 1, a: 1, uv: v.flip ? [u1, fy / tex.h, u0, (fy + pack.frameHeight) / tex.h] : [u0, fy / tex.h, u1, (fy + pack.frameHeight) / tex.h], additive: pack.additive !== false };
      const bucket = byTex.get(tex) ?? { additive: [], normal: [] };
      (q.additive ? bucket.additive : bucket.normal).push(q);
      byTex.set(tex, bucket);
    }
    for (const [tex, { additive, normal }] of byTex) {
      if (normal.length) this.backend.drawQuads(tex, normal);
      if (additive.length) this.backend.drawQuads(tex, additive);
    }
  }

  // ---------- Камера и стоп-кадр ----------

  private restCam(): { z: number; x: number; y: number } {
    return { z: 1, x: (this.cssW * this.dpr) / 2, y: this.cssH * this.dpr * 0.62 };
  }

  private view(): { z: number; x: number; y: number } {
    return { z: this.cam.z * (1 + this.camPunch), x: this.cam.x, y: this.cam.y };
  }

  /** Камера наезжает на пару «атакующий — цель» (как в Darkest Dungeon), без потери обоих из кадра. */
  focusCam(aId: string, tId: string, zoom = 1.06): void {
    if (this.fast || this.setup.showcase) return;
    const a = this.actors.get(aId);
    const t = this.actors.get(tId);
    if (!a || !t) return;
    const W = this.cssW * this.dpr;
    const H = this.cssH * this.dpr;
    const x = (a.x + t.x) / 2;
    const y = (a.y - a.h * 0.45 + t.y - t.h * 0.45) / 2;
    // Не уводим центр дальше, чем позволяет масштаб: края фона не должны показаться.
    const mx = W * 0.5 * (1 - 1 / zoom) * 2.2;
    this.camGoal = { z: zoom, x: Math.max(W / 2 - mx, Math.min(W / 2 + mx, x)), y: Math.max(H * 0.3, Math.min(H * 0.75, y)) };
  }

  releaseCam(): void {
    this.camGoal = this.restCam();
  }

  /** Толчок камеры и стоп-кадр в момент удара: главное, что даёт удару «вес». */
  impactFeel(strength: 'light' | 'heavy' | 'crit'): void {
    if (this.fast) return;
    const ms = strength === 'crit' ? 140 : strength === 'heavy' ? 105 : 60;
    this.freezeUntil = Math.max(this.freezeUntil, performance.now() + ms / Math.max(1, this.speed * 0.75));
    this.camPunch = Math.max(this.camPunch, strength === 'crit' ? 0.07 : strength === 'heavy' ? 0.05 : 0.028);
  }

  // ---------- Взаимодействие ----------

  hitTest(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const v = this.view();
    const x = ((clientX - rect.left) * this.dpr - v.x) / v.z + v.x;
    const y = ((clientY - rect.top) * this.dpr - v.y) / v.z + v.y;
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
    this.play(actorId, 'attack');
    this.setPose(actorId, 'windup');
    this.focusCam(actorId, targetId, heavy ? 1.08 : 1.06);
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
    this.playVfx('slash', c.x, c.y, t.h * (heavy ? 1.2 : 0.95), dir < 0);
    this.setPose(actorId, 'strike');
    this.impactFeel(heavy || a.spec.boss ? 'heavy' : 'light');
    impact();
    await this.wait(heavy ? 160 : 110);
    let back = false;
    await this.tween(300, (k) => {
      if (!back && k > 0.45) {
        back = true;
        this.setPose(actorId, 'idle');
        this.releaseCam();
      }
      a.p.offX = dx * (1 - k);
      a.p.offY = dy * (1 - k);
      a.p.lean = 0.16 * dir * (1 - k);
      a.p.sx = 1.05 - 0.05 * k;
      a.p.sy = 0.96 + 0.04 * k;
    }, ease.outCubic);
    a.p.lean = 0;
    a.p.sx = 1;
    a.p.sy = 1;
    this.setPose(actorId, 'idle');
    this.releaseCam();
  }

  /** Прыжок волка: дуга к цели и обратно. */
  async pounce(actorId: string, targetId: string, impact: () => void): Promise<void> {
    const a = this.actor(actorId);
    const t = this.actor(targetId);
    const dir = a.dir();
    const dx = (t.x - a.x) + t.w * 0.45 * -dir;
    const dy = t.y - a.y;
    this.play(actorId, 'attack');
    this.setPose(actorId, 'windup');
    this.focusCam(actorId, targetId, 1.06);
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
    this.playVfx('slash', c.x, c.y, t.h * 0.9, dir < 0);
    this.setPose(actorId, 'strike');
    this.impactFeel('light');
    impact();
    await this.tween(340, (k) => {
      a.p.offX = dx * (1 - k);
      a.p.offY = dy * (1 - k) - Math.sin(Math.PI * k) * a.h * 0.25;
      a.p.sy = 1;
      a.p.rot = 0;
    }, ease.outCubic);
    this.setPose(actorId, 'idle');
    this.releaseCam();
  }

  /** Выстрел: натяжение, снаряд по дуге, попадание (impact). */
  async shoot(actorId: string, targetId: string, kind: 'arrow' | 'bolt' | 'ash' | 'light', impact: () => void, empowered = false): Promise<void> {
    const a = this.actor(actorId);
    const t = this.actor(targetId);
    const dir = a.dir();
    const color: Rgb = kind === 'ash' ? ASH : kind === 'light' ? [0.7, 0.85, 1] : empowered ? GOLD : [1, 0.95, 0.85];
    this.play(actorId, 'shoot');
    this.setPose(actorId, 'aim');
    if (empowered) this.focusCam(actorId, targetId, 1.05);
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
    // Выпуск и отдача.
    this.setPose(actorId, 'shoot');
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
    if (kind === 'ash') {
      this.glowFx(to.x, to.y, t.w * 1.6, ASH, 0.5);
      this.playVfx('ashBurst', to.x, to.y, t.h * 0.9);
    }
    if (empowered) this.impactFeel('heavy');
    impact();
    await this.tween(200, (k) => {
      a.p.offX = -6 * this.dpr * dir * (1 - k);
    });
    a.p.offX = 0;
    a.p.lean = 0;
    this.setPose(actorId, 'idle');
    this.releaseCam();
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
    if (!t.dead) {
      this.play(targetId, 'hit');
      this.setPose(targetId, 'hit');
      void this.wait(heavy ? 420 : 340).then(() => {
        if (!t.dead && t.pose === 'hit') this.setPose(targetId, 'idle');
      });
    }
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
    this.play(targetId, 'death');
    this.setPose(targetId, 'down');
    if (t.spec.side === 'hero') {
      t.fallen = true;
      if (t.spec.poses) {
        // Лежачая поза уже нарисована: только гаснут цвет и яркость.
        await this.tween(600, (k) => {
          t.p.desat = 0.55 * k;
          t.p.alpha = 1 - 0.15 * k;
        });
        return;
      }
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
    this.setPose(targetId, 'idle');
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
    this.play(actorId, 'cast');
    this.setPose(actorId, 'cast');
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
    this.setPose(actorId, 'idle');
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
    this.playVfx('heal', c.x, t.y - t.h * 0.5, t.h * 1.1);
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
    this.playVfx('cover', to.x, to.y, t.h);
    t.status.cover = true;
  }

  /** Подготовка телеграфа: стойка с удержанием и цветное свечение; держится до удара. */
  async prepare(actorId: string, color: Rgb): Promise<void> {
    const a = this.actor(actorId);
    a.status.charging = color;
    this.play(actorId, 'prepare');
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
    this.setPose(actorId, 'strike');
    this.impactFeel('crit');
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
        const tc = t.chest();
        this.playVfx('wave', tc.x, tc.y, t.h);
        impactAt(t.spec.id);
      });
    }
    await this.wait(800);
    await this.tween(300, (k) => {
      a.p.sy = 1.06 - 0.06 * k;
      a.p.lean = -0.08 * a.dir() * (1 - k);
    });
    this.setPose(actorId, 'idle');
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
    // Финальный арт II фазы от художника заменяет модель; процедурное свечение тогда не накладывается.
    if (a.spec.anim2 && a.animTex2.length) {
      a.anim = a.spec.anim2;
      a.animTex = a.animTex2;
      a.clip = null;
    }
    if (a.spec.rig2 && a.rigAtlas2) {
      a.rig = a.spec.rig2;
      a.rigAtlas = a.rigAtlas2;
      a.clip = null;
    }
    if (a.spec.poses2 && a.poseTex2.idle?.length) {
      a.posePack = a.spec.poses2;
      a.poseTex = a.poseTex2;
      a.poseGlow = a.poseGlow2;
      a.poseAlt = a.poseAlt2;
      a.poseChoice = {};
      a.prevTex = null;
      // Холст II фазы может отличаться — пересчитать размеры.
      this.layout();
    }
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
      this.play(id, 'victory');
      this.setPose(id, 'victory');
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

  /** Витрина: периодически проигрывает жест умения, чтобы фигура «жила» и между вдохами. */
  showcaseLoop(id: string, color: Rgb): void {
    const tick = async () => {
      if (this.destroyed) return;
      await this.gesture(id, color);
      if (!this.destroyed) window.setTimeout(() => void tick(), 4200);
    };
    window.setTimeout(() => void tick(), 1200);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    for (const t of this.tweens) t.resolve();
    for (const p of this.projectiles) p.resolve();
    this.tweens = [];
    this.projectiles = [];
    for (const a of this.actors.values()) if (a.rigTarget) this.backend.disposeTarget(a.rigTarget);
    this.backend.destroy();
    this.canvas.remove();
  }

  /** Досчёт боя: все текущие анимации мгновенно завершаются. */
  finishAll(): void {
    this.fast = true;
    this.freezeUntil = 0;
    this.camPunch = 0;
    this.releaseCam();
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
    if (alive && a.pose === 'down') a.pose = 'idle';
  }

  setPhase2(id: string): void {
    const a = this.actors.get(id);
    if (a && !a.phase2) this.enterPhase2Visuals(a, true);
  }

  stats(): { backend: string; actors: number; particles: number; errors: string[]; units: Array<{ id: string; x: number; offX: number; alpha: number; dissolve: number; clip: string | null; pose: PoseName | null; anim: boolean }> } {
    return {
      backend: this.backend.kind,
      actors: this.actors.size,
      particles: this.particles.length,
      errors: [...this.errors],
      units: [...this.actors.values()].map((a) => ({ id: a.spec.id, x: Math.round(a.x), offX: Math.round(a.p.offX), alpha: a.p.alpha, dissolve: a.p.dissolve, clip: a.clip?.name ?? null, pose: a.posePack ? this.shownPose(a) : null, anim: !!a.anim })),
    };
  }
}

function mulMat(p: [number, number, number, number, number, number], c: [number, number, number, number, number, number]): [number, number, number, number, number, number] {
  return [p[0] * c[0] + p[2] * c[1], p[1] * c[0] + p[3] * c[1], p[0] * c[2] + p[2] * c[3], p[1] * c[2] + p[3] * c[3], p[0] * c[4] + p[2] * c[5] + p[4], p[1] * c[4] + p[3] * c[5] + p[5]];
}
