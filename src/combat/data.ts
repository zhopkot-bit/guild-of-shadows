import { HP_SCALE, LEVEL_STAT_GROWTH } from '../core/config';
import type { Hero, HeroClass, Rarity } from '../core/types';
import type { EnemyKind } from '../content/roster';
import type { Skill, Stats, Unit } from './types';

/** Умения героев — Combat & Expeditions Spec v0.3, раздел «Роли». */
export const SKILLS: Record<string, Skill> = {
  cover: { id: 'cover', name: 'Прикрытие', cooldown: 2, target: 'ally', effect: 'cover', mult: 0, coverPct: 0.3 },
  lunge: { id: 'lunge', name: 'Точный выпад', cooldown: 2, target: 'enemy', effect: 'damage', mult: 1.7 },
  aimedShot: { id: 'aimedShot', name: 'Прицельный выстрел', cooldown: 2, target: 'enemy', effect: 'damage', mult: 2.0, penetration: 0.3 },
  healingLight: { id: 'healingLight', name: 'Свет исцеления', cooldown: 2, target: 'ally', effect: 'heal', mult: 0, healPctMax: 0.22 },
};

export interface ClassDef {
  cls: HeroClass;
  name: string;
  stats: Stats;
  skill: string;
  passive: string;
  blurb: string;
}

/** Базовые характеристики L1 — Content Bible v1.1 / Combat Spec v0.3. */
export const CLASSES: Record<HeroClass, ClassDef> = {
  defender: {
    cls: 'defender', name: 'Защитник', stats: { maxHp: 145, atk: 12, def: 8, spd: 6 }, skill: 'cover',
    passive: 'Последний заслон: пока Защитник жив, первый удар по союзнику с HP ниже 35% за бой слабее на 15%.',
    blurb: 'Прикрывает союзника: следующий удар по нему слабее на 30%.',
  },
  scout: {
    cls: 'scout', name: 'Разведчик', stats: { maxHp: 100, atk: 15, def: 4, spd: 11 }, skill: 'lunge',
    passive: 'Читает следы: открывает разведывательные варианты в событиях.',
    blurb: 'Ходит рано; Точный выпад наносит ×1.7 урона.',
  },
  shooter: {
    cls: 'shooter', name: 'Стрелок', stats: { maxHp: 82, atk: 19, def: 3, spd: 7 }, skill: 'aimedShot',
    passive: 'Дисциплина огня: обычная атака по врагу с подготовленным ударом игнорирует ещё 10% DEF.',
    blurb: 'Прицельный выстрел ×2.0 игнорирует 30% защиты цели.',
  },
  healer: {
    cls: 'healer', name: 'Целительница', stats: { maxHp: 110, atk: 9, def: 5, spd: 7 }, skill: 'healingLight',
    passive: 'Мягкое восстановление: после победы самый раненый союзник восстанавливает 5% HP.',
    blurb: 'Свет исцеления восстанавливает союзнику 22% HP.',
  },
};

// Редкость — косметическая/коллекционная характеристика, а не множитель боевой силы.
export const RARITY_MULT: Record<Rarity, number> = { common: 1, rare: 1, epic: 1, legendary: 1 };
export const RARITY_NAME: Record<Rarity, string> = { common: 'Обычный', rare: 'Редкий', epic: 'Эпический', legendary: 'Легендарный' };

export interface EnemyDef {
  id: EnemyKind;
  name: string;
  stats: Stats;
  boss?: boolean;
  /** Короткое описание поведения для подсказки на арене. */
  behavior: string;
}

/** Четыре базовых архетипа и босс — Content Bible v1.1, листы Enemies и Boss. */
export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  goblinRaider: { id: 'goblinRaider', name: 'Гоблин-налётчик', stats: { maxHp: 90, atk: 14, def: 3, spd: 8 }, behavior: 'Бьёт Защитника, а без него — героя с наименьшим HP.' },
  ashWolf: { id: 'ashWolf', name: 'Пепельный волк', stats: { maxHp: 72, atk: 13, def: 2, spd: 12 }, behavior: 'Быстрый; бросается на самого израненного героя.' },
  boneGuard: { id: 'boneGuard', name: 'Костяной страж', stats: { maxHp: 120, atk: 11, def: 9, spd: 4 }, behavior: 'Готовит тяжёлый удар ×1.6 по выбранной цели.' },
  ashMage: { id: 'ashMage', name: 'Пепельный чародей', stats: { maxHp: 68, atk: 12, def: 2, spd: 10 }, behavior: 'Каждый третий ход наводит пепельный заряд ×1.4 на слабейшего.' },
  boneKing: { id: 'boneKing', name: 'Костяной король', stats: { maxHp: 460, atk: 22, def: 8, spd: 6 }, boss: true, behavior: 'Фаза I — тяжёлый клинок по одной цели; фаза II — призрачная волна по всему отряду.' },
};

export const BOSS_PHASE2_NAME = 'Костяной король — пробуждённый';

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

/** Итоговые характеристики героя: роль × уровень × бонусы постов и реликвий. Редкость не даёт скрытого множителя силы. */
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
  const skill = SKILLS[CLASSES[hero.cls].skill];
  return {
    id: hero.id,
    name: hero.name,
    side: 'hero',
    kind: hero.cls,
    stats,
    hp: Math.min(stats.maxHp, hp ?? stats.maxHp),
    cd: 0,
    skill: skill ? { ...skill } : null,
    alive: (hp ?? stats.maxHp) > 0,
    heroId: hero.id,
    identity: hero.identity,
    rarity: hero.rarity,
    portrait: hero.portrait,
    cover: 0,
    turns: 0,
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

/** Элита по Combat Spec v0.3: HP ×1.35, ATK ×1.15 и видимая метка. */
export const ELITE_HP = 1.35;
export const ELITE_ATK = 1.15;

export function enemyUnit(id: EnemyKind, uid: string, scale: EnemyScale): Unit {
  const def = ENEMIES[id];
  if (!def) throw new Error(`Неизвестный враг: ${id}`);
  const t = scale.tier - 1;
  const hpAtk = Math.pow(1.3, t) * (1 + scale.ramp) * (scale.mult ?? 1);
  const defMult = Math.pow(1.15, t);
  const maxHp = Math.round(def.stats.maxHp * hpAtk * (scale.elite ? ELITE_HP : 1) * HP_SCALE);
  const stats: Stats = {
    maxHp,
    atk: Math.round(def.stats.atk * hpAtk * (scale.elite ? ELITE_ATK : 1)),
    def: Math.round(def.stats.def * defMult),
    spd: def.stats.spd,
  };
  const unit: Unit = {
    id: uid,
    name: def.name,
    side: 'enemy',
    kind: def.id,
    stats,
    hp: maxHp,
    cd: 0,
    skill: null,
    alive: true,
    intent: null,
    turns: 0,
  };
  if (def.boss) {
    unit.boss = true;
    unit.bossPhase = 1;
    unit.phaseTurns = 0;
  }
  if (scale.elite) unit.elite = true;
  return unit;
}
