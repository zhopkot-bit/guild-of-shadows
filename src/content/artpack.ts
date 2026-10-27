import { Rig, type DbAtlas, type DbSkeleton } from '../ui/arena/rig';

/**
 * Реестр финального арта художника (`public/art/v17/art-pack.json`).
 * Если файла нет или запись пустая, игра использует текущие ассеты и процедурную анимацию.
 * Формат описан в ТЗ художнику (docs/ARTIST_BRIEF_RU.md) и проверяется `tools/art/validate_pack.mjs`.
 */

export type ClipName = 'idle' | 'attack' | 'shoot' | 'cast' | 'hit' | 'death' | 'prepare' | 'victory';
export const CLIP_NAMES: readonly ClipName[] = ['idle', 'attack', 'shoot', 'cast', 'hit', 'death', 'prepare', 'victory'];

export interface AnimClip {
  /** Индексы кадров в атласе (слева направо, сверху вниз). */
  frames: number[];
  fps: number;
  loop?: boolean;
  /** Кадр попадания/выпуска снаряда (для синхронизации с правилами), индекс внутри frames. */
  impact?: number;
}

export interface AnimPack {
  version: 1;
  /** Путь к атласу относительно json (одна страница). */
  image?: string;
  /** Несколько страниц атласа одного размера; индексы кадров сквозные. */
  pages?: string[];
  frameWidth: number;
  frameHeight: number;
  /** Точка опоры (ноги) в долях кадра. */
  pivot: [number, number];
  clips: Partial<Record<ClipName, AnimClip>> & { idle: AnimClip };
  /** Разрешённые URL страниц атласа (заполняется загрузчиком). */
  pageUrls?: string[];
}

/**
 * Набор поз: несколько цельных иллюстраций персонажа на холсте одного размера. Движок не «гнёт» картинку,
 * а мгновенно переключает позы на фазах действия и добавляет движение, стоп-кадр удара и камеру.
 * Основной формат для генеративного арта: целую позу сгенерировать согласованно гораздо проще, чем части рига.
 */
export type PoseName = 'idle' | 'wounded' | 'windup' | 'strike' | 'aim' | 'shoot' | 'cast' | 'prepare' | 'hit' | 'down' | 'victory';
export const POSE_NAMES: readonly PoseName[] = ['idle', 'wounded', 'windup', 'strike', 'aim', 'shoot', 'cast', 'prepare', 'hit', 'down', 'victory'];
/** Чем заменить отсутствующую позу (по цепочке, последняя замена — idle). */
export const POSE_FALLBACK: Partial<Record<PoseName, PoseName>> = { wounded: 'idle', aim: 'windup', shoot: 'strike', cast: 'windup', prepare: 'windup', victory: 'idle', down: 'hit', hit: 'idle', windup: 'idle', strike: 'idle' };
/** Доля здоровья, ниже которой стойку сменяет «раненая» (`wounded`). */
export const WOUNDED_HP = 0.3;
export const REQUIRED_POSES: readonly PoseName[] = ['idle', 'windup', 'strike', 'hit', 'down'];

export interface PosePack {
  version: 1;
  frameWidth: number;
  frameHeight: number;
  /** Точка опоры (между ступнями в стойке) в долях холста — одинакова для всех поз. */
  pivot: [number, number];
  /** Доля высоты холста, которую занимает стоящая фигура (запас сверху/сбоку — под оружие и замах). */
  figureHeight: number;
  /** Доля ширины холста под фигуру в стойке (для области выбора и тени); по умолчанию — 0,48 роста. */
  figureWidth?: number;
  /**
   * Картинка позы (путь относительно json) или короткая серия 2–4 картинок. Серия действия проигрывается
   * один раз и держит последний кадр; серия стойки и «готовлю удар» медленно качается туда-обратно.
   */
  poses: Partial<Record<PoseName, string | string[]>> & { idle: string | string[] };
  /** Скорость серий, кадров в секунду (по умолчанию 12). */
  fps?: number;
  /**
   * Маски свечения: на тех же холстах, что и поза; яркость альфы — сила свечения (глаза, клинок, ядро).
   * Серия маски совпадает по длине с серией позы или состоит из одной картинки на все кадры.
   */
  glow?: Partial<Record<PoseName, string | string[]>>;
  /** Цвет свечения (0..1); по умолчанию — тлеющий оранжевый, во II фазе босса — призрачный голубой. */
  glowColor?: [number, number, number];
  /** Сила свечения (по умолчанию 1). */
  glowStrength?: number;
  /** Дополнительные варианты позы (картинка или серия): игра выбирает случайный, не повторяя подряд. */
  alternatives?: Partial<Record<PoseName, Array<string | string[]>>>;
  /** Разрешённые URL (заполняется загрузчиком). */
  poseUrls?: Partial<Record<PoseName, string[]>>;
  glowUrls?: Partial<Record<PoseName, string[]>>;
  altUrls?: Partial<Record<PoseName, string[][]>>;
}

/** Листы эффектов, которые игра проигрывает в конкретных местах боя. */
export type VfxId = 'slash' | 'ashBurst' | 'heal' | 'wave' | 'cover';
export const VFX_IDS: readonly VfxId[] = ['slash', 'ashBurst', 'heal', 'wave', 'cover'];

export interface VfxPack {
  version: 1;
  image?: string;
  pages?: string[];
  frameWidth: number;
  frameHeight: number;
  /** Сколько кадров в листе (по порядку слева направо, сверху вниз, сквозь страницы). */
  frames: number;
  fps: number;
  /** Аддитивное смешивание (свет, огонь) — по умолчанию да; false — обычное (дым, осколки). */
  additive?: boolean;
  /** Множитель размера относительно цели (по умолчанию 1 = рост цели). */
  scale?: number;
  pageUrls?: string[];
}

export function isVfxPack(v: unknown): v is VfxPack {
  if (!v || typeof v !== 'object') return false;
  const p = v as VfxPack;
  return p.version === 1 && (typeof p.image === 'string' || (Array.isArray(p.pages) && p.pages.length > 0))
    && p.frameWidth > 0 && p.frameHeight > 0 && Number.isInteger(p.frames) && p.frames > 0 && p.fps >= 4 && p.fps <= 60
    && (p.scale === undefined || (p.scale > 0 && p.scale <= 4));
}

const asList = (v: string | string[] | undefined): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

export function isPosePack(v: unknown): v is PosePack {
  if (!v || typeof v !== 'object') return false;
  const p = v as PosePack;
  return p.version === 1 && p.frameWidth > 0 && p.frameHeight > 0 && Array.isArray(p.pivot) && p.pivot.length === 2
    && p.figureHeight > 0 && p.figureHeight <= 1 && !!p.poses && asList(p.poses.idle).length > 0
    && (p.fps === undefined || (p.fps >= 2 && p.fps <= 30))
    && (p.glowColor === undefined || (Array.isArray(p.glowColor) && p.glowColor.length === 3 && p.glowColor.every((c) => c >= 0 && c <= 2)))
    && (p.glowStrength === undefined || (p.glowStrength >= 0 && p.glowStrength <= 3));
}

/** Поза, которая реально будет показана: сама или ближайшая замена из имеющихся. */
export function resolvePose(have: (n: PoseName) => boolean, want: PoseName): PoseName {
  let n: PoseName | undefined = want;
  for (let guard = 0; n && guard < 6; guard++) {
    if (have(n)) return n;
    n = POSE_FALLBACK[n];
  }
  return 'idle';
}

export interface ArenaLayer {
  src: string;
  /** 0 — неподвижный дальний план, 1 — движется вместе с камерой. */
  parallax: number;
  /** Слой переднего плана рисуется поверх бойцов. */
  front?: boolean;
}

export interface ArtPackEntry {
  /** Портрет для интерфейса из поставки художника (если облик героя меняется). */
  portrait?: string;
  /** Набор поз (`*_poses.json`) — основной формат для генеративного арта. */
  poses?: string;
  /** Набор поз II фазы босса. */
  phase2Poses?: string;
  /** Другой облик для двойников (враг «Б», «В»…): пути к наборам поз по порядку. */
  posesVariants?: string[];
  anim?: string;
  /** Скелет DragonBones (`*_ske.json`) и его атлас (`*_tex.json`). */
  rig?: string;
  rigAtlas?: string;
  rigArmature?: string;
  phase2Rig?: string;
  phase2RigAtlas?: string;
  /** Отдельный спрайт/анимация II фазы босса. */
  phase2Sprite?: string;
  phase2Anim?: string;
}

export interface ArtPackRegistry {
  version: 1;
  heroes: Record<string, ArtPackEntry>;
  enemies: Record<string, ArtPackEntry>;
  arenas: Record<string, { layers: ArenaLayer[] }>;
  /** Листы эффектов умений (путь к json листа). */
  vfx?: Partial<Record<VfxId, string>>;
}

const EMPTY: ArtPackRegistry = { version: 1, heroes: {}, enemies: {}, arenas: {} };
let registry: ArtPackRegistry = EMPTY;
const packs = new Map<string, AnimPack>();
const posePacks = new Map<string, PosePack>();
const vfxPacks: Partial<Record<VfxId, VfxPack>> = {};
export interface LoadedRig {
  rig: Rig;
  atlasUrl: string;
}
const rigs = new Map<string, LoadedRig>();
const ART_ROOT = './art/v17/';

function resolve(base: string, rel: string): string {
  if (/^(\.\/|\/|https?:)/.test(rel)) return rel;
  return base.replace(/[^/]*$/, '') + rel;
}

export function isAnimPack(v: unknown): v is AnimPack {
  if (!v || typeof v !== 'object') return false;
  const p = v as AnimPack;
  return p.version === 1 && (typeof p.image === 'string' || (Array.isArray(p.pages) && p.pages.length > 0)) && p.frameWidth > 0 && p.frameHeight > 0
    && Array.isArray(p.pivot) && !!p.clips && !!p.clips.idle && Array.isArray(p.clips.idle.frames) && p.clips.idle.frames.length > 0;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-cache' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(t);
  }
}

/** Загружает реестр и все объявленные пакеты анимаций. Ошибки не ломают игру: вернётся пустой реестр. */
export async function loadArtPack(timeoutMs = 2500): Promise<ArtPackRegistry> {
  const override = new URLSearchParams(window.location.search).get('artpack');
  const url = override ?? `${ART_ROOT}art-pack.json`;
  const raw = await fetchJson(url, timeoutMs);
  if (!raw || typeof raw !== 'object' || (raw as ArtPackRegistry).version !== 1) return registry;
  const reg = raw as ArtPackRegistry;
  registry = { version: 1, heroes: reg.heroes ?? {}, enemies: reg.enemies ?? {}, arenas: reg.arenas ?? {}, vfx: reg.vfx ?? {} };
  const base = override ?? `${ART_ROOT}art-pack.json`;
  // Resolve portrait URLs before the UI constructs character cards.
  for (const group of [registry.heroes, registry.enemies]) {
    for (const e of Object.values(group)) {
      if (e.portrait) e.portrait = new URL(e.portrait, new URL(base, window.location.href)).href;
    }
  }
  const entries = [...Object.values(registry.heroes), ...Object.values(registry.enemies)];
  await Promise.all(entries.flatMap((e) => [e.anim, e.phase2Anim]).filter((x): x is string => !!x).map(async (rel) => {
    const u = resolve(base, rel);
    const pack = await fetchJson(u, timeoutMs);
    if (isAnimPack(pack)) packs.set(rel, { ...pack, pageUrls: (pack.pages ?? [pack.image as string]).map((pg) => resolve(u, pg)) });
    else console.error(`Пакет анимации не прошёл проверку: ${u}`);
  }));
  await Promise.all(entries.flatMap((e) => [e.poses, e.phase2Poses, ...(e.posesVariants ?? [])]).filter((x): x is string => !!x).map(async (rel) => {
    const u = resolve(base, rel);
    const pack = await fetchJson(u, timeoutMs);
    if (!isPosePack(pack)) {
      console.error(`Набор поз не прошёл проверку: ${u}`);
      return;
    }
    const poseUrls: Partial<Record<PoseName, string[]>> = {};
    const glowUrls: Partial<Record<PoseName, string[]>> = {};
    const altUrls: Partial<Record<PoseName, string[][]>> = {};
    for (const n of POSE_NAMES) {
      const list = asList(pack.poses[n]);
      if (list.length) poseUrls[n] = list.map((x) => resolve(u, x));
      const glow = asList(pack.glow?.[n]);
      if (list.length && glow.length) glowUrls[n] = glow.map((x) => resolve(u, x));
      const alts = (pack.alternatives?.[n] ?? []).map((a) => asList(a)).filter((a) => a.length);
      if (list.length && alts.length) altUrls[n] = alts.map((a) => a.map((x) => resolve(u, x)));
    }
    posePacks.set(rel, { ...pack, poseUrls, glowUrls, altUrls });
  }));
  await Promise.all((Object.entries(registry.vfx ?? {}) as Array<[VfxId, string]>).filter(([id]) => VFX_IDS.includes(id)).map(async ([id, rel]) => {
    const u = resolve(base, rel);
    const pack = await fetchJson(u, timeoutMs);
    if (isVfxPack(pack)) vfxPacks[id] = { ...pack, pageUrls: (pack.pages ?? [pack.image as string]).map((pg) => resolve(u, pg)) };
    else console.error(`Лист эффекта не прошёл проверку: ${u}`);
  }));
  // Скелеты DragonBones.
  await Promise.all(entries.flatMap((e) => [[e.rig, e.rigAtlas, e.rigArmature], [e.phase2Rig, e.phase2RigAtlas, e.rigArmature]] as Array<[string | undefined, string | undefined, string | undefined]>)
    .filter(([s, a]) => !!s && !!a)
    .map(async ([ske, atl, arm]) => {
      const su = resolve(base, ske as string);
      const au = resolve(base, atl as string);
      const [sj, aj] = await Promise.all([fetchJson(su, timeoutMs), fetchJson(au, timeoutMs)]);
      try {
        if (!sj || !aj) throw new Error('файл не загрузился');
        const atlas = aj as DbAtlas;
        rigs.set(ske as string, { rig: new Rig(sj as DbSkeleton, atlas, arm), atlasUrl: resolve(au, atlas.imagePath) });
      } catch (e) {
        console.error(`Скелет не загружен: ${su}`, e);
      }
    }));
  for (const e of entries) {
    if (e.phase2Sprite) e.phase2Sprite = resolve(base, e.phase2Sprite);
  }
  for (const a of Object.values(registry.arenas)) for (const l of a.layers) l.src = resolve(base, l.src);
  return registry;
}

export function artPortraitFor(group: 'heroes' | 'enemies', id: string): string | null {
  return registry[group][id]?.portrait ?? null;
}

export function artFor(group: 'heroes' | 'enemies', id: string): { poses: PosePack | null; phase2Poses: PosePack | null; posesVariants: PosePack[]; anim: AnimPack | null; phase2Sprite: string | null; phase2Anim: AnimPack | null; rig: LoadedRig | null; phase2Rig: LoadedRig | null } {
  const e = registry[group][id];
  return {
    poses: e?.poses ? posePacks.get(e.poses) ?? null : null,
    phase2Poses: e?.phase2Poses ? posePacks.get(e.phase2Poses) ?? null : null,
    posesVariants: (e?.posesVariants ?? []).map((rel) => posePacks.get(rel)).filter((x): x is PosePack => !!x),
    anim: e?.anim ? packs.get(e.anim) ?? null : null,
    phase2Sprite: e?.phase2Sprite ?? null,
    phase2Anim: e?.phase2Anim ? packs.get(e.phase2Anim) ?? null : null,
    rig: e?.rig ? rigs.get(e.rig) ?? null : null,
    phase2Rig: e?.phase2Rig ? rigs.get(e.phase2Rig) ?? null : null,
  };
}

/** Загруженные листы эффектов умений. */
export function vfxPacksLoaded(): Partial<Record<VfxId, VfxPack>> {
  return { ...vfxPacks };
}

export function arenaLayers(id: string): ArenaLayer[] {
  return registry.arenas[id]?.layers ?? [];
}
