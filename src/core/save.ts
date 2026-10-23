import { MAX_HERO_LEVEL, MAX_TICKETS, MAX_TIER, PARTY_SIZE } from './config';
import { SAVE_VERSION, dayKey, newGame } from './state';
import {
  HERO_CLASSES,
  POST_IDS,
  RARITIES,
  type GameState,
  type Hero,
  type HeroStatus,
  type PostId,
} from './types';

export { SAVE_VERSION };

export type LoadResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: 'empty' | 'corrupt' | 'newer' };

type Raw = Record<string, unknown>;

/**
 * Миграции: ключ N переводит сейв версии N в версию N+1.
 * Когда меняете структуру GameState — увеличьте SAVE_VERSION и добавьте шаг сюда, например:
 *   1: (s) => ({ ...s, newField: 0 }),
 * Старые сейвы игроков при этом продолжают работать.
 */
const MIGRATIONS: Record<number, (save: Raw) => Raw> = {};

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  return Math.round(num(v, fallback, min, max));
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function normalizeHero(raw: unknown, seen: Set<string>, nowMs: number): Hero | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || seen.has(raw.id)) return null;
  seen.add(raw.id);
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name.slice(0, 24) : 'Герой',
    cls: oneOf(raw.cls, HERO_CLASSES, 'warrior'),
    rarity: oneOf(raw.rarity, RARITIES, 'common'),
    level: int(raw.level, 1, 1, MAX_HERO_LEVEL),
    status: raw.status === 'lost' ? 'wounded' : oneOf<HeroStatus>(raw.status, ['ready', 'wounded', 'lost'], 'ready'),
    woundedUntil: raw.status === 'lost' ? nowMs + 30 * 60 * 1000 : num(raw.woundedUntil, 0, 0),
    portrait: int(raw.portrait, 1, 1, 99),
  };
}

/**
 * Приводит произвольный объект к валидному GameState: битые или отсутствующие поля получают
 * значения по умолчанию, NaN и Infinity отбрасываются. Игра не падает от испорченного сейва.
 */
function normalize(raw: Raw, nowMs: number): GameState {
  const base = newGame(nowMs);
  const postsRaw = isObject(raw.posts) ? raw.posts : {};
  const posts = { ...base.posts };
  for (const id of POST_IDS) posts[id as PostId] = int(postsRaw[id], base.posts[id], 0, 10_000);

  const seen = new Set<string>();
  const heroes: Hero[] = [];
  if (Array.isArray(raw.heroes)) {
    for (const h of raw.heroes) {
      const hero = normalizeHero(h, seen, nowMs);
      if (hero) heroes.push(hero);
    }
  }
  const finalHeroes = heroes.length > 0 ? heroes : base.heroes;
  const alive = new Set(finalHeroes.filter((h) => h.status !== 'lost').map((h) => h.id));
  const party = (Array.isArray(raw.party) ? raw.party : [])
    .filter((id): id is string => typeof id === 'string' && alive.has(id))
    .slice(0, PARTY_SIZE);

  const t = isObject(raw.tickets) ? raw.tickets : {};
  const stats = isObject(raw.stats) ? raw.stats : {};
  const createdAt = num(raw.createdAt, nowMs, 0);

  return {
    version: SAVE_VERSION,
    createdAt,
    lastSeen: num(raw.lastSeen, nowMs, 0),
    gold: num(raw.gold, 0, 0),
    essence: num(raw.essence, 0, 0),
    posts,
    relicarium: int(raw.relicarium, 0, 0, 10_000),
    heroes: finalHeroes,
    party: party.length > 0 ? party : finalHeroes.filter((h) => h.status !== 'lost').slice(0, PARTY_SIZE).map((h) => h.id),
    nextHeroId: int(raw.nextHeroId, finalHeroes.length + 1, finalHeroes.length + 1, 1_000_000),
    recruitsBought: int(raw.recruitsBought, 0, 0, 10_000),
    tickets: {
      count: int(t.count, MAX_TICKETS, 0, 99),
      updatedAt: num(t.updatedAt, nowMs, 0),
      rewardedToday: int(t.rewardedToday, 0, 0, 99),
      rewardedDay: typeof t.rewardedDay === 'string' ? t.rewardedDay : dayKey(nowMs),
    },
    expeditionsCompleted: int(raw.expeditionsCompleted, 0, 0, 1_000_000),
    seedCounter: int(raw.seedCounter, 0, 0, 2_000_000_000),
    maxTier: int(raw.maxTier, 1, 1, MAX_TIER),
    stats: {
      expeditionsStarted: int(stats.expeditionsStarted, 0, 0, 1_000_000),
      expeditionsWon: int(stats.expeditionsWon, 0, 0, 1_000_000),
      heroesLost: int(stats.heroesLost, 0, 0, 1_000_000),
    },
    activeRun: typeof raw.activeRun === 'string' ? raw.activeRun : null,
  };
}

export function deserialize(json: string | null, nowMs: number): LoadResult {
  if (json === null || json === '') return { ok: false, reason: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (!isObject(parsed)) return { ok: false, reason: 'corrupt' };

  let version = typeof parsed.version === 'number' ? parsed.version : NaN;
  if (!Number.isInteger(version) || version < 1) return { ok: false, reason: 'corrupt' };
  // Сейв из более новой версии игры не трогаем: иначе перезапись сотрёт прогресс игрока.
  if (version > SAVE_VERSION) return { ok: false, reason: 'newer' };

  let save: Raw = parsed;
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return { ok: false, reason: 'corrupt' };
    save = step(save);
    version += 1;
  }
  return { ok: true, state: normalize(save, nowMs) };
}
