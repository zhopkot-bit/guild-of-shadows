import { describe, expect, it } from 'vitest';
import {
  applyOffline,
  buyPost,
  buyRelicarium,
  computeOffline,
  grantRewardedTicket,
  postIncome,
  regenTickets,
  rewardedTicketsLeft,
  spendTicket,
  tick,
  totalIncome,
  upgradeCost,
} from '../src/core/economy';
import { MAX_TICKETS, OFFLINE_CAP_SEC, POSTS, REWARDED_TICKETS_PER_DAY, TICKET_REGEN_MS, postDef } from '../src/core/config';
import { newGame } from '../src/core/state';

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);

describe('посты', () => {
  it('доход растёт с уровнем и удваивается на рубеже', () => {
    const def = postDef('barracks');
    expect(postIncome(def, 0)).toBe(0);
    expect(postIncome(def, 1)).toBe(1);
    expect(postIncome(def, 24)).toBe(24);
    expect(postIncome(def, 25)).toBe(25 * 2); // рубеж: ×2
    expect(postIncome(def, 50)).toBe(50 * 4);
  });

  it('цена открытия — unlockCost, цена апгрейда растёт', () => {
    for (const def of POSTS) {
      expect(upgradeCost(def, 0)).toBe(def.unlockCost);
      let prev = 0;
      for (let l = 1; l < 60; l++) {
        const c = upgradeCost(def, l);
        expect(c).toBeGreaterThan(prev);
        prev = c;
      }
    }
  });

  it('покупка списывает золото и повышает уровень; без денег — отказ', () => {
    const s = newGame(T0);
    expect(buyPost(s, 'barracks')).toBe(false); // золота нет
    s.gold = 100;
    const before = s.gold;
    const cost = upgradeCost(postDef('barracks'), 1);
    expect(buyPost(s, 'barracks')).toBe(true);
    expect(s.posts.barracks).toBe(2);
    expect(s.gold).toBeCloseTo(before - cost, 9);
  });

  it('Реликварий даёт +5% к доходу', () => {
    const s = newGame(T0);
    const base = totalIncome(s);
    s.essence = 5;
    expect(buyRelicarium(s)).toBe(true);
    expect(totalIncome(s)).toBeCloseTo(base * 1.05, 9);
    expect(buyRelicarium(s)).toBe(false); // следующий стоит дороже, эссенции не хватает
  });
});

describe('офлайн-прогресс', () => {
  it('формула совпадает с пошаговой симуляцией', () => {
    const a = newGame(T0);
    a.posts.barracks = 7;
    a.posts.forge = 3;
    const b = structuredClone(a);
    const seconds = 3600;
    for (let i = 0; i < seconds; i++) tick(a, 1);
    const summary = computeOffline(b, T0 + seconds * 1000);
    expect(summary.seconds).toBe(seconds);
    expect(summary.gold).toBeCloseTo(a.gold, 6);
  });

  it('ограничен потолком и не уходит в минус при сдвиге часов назад', () => {
    const s = newGame(T0);
    const huge = computeOffline(s, T0 + 100 * 3600 * 1000);
    expect(huge.seconds).toBe(OFFLINE_CAP_SEC);
    expect(huge.capped).toBe(true);
    const back = computeOffline(s, T0 - 5000);
    expect(back.seconds).toBe(0);
    expect(back.gold).toBe(0);
  });

  it('applyOffline начисляет золото, жетоны и обновляет lastSeen', () => {
    const s = newGame(T0);
    s.tickets.count = 0;
    s.tickets.updatedAt = T0;
    const now = T0 + 2 * TICKET_REGEN_MS + 1000;
    const summary = applyOffline(s, now);
    expect(summary.tickets).toBe(2);
    expect(s.tickets.count).toBe(2);
    expect(s.lastSeen).toBe(now);
    expect(s.gold).toBeGreaterThan(0);
  });
});

describe('жетоны экспедиции', () => {
  it('начисляются целыми шагами и сохраняют остаток времени', () => {
    const s = newGame(T0);
    s.tickets.count = 0;
    s.tickets.updatedAt = T0;
    const gained = regenTickets(s, T0 + Math.floor(1.5 * TICKET_REGEN_MS));
    expect(gained).toBe(1);
    expect(s.tickets.updatedAt).toBe(T0 + TICKET_REGEN_MS); // остаток 0.5 шага не потерян
  });

  it('копилка ограничена, а при полной таймер стоит', () => {
    const s = newGame(T0);
    s.tickets.count = 0;
    s.tickets.updatedAt = T0;
    regenTickets(s, T0 + 100 * TICKET_REGEN_MS);
    expect(s.tickets.count).toBe(MAX_TICKETS);
    expect(regenTickets(s, T0 + 200 * TICKET_REGEN_MS)).toBe(0);
  });

  it('при трате из полной копилки таймер стартует с момента траты', () => {
    const s = newGame(T0);
    const now = T0 + 10 * TICKET_REGEN_MS;
    expect(spendTicket(s, now)).toBe(true);
    expect(s.tickets.count).toBe(MAX_TICKETS - 1);
    expect(s.tickets.updatedAt).toBe(now);
  });

  it('жетоны за рекламу ограничены суточным лимитом и сбрасываются на следующий день', () => {
    const s = newGame(T0);
    for (let i = 0; i < REWARDED_TICKETS_PER_DAY; i++) expect(grantRewardedTicket(s, T0)).toBe(true);
    expect(grantRewardedTicket(s, T0)).toBe(false);
    expect(rewardedTicketsLeft(s, T0)).toBe(0);
    const tomorrow = T0 + 24 * 3600 * 1000;
    expect(rewardedTicketsLeft(s, tomorrow)).toBe(REWARDED_TICKETS_PER_DAY);
    expect(grantRewardedTicket(s, tomorrow)).toBe(true);
  });
});
