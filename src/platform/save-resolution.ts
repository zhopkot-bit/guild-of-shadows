/**
 * Resolves the local and cloud save candidates without silently preferring a stale cloud copy.
 * Rules: valid candidate beats invalid; newer schema wins (older clients must not overwrite it);
 * then newer lastSeen; when timestamps tie, compare deterministic progress signals; finally prefer
 * local because it is written synchronously before the cloud request.
 * This is a conservative tie-breaker, not a merge of individual save fields.
 */
type Raw = Record<string, unknown>;

interface SaveMeta {
  version: number;
  lastSeen: number;
  progress: number[];
}

function record(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function meta(json: string | null): SaveMeta | null {
  if (!json) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!record(value)) return null;
  const version = finite(value.version, -1);
  if (!Number.isInteger(version) || version < 1) return null;

  const posts = record(value.posts) ? value.posts : {};
  const stats = record(value.stats) ? value.stats : {};
  const heroes = Array.isArray(value.heroes) ? value.heroes.filter(record) : [];
  const postLevels = Object.values(posts).reduce<number>((sum, n) => sum + Math.max(0, finite(n)), 0);
  const heroLevels = heroes.reduce<number>((sum, hero) => {
    return sum + (hero.status === 'lost' ? 0 : Math.max(0, finite(hero.level, 1)));
  }, 0);
  const progress = [
    Math.max(0, finite(value.expeditionsCompleted)),
    Math.max(0, finite(value.maxTier, 1)),
    Math.max(0, finite(stats.expeditionsWon)),
    postLevels,
    heroLevels,
    Math.max(0, finite(value.gold)),
    Math.max(0, finite(value.essence)),
  ];
  return { version, lastSeen: finite(value.lastSeen, -1), progress };
}

function compareVector(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

/** Returns the original JSON string; it never rewrites either candidate. */
export function resolveSave(local: string | null, cloud: string | null): string | null {
  if (local === null) return cloud;
  if (cloud === null) return local;

  const l = meta(local);
  const c = meta(cloud);
  if (l === null) return c === null ? local : cloud;
  if (c === null) return local;

  // Highest schema version wins so an older client cannot replace an unknown newer save.
  if (l.version !== c.version) return l.version > c.version ? local : cloud;
  if (l.lastSeen !== c.lastSeen) return l.lastSeen > c.lastSeen ? local : cloud;

  const progress = compareVector(l.progress, c.progress);
  if (progress !== 0) return progress > 0 ? local : cloud;
  return local;
}
