import {
  COST_GROWTH,
  HERO_LEVEL_CAPS,
  INCOME_MILESTONE,
  MAX_TICKETS,
  OFFLINE_CAP_SEC,
  POSTS,
  RELICARIUM_BONUS,
  REWARDED_TICKETS_PER_DAY,
  TICKET_REGEN_MIN_MS,
  TICKET_REGEN_MS,
  postDef,
  type PostDef,
  type PostEffectKind,
} from './config';
import type { Num } from './num';
import { dayKey } from './state';
import type { GameState, Hero, PostId } from './types';

// ---------- Посты ----------

/** Доход поста в секунду. Уровень 0 — пост закрыт. Каждые INCOME_MILESTONE уровней доход удваивается. */
export function postIncome(def: PostDef, level: number): Num {
  if (level <= 0) return 0;
  return def.baseIncome * level * Math.pow(2, Math.floor(level / INCOME_MILESTONE));
}

/** Цена следующего шага: открытие (уровень 0 → 1) или апгрейд (L → L+1). */
export function upgradeCost(def: PostDef, level: number): Num {
  if (level <= 0) return def.unlockCost;
  return def.baseCost * Math.pow(COST_GROWTH, level);
}

export function incomeMultiplier(state: GameState): number {
  return 1 + RELICARIUM_BONUS * state.relicarium;
}

export function totalIncome(state: GameState): Num {
  let sum = 0;
  for (const def of POSTS) sum += postIncome(def, state.posts[def.id]);
  return sum * incomeMultiplier(state) * (1 + postEffect(state, 'incomePct'));
}

export function addGold(state: GameState, amount: Num): void {
  state.gold += amount;
}

/** Прошло dtSec секунд активной игры. */
export function tick(state: GameState, dtSec: number): void {
  if (dtSec <= 0) return;
  addGold(state, totalIncome(state) * dtSec);
}

export function buyPost(state: GameState, id: PostId): boolean {
  const def = postDef(id);
  const level = state.posts[id];
  const cost = upgradeCost(def, level);
  if (state.gold < cost) return false;
  state.gold -= cost;
  state.posts[id] = level + 1;
  return true;
}

/** Покупает до `count` уровней подряд; возвращает, сколько куплено. */
export function buyPostMany(state: GameState, id: PostId, count: number): number {
  let bought = 0;
  while (bought < count && buyPost(state, id)) bought += 1;
  return bought;
}

// ---------- Реликварий (сток осколков реликвий) ----------

export function relicariumCost(purchased: number): Num {
  return Math.ceil(5 * Math.pow(1.6, purchased));
}

export function buyRelicarium(state: GameState): boolean {
  const cost = relicariumCost(state.relicarium);
  if (state.essence < cost) return false;
  state.essence -= cost;
  state.relicarium += 1;
  return true;
}

// ---------- Герои ----------

/** Стоимость улучшения зависит от уровня, а не от редкости: редкий герой не должен быть дороже в обслуживании. */
export function heroUpgradeCost(hero: Hero): Num {
  return Math.ceil(60 * Math.pow(1.32, hero.level - 1));
}

/** Максимальный уровень героя сейчас: растёт, когда вы побеждаете в самом глубоком открытом подземелье. */
export function heroLevelCap(state: GameState): number {
  const idx = Math.min(Math.max(state.maxTier, 1), HERO_LEVEL_CAPS.length) - 1;
  return HERO_LEVEL_CAPS[idx] as number;
}

export function upgradeHero(state: GameState, heroId: string): boolean {
  const hero = state.heroes.find((h) => h.id === heroId);
  if (!hero || hero.status === 'lost' || hero.level >= heroLevelCap(state)) return false;
  const cost = heroUpgradeCost(hero);
  if (state.gold < cost) return false;
  state.gold -= cost;
  hero.level += 1;
  return true;
}

/** Снимает статус «ранен» с героев, у которых таймер вышел. */
export function refreshHeroes(state: GameState, nowMs: number): void {
  for (const hero of state.heroes) {
    if (hero.status === 'wounded' && nowMs >= hero.woundedUntil) {
      hero.status = 'ready';
      hero.woundedUntil = 0;
    }
  }
}

// ---------- Бонусы постов для Экспедиции ----------

export function postEffect(state: GameState, kind: PostEffectKind): number {
  const matching = POSTS.filter((p) => p.effect.kind === kind);
  if (matching.length === 0) return 0;
  // Эффекты одинакового типа суммируются, но каждый пост сохраняет собственный предел.
  return matching.reduce((sum, def) => sum + Math.min(def.effect.cap, def.effect.perLevel * state.posts[def.id]), 0);
}

// ---------- Жетоны ----------

export function ticketRegenMs(state: GameState): number {
  const reduced = TICKET_REGEN_MS * (1 - postEffect(state, 'ticketRegen'));
  return Math.max(TICKET_REGEN_MIN_MS, Math.round(reduced));
}

/**
 * Начисляет жетоны за прошедшее время одной формулой (без цикла по секундам).
 * Возвращает, сколько жетонов добавилось.
 */
export function regenTickets(state: GameState, nowMs: number): number {
  const t = state.tickets;
  if (t.count >= MAX_TICKETS) {
    t.updatedAt = nowMs;
    return 0;
  }
  const elapsed = nowMs - t.updatedAt;
  if (elapsed <= 0) return 0;
  const step = ticketRegenMs(state);
  const gained = Math.min(MAX_TICKETS - t.count, Math.floor(elapsed / step));
  if (gained <= 0) return 0;
  t.count += gained;
  t.updatedAt = t.count >= MAX_TICKETS ? nowMs : t.updatedAt + gained * step;
  return gained;
}

/** Списывает жетон. Если копилка была полной, таймер следующего жетона стартует с этого момента. */
export function spendTicket(state: GameState, nowMs: number): boolean {
  const t = state.tickets;
  if (t.count <= 0) return false;
  if (t.count >= MAX_TICKETS) t.updatedAt = nowMs;
  t.count -= 1;
  return true;
}

export function msToNextTicket(state: GameState, nowMs: number): number {
  if (state.tickets.count >= MAX_TICKETS) return 0;
  return Math.max(0, state.tickets.updatedAt + ticketRegenMs(state) - nowMs);
}

export function rewardedTicketsLeft(state: GameState, nowMs: number): number {
  const t = state.tickets;
  if (t.rewardedDay !== dayKey(nowMs)) return REWARDED_TICKETS_PER_DAY;
  return Math.max(0, REWARDED_TICKETS_PER_DAY - t.rewardedToday);
}

/** Вызывать после успешного просмотра rewarded-рекламы. */
export function grantRewardedTicket(state: GameState, nowMs: number): boolean {
  const t = state.tickets;
  const today = dayKey(nowMs);
  if (t.rewardedDay !== today) {
    t.rewardedDay = today;
    t.rewardedToday = 0;
  }
  if (t.rewardedToday >= REWARDED_TICKETS_PER_DAY) return false;
  t.rewardedToday += 1;
  t.count += 1; // допускаем сверх лимита накопления: жетон за рекламу не сгорает
  return true;
}

// ---------- Офлайн-прогресс ----------

export interface OfflineSummary {
  seconds: number;
  capped: boolean;
  gold: Num;
  tickets: number;
}

/**
 * Считает офлайн-доход формулой «доход × время». Время берём у платформы (на Яндексе это серверное
 * время, которое игрок не может подкрутить), отрицательный интервал игнорируем.
 */
export function computeOffline(state: GameState, nowMs: number): OfflineSummary {
  const rawSec = Math.max(0, (nowMs - state.lastSeen) / 1000);
  const seconds = Math.min(rawSec, OFFLINE_CAP_SEC);
  return { seconds, capped: rawSec > OFFLINE_CAP_SEC, gold: totalIncome(state) * seconds, tickets: 0 };
}

export function applyOffline(state: GameState, nowMs: number): OfflineSummary {
  const summary = computeOffline(state, nowMs);
  addGold(state, summary.gold);
  summary.tickets = regenTickets(state, nowMs);
  refreshHeroes(state, nowMs);
  state.lastSeen = nowMs;
  return summary;
}
