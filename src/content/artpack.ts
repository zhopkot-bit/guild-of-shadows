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

export interface ArenaLayer {
  src: string;
  /** 0 — неподвижный дальний план, 1 — движется вместе с камерой. */
  parallax: number;
  /** Слой переднего плана рисуется поверх бойцов. */
  front?: boolean;
}

export interface ArtPackEntry {
  /** Optional in-game portrait supplied with the art pack. */
  portrait?: string;
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
}

const EMPTY: ArtPackRegistry = { version: 1, heroes: {}, enemies: {}, arenas: {} };
let registry: ArtPackRegistry = EMPTY;
const packs = new Map<string, AnimPack>();
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
  registry = { version: 1, heroes: reg.heroes ?? {}, enemies: reg.enemies ?? {}, arenas: reg.arenas ?? {} };
  const base = override ?? `${ART_ROOT}art-pack.json`;
  // Resolve portrait URLs before the UI constructs character cards.
  for (const group of [registry.heroes, registry.enemies]) {
    for (const e of Object.values(group)) if (e.portrait) e.portrait = resolve(base, e.portrait);
  }
  const entries = [...Object.values(registry.heroes), ...Object.values(registry.enemies)];
  await Promise.all(entries.flatMap((e) => [e.anim, e.phase2Anim]).filter((x): x is string => !!x).map(async (rel) => {
    const u = resolve(base, rel);
    const pack = await fetchJson(u, timeoutMs);
    if (isAnimPack(pack)) packs.set(rel, { ...pack, pageUrls: (pack.pages ?? [pack.image as string]).map((pg) => resolve(u, pg)) });
    else console.error(`Пакет анимации не прошёл проверку: ${u}`);
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

export function artFor(group: 'heroes' | 'enemies', id: string): { anim: AnimPack | null; phase2Sprite: string | null; phase2Anim: AnimPack | null; rig: LoadedRig | null; phase2Rig: LoadedRig | null } {
  const e = registry[group][id];
  return {
    anim: e?.anim ? packs.get(e.anim) ?? null : null,
    phase2Sprite: e?.phase2Sprite ?? null,
    phase2Anim: e?.phase2Anim ? packs.get(e.phase2Anim) ?? null : null,
    rig: e?.rig ? rigs.get(e.rig) ?? null : null,
    phase2Rig: e?.phase2Rig ? rigs.get(e.phase2Rig) ?? null : null,
  };
}

export function arenaLayers(id: string): ArenaLayer[] {
  return registry.arenas[id]?.layers ?? [];
}
