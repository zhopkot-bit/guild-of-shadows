import { afterEach, describe, expect, it, vi } from 'vitest';
import { artPortraitFor, loadArtPack } from '../src/content/artpack';

afterEach(() => vi.unstubAllGlobals());

async function load(portrait?: string, search = '') {
  vi.stubGlobal('window', {
    location: { href: `https://game.test/releases/v18/index.html${search}`, search },
    setTimeout, clearTimeout,
  });
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    version: 1,
    heroes: { bran: portrait ? { portrait } : {} },
    enemies: { goblinRaider: portrait ? { portrait } : {} },
    arenas: {},
  }) });
  vi.stubGlobal('fetch', fetch);
  await loadArtPack();
  return fetch;
}

describe('art-pack portrait URLs', () => {
  it('resolves portraits under the default registry in a deployed subdirectory', async () => {
    const fetch = await load('heroes/bran/portrait.webp');
    expect(artPortraitFor('heroes', 'bran')).toBe('https://game.test/releases/v18/art/v17/heroes/bran/portrait.webp');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['face.webp', './face.webp', '../faces/face.webp'])(
    'resolves %s relative to a custom registry for heroes and enemies', async path => {
      await load(path, '?artpack=/custom/pack/registry.json');
      const expected = new URL(path, 'https://game.test/custom/pack/registry.json').href;
      expect(artPortraitFor('heroes', 'bran')).toBe(expected);
      expect(artPortraitFor('enemies', 'goblinRaider')).toBe(expected);
    },
  );

  it.each(['/faces/bran.webp', 'https://cdn.test/bran.webp'])(
    'preserves the destination of an absolute portrait URL %s', async path => {
      await load(path);
      expect(artPortraitFor('heroes', 'bran')).toBe(new URL(path, 'https://game.test').href);
    },
  );

  it('returns null for absent overrides and clears previous portraits when a new registry is loaded', async () => {
    await load('face.webp');
    await load();
    expect(artPortraitFor('heroes', 'bran')).toBeNull();
    expect(artPortraitFor('heroes', 'unknown')).toBeNull();
    expect(artPortraitFor('enemies', 'goblinRaider')).toBeNull();
  });
});
