import type { PostId } from './types';

/** Настройки, которые чаще всего придётся крутить при балансе. Всё в одном месте. */

// --- Idle-слой ---
export const COST_GROWTH = 1.15; // рост цены апгрейда поста за уровень
export const INCOME_MILESTONE = 25; // каждые N уровней доход поста удваивается
export const RELICARIUM_BONUS = 0.05; // +5% к золоту за покупку Реликвария
export const OFFLINE_CAP_SEC = 8 * 3600; // сколько офлайна засчитываем бесплатно

// --- Экспедиция ---
export const PARTY_SIZE = 3;
export const MAX_TICKETS = 3;
export const TICKET_REGEN_MS = 45 * 60 * 1000;
export const TICKET_REGEN_MIN_MS = 25 * 60 * 1000;
export const REWARDED_TICKETS_PER_DAY = 3;
export const WOUND_MS = 30 * 60 * 1000;
export const SAFE_EXPEDITIONS = 3; // первые N забегов без гибели героев
/** Множитель HP/АТК врагов в первых забегах (по номеру забега): мягкий вход, затем обычная сложность. */
export const TUTORIAL_ENEMY_SCALE = [0.5, 0.65, 0.85] as const;
export const FATE_BASE = 0.5; // базовый шанс выжить павшему герою
export const FATE_MAX = 0.75;
export const MAX_TIER = 3;
export const MAX_HERO_LEVEL = 20;
/** Потолок уровня героев по глубине открытого подземелья: прокачка упирается в прохождение Экспедиций. */
export const HERO_LEVEL_CAPS = [8, 14, 20] as const;
/** Общий множитель здоровья героев и врагов: удлиняет бои, не меняя баланс сторон. */
export const HP_SCALE = 1.5;
export const LEVEL_STAT_GROWTH = 0.12; // +12% характеристик за уровень
export const MAX_ROUNDS = 40; // защита боя от зацикливания
export const FIRST_RUN_SEED = 1337; // фиксированная карта первого забега

// --- Посты ---
export type PostEffectKind = 'hpPct' | 'atkPct' | 'campHeal' | 'incomePct' | 'ticketRegen' | 'fateBonus';

export interface PostDef {
  id: PostId;
  name: string;
  icon: string;
  blurb: string;
  unlockCost: number;
  baseCost: number;
  baseIncome: number;
  effect: { kind: PostEffectKind; perLevel: number; cap: number; label: string };
}

export const POSTS: readonly PostDef[] = [
  {
    id: 'barracks',
    name: 'Казарма',
    icon: '🛡',
    blurb: 'Тренировочный плац. Крепкие бойцы приносят золото и выносливость отряду.',
    unlockCost: 0,
    baseCost: 10,
    baseIncome: 1,
    effect: { kind: 'hpPct', perLevel: 0.01, cap: 0.5, label: 'HP отряда' },
  },
  {
    id: 'forge',
    name: 'Кузница',
    icon: '⚒',
    blurb: 'Оружие для экспедиций и стабильный доход от заказов.',
    unlockCost: 500,
    baseCost: 400,
    baseIncome: 2,
    effect: { kind: 'atkPct', perLevel: 0.01, cap: 0.5, label: 'АТК отряда' },
  },
  {
    id: 'library',
    name: 'Библиотека магии',
    icon: '📜',
    blurb: 'Гримуары и наставники укрепляют защитные чары отряда.',
    unlockCost: 10_000,
    baseCost: 8_000,
    baseIncome: 20,
    effect: { kind: 'hpPct', perLevel: 0.005, cap: 0.25, label: 'HP отряда' },
  },
  {
    id: 'tavern',
    name: 'Таверна информаторов',
    icon: '🍺',
    blurb: 'Слухи о слабостях чудовищ повышают доход от заказов.',
    unlockCost: 200_000,
    baseCost: 160_000,
    baseIncome: 220,
    effect: { kind: 'incomePct', perLevel: 0.01, cap: 0.5, label: 'доход гильдии' },
  },
  {
    id: 'alchemy',
    name: 'Алхимическая лаборатория',
    icon: '⚗',
    blurb: 'Зелья и эликсиры усиливают отдых в лагере.',
    unlockCost: 5_000_000,
    baseCost: 4_000_000,
    baseIncome: 2_800,
    effect: { kind: 'campHeal', perLevel: 0.005, cap: 0.3, label: 'лечение в лагере' },
  },
];

export function postDef(id: PostId): PostDef {
  const def = POSTS.find((p) => p.id === id);
  if (!def) throw new Error(`Неизвестный пост: ${id}`);
  return def;
}
