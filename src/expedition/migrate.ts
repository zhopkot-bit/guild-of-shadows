import { CLASSES, SKILLS } from '../combat/data';
import { BOSS_PHASE2_NAME, ENEMIES } from '../combat/data';
import { LEGACY_ENEMY_KIND } from '../content/roster';
import { eventDef } from './events';

type Raw = Record<string, unknown>;

const LEGACY_ROLE: Record<string, string> = { warrior: 'defender', mage: 'shooter', rogue: 'scout', priest: 'healer' };

function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Переводит сохранённый активный забег v1 (сейвы v1.4) в схему v2 без потери прогресса:
 * роли и личности героев, канонические виды врагов, умения по ролям, события Content Bible.
 * Состояние RNG, карта, HP и очередь хода сохраняются как есть.
 */
export function migrateRunJsonV1(json: string, migrateHero: (raw: unknown) => unknown): string {
  let run: unknown;
  try {
    run = JSON.parse(json);
  } catch {
    return json;
  }
  if (!isObject(run)) return json;
  const heroes: Raw = {};
  if (isObject(run.heroes)) {
    for (const [id, h] of Object.entries(run.heroes)) heroes[id] = migrateHero(h);
    run.heroes = heroes;
  }
  if (isObject(run.event) && typeof run.event.id === 'string') {
    try {
      run.event = eventDef(run.event.id);
    } catch {
      run.event = null;
      if (run.stage === 'event') run.stage = 'map';
    }
  }
  if (isObject(run.battle) && Array.isArray(run.battle.units)) {
    const b = run.battle;
    b.schema = 2;
    b.lastStandUsed = false;
    b.units = (b.units as unknown[]).map((u) => {
      if (!isObject(u)) return u;
      if (u.side === 'hero') {
        const hero = typeof u.heroId === 'string' ? heroes[u.heroId] : undefined;
        const role = isObject(hero) && typeof hero.cls === 'string' ? hero.cls : LEGACY_ROLE[String(u.kind)] ?? 'defender';
        const cls = CLASSES[role as keyof typeof CLASSES] ?? CLASSES.defender;
        const skill = SKILLS[cls.skill];
        return {
          ...u,
          kind: cls.cls,
          identity: isObject(hero) ? hero.identity ?? null : null,
          skill: skill ? { ...skill } : null,
          cd: Math.min(2, Math.max(0, Number(u.cd) || 0)),
          cover: 0,
          turns: 0,
        };
      }
      const kind = LEGACY_ENEMY_KIND[String(u.kind)] ?? String(u.kind);
      const out: Raw = { ...u, kind, skill: null, intent: null, turns: 0 };
      const def = ENEMIES[kind as keyof typeof ENEMIES];
      if (def && !u.elite) out.name = def.name;
      if (u.boss) {
        out.phaseTurns = 0;
        out.name = u.bossPhase === 2 ? BOSS_PHASE2_NAME : ENEMIES.boneKing.name;
      }
      return out;
    });
  }
  return JSON.stringify(run);
}
