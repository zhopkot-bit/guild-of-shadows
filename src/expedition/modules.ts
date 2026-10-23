import { HP_SCALE } from '../core/config';
import type { RNG } from '../core/rng';

/**
 * Временные модули экспедиции — Content Bible v1.1, лист Modules (MOD01–MOD08).
 * Действуют только в одном забеге и не стакаются: каждый модуль можно получить один раз.
 */
export type ModuleId =
  | 'guardianMail'
  | 'hawkEye'
  | 'piercingArrow'
  | 'wardenShield'
  | 'healingPotion'
  | 'pathfinderMap'
  | 'swiftFeather'
  | 'relicPouch';

export interface ModuleDef {
  id: ModuleId;
  contentId: string;
  name: string;
  category: string;
  text: string;
  /** Иконка из ui/glyphs (контур без символики). */
  glyph: 'shield' | 'scout' | 'aimedShot' | 'cover' | 'heart' | 'target' | 'fast' | 'ember';
}

export const MODULES: readonly ModuleDef[] = [
  { id: 'guardianMail', contentId: 'MOD01', name: 'Кольчуга хранителя', category: 'Защита', text: '+12% максимального HP отряда', glyph: 'shield' },
  { id: 'hawkEye', contentId: 'MOD02', name: 'Око ястреба', category: 'Урон', text: 'Обычная атака Стрелка наносит +15% урона', glyph: 'scout' },
  { id: 'piercingArrow', contentId: 'MOD03', name: 'Пробивная стрела', category: 'Пробитие', text: 'Первая атака Стрелка в каждом бою игнорирует ещё 30% защиты', glyph: 'aimedShot' },
  { id: 'wardenShield', contentId: 'MOD04', name: 'Щит хранителя', category: 'Снижение урона', text: 'Первый удар по отряду в каждом бою слабее на 8', glyph: 'cover' },
  { id: 'healingPotion', contentId: 'MOD05', name: 'Зелье восстановления', category: 'Восстановление', text: `Отдых в лагере дополнительно лечит каждого на ${Math.round(15 * HP_SCALE)} HP`, glyph: 'heart' },
  { id: 'pathfinderMap', contentId: 'MOD06', name: 'Карта следопыта', category: 'Разведка', text: 'На карте виден состав противников в доступных боях', glyph: 'target' },
  { id: 'swiftFeather', contentId: 'MOD07', name: 'Перо быстрого шага', category: 'Инициатива', text: '+1 СКР отряду в первом раунде каждого боя', glyph: 'fast' },
  { id: 'relicPouch', contentId: 'MOD08', name: 'Сумка собирателя', category: 'Экономика', text: 'После первой элитной встречи: +1 осколок реликвий', glyph: 'ember' },
];

export function moduleDef(id: ModuleId): ModuleDef {
  const def = MODULES.find((m) => m.id === id);
  if (!def) throw new Error(`Неизвестный модуль: ${id}`);
  return def;
}

export function isModuleId(id: string): id is ModuleId {
  return MODULES.some((m) => m.id === id);
}

/** Реликвии сейвов v1.4–v1.7 → ближайшие по смыслу модули. Перо Феникса сохраняет свой эффект отдельно. */
export const LEGACY_RELIC: Record<string, ModuleId | null> = {
  guardShield: 'guardianMail',
  fortitudeAmulet: 'wardenShield',
  wolfFang: 'hawkEye',
  fireRune: 'piercingArrow',
  shadowCloak: 'swiftFeather',
  lifeChalice: 'healingPotion',
  greedDagger: 'relicPouch',
  phoenixFeather: null,
};

/** Нормализует список модулей забега (в том числе старые id реликвий), без дублей. */
export function normalizeModules(raw: readonly string[]): ModuleId[] {
  const out: ModuleId[] = [];
  for (const id of raw) {
    const mapped = isModuleId(id) ? id : LEGACY_RELIC[id] ?? null;
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

export interface ModuleEffects {
  /** Бонус к maxHP; общий предел бонуса maxHP-модулей — 25%. */
  hpPct: number;
  shooterBasicBonus: number;
  shooterFirstPen: number;
  wardenFlat: number;
  campHealAbs: number;
  revealEncounters: boolean;
  firstRoundSpd: number;
  pouch: boolean;
}

export const MODULE_HP_CAP = 0.25;

export function moduleEffects(owned: readonly ModuleId[]): ModuleEffects {
  const has = (id: ModuleId) => owned.includes(id);
  return {
    hpPct: Math.min(MODULE_HP_CAP, has('guardianMail') ? 0.12 : 0),
    shooterBasicBonus: has('hawkEye') ? 0.15 : 0,
    shooterFirstPen: has('piercingArrow') ? 0.3 : 0,
    wardenFlat: has('wardenShield') ? 8 : 0,
    campHealAbs: has('healingPotion') ? 15 : 0,
    revealEncounters: has('pathfinderMap'),
    firstRoundSpd: has('swiftFeather') ? 1 : 0,
    pouch: has('relicPouch'),
  };
}

/** До n разных модулей, которых ещё нет у отряда. Может вернуть меньше, если выбор исчерпан. */
export function rollModules(rng: RNG, owned: readonly ModuleId[], n: number): ModuleId[] {
  const pool = MODULES.filter((m) => !owned.includes(m.id)).map((m) => m.id);
  return rng.shuffle(pool).slice(0, n);
}
