import { ENEMY_ART, LEGACY_ENEMY_KIND, heroArt, isEnemyKind, type EnemyKind } from '../content/roster';
import { artPortraitFor } from '../content/artpack';
import type { Hero, HeroClass } from '../core/types';
import { h } from './dom';
import { glyph } from './glyphs';

/**
 * Портрет — только лицо и плечи конкретного персонажа (отдельный ресурс 256×320 / 256×256),
 * никогда не полнофигурный спрайт. Источник выбирается по личности героя (content/roster.ts).
 * Размеры: 48, 64, 96, 128 px; кадр фиксирован (aspect-ratio), изображение не растягивается.
 */
export type PortraitSize = 48 | 64 | 96 | 128;

export interface PortraitOpts {
  size: PortraitSize;
  /** Подпись для скринридеров; на миниатюрах имя дублируется текстом рядом. */
  label: string;
  boss?: boolean;
  foe?: boolean;
}

function frame(o: PortraitOpts, extra: string): HTMLElement {
  return h('div', { class: `portrait portrait--${o.size}${o.foe ? ' portrait--foe' : ''}${o.boss ? ' portrait--boss' : ''} ${extra}`, role: 'img', 'aria-label': o.label });
}

function image(el: HTMLElement, src: string, fallback: () => void): void {
  const img = h('img', { src, alt: '', draggable: 'false', decoding: 'async' });
  img.addEventListener('error', () => {
    // Ошибка ресурса не превращается в «битую картинку»: остаётся эмблема роли.
    console.error(`Портрет не загрузился: ${src}`);
    img.remove();
    fallback();
  }, { once: true });
  el.append(img);
}

function emblem(el: HTMLElement, role: HeroClass): void {
  el.classList.add('portrait--emblem');
  el.append(glyph(role, 28, 1.6));
}

export function heroPortrait(hero: Pick<Hero, 'identity' | 'cls' | 'name'>, size: PortraitSize): HTMLElement {
  const art = heroArt(hero);
  const el = frame({ size, label: hero.name }, `portrait--role-${art.emblem}${hero.identity ? ` portrait--${hero.identity}` : ''}`);
  el.dataset.identity = hero.identity ?? 'recruit';
  const override = hero.identity ? artPortraitFor('heroes', hero.identity) : null;
  const portrait = override ?? art.portrait;
  const fallback = () => emblem(el, art.emblem);
  if (portrait) image(el, portrait, () => {
    if (override && art.portrait && override !== art.portrait) image(el, art.portrait, fallback);
    else fallback();
  });
  else fallback();
  return el;
}

export function enemyPortrait(kind: string, label: string, size: PortraitSize): HTMLElement {
  const k: EnemyKind | undefined = isEnemyKind(kind) ? kind : LEGACY_ENEMY_KIND[kind];
  const el = frame({ size, label, foe: true, boss: k === 'boneKing' }, '');
  el.dataset.kind = k ?? kind;
  if (k) {
    const fallback = () => el.append(glyph('skull', 28));
    const standard = ENEMY_ART[k].portrait;
    const override = artPortraitFor('enemies', k);
    image(el, override ?? standard, () => {
      if (override && override !== standard) image(el, standard, fallback);
      else fallback();
    });
  }
  else el.append(glyph('skull', 28));
  return el;
}
