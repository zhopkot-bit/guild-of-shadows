import { describe, expect, it } from 'vitest';
import { newGame } from '../src/core/state';
import { runAuto } from '../src/combat/ai';
import {
  availableNodes, chooseBossPrep, chooseCamp, chooseChest, chooseEventOption, continueFromEvent,
  deserializeRun, enterNode, eventChoices, finishBattle, finishRun, serializeRun, startRun, type Run,
} from '../src/expedition/run';
import type { NodeType } from '../src/expedition/map';

function fresh() {
  const state = newGame(1000);
  for (const hero of state.heroes) hero.level = 15;
  return { state, run: startRun(state, 1000, 1) };
}
function enter(run: Run, type: NodeType): void {
  const node = availableNodes(run)[0]!;
  node.type = type;
  enterNode(run, node.id);
}
function win(run: Run): void {
  expect(runAuto(run.battle!)).toBe('victory');
  finishBattle(run);
}
function event(run: Run, ambush = false): void {
  chooseEventOption(run, eventChoices(run).find((c) => c.available)!.choice.id);
  if (ambush) run.pendingAmbush = true;
  continueFromEvent(run);
}

describe('завершённые узлы экспедиции', () => {
  it('победа по маршруту со всеми типами узлов даёт ровно семь завершений', () => {
    const { state, run } = fresh();
    const types: NodeType[] = ['event', 'battle', 'chest', 'elite', 'event', 'camp', 'boss'];
    for (const [index, type] of types.entries()) {
      enter(run, type);
      expect(run.nodesCleared).toBe(index);
      switch (type) {
        case 'event': event(run); break;
        case 'chest': chooseChest(run, run.chestOffers![0]!.id); break;
        case 'camp': chooseCamp(run, 'rest'); break;
        case 'boss': chooseBossPrep(run, 'heal'); win(run); break;
        case 'elite':
          win(run);
          expect(run.nodesCleared).toBe(index);
          chooseChest(run, run.chestOffers![0]!.id);
          break;
        case 'battle': win(run); break;
      }
      expect(run.nodesCleared).toBe(index + 1);
      expect(deserializeRun(serializeRun(run))!.nodesCleared).toBe(index + 1);
    }
    expect(finishRun(run, state, 1000).nodesCleared).toBe(7);
    expect(run.completedNodes).toEqual(run.visited);
  });

  it('исход события не завершает узел до продолжения; засада считается один раз', () => {
    const { run } = fresh();
    enter(run, 'event');
    chooseEventOption(run, eventChoices(run).find((c) => c.available)!.choice.id);
    expect(run.nodesCleared).toBe(0);
    run.pendingAmbush = true;
    continueFromEvent(run);
    expect(run.nodesCleared).toBe(0);
    win(run);
    expect(run.nodesCleared).toBe(1);
    expect(run.completedNodes).toEqual(run.visited);
    expect(() => finishBattle(run)).toThrow();
    expect(run.nodesCleared).toBe(1);
  });

  it('элитная награда после перезагрузки не добавляет второй узел', () => {
    let { run } = fresh();
    enter(run, 'elite');
    win(run);
    run = deserializeRun(serializeRun(run))!;
    expect(run.nodesCleared).toBe(0);
    const offer = run.chestOffers![0]!.id;
    chooseChest(run, offer);
    expect(run.nodesCleared).toBe(1);
    expect(() => chooseChest(run, offer)).toThrow();
    expect(run.nodesCleared).toBe(1);
  });

  it('поражение не завершает текущий узел, добровольный выход сохраняет прошлые завершения', () => {
    const { run, state } = fresh();
    enter(run, 'camp');
    chooseCamp(run, 'rest');
    const abandoned = deserializeRun(serializeRun(run))!;
    abandoned.stage = 'ended';
    abandoned.result = 'defeat';
    expect(finishRun(abandoned, state, 1000).nodesCleared).toBe(1);
    enter(run, 'battle');
    for (const unit of run.battle!.units) if (unit.side === 'hero') { unit.hp = 0; unit.alive = false; }
    run.battle!.result = 'defeat';
    run.battle!.current = null;
    finishBattle(run);
    expect(run.nodesCleared).toBe(1);
    expect(deserializeRun(serializeRun(run))!.nodesCleared).toBe(1);
  });

  it('старый активный сейв пересчитывается по завершённому префиксу маршрута', () => {
    const { run } = fresh();
    enter(run, 'event'); event(run);
    enter(run, 'camp'); chooseCamp(run, 'rest');
    delete run.completedNodes;
    run.nodesCleared = 0; // старое значение учитывало только победы в боях
    const map = deserializeRun(serializeRun(run))!;
    expect(map.nodesCleared).toBe(2);
    enter(map, 'battle');
    delete map.completedNodes;
    map.nodesCleared = 0;
    const battle = deserializeRun(serializeRun(map))!;
    expect(battle.nodesCleared).toBe(2);
    win(battle);
    expect(battle.nodesCleared).toBe(3);
  });

  it('уже выданные исторические итоги не пересчитываются и не выдаются повторно', () => {
    const { state, run } = fresh();
    enter(run, 'camp'); chooseCamp(run, 'rest');
    delete run.completedNodes;
    run.nodesCleared = 0;
    run.stage = 'ended';
    run.result = 'defeat';
    const summary = finishRun(run, state, 1000);
    const gold = state.gold;
    const copy = deserializeRun(serializeRun(run))!;
    expect(finishRun(copy, state, 1000)).toEqual(summary);
    expect(copy.nodesCleared).toBe(0);
    expect(state.gold).toBe(gold);
  });
});
