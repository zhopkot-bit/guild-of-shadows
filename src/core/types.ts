import type { Num } from './num';

/** Боевые роли по Content Bible v1.1 / Combat Spec v0.3 (ROLE_DEFENDER, ROLE_SCOUT, ROLE_SHOOTER, ROLE_HEALER). */
export type HeroClass = 'defender' | 'scout' | 'shooter' | 'healer';
export type HeroRole = HeroClass;
export const HERO_CLASSES: readonly HeroClass[] = ['defender', 'scout', 'shooter', 'healer'];

/** Личность канонического героя. Портрет и спрайт выбираются по ней, а не по роли. */
export type HeroIdentity = 'bran' | 'mira' | 'rook' | 'nora';
export const HERO_IDENTITIES: readonly HeroIdentity[] = ['bran', 'mira', 'rook', 'nora'];

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export type PostId = 'barracks' | 'forge' | 'library' | 'tavern' | 'alchemy';
export const POST_IDS: readonly PostId[] = ['barracks', 'forge', 'library', 'tavern', 'alchemy'];

export type HeroStatus = 'ready' | 'wounded' | 'lost';

export interface Hero {
  id: string;
  name: string;
  /** Роль героя (поле сохранило старое имя ради совместимости сейвов). */
  cls: HeroClass;
  /** Канонический персонаж; null — безымянный новобранец из старых сейвов (без чужого лица). */
  identity: HeroIdentity | null;
  rarity: Rarity;
  level: number;
  status: HeroStatus;
  /** Метка времени (мс, по часам платформы), до которой герой ранен. */
  woundedUntil: number;
  /** Устаревший номер варианта портрета; не влияет на выбор арта (см. content/roster.ts). */
  portrait: number;
}

export interface TicketState {
  count: number;
  /** Метка времени (мс), от которой отсчитывается следующий жетон. */
  updatedAt: number;
  rewardedToday: number;
  /** Дата (UTC, YYYY-MM-DD), к которой относится rewardedToday. */
  rewardedDay: string;
}

export interface Stats {
  expeditionsStarted: number;
  expeditionsWon: number;
  heroesLost: number;
}

export interface GameState {
  version: number;
  createdAt: number;
  lastSeen: number;
  gold: Num;
  essence: Num;
  /** Уровни постов; 0 — не открыт. */
  posts: Record<PostId, number>;
  /** Сколько раз куплен Реликварий. */
  relicarium: number;
  heroes: Hero[];
  /** id героев в отряде (до 3). */
  party: string[];
  nextHeroId: number;
  recruitsBought: number;
  tickets: TicketState;
  /** Завершённых экспедиций — для онбординга и защиты от смерти в первых забегах. */
  expeditionsCompleted: number;
  /** Счётчик для сидов (забеги, имена): растёт при каждом использовании. */
  seedCounter: number;
  /** Самое глубокое открытое подземелье (1..). */
  maxTier: number;
  stats: Stats;
  /** Сериализованный активный забег; строка изолирует модель сохранения от runtime-классов боя. */
  activeRun: string | null;
}
