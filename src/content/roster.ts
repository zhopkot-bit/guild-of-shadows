import type { Hero, HeroClass, HeroIdentity } from '../core/types';

/**
 * Единый реестр соответствия: heroId (Content Bible) → имя → роль → портрет → боевой спрайт.
 * UI, бой и тесты берут арт только отсюда. Выбор по классу/роли запрещён: две роли могут
 * совпасть у разных людей, а лицо принадлежит конкретному персонажу.
 */
export interface HeroIdentityDef {
  identity: HeroIdentity;
  contentId: 'HERO_BRAN' | 'HERO_MIRA' | 'HERO_ROOK' | 'HERO_NORA';
  name: string;
  epithet: string;
  role: HeroClass;
  /** Краткое визуальное описание для alt-текста и QA-сверки с концепт-артом. */
  look: string;
  portrait: string;
  sprite: string;
  /** Тип базовой атаки на арене: ближний бой или выстрел. */
  attackStyle: 'melee' | 'bow' | 'crossbow' | 'staff';
}

export const ROSTER: readonly HeroIdentityDef[] = [
  {
    identity: 'bran', contentId: 'HERO_BRAN', name: 'Бран', epithet: 'Опора', role: 'defender',
    look: 'тёмноволосый бородатый мужчина в латах, синий шарф, щит и меч',
    portrait: './art/v17/heroes/bran/portrait.webp', sprite: './art/v17/heroes/bran/sprite.webp', attackStyle: 'melee',
  },
  {
    identity: 'mira', contentId: 'HERO_MIRA', name: 'Мира', epithet: 'Глаз маршрута', role: 'scout',
    look: 'женщина в зелёном капюшоне, лук и колчан',
    portrait: './art/v17/heroes/mira/portrait.webp', sprite: './art/v17/heroes/mira/sprite.webp', attackStyle: 'bow',
  },
  {
    identity: 'rook', contentId: 'HERO_ROOK', name: 'Рук', epithet: 'Точный расчёт', role: 'shooter',
    look: 'черноволосый мужчина в тёмном плаще, арбалет',
    portrait: './art/v17/heroes/rook/portrait.webp', sprite: './art/v17/heroes/rook/sprite.webp', attackStyle: 'crossbow',
  },
  {
    identity: 'nora', contentId: 'HERO_NORA', name: 'Нора', epithet: 'Тихий свет', role: 'healer',
    look: 'светловолосая женщина в бело-синем одеянии, посох с кристаллом',
    portrait: './art/v17/heroes/nora/portrait.webp', sprite: './art/v17/heroes/nora/sprite.webp', attackStyle: 'staff',
  },
];

export const ROLE_NAME: Record<HeroClass, string> = {
  defender: 'Защитник',
  scout: 'Разведчик',
  shooter: 'Стрелок',
  healer: 'Целительница',
};

/** Имя роли с учётом рода канонического персонажа (Content Bible: «Целительница» у Норы). */
export function roleName(hero: Pick<Hero, 'cls'>): string {
  if (hero.cls === 'healer') return 'Целительница';
  return ROLE_NAME[hero.cls];
}

export function identityDef(identity: HeroIdentity): HeroIdentityDef {
  const def = ROSTER.find((d) => d.identity === identity);
  if (!def) throw new Error(`Неизвестный герой: ${identity}`);
  return def;
}

export interface HeroArt {
  portrait: string | null;
  sprite: string | null;
  /** Эмблема роли для безымянных новобранцев: без лица, чтобы не выдавать одного героя за другого. */
  emblem: HeroClass;
  attackStyle: HeroIdentityDef['attackStyle'];
}

const ROLE_ATTACK: Record<HeroClass, HeroIdentityDef['attackStyle']> = { defender: 'melee', scout: 'bow', shooter: 'crossbow', healer: 'staff' };

export function heroArt(hero: Pick<Hero, 'identity' | 'cls'>): HeroArt {
  if (hero.identity) {
    const def = identityDef(hero.identity);
    return { portrait: def.portrait, sprite: def.sprite, emblem: def.role, attackStyle: def.attackStyle };
  }
  return { portrait: null, sprite: null, emblem: hero.cls, attackStyle: ROLE_ATTACK[hero.cls] };
}

// ---------- Противники ----------

export type EnemyKind = 'goblinRaider' | 'ashWolf' | 'boneGuard' | 'ashMage' | 'boneKing';

export interface EnemyArt {
  contentId: string;
  portrait: string;
  sprite: string;
  attackStyle: 'melee' | 'pounce' | 'spell';
}

export const ENEMY_ART: Record<EnemyKind, EnemyArt> = {
  goblinRaider: { contentId: 'ENM_GOBLIN_RAIDER', portrait: './art/v17/enemies/goblin_raider/portrait.webp', sprite: './art/v17/enemies/goblin_raider/sprite.webp', attackStyle: 'melee' },
  ashWolf: { contentId: 'ENM_ASH_WOLF', portrait: './art/v17/enemies/ash_wolf/portrait.webp', sprite: './art/v17/enemies/ash_wolf/sprite.webp', attackStyle: 'pounce' },
  boneGuard: { contentId: 'ENM_BONE_GUARD', portrait: './art/v17/enemies/bone_guard/portrait.webp', sprite: './art/v17/enemies/bone_guard/sprite.webp', attackStyle: 'melee' },
  ashMage: { contentId: 'ENM_ASH_MAGE', portrait: './art/v17/enemies/ash_mage/portrait.webp', sprite: './art/v17/enemies/ash_mage/sprite.webp', attackStyle: 'spell' },
  boneKing: { contentId: 'BOSS_BONE_KING', portrait: './art/v17/boss/bone_king/portrait.webp', sprite: './art/v17/boss/bone_king/sprite.webp', attackStyle: 'melee' },
};

export const BOSS_EMISSIVE = './art/v17/boss/bone_king/emissive.webp';

/** Старые id врагов v1.4 (активные бои в сейвах) → канонические архетипы. */
export const LEGACY_ENEMY_KIND: Record<string, EnemyKind> = {
  skeleton: 'boneGuard',
  goblin: 'goblinRaider',
  troll: 'boneGuard',
  shaman: 'ashMage',
  guardian: 'boneKing',
};

export function isEnemyKind(kind: string): kind is EnemyKind {
  return kind in ENEMY_ART;
}
