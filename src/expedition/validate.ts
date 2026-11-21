import { MAX_HERO_LEVEL, MAX_TIER, PARTY_SIZE } from '../core/config';
import { RNG } from '../core/rng';
import { HERO_CLASSES, HERO_IDENTITIES, RARITIES } from '../core/types';
import { ENEMIES } from '../combat/data';
import { eventDef } from './events';
import { LAYERS } from './map';
import { isModuleId } from './modules';
import type { Run } from './run';

type Raw = Record<string, unknown>;
const record = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const number = (v: unknown, min = 0, max = Infinity): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const integer = (v: unknown, min = 0, max = Infinity): v is number => number(v, min, max) && Number.isInteger(v);
const oneOf = (v: unknown, values: readonly string[]): v is string => typeof v === 'string' && values.includes(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);
const unique = (v: readonly unknown[]): boolean => new Set(v).size === v.length;
const optionalNumber = (v: unknown, max = Infinity): boolean => v === undefined || number(v, 0, max);

function hero(v: unknown): boolean {
  return record(v) && text(v.id) && text(v.name) && oneOf(v.cls, HERO_CLASSES) &&
    (v.identity === null || oneOf(v.identity, HERO_IDENTITIES)) && oneOf(v.rarity, RARITIES) &&
    integer(v.level, 1, MAX_HERO_LEVEL) && oneOf(v.status, ['ready', 'wounded', 'lost']) &&
    number(v.woundedUntil) && integer(v.portrait, 1);
}

function intent(v: unknown, ids: Set<string>): boolean {
  return record(v) && oneOf(v.id, ['cleaver', 'heavyBlow', 'ashBolt', 'spectralWave']) &&
    text(v.name) && number(v.mult) && typeof v.aoe === 'boolean' &&
    (v.aoe ? v.targetId === null : text(v.targetId) && ids.has(v.targetId));
}

function skill(v: unknown): boolean {
  return v === null || record(v) && text(v.id) && text(v.name) && integer(v.cooldown) &&
    oneOf(v.target, ['enemy', 'allEnemies', 'ally']) && oneOf(v.effect, ['damage', 'heal', 'cover']) &&
    number(v.mult) && optionalNumber(v.penetration, 1) && optionalNumber(v.healPctMax, 1) && optionalNumber(v.coverPct, 1);
}

function battle(v: unknown, heroIds: Set<string>): boolean {
  if (!record(v) || !(v.rng instanceof RNG) || !Array.isArray(v.units) || v.units.length === 0 ||
      !v.units.every((u) => record(u) && text(u.id)) || !integer(v.round) ||
      !strings(v.queue) || !unique(v.queue) || !Array.isArray(v.log) ||
      !oneOf(v.result, ['ongoing', 'victory', 'defeat']) || !record(v.mods) ||
      !number(v.mods.skillDamageMult) || typeof v.mods.phoenix !== 'boolean') return false;
  const units = v.units as Raw[];
  const ids = new Set(units.map((u) => u.id as string));
  if (ids.size !== units.length || !v.queue.every((id) => ids.has(id)) ||
      !(v.current === null || text(v.current) && ids.has(v.current) && !v.queue.includes(v.current))) return false;
  const party: string[] = [];
  for (const u of units) {
    if (!text(u.name) || !oneOf(u.side, ['hero', 'enemy']) || !record(u.stats) ||
        !number(u.stats.maxHp, 1) || !['atk', 'def', 'spd'].every((key) => number((u.stats as Raw)[key])) ||
        !number(u.hp, 0, u.stats.maxHp) || typeof u.alive !== 'boolean' || u.alive !== (u.hp > 0) ||
        !integer(u.cd) || !skill(u.skill) || !optionalNumber(u.cover, 1) ||
        !optionalNumber(u.turns) || !optionalNumber(u.phaseTurns) ||
        !(u.intent === undefined || u.intent === null || intent(u.intent, ids))) return false;
    if (u.side === 'hero') {
      if (!text(u.heroId) || !heroIds.has(u.heroId) || !oneOf(u.kind, HERO_CLASSES) ||
          !(u.identity === undefined || u.identity === null || oneOf(u.identity, HERO_IDENTITIES))) return false;
      party.push(u.heroId);
    } else if (!text(u.kind) || !Object.hasOwn(ENEMIES, u.kind)) return false;
    if (u.bossPhase !== undefined && u.bossPhase !== 1 && u.bossPhase !== 2) return false;
  }
  if (!party.length || !unique(party) || !units.some((u) => u.side === 'enemy')) return false;
  if (v.current !== null && !units.find((u) => u.id === v.current)?.alive) return false;
  if (v.result === 'ongoing' && (!units.some((u) => u.side === 'hero' && u.alive) ||
      !units.some((u) => u.side === 'enemy' && u.alive))) return false;
  for (const key of ['shooterBasicBonus', 'pierceLeft', 'wardenLeft', 'firstRoundSpd', 'bossWard']) {
    if (!optionalNumber(v.mods[key])) return false;
  }
  // Logs are rendered with unitById: dangling references must not reach the UI.
  for (const e of v.log) {
    if (!record(e) || !text(e.t)) return false;
    for (const key of ['actor', 'target', 'unit', 'to']) {
      if (e[key] !== undefined && (!text(e[key]) || !ids.has(e[key] as string))) return false;
    }
    if (['prepare', 'cancel', 'ward'].includes(e.t) && !intent(e.intent, ids)) return false;
    const ref = (key: string) => text(e[key]) && ids.has(e[key] as string);
    switch (e.t) {
      case 'hit':
        if (!ref('actor') || !ref('target') || !number(e.dmg) || typeof e.killed !== 'boolean') return false;
        break;
      case 'heal':
      case 'aftercare':
        if (!ref('actor') || !ref('target') || !number(e.amount)) return false;
        break;
      case 'cover':
        if (!ref('actor') || !ref('target') || !number(e.pct, 0, 1)) return false;
        break;
      case 'prepare':
      case 'cancel':
      case 'ward':
        if (!ref('actor')) return false;
        break;
      case 'retarget':
        if (!ref('actor') || !ref('to')) return false;
        break;
      case 'phoenix':
        if (!ref('target')) return false;
        break;
      case 'bossPhase':
        if (!ref('unit') || !text(e.name) || e.phase !== 2) return false;
        break;
      case 'round':
        if (!integer(e.n, 1)) return false;
        break;
      case 'end':
        if (!oneOf(e.result, ['victory', 'defeat'])) return false;
        break;
    }
  }
  return true;
}

/** Validate restored data before any screen, controller or reward code can use it. */
export function validRun(value: unknown): value is Run {
  if (!record(value)) return false;
  const r = value;
  if (!integer(r.seed, 0, 0xffffffff) || !integer(r.tier, 1, MAX_TIER) || !(r.rng instanceof RNG) ||
      !oneOf(r.stage, ['map', 'battle', 'event', 'eventResult', 'chest', 'camp', 'prep', 'ended']) ||
      !record(r.heroes) || !Array.isArray(r.members) || r.members.length !== PARTY_SIZE ||
      !Array.isArray(r.map) || !r.map.length || !strings(r.visited) || !unique(r.visited) ||
      !strings(r.eventsSeen) || !strings(r.fallen) || !unique(r.fallen) ||
      !Array.isArray(r.relics) || !r.relics.every((id) => typeof id === 'string' && isModuleId(id)) ||
      !record(r.postBonus) || !['hpPct', 'atkPct', 'campHeal'].every((key) => number((r.postBonus as Raw)[key])) ||
      !number(r.atkBuff) || !number(r.essenceEarned, -Infinity) || !optionalNumber(r.goldEarned) ||
      !number(r.enemyMult, Number.MIN_VALUE) || !integer(r.nodesCleared) || !integer(r.elitesCleared) ||
      !integer(r.pendingRecruits) || !integer(r.reviveLeft, 0, 1) ||
      !['safe', 'finished', 'phoenixLeft', 'pendingAmbush'].every((key) => typeof r[key] === 'boolean') ||
      !(r.pouchUsed === undefined || typeof r.pouchUsed === 'boolean') ||
      !(r.bossPrep === undefined || r.bossPrep === null || oneOf(r.bossPrep, ['heal', 'ward']))) return false;

  const heroIds: string[] = [];
  for (const member of r.members) {
    if (!record(member) || !text(member.heroId) || !Object.hasOwn(r.heroes, member.heroId) ||
        !hero(r.heroes[member.heroId]) || (r.heroes[member.heroId] as Raw).id !== member.heroId ||
        typeof member.alive !== 'boolean' || !number(member.frac, 0, 1) ||
        member.alive !== (member.frac > 0) || member.alive === r.fallen.includes(member.heroId)) return false;
    heroIds.push(member.heroId);
  }
  if (!unique(heroIds) || !r.fallen.every((id) => heroIds.includes(id))) return false;
  if (r.stage !== 'ended' && !r.members.some((m) => (m as Raw).alive)) return false;
  if (!Object.entries(r.heroes).every(([id, h]) => heroIds.includes(id) && hero(h))) return false;

  const nodes = r.map;
  if (!nodes.every((n) => record(n) && text(n.id) && integer(n.layer, 1, LAYERS + 1) && integer(n.index) &&
      oneOf(n.type, ['battle', 'elite', 'event', 'chest', 'camp', 'boss']) && strings(n.next) && unique(n.next))) return false;
  const byId = new Map((nodes as Raw[]).map((n) => [n.id as string, n]));
  if (byId.size !== nodes.length) return false;
  for (const n of byId.values()) {
    if (n.layer !== LAYERS + 1 && !(n.next as string[]).length) return false;
    if (!(n.next as string[]).every((id) => byId.get(id)?.layer === (n.layer as number) + 1)) return false;
  }
  if (!nodes.some((n) => (n as Raw).layer === 1) || !nodes.some((n) => (n as Raw).layer === LAYERS + 1)) return false;
  const visited = r.visited;
  if (r.completedNodes !== undefined && (!strings(r.completedNodes) || !unique(r.completedNodes) ||
      r.completedNodes.length !== r.nodesCleared || !r.completedNodes.every((id, i) => visited[i] === id))) return false;
  if (!visited.every((id, i) => byId.has(id) && (i === 0 ? byId.get(id)!.layer === 1 :
      (byId.get(visited[i - 1] as string)!.next as string[]).includes(id)))) return false;
  if (r.currentNodeId !== (r.visited.at(-1) ?? null)) return false;
  if (r.stage === 'map' && r.currentNodeId !== null && !(byId.get(r.currentNodeId as string)!.next as string[]).length) return false;
  if (r.stage !== 'map' && r.stage !== 'ended' && r.currentNodeId === null) return false;

  if (r.stage === 'battle') {
    if (!oneOf(r.battleKind, ['battle', 'elite', 'boss', 'ambush']) || !battle(r.battle, new Set(heroIds))) return false;
  } else if (r.battle !== null || r.battleKind !== null) return false;

  if (r.event !== null) {
    if (!record(r.event) || !text(r.event.id)) return false;
    try { eventDef(r.event.id); } catch { return false; }
  }
  if (r.stage === 'event' || r.stage === 'eventResult') {
    if (r.event === null) return false;
    if (r.stage === 'eventResult' && (!record(r.eventResult) || typeof r.eventResult.text !== 'string' ||
        !Array.isArray(r.eventResult.lines) || !r.eventResult.lines.every((s) => typeof s === 'string'))) return false;
  }
  if (r.chestOffers !== null) {
    if (!Array.isArray(r.chestOffers)) return false;
    const ids: string[] = [];
    for (const offer of r.chestOffers) {
      if (!record(offer) || !text(offer.id)) return false;
      if (offer.kind === 'module' ? !(typeof offer.module === 'string' && isModuleId(offer.module)) :
          offer.kind === 'heal' ? !number(offer.pct, 0, 1) : offer.kind === 'essence' ? !number(offer.amount) : true) return false;
      ids.push(offer.id);
    }
    if (!unique(ids)) return false;
  }
  if (r.stage === 'chest' && (!Array.isArray(r.chestOffers) || r.chestOffers.length === 0)) return false;
  if (r.stage === 'ended' ? !oneOf(r.result, ['victory', 'defeat']) : r.result !== null || r.finished) return false;
  if (r.summary !== null) {
    const s = r.summary;
    if (!record(s) || r.stage !== 'ended' || !r.finished || s.result !== r.result || s.tier !== r.tier ||
        s.safe !== r.safe || !number(s.gold) || !number(s.essence) || !integer(s.nodesCleared) ||
        !['recruits', 'survivors', 'lost'].every((key) => Array.isArray(s[key]) && (s[key] as unknown[]).every(hero)) ||
        !(s.unlockedTier === null || integer(s.unlockedTier, 1, MAX_TIER)) ||
        !(s.doubled === undefined || typeof s.doubled === 'boolean')) return false;
  } else if (r.finished) return false;
  return true;
}
