import type { RNG } from '../core/rng';

export type RelicId =
  | 'wolfFang'
  | 'guardShield'
  | 'shadowCloak'
  | 'lifeChalice'
  | 'fireRune'
  | 'fortitudeAmulet'
  | 'greedDagger'
  | 'phoenixFeather';

export interface RelicDef {
  id: RelicId;
  name: string;
  icon: string;
  text: string;
}

/** Реликвии живут только в одном забеге — в этом суть roguelite-слоя. */
export const RELICS: readonly RelicDef[] = [
  { id: 'wolfFang', name: 'Клык Волка', icon: '🐺', text: '+15% АТК отряда' },
  { id: 'guardShield', name: 'Щит Стража', icon: '🛡', text: '+20% HP отряда' },
  { id: 'shadowCloak', name: 'Плащ Теней', icon: '🌑', text: '+15% СКР отряда' },
  { id: 'lifeChalice', name: 'Кубок Жизни', icon: '🏆', text: 'После боя лечит 10% HP' },
  { id: 'fireRune', name: 'Руна Огня', icon: '🔥', text: 'Умения бьют на 30% сильнее' },
  { id: 'fortitudeAmulet', name: 'Амулет Стойкости', icon: '📿', text: '+25% ЗАЩ отряда' },
  { id: 'greedDagger', name: 'Кинжал Жадности', icon: '🗡', text: '+50% Эссенции за забег' },
  { id: 'phoenixFeather', name: 'Перо Феникса', icon: '🪶', text: 'Первый павший герой воскресает (30% HP)' },
];

export function relicDef(id: RelicId): RelicDef {
  const def = RELICS.find((r) => r.id === id);
  if (!def) throw new Error(`Неизвестная реликвия: ${id}`);
  return def;
}

export interface RelicEffects {
  hpPct: number;
  atkPct: number;
  defPct: number;
  spdPct: number;
  skillDamageMult: number;
  essenceMult: number;
  healAfterBattle: number;
  hasPhoenix: boolean;
}

export function relicEffects(owned: readonly RelicId[]): RelicEffects {
  const has = (id: RelicId) => owned.includes(id);
  return {
    hpPct: has('guardShield') ? 0.2 : 0,
    atkPct: has('wolfFang') ? 0.15 : 0,
    defPct: has('fortitudeAmulet') ? 0.25 : 0,
    spdPct: has('shadowCloak') ? 0.15 : 0,
    skillDamageMult: has('fireRune') ? 1.3 : 1,
    essenceMult: has('greedDagger') ? 1.5 : 1,
    healAfterBattle: has('lifeChalice') ? 0.1 : 0,
    hasPhoenix: has('phoenixFeather'),
  };
}

/** До n разных реликвий, которых ещё нет у отряда. Может вернуть меньше, если выбор исчерпан. */
export function rollRelics(rng: RNG, owned: readonly RelicId[], n: number): RelicId[] {
  const pool = RELICS.filter((r) => !owned.includes(r.id)).map((r) => r.id);
  return rng.shuffle(pool).slice(0, n);
}
