import type { RNG } from '../core/rng';
import type { Rarity } from '../core/types';

export type Side = 'hero' | 'enemy';

/** Цели умения указаны относительно того, кто его применяет. */
export type SkillTarget = 'enemy' | 'allEnemies' | 'ally';

export interface Skill {
  id: string;
  name: string;
  /** Сколько своих ходов умение недоступно после применения. */
  cooldown: number;
  target: SkillTarget;
  /** Множитель урона; 0 — умение не наносит урон (лечение). */
  mult: number;
  ignoreDef?: boolean;
  healPctMax?: number;
  healAtkMult?: number;
}

export interface Stats {
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
}

export interface Unit {
  id: string;
  name: string;
  side: Side;
  /** Класс героя или id врага (для иконки/портрета). */
  kind: string;
  stats: Stats;
  hp: number;
  /** Сколько своих ходов осталось до готовности умения. */
  cd: number;
  skill: Skill | null;
  alive: boolean;
  heroId?: string;
  rarity?: Rarity;
  portrait?: number;
  boss?: boolean;
  /** Текущая фаза босса; optional для совместимости со старыми сохранениями. */
  bossPhase?: 1 | 2;
  elite?: boolean;
}

export interface Action {
  actorId: string;
  kind: 'attack' | 'skill';
  /** Не нужен для умений по всем врагам. */
  targetId?: string;
  /**
   * Результат тайминга игрока: множитель урона героя (0.5..1.5, по умолчанию 1).
   * Авторежим всегда играет с 1, поэтому баланс считается по нему, а ручная игра только добавляет сверху.
   */
  power?: number;
  /** Доля урона, которую гасит парирование героя (0..0.7, по умолчанию 0). Действует на удары врагов. */
  guard?: number;
}

export interface BattleMods {
  /** Множитель урона умений героев (Руна Огня). */
  skillDamageMult: number;
  /** Перо Феникса: первый павший герой воскресает один раз. */
  phoenix: boolean;
}

export type BattleEvent =
  | { t: 'round'; n: number }
  | { t: 'hit'; actor: string; target: string; dmg: number; skill?: string; killed: boolean }
  | { t: 'heal'; actor: string; target: string; amount: number; skill: string }
  | { t: 'phoenix'; target: string }
  | { t: 'bossPhase'; unit: string; phase: 2; name: string }
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
}
