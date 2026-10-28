/**
 * Генерирует сохранения для визуальной приёмки через настоящие модули игры (без подделки состояния UI).
 * Запуск: npx tsx tools/qa/make-saves.ts <outDir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { advance, applyAction } from '../../src/combat/battle';
import { autoAction } from '../../src/combat/ai';
import { serialize } from '../../src/core/save';
import { newGame } from '../../src/core/state';
import type { GameState } from '../../src/core/types';
import { chooseBossPrep, enterNode, availableNodes, serializeRun, startRun, type Run } from '../../src/expedition/run';

const out = process.argv[2] ?? 'qa-saves';
mkdirSync(out, { recursive: true });
const T0 = Date.now();

function game(): GameState {
  const s = newGame(T0);
  // QA_PARTY=mira,rook,nora — проверить художнический пакет в нужном составе и порядке.
  if (process.env.QA_PARTY) {
    const identities = process.env.QA_PARTY.split(',');
    const party = identities.map((identity) => s.heroes.find((h) => h.identity === identity)?.id);
    if (party.length < 1 || party.length > 3 || new Set(party).size !== party.length || party.some((id) => !id)) {
      throw new Error('QA_PARTY: нужны 1–3 разных героя из стартового ростера');
    }
    s.party = party as string[];
  }
  s.gold = 5400;
  s.essence = 7;
  s.posts.forge = 3;
  s.expeditionsCompleted = 4;
  s.maxTier = 2;
  for (const h of s.heroes) h.level = 6;
  return s;
}

function save(name: string, s: GameState, run: Run | null): void {
  s.activeRun = run ? serializeRun(run) : null;
  writeFileSync(join(out, `${name}.json`), serialize(s));
  console.log('saved', name, run?.stage ?? 'guild');
}

/** Переход к узлу заданного типа по доступным путям (настоящие правила карты). */
function walkTo(run: Run, type: string): boolean {
  for (let i = 0; i < 12; i++) {
    const nodes = availableNodes(run);
    const want = nodes.find((n) => n.type === type);
    if (want) {
      enterNode(run, want.id);
      return true;
    }
    const step = nodes.find((n) => n.type === 'camp' || n.type === 'chest' || n.type === 'event') ?? nodes[0];
    if (!step) return false;
    enterNode(run, step.id);
    // Небоевые узлы закрываем «пустым» выбором, бой — пропускаем: нужен только путь к цели.
    if (run.stage !== 'map') {
      run.stage = 'map';
      run.battle = null;
      run.event = null;
      run.chestOffers = null;
    }
  }
  return false;
}

// 1. Гильдия без забега.
save('guild', game(), null);

// 2. Обычный бой на первом слое.
{
  const s = game();
  const run = startRun(s, T0, 1);
  walkTo(run, 'battle');
  save('battle', s, run);
}

// 2б. Событие Content Bible (экран выбора).
{
  const s = game();
  const run = startRun(s, T0, 1);
  walkTo(run, 'event');
  save('event', s, run);
}

// 3. Элита (усиленный Костяной страж) на глубине II.
{
  const s = game();
  const run = startRun(s, T0, 2);
  if (!walkTo(run, 'elite')) {
    run.stage = 'map';
    walkTo(run, 'battle');
  }
  save('elite', s, run);
}

// 4. Босс, фаза I, и тот же бой после нескольких ходов (телеграф клинка).
{
  const s = game();
  const run = startRun(s, T0, 1);
  walkTo(run, 'boss');
  save('boss-prep', s, run);
  chooseBossPrep(run, 'ward');
  save('boss', s, run);
  const b = run.battle!;
  for (let i = 0; i < 40; i++) {
    const actor = advance(b);
    if (!actor) break;
    const boss = b.units.find((u) => u.boss)!;
    if (boss.intent && actor.side === 'hero') break;
    applyAction(b, autoAction(b, actor));
  }
  save('boss-telegraph', s, run);
  // 5. Фаза II: доводим HP короля до порога настоящими ударами.
  for (let i = 0; i < 200; i++) {
    const boss = b.units.find((u) => u.boss)!;
    const actor = advance(b);
    if (!actor) break;
    if (boss.bossPhase === 2 && actor.side === 'hero' && boss.intent) break;
    const a = autoAction(b, actor);
    applyAction(b, a);
    // Герои не должны погибнуть до снимка: подлечиваем модель, а не UI.
    for (const u of b.units) if (u.side === 'hero' && u.alive && u.hp < u.stats.maxHp * 0.5) u.hp = Math.round(u.stats.maxHp * 0.8);
  }
  save('boss-phase2', s, run);
}
