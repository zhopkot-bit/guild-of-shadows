/** Make renderer fixtures with real combat units from an existing QA battle.
 * Run make-saves.ts first with QA_PARTY=mira,rook,nora.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { autoAction } from '../../src/combat/ai';
import { advance, applyAction, createBattle } from '../../src/combat/battle';
import { enemyUnit } from '../../src/combat/data';
import type { EnemyKind } from '../../src/content/roster';
import { hashSeed } from '../../src/core/rng';
import { deserializeRun, serializeRun } from '../../src/expedition/run';

const src = process.argv[2] ?? 'qa-saves/mira';
const out = process.argv[3] ?? 'qa-saves/pose-sets';
mkdirSync(out, { recursive: true });
const scenarios: Record<string, EnemyKind[]> = {
  mixed: ['goblinRaider', 'boneGuard', 'ashWolf'],
  mage: ['ashMage'],
};
for (const [name, kinds] of Object.entries(scenarios)) {
  const save = JSON.parse(readFileSync(join(src, 'battle.json'), 'utf8'));
  const run = deserializeRun(save.activeRun);
  assert(run?.battle && run.stage === 'battle', 'Expected a valid source battle');
  const heroes = run.battle.units.filter(unit => unit.side === 'hero');
  const enemies = kinds.map((kind, i) => enemyUnit(kind, `e${i + 1}`, { tier: 1, ramp: 0 }));
  const battle = createBattle(heroes, enemies, hashSeed('R01 pose fixture ' + name), run.battle.mods);
  let actor = advance(battle);
  while (actor?.side === 'enemy' && battle.round === 1) {
    applyAction(battle, autoAction(battle, actor));
    actor = advance(battle);
  }
  assert(actor?.side === 'hero' && actor.alive && battle.round === 1, 'Expected a first-round manual turn');
  run.battle = battle;
  save.activeRun = serializeRun(run);
  const restored = deserializeRun(save.activeRun);
  assert(restored?.battle, 'Fixture failed game deserialization: ' + name);
  assert.equal(advance(restored.battle)?.id, actor.id, 'Restoration must preserve the manual turn');
  assert.deepEqual(restored.battle.units.filter(unit => unit.side === 'enemy').map(unit => unit.kind), kinds);
  writeFileSync(join(out, `${name}.json`), JSON.stringify(save));
  console.log(`${name}: ${kinds.join(', ')}, round ${battle.round}, manual turn ${actor.id}`);
}
for (const name of ['boss', 'boss-phase2']) {
  const file = readFileSync(join(src, `${name}.json`), 'utf8');
  writeFileSync(join(out, `${name}.json`), file);
}
