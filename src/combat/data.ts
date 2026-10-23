import { HP_SCALE, LEVEL_STAT_GROWTH } from '../core/config';
import type { Hero, HeroClass, Rarity } from '../core/types';
import type { Skill, Stats, Unit } from './types';

export const SKILLS: Record<string, Skill> = {
  powerStrike: { id: 'powerStrike', name: 'Мощный удар', cooldown: 3, target: 'enemy', mult: 2.0 },
  fireWave: { id: 'fireWave', name: 'Огненная волна', cooldown: 3, target: 'allEnemies', mult: 0.8 },
  backstab: { id: 'backstab', name: 'Удар в спину', cooldown: 3, target: 'enemy', mult: 2.4, ignoreDef: true },
  heal: { id: 'heal', name: 'Исцеление', cooldown: 2, target: 'ally', mult: 0, healPctMax: 0.25, healAtkMult: 1 },
  shamanHeal: { id: 'shamanHeal', name: 'Знахарство', cooldown: 3, target: 'ally', mult: 0, healPctMax: 0.3, healAtkMult: 0 },
  groundSlam: { id: 'groundSlam', name: 'Удар по площади', cooldown: 3, target: 'allEnemies', mult: 0.7 },
};

export interface ClassDef {
  cls: HeroClass;
  name: string;
  icon: string;
  stats: Stats;
  skill: string;
  blurb: string;
}

export const CLASSES: Record<HeroClass, ClassDef> = {
  warrior: { cls: 'warrior', name: 'Воин', icon: '⚔', stats: { maxHp: 120, atk: 14, def: 8, spd: 8 }, skill: 'powerStrike', blurb: 'Крепкий боец, мощный удар по одной цели.' },
  mage: { cls: 'mage', name: 'Маг', icon: '✦', stats: { maxHp: 70, atk: 18, def: 3, spd: 10 }, skill: 'fireWave', blurb: 'Хрупкий, но бьёт по всем врагам сразу.' },
  rogue: { cls: 'rogue', name: 'Плут', icon: '🗡', stats: { maxHp: 85, atk: 16, def: 5, spd: 14 }, skill: 'backstab', blurb: 'Ходит первым, удар в спину игнорирует защиту.' },
  priest: { cls: 'priest', name: 'Жрец', icon: '✚', stats: { maxHp: 90, atk: 10, def: 5, spd: 9 }, skill: 'heal', blurb: 'Лечит союзников, слабо бьёт сам.' },
};

// Редкость — косметическая/коллекционная характеристика, а не множитель боевой силы.
// Оставлено как таблица для совместимости с существующими сейвами и UI.
export const RARITY_MULT: Record<Rarity, number> = { common: 1, rare: 1, epic: 1, legendary: 1 };
export const RARITY_NAME: Record<Rarity, string> = { common: 'Обычный', rare: 'Редкий', epic: 'Эпический', legendary: 'Легендарный' };

export interface EnemyDef {
  id: string;
  name: string;
  icon: string;
  stats: Stats;
  skill?: string;
  boss?: boolean;
}

export const ENEMIES: Record<string, EnemyDef> = {
  skeleton: { id: 'skeleton', name: 'Скелет', icon: '💀', stats: { maxHp: 60, atk: 12, def: 6, spd: 7 } },
  goblin: { id: 'goblin', name: 'Гоблин-лучник', icon: '🏹', stats: { maxHp: 40, atk: 14, def: 2, spd: 13 } },
  troll: { id: 'troll', name: 'Тролль', icon: '🪨', stats: { maxHp: 140, atk: 16, def: 10, spd: 4 } },
  shaman: { id: 'shaman', name: 'Шаман', icon: '🔮', stats: { maxHp: 50, atk: 10, def: 3, spd: 9 }, skill: 'shamanHeal' },
  guardian: { id: 'guardian', name: 'Страж гробницы', icon: '👁', stats: { maxHp: 380, atk: 20, def: 12, spd: 8 }, skill: 'groundSlam', boss: true },
};

export interface HeroBonus {
  hpPct: number;
  atkPct: number;
  defPct: number;
  spdPct: number;
}

export const NO_BONUS: HeroBonus = { hpPct: 0, atkPct: 0, defPct: 0, spdPct: 0 };

export function levelMult(level: number): number {
  return 1 + LEVEL_STAT_GROWTH * (level - 1);
}

/** Итоговые характеристики героя: класс × уровень × бонусы постов и реликвий. Редкость не даёт скрытого множителя силы. */
export function heroStats(hero: Pick<Hero, 'cls' | 'level' | 'rarity'>, bonus: HeroBonus = NO_BONUS): Stats {
  const base = CLASSES[hero.cls].stats;
  const m = levelMult(hero.level) * RARITY_MULT[hero.rarity];
  return {
    maxHp: Math.round(base.maxHp * m * (1 + bonus.hpPct) * HP_SCALE),
    atk: Math.round(base.atk * m * (1 + bonus.atkPct)),
    def: Math.round(base.def * m * (1 + bonus.defPct)),
    spd: Math.round(base.spd * (1 + bonus.spdPct)),
  };
}

export function heroUnit(hero: Hero, bonus: HeroBonus, hp?: number): Unit {
  const stats = heroStats(hero, bonus);
  return {
    id: hero.id,
    name: hero.name,
    side: 'hero',
    kind: hero.cls,
    stats,
    hp: Math.min(stats.maxHp, hp ?? stats.maxHp),
    cd: 1,
    skill: SKILLS[CLASSES[hero.cls].skill] ?? null,
    alive: (hp ?? stats.maxHp) > 0,
    heroId: hero.id,
    rarity: hero.rarity,
    portrait: hero.portrait,
  };
}

export interface EnemyScale {
  tier: number;
  /** Нарастание внутри забега: 0 на первом слое, растёт к боссу. */
  ramp: number;
  elite?: boolean;
  /** Дополнительный множитель HP/АТК (обучающие забеги). По умолчанию 1. */
  mult?: number;
}

export function enemyUnit(id: string, uid: string, scale: EnemyScale): Unit {
  const def = ENEMIES[id];
  if (!def) throw new Error(`Неизвестный враг: ${id}`);
  const t = scale.tier - 1;
  const hpAtk = Math.pow(1.3, t) * (1 + scale.ramp) * (scale.mult ?? 1);
  const defMult = Math.pow(1.15, t);
  const maxHp = Math.round(def.stats.maxHp * hpAtk * (scale.elite ? 1.5 : 1) * HP_SCALE);
  const stats: Stats = {
    maxHp,
    atk: Math.round(def.stats.atk * hpAtk * (scale.elite ? 1.2 : 1)),
    def: Math.round(def.stats.def * defMult),
    spd: def.stats.spd,
  };
  const unit: Unit = {
    id: uid,
    name: scale.elite ? `${def.name} (элита)` : def.name,
    side: 'enemy',
    kind: def.id,
    stats,
    hp: maxHp,
    cd: 1,
    skill: def.skill ? SKILLS[def.skill] ?? null : null,
    alive: true,
  };
  if (def.boss) {
    unit.boss = true;
    unit.bossPhase = 1;
  }
  if (scale.elite) unit.elite = true;
  return unit;
}
