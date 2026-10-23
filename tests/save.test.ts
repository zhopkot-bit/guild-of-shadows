import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, deserialize, serialize } from '../src/core/save';
import { newGame } from '../src/core/state';

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);

describe('сохранения', () => {
  it('туда и обратно без потерь', () => {
    const s = newGame(T0);
    s.gold = 12345.5;
    s.essence = 9;
    s.posts.forge = 4;
    s.relicarium = 2;
    const r = deserialize(serialize(s), T0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state).toEqual(s);
  });

  it('пусто и мусор не роняют игру', () => {
    expect(deserialize(null, T0)).toEqual({ ok: false, reason: 'empty' });
    expect(deserialize('', T0)).toEqual({ ok: false, reason: 'empty' });
    expect(deserialize('{не json', T0)).toEqual({ ok: false, reason: 'corrupt' });
    expect(deserialize('[1,2,3]', T0)).toEqual({ ok: false, reason: 'corrupt' });
    expect(deserialize('{"version":"x"}', T0)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('сейв из более новой версии не перезаписывается молча', () => {
    const json = JSON.stringify({ ...newGame(T0), version: SAVE_VERSION + 1 });
    expect(deserialize(json, T0)).toEqual({ ok: false, reason: 'newer' });
  });

  it('NaN, минус и бесконечность в числах заменяются безопасными значениями', () => {
    const s = newGame(T0);
    const json = serialize({ ...s, gold: Number.NaN, essence: -50, relicarium: Infinity });
    const r = deserialize(json, T0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.gold).toBe(0);
      expect(r.state.essence).toBe(0);
      expect(r.state.relicarium).toBe(0);
    }
  });

  it('отсутствующие поля получают значения по умолчанию', () => {
    const r = deserialize(JSON.stringify({ version: SAVE_VERSION, gold: 77 }), T0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.gold).toBe(77);
      expect(r.state.heroes.length).toBeGreaterThan(0);
      expect(r.state.party.length).toBeGreaterThan(0);
      expect(r.state.posts.barracks).toBeGreaterThanOrEqual(1);
    }
  });

  it('migrates legacy permanently-lost heroes to temporary wounds', () => {
    const s = newGame(T0);
    const legacy = { ...s, heroes: s.heroes.map((h, i) => i === 0 ? { ...h, status: 'lost' } : h), party: s.party };
    const result = deserialize(JSON.stringify(legacy), T0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.heroes[0]!.status).toBe('wounded');
      expect(result.state.heroes[0]!.woundedUntil).toBeGreaterThan(T0);
      expect(result.state.party).toContain(result.state.heroes[0]!.id);
    }
  });

  it('битые герои отбрасываются, дубли id тоже, отряд чистится от несуществующих', () => {
    const s = newGame(T0);
    const first = s.heroes[0]!;
    const json = JSON.stringify({
      ...s,
      heroes: [first, { ...first }, { id: 'x1', cls: 'dragon', rarity: 'mythic', level: 999, status: 'zzz' }, 42, null],
      party: [first.id, 'ghost'],
    });
    const r = deserialize(json, T0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.heroes).toHaveLength(2);
      const odd = r.state.heroes.find((h) => h.id === 'x1')!;
      expect(odd.cls).toBe('warrior');
      expect(odd.rarity).toBe('common');
      expect(odd.level).toBe(20);
      expect(odd.status).toBe('ready');
      expect(r.state.party).toEqual([first.id]);
    }
  });
});
