/** Make renderer fixtures with real combat units from an existing QA battle.
 * Run make-saves.ts first with QA_PARTY=mira,rook,nora.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { enemyUnit } from '../../src/combat/data';
import type { EnemyKind } from '../../src/content/roster';

const src = process.argv[2] ?? 'qa-saves/mira';
const out = process.argv[3] ?? 'qa-saves/pose-sets';
mkdirSync(out, { recursive: true });
const scenarios: Record<string, EnemyKind[]> = {
  mixed: ['goblinRaider', 'boneGuard', 'ashWolf'],
  mage: ['ashMage'],
};
for (const [name, kinds] of Object.entries(scenarios)) {
  const save = JSON.parse(readFileSync(join(src, 'battle.json'), 'utf8'));
  const run = JSON.parse(save.activeRun);
  const battle = run.battle;
  const heroes = battle.units.filter((unit: { side: string }) => unit.side === 'hero');
  const enemies = kinds.map((kind, i) => enemyUnit(kind, `e${i + 1}`, { tier: 1, ramp: 0 }));
  battle.units = [...heroes, ...enemies];
  battle.queue = battle.queue.filter((id: string) => heroes.some((unit: { id: string }) => unit.id === id));
  battle.queue.push(...enemies.map((unit) => unit.id));
  save.activeRun = JSON.stringify(run);
  writeFileSync(join(out, `${name}.json`), JSON.stringify(save));
  console.log(`${name}: ${kinds.join(', ')}`);
}
for (const name of ['boss', 'boss-phase2']) {
  const file = readFileSync(join(src, `${name}.json`), 'utf8');
  writeFileSync(join(out, `${name}.json`), file);
}
