import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLASSES } from '../src/combat/data';
import { BOSS_EMISSIVE, ENEMY_ART, ROSTER, heroArt, identityDef } from '../src/content/roster';
import { newGame } from '../src/core/state';

const PUBLIC = join(process.cwd(), 'public');

/** Минимальный разбор заголовка WebP (VP8 / VP8L / VP8X): размеры и наличие альфы. */
function webpInfo(path: string): { w: number; h: number; alpha: boolean } {
  const b = readFileSync(path);
  expect(b.toString('ascii', 0, 4)).toBe('RIFF');
  expect(b.toString('ascii', 8, 12)).toBe('WEBP');
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    const alpha = (b[20]! & 0x10) !== 0;
    const w = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16));
    const h = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16));
    return { w, h, alpha };
  }
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1, alpha: ((bits >> 28) & 1) === 1 };
  }
  // VP8 (lossy без альфы)
  return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, alpha: false };
}

function file(url: string): string {
  return join(PUBLIC, url.replace(/^\.\//, ''));
}

describe('реестр героев: heroId → имя → роль → портрет → спрайт', () => {
  it('четыре канонических героя с ролями Content Bible', () => {
    expect(ROSTER.map((d) => [d.contentId, d.name, d.role])).toEqual([
      ['HERO_BRAN', 'Бран', 'defender'],
      ['HERO_MIRA', 'Мира', 'scout'],
      ['HERO_ROOK', 'Рук', 'shooter'],
      ['HERO_NORA', 'Нора', 'healer'],
    ]);
    for (const d of ROSTER) expect(CLASSES[d.role]).toBeDefined();
  });

  it('у каждого героя свой портрет и свой спрайт; путь содержит его identity', () => {
    const portraits = new Set<string>();
    const sprites = new Set<string>();
    for (const d of ROSTER) {
      expect(d.portrait).toContain(`/heroes/${d.identity}/`);
      expect(d.sprite).toContain(`/heroes/${d.identity}/`);
      expect(d.portrait).not.toBe(d.sprite);
      portraits.add(d.portrait);
      sprites.add(d.sprite);
    }
    expect(portraits.size).toBe(4);
    expect(sprites.size).toBe(4);
  });

  it('файлы существуют; портрет 256×320, спрайт — с альфа-каналом (настоящий вырез, не прямоугольник)', () => {
    for (const d of ROSTER) {
      expect(existsSync(file(d.portrait)), d.portrait).toBe(true);
      expect(existsSync(file(d.sprite)), d.sprite).toBe(true);
      expect(webpInfo(file(d.portrait))).toMatchObject({ w: 256, h: 320 });
      const sp = webpInfo(file(d.sprite));
      expect(sp.alpha).toBe(true);
      expect(sp.h).toBeGreaterThan(sp.w);
    }
  });

  it('изображения разных героев не совпадают побайтно (нет перепутанных копий)', () => {
    const hashes = ROSTER.flatMap((d) => [d.portrait, d.sprite]).map((p) => createHash('sha1').update(readFileSync(file(p))).digest('hex'));
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('арт выбирается по личности, а не по роли: новобранец-разведчик не получает лицо Миры', () => {
    expect(heroArt({ identity: 'mira', cls: 'scout' }).portrait).toBe(identityDef('mira').portrait);
    const recruit = heroArt({ identity: null, cls: 'scout' });
    expect(recruit.portrait).toBeNull();
    expect(recruit.sprite).toBeNull();
    expect(recruit.emblem).toBe('scout');
    // Даже при «чужой» роли в сейве лицо определяется личностью.
    expect(heroArt({ identity: 'bran', cls: 'healer' }).portrait).toBe(identityDef('bran').portrait);
  });

  it('новая игра создаёт ровно четырёх канонических героев с уникальными id', () => {
    const s = newGame(1);
    expect(s.heroes.map((h) => [h.name, h.identity, h.cls])).toEqual([
      ['Бран', 'bran', 'defender'],
      ['Мира', 'mira', 'scout'],
      ['Рук', 'rook', 'shooter'],
      ['Нора', 'nora', 'healer'],
    ]);
    expect(new Set(s.heroes.map((h) => h.id)).size).toBe(4);
    expect(s.party).toHaveLength(3);
  });
});

describe('арт противников и босса', () => {
  it('четыре архетипа и Костяной король: портрет 256×256, спрайт с альфой', () => {
    for (const [kind, art] of Object.entries(ENEMY_ART)) {
      expect(existsSync(file(art.portrait)), kind).toBe(true);
      expect(webpInfo(file(art.portrait))).toMatchObject({ w: 256, h: 256 });
      const sp = webpInfo(file(art.sprite));
      expect(sp.alpha, kind).toBe(true);
    }
    expect(webpInfo(file(BOSS_EMISSIVE)).alpha).toBe(true);
  });

  it('арены — фон 1920×1080 без запечённых бойцов (отдельные файлы от спрайтов)', () => {
    for (const p of ['./art/v17/arena/crypt.webp', './art/v17/arena/crypt_boss.webp']) {
      expect(webpInfo(file(p))).toMatchObject({ w: 1920, h: 1080 });
    }
  });
});
