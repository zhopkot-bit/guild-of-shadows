import type { Num } from './num';

export type HeroClass = 'warrior' | 'mage' | 'rogue' | 'priest';
export const HERO_CLASSES: readonly HeroClass[] = ['warrior', 'mage', 'rogue', 'priest'];

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export type PostId = 'barracks' | 'forge' | 'library' | 'tavern' | 'alchemy';
export const POST_IDS: readonly PostId[] = ['barracks', 'forge', 'library', 'tavern', 'alchemy'];

export type HeroStatus = 'ready' | 'wounded' | 'lost';

export interface Hero {
  id: string;
  name: string;
  cls: HeroClass;
  rarity: Rarity;
  level: number;
  status: HeroStatus;
  /** Метка времени (мс, по часам платформы), до которой герой ранен. */
  woundedUntil: number;
  /** Номер варианта портрета (для будущего арта: warrior_common_1.webp). */
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
