import { runAuto } from '../combat/ai';
import type { MapNode } from './map';
import {
  availableNodes,
  chooseCamp,
  chooseChest,
  chooseEventOption,
  eventChoices,
  continueFromEvent,
  enterNode,
  finishBattle,
  liveMembers,
  type Run,
} from './run';

/**
 * Бот, который проходит забег целиком без интерфейса. Нужен для тестов и для симуляции баланса
 * (tools/sim.ts): «какой процент забегов выигрывается на уровне героев N».
 */

const NODE_SCORE: Record<MapNode['type'], number> = { chest: 6, event: 4, battle: 3, elite: 2, camp: 1, boss: 0 };

function avgFrac(run: Run): number {
  const live = liveMembers(run);
  return live.length === 0 ? 0 : live.reduce((s, m) => s + m.frac, 0) / live.length;
}

export function defaultChoose(run: Run, nodes: MapNode[]): MapNode {
  const hp = avgFrac(run);
  const score = (n: MapNode): number => {
    if (n.type === 'camp') return hp < 0.6 ? 10 : 1;
    if (n.type === 'elite') return hp > 0.8 ? 5 : 0;
    return NODE_SCORE[n.type];
  };
  return nodes.slice().sort((a, b) => score(b) - score(a))[0] as MapNode;
}

export interface AutoPlayStats {
  /** Сколько действий (ударов, умений) совершено во всех боях забега. */
  actions: number;
  battles: number;
  decisions: number;
}

export function autoPlayRun(
  run: Run,
  choose: (run: Run, nodes: MapNode[]) => MapNode = defaultChoose,
  stats?: AutoPlayStats,
): void {
  let guard = 0;
  while (run.stage !== 'ended') {
    if (++guard > 300) throw new Error('autoPlayRun: забег не завершается');
    switch (run.stage) {
      case 'map':
        if (stats) stats.decisions += 1;
        enterNode(run, choose(run, availableNodes(run)).id);
        break;
      case 'battle': {
        const battle = run.battle as NonNullable<Run['battle']>;
        runAuto(battle);
        if (stats) {
          stats.battles += 1;
          stats.actions += battle.log.filter((e) => e.t === 'hit' || e.t === 'heal').length;
        }
        finishBattle(run);
        break;
      }
      case 'event':
        // Бот выбирает первый доступный вариант (варианты Миры недоступны без неё в отряде).
        chooseEventOption(run, (eventChoices(run).find((c) => c.available) ?? eventChoices(run)[0])!.choice.id);
        break;
      case 'eventResult':
        continueFromEvent(run);
        break;
      case 'chest':
        chooseChest(run, (run.chestOffers as NonNullable<Run['chestOffers']>)[0]!.id);
        break;
      case 'camp':
        chooseCamp(run, avgFrac(run) < 0.9 ? 'rest' : 'train');
        break;
    }
  }
}
