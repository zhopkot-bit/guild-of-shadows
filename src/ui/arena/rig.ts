/**
 * Минимальный рантайм скелетной (cutout) анимации в формате DragonBones 5.x (JSON).
 * Редактор DragonBones бесплатный, формат открытый — лицензия рантайма не нужна.
 *
 * Поддерживается: иерархия костей (x, y, skX, skY, scX, scY), слоты с изображениями из атласа
 * (`*_tex.json`, без поворота подтекстур), анимации костей translate/rotate/scale (ступенька или линейно),
 * видимость/прозрачность слотов (displayFrame, colorFrame aM), события кадров (например «impact»).
 * Не поддерживается: деформация мешей (FFD), IK, вложенные арматуры — валидатор сообщает об этом.
 */

export type Mat = [number, number, number, number, number, number];

export interface DbTransform {
  x?: number;
  y?: number;
  skX?: number;
  skY?: number;
  scX?: number;
  scY?: number;
}

interface DbFrame {
  duration?: number;
  tweenEasing?: number | null;
  x?: number;
  y?: number;
  rotate?: number;
  value?: number | { aM?: number };
  events?: Array<{ name: string }>;
  event?: string;
}

export interface DbArmature {
  name: string;
  frameRate?: number;
  /** Full swept animation bounds (includes sword arc), used only for drawing. */
  aabb?: { x: number; y: number; width: number; height: number };
  /** Resting character bounds; independent of animation sweeps. */
  layoutAabb?: { x: number; y: number; width: number; height: number };
  bone: Array<{ name: string; parent?: string; transform?: DbTransform }>;
  slot: Array<{ name: string; parent: string; displayIndex?: number; color?: { aM?: number } }>;
  skin: Array<{ slot: Array<{ name: string; display: Array<{ name: string; type?: string; transform?: DbTransform }> }> }>;
  animation?: Array<{
    name: string;
    duration?: number;
    playTimes?: number;
    bone?: Array<{ name: string; translateFrame?: DbFrame[]; rotateFrame?: DbFrame[]; scaleFrame?: DbFrame[] }>;
    slot?: Array<{ name: string; displayFrame?: DbFrame[]; colorFrame?: DbFrame[] }>;
    frame?: DbFrame[];
  }>;
}

export interface DbSkeleton {
  frameRate?: number;
  armature: DbArmature[];
}

export interface DbAtlas {
  imagePath: string;
  width?: number;
  height?: number;
  SubTexture: Array<{ name: string; x: number; y: number; width: number; height: number; frameX?: number; frameY?: number; frameWidth?: number; frameHeight?: number; rotated?: boolean }>;
}

/** Часть персонажа к отрисовке: аффинная матрица мира и прямоугольник изображения в локальных координатах. */
export interface RigPart {
  m: Mat;
  x0: number;
  y0: number;
  w: number;
  h: number;
  uv: [number, number, number, number];
  alpha: number;
}

const D2R = Math.PI / 180;

export function localMatrix(t: DbTransform): Mat {
  const skX = (t.skX ?? 0) * D2R;
  const skY = (t.skY ?? 0) * D2R;
  const scX = t.scX ?? 1;
  const scY = t.scY ?? 1;
  return [Math.cos(skY) * scX, Math.sin(skY) * scX, -Math.sin(skX) * scY, Math.cos(skX) * scY, t.x ?? 0, t.y ?? 0];
}

export function mul(p: Mat, c: Mat): Mat {
  return [
    p[0] * c[0] + p[2] * c[1],
    p[1] * c[0] + p[3] * c[1],
    p[0] * c[2] + p[2] * c[3],
    p[1] * c[2] + p[3] * c[3],
    p[0] * c[4] + p[2] * c[5] + p[4],
    p[1] * c[4] + p[3] * c[5] + p[5],
  ];
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Значение таймлайна в момент t (в кадрах). tweenEasing null/undefined — ступенька, число — линейно. */
export function sampleTimeline<T>(frames: DbFrame[] | undefined, t: number, pick: (f: DbFrame) => T, lerp: (a: T, b: T, k: number) => T, fallback: T): T {
  if (!frames || frames.length === 0) return fallback;
  let start = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i] as DbFrame;
    const dur = f.duration ?? 1;
    const next = frames[i + 1];
    if (t < start + dur || !next) {
      if (!next || dur <= 0 || f.tweenEasing === undefined || f.tweenEasing === null) return pick(f);
      return lerp(pick(f), pick(next), Math.min(1, Math.max(0, (t - start) / dur)));
    }
    start += dur;
  }
  return pick(frames[frames.length - 1] as DbFrame);
}

const num = (a: number, b: number, k: number) => a + (b - a) * k;

export class Rig {
  readonly armature: DbArmature;
  readonly frameRate: number;
  readonly aabb: { x: number; y: number; width: number; height: number };
  readonly layoutAabb: { x: number; y: number; width: number; height: number };
  private sub = new Map<string, DbAtlas['SubTexture'][number]>();
  private boneOrder: DbArmature['bone'];

  constructor(ske: DbSkeleton, readonly atlas: DbAtlas, name?: string) {
    const arm = (name ? ske.armature.find((a) => a.name === name) : ske.armature[0]) ?? ske.armature[0];
    if (!arm) throw new Error('В скелете нет арматуры');
    this.armature = arm;
    this.frameRate = arm.frameRate ?? ske.frameRate ?? 24;
    for (const s of atlas.SubTexture) this.sub.set(s.name, s);
    // Кости в порядке иерархии: родитель раньше потомка.
    const placed = new Set<string>();
    const order: DbArmature['bone'] = [];
    let guard = 0;
    while (order.length < arm.bone.length && guard++ < 1000) {
      for (const b of arm.bone) if (!placed.has(b.name) && (!b.parent || placed.has(b.parent))) {
        order.push(b);
        placed.add(b.name);
      }
    }
    this.boneOrder = order;
    this.aabb = arm.aabb ?? this.computeAabb();
    // Legacy rigs stay unchanged until a genuine rest-pose bbox is supplied.
    const standing = arm.layoutAabb ?? this.aabb;
    if (![standing.x, standing.y, standing.width, standing.height].every(Number.isFinite) || standing.width <= 0 || standing.height <= 0) {
      throw new Error('DragonBones: invalid layoutAabb');
    }
    this.layoutAabb = standing;
  }

  animations(): string[] {
    return (this.armature.animation ?? []).map((a) => a.name);
  }

  /** Длительность анимации в секундах и признак цикла. */
  info(name: string): { duration: number; loop: boolean; events: Array<{ name: string; time: number }> } | null {
    const a = this.armature.animation?.find((x) => x.name === name);
    if (!a) return null;
    const events: Array<{ name: string; time: number }> = [];
    let t = 0;
    for (const f of a.frame ?? []) {
      for (const e of f.events ?? []) events.push({ name: e.name, time: t / this.frameRate });
      if (f.event) events.push({ name: f.event, time: t / this.frameRate });
      t += f.duration ?? 1;
    }
    return { duration: (a.duration ?? 1) / this.frameRate, loop: (a.playTimes ?? 1) === 0, events };
  }

  /** Поза в момент time (сек) анимации name; без анимации — исходная поза. */
  pose(name: string | null, time: number): RigPart[] {
    const anim = name ? this.armature.animation?.find((x) => x.name === name) : undefined;
    const t = anim ? time * this.frameRate : 0;
    const world = new Map<string, Mat>();
    for (const b of this.boneOrder) {
      const tl = anim?.bone?.find((x) => x.name === b.name);
      const base = b.transform ?? {};
      const tr = sampleTimeline(tl?.translateFrame, t, (f) => [f.x ?? 0, f.y ?? 0] as [number, number], (p, q, k) => [num(p[0], q[0], k), num(p[1], q[1], k)] as [number, number], [0, 0] as [number, number]);
      const rot = sampleTimeline(tl?.rotateFrame, t, (f) => f.rotate ?? 0, num, 0);
      const sc = sampleTimeline(tl?.scaleFrame, t, (f) => [f.x ?? 1, f.y ?? 1] as [number, number], (p, q, k) => [num(p[0], q[0], k), num(p[1], q[1], k)] as [number, number], [1, 1] as [number, number]);
      const local = localMatrix({
        x: (base.x ?? 0) + tr[0],
        y: (base.y ?? 0) + tr[1],
        skX: (base.skX ?? 0) + rot,
        skY: (base.skY ?? 0) + rot,
        scX: (base.scX ?? 1) * sc[0],
        scY: (base.scY ?? 1) * sc[1],
      });
      const parent = b.parent ? world.get(b.parent) : undefined;
      world.set(b.name, parent ? mul(parent, local) : local);
    }
    const parts: RigPart[] = [];
    const skin = this.armature.skin[0];
    const aw = this.atlas.width ?? 1;
    const ah = this.atlas.height ?? 1;
    for (const slot of this.armature.slot) {
      const stl = anim?.slot?.find((x) => x.name === slot.name);
      const index = sampleTimeline(stl?.displayFrame, t, (f) => (typeof f.value === 'number' ? f.value : 0), (a) => a, slot.displayIndex ?? 0);
      if (index < 0) continue;
      const alpha = sampleTimeline(stl?.colorFrame, t, (f) => (typeof f.value === 'object' ? (f.value.aM ?? 100) : 100) / 100, num, (slot.color?.aM ?? 100) / 100);
      if (alpha <= 0.001) continue;
      const disp = skin?.slot.find((s) => s.name === slot.name)?.display[index];
      if (!disp || (disp.type && disp.type !== 'image')) continue;
      const st = this.sub.get(disp.name);
      const bone = world.get(slot.parent);
      if (!st || !bone) continue;
      const fw = st.frameWidth ?? st.width;
      const fh = st.frameHeight ?? st.height;
      parts.push({
        m: mul(bone, localMatrix(disp.transform ?? {})),
        x0: -fw / 2 - (st.frameX ?? 0),
        y0: -fh / 2 - (st.frameY ?? 0),
        w: st.width,
        h: st.height,
        uv: [st.x / aw, st.y / ah, (st.x + st.width) / aw, (st.y + st.height) / ah],
        alpha,
      });
    }
    return parts;
  }

  private computeAabb(): { x: number; y: number; width: number; height: number } {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of this.pose(null, 0)) {
      for (const [cx, cy] of [[p.x0, p.y0], [p.x0 + p.w, p.y0], [p.x0, p.y0 + p.h], [p.x0 + p.w, p.y0 + p.h]] as Array<[number, number]>) {
        const [x, y] = apply(p.m, cx, cy);
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    if (!Number.isFinite(x0)) return { x: -50, y: -100, width: 100, height: 100 };
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
}
