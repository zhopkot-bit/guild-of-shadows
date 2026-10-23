import { ROSTER, identityDef } from '../content/roster';
import { MAX_TICKETS } from './config';
import type { GameState, Hero, HeroIdentity } from './types';

/**
 * v1 — исходный формат (роли warrior/mage/rogue/priest, без identity).
 * v2 — канонические роли и личности героев (миграция в save.ts).
 */
export const SAVE_VERSION = 2;

export function dayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Выдаёт следующий сид и сдвигает счётчик. Состояние остаётся единственным источником случайности. */
export function nextSeed(state: GameState): number {
  state.seedCounter += 1;
  // Смешиваем счётчик с временем создания, чтобы у разных игроков сиды различались.
  return ((state.createdAt >>> 0) ^ Math.imul(state.seedCounter, 0x9e3779b1)) >>> 0;
}

/** Добавляет в гильдию канонического героя. Имя, роль и арт берутся из реестра, а не из случайной таблицы. */
export function createCanonHero(state: GameState, identity: HeroIdentity): Hero {
  const def = identityDef(identity);
  const hero: Hero = {
    id: `h${state.nextHeroId}`,
    name: def.name,
    cls: def.role,
    identity,
    rarity: 'common',
    level: 1,
    status: 'ready',
    woundedUntil: 0,
    portrait: 1,
  };
  state.nextHeroId += 1;
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
  // Канонический стартовый ростер GDD v1.1 §8.3: Бран, Мира, Рук, Нора; в отряде трое.
  for (const def of ROSTER) createCanonHero(state, def.identity);
  // Стартовый отряд закрывает три функции: защита, урон с дистанции, лечение.
  state.party = state.heroes.filter((h) => h.identity !== 'mira').map((h) => h.id);
  return state;
}
