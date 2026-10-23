import { MAX_TICKETS } from './config';
import { RNG } from './rng';
import type { GameState, Hero, HeroClass, Rarity } from './types';

export const SAVE_VERSION = 1;

const NAMES = [
  'Рагнар', 'Мирра', 'Каэль', 'Лиара', 'Торвин', 'Эйла', 'Дрейк', 'Сильвана', 'Горан', 'Нира',
  'Бран', 'Ясна', 'Вальдер', 'Келла', 'Ормунд', 'Тесса', 'Хальдор', 'Ивара', 'Магнус', 'Рейна',
  'Скарн', 'Элиса', 'Кроув', 'Далия', 'Фенрис', 'Агата', 'Орвин', 'Лейла', 'Тарн', 'Весна',
];

export function dayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Выдаёт следующий сид и сдвигает счётчик. Состояние остаётся единственным источником случайности. */
export function nextSeed(state: GameState): number {
  state.seedCounter += 1;
  // Смешиваем счётчик с временем создания, чтобы у разных игроков сиды различались.
  return ((state.createdAt >>> 0) ^ Math.imul(state.seedCounter, 0x9e3779b1)) >>> 0;
}

export function createHero(state: GameState, cls: HeroClass, rarity: Rarity): Hero {
  const rng = new RNG(nextSeed(state));
  const used = new Set(state.heroes.map((h) => h.name));
  const free = NAMES.filter((n) => !used.has(n));
  const name = rng.pick(free.length > 0 ? free : NAMES);
  const id = `h${state.nextHeroId}`;
  state.nextHeroId += 1;
  const hero: Hero = {
    id,
    name,
    cls,
    rarity,
    level: 1,
    status: 'ready',
    woundedUntil: 0,
    portrait: rng.int(1, 3),
  };
  state.heroes.push(hero);
  return hero;
}

export function newGame(nowMs: number): GameState {
  const state: GameState = {
    version: SAVE_VERSION,
    createdAt: nowMs,
    lastSeen: nowMs,
    gold: 0,
    essence: 0,
    posts: { barracks: 1, forge: 0, library: 0, tavern: 0, alchemy: 0 },
    relicarium: 0,
    heroes: [],
    party: [],
    nextHeroId: 1,
    recruitsBought: 0,
    tickets: { count: MAX_TICKETS, updatedAt: nowMs, rewardedToday: 0, rewardedDay: dayKey(nowMs) },
    expeditionsCompleted: 0,
    seedCounter: 0,
    maxTier: 1,
    stats: { expeditionsStarted: 0, expeditionsWon: 0, heroesLost: 0 },
    activeRun: null,
  };
  const warrior = createHero(state, 'warrior', 'common');
  const mage = createHero(state, 'mage', 'common');
  createHero(state, 'rogue', 'common');
  const priest = createHero(state, 'priest', 'common');
  // Канонический стартовый ростер: фиксированные имена делают обучение и баланс воспроизводимыми.
  warrior.name = 'Бран';
  mage.name = 'Мира';
  const rogue = state.heroes.find((h) => h.cls === 'rogue');
  const priestHero = state.heroes.find((h) => h.cls === 'priest');
  if (rogue) rogue.name = 'Рук';
  if (priestHero) priestHero.name = 'Нора';
  state.party = [warrior.id, mage.id, priest.id];
  return state;
}
