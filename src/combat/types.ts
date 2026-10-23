import type { RNG } from '../core/rng';
import type { HeroIdentity, Rarity } from '../core/types';

export type Side = 'hero' | 'enemy';

/** Цели умения указаны относительно того, кто его применяет. */
export type SkillTarget = 'enemy' | 'allEnemies' | 'ally';

export type SkillEffect = 'damage' | 'heal' | 'cover';

export interface Skill {
  id: string;
  name: string;
  /** Сколько своих ходов умение недоступно после применения. */
  cooldown: number;
  target: SkillTarget;
  effect: SkillEffect;
  /** Множитель урона; 0 — умение не наносит урон. */
  mult: number;
  /** Доля DEF цели, которую игнорирует удар (Прицельный выстрел — 0.3). */
  penetration?: number;
  /** Лечение: доля maxHP цели. */
  healPctMax?: number;
  /** Прикрытие: доля снижения следующего входящего удара. */
  coverPct?: number;
  /** Устаревшие поля сейвов v1; движок v2 их не использует. */
  ignoreDef?: boolean;
  healAtkMult?: number;
}

export interface Stats {
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
}

/**
 * Телеграф: подготовленный удар, который выполнится на следующем собственном ходу юнита.
 * Цель фиксируется в момент подготовки и видна игроку; если юнит выбыл — удар отменяется.
 */
export interface Intent {
  id: 'cleaver' | 'heavyBlow' | 'ashBolt' | 'spectralWave';
  name: string;
  mult: number;
  /** true — удар по всем живым героям; targetId не используется. */
  aoe: boolean;
  targetId: string | null;
}

export interface Unit {
  id: string;
  name: string;
  side: Side;
  /** Роль героя или вид противника (для ИИ и арта). */
  kind: string;
  stats: Stats;
  hp: number;
  /** Сколько своих ходов осталось до готовности умения. */
  cd: number;
  skill: Skill | null;
  alive: boolean;
  heroId?: string;
  identity?: HeroIdentity | null;
  rarity?: Rarity;
  portrait?: number;
  boss?: boolean;
  /** Текущая фаза босса; optional для совместимости со старыми сохранениями. */
  bossPhase?: 1 | 2;
  elite?: boolean;
  /** Подготовленный (телеграфированный) удар. */
  intent?: Intent | null;
  /** Снижение следующего входящего удара от Прикрытия (0..1). */
  cover?: number;
  /** Сколько собственных ходов юнит сделал (циклы особых атак). */
  turns?: number;
  /** Счётчик ходов босса с начала текущей фазы. */
  phaseTurns?: number;
}

export type ActionKind = 'attack' | 'skill' | 'prepare' | 'release';

export interface Action {
  actorId: string;
  kind: ActionKind;
  /** Не нужен для умений по всем врагам и для групповых телеграфов. */
  targetId?: string;
  /** Для prepare: какой удар готовится. */
  intent?: Intent;
}

export interface BattleMods {
  /** Множитель урона умений героев (Руна Огня). */
  skillDamageMult: number;
  /** Перо Феникса (наследие сейвов до v1.8): первый павший герой воскресает один раз. */
  phoenix: boolean;
  /** MOD02 Око ястреба: бонус урона обычной атаки Стрелка. */
  shooterBasicBonus?: number;
  /** MOD03 Пробивная стрела: пробитие первой атаки Стрелка в бою; 0 — заряд израсходован. */
  pierceLeft?: number;
  /** MOD04 Щит хранителя: фиксированное снижение первого удара по отряду; 0 — израсходован. */
  wardenLeft?: number;
  /** MOD07 Перо быстрого шага: +СКР героям в первом раунде. */
  firstRoundSpd?: number;
  /** Подготовка к боссу «Защита»: доля урона, снимаемая с первой спецатаки босса; 0 — израсходована. */
  bossWard?: number;
}

export interface HitInfo {
  t: 'hit';
  actor: string;
  target: string;
  dmg: number;
  skill?: string;
  /** Тип удара для подачи на арене. */
  via: 'attack' | 'skill' | 'intent';
  intentId?: Intent['id'];
  killed: boolean;
  /** Сколько урона поглотили Прикрытие/Последний заслон. */
  mitigated?: number;
  covered?: boolean;
  lastStand?: boolean;
  /** Сработал Щит хранителя (MOD04). */
  warden?: boolean;
  /** Сработала Пробивная стрела (MOD03). */
  pierced?: boolean;
}

export type BattleEvent =
  | { t: 'round'; n: number }
  | HitInfo
  | { t: 'heal'; actor: string; target: string; amount: number; skill: string }
  | { t: 'cover'; actor: string; target: string; pct: number }
  | { t: 'prepare'; actor: string; intent: Intent }
  | { t: 'retarget'; actor: string; from: string; to: string }
  | { t: 'cancel'; actor: string; intent: Intent }
  | { t: 'phoenix'; target: string }
  | { t: 'bossPhase'; unit: string; phase: 2; name: string }
  | { t: 'aftercare'; actor: string; target: string; amount: number }
  | { t: 'ward'; actor: string; intent: Intent }
  | { t: 'end'; result: 'victory' | 'defeat' };

export type BattleResult = 'ongoing' | 'victory' | 'defeat';

export interface Battle {
  units: Unit[];
  round: number;
  /** id тех, кто ещё не ходил в этом раунде. */
  queue: string[];
  /** Тот, чей ход сейчас (ждёт действия). */
  current: string | null;
  rng: RNG;
  log: BattleEvent[];
  result: BattleResult;
  mods: BattleMods;
  /** Пассивка Защитника «Последний заслон» уже сработала в этом бою. */
  lastStandUsed?: boolean;
  /** Версия схемы боя (2 — v1.7). */
  schema?: number;
}
