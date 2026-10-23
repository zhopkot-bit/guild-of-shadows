import { ART } from '../core/config';
import type { Rarity } from '../core/types';
import { h } from './dom';

/** Растровые портреты — кропы утверждённого концепт-пака. Не найденные сущности используют старый SVG/монограмму. */
const RASTER_ART: Record<string, string> = {
  warrior: 'warrior.webp', mage: 'mage.webp', rogue: 'rogue.webp', priest: 'priest.webp',
  skeleton: 'skeleton.webp', guardian: 'guardian.webp', goblin: 'goblin.webp', troll: 'troll.webp', shaman: 'shaman.webp',
};

const FACE_ART: Record<string, string> = {
  warrior: 'warrior_face.webp', mage: 'mage_face.webp', rogue: 'rogue_face.webp', priest: 'priest_face.webp',
  skeleton: 'skeleton_face.webp', guardian: 'guardian_face.webp', goblin: 'goblin_face.webp', troll: 'troll_face.webp', shaman: 'shaman_face.webp', hunter: 'hunter_face.webp',
};

export interface PortraitOpts {
  kind: string;
  name: string;
  size: 'xs' | 'sm' | 'md' | 'lg';
  rarity?: Rarity;
  foe?: boolean;
  boss?: boolean;
}

export function portrait(o: PortraitOpts): HTMLElement {
  const cls = ['portrait', `portrait--${o.size}`];
  if (o.foe) cls.push('foe');
  else {
    cls.push(`cls-${o.kind}`);
    if (o.rarity) cls.push(`rar-${o.rarity}`);
  }
  if (o.boss) cls.push('boss');
  const el = h('div', { class: cls.join(' ') });
  if (ART.portraits && RASTER_ART[o.kind]) {
    const img = h('img', { src: FACE_ART[o.kind] ? `./art/faces/${FACE_ART[o.kind]}` : `${ART.basePath}${RASTER_ART[o.kind]}`, alt: '', draggable: 'false', loading: 'lazy' });
    img.addEventListener('error', () => {
      img.remove();
      if (o.kind === 'priest' || o.kind === 'warrior' || o.kind === 'mage' || o.kind === 'rogue') {
        el.append(h('img', { src: `${ART.basePath}${o.kind}.svg`, alt: '', draggable: 'false' }));
      } else {
        el.append(h('span', { class: 'portrait__mono' }, o.name.slice(0, 1)));
      }
    }, { once: true });
    el.append(img);
  } else {
    el.append(h('span', { class: 'portrait__mono' }, o.name.slice(0, 1)));
  }
  return el;
}
