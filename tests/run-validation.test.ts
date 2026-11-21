import { describe, expect, it } from 'vitest';
import { newGame } from '../src/core/state';
import { deserialize, serialize } from '../src/core/save';
import { autoAction, runAuto } from '../src/combat/ai';
import { advance, applyAction } from '../src/combat/battle';
import { defaultChoose } from '../src/expedition/autoplay';
import {
  availableNodes, canStartRun, chooseBossPrep, chooseCamp, chooseChest, chooseEventOption, continueFromEvent, deserializeRun,
  enterNode, eventChoices, finishBattle, finishRun, serializeRun, startRun, type Run,
} from '../src/expedition/run';
import type { NodeType } from '../src/expedition/map';

const NOW = 1000;
const fresh = () => startRun(newGame(NOW), NOW, 1);
function atNode(type: NodeType): Run {
  const run = fresh();
  const node = availableNodes(run)[0]!;
  node.type = type;
  enterNode(run, node.id);
  return run;
}

describe('граница запуска экспедиции', () => {
  it.each([NaN, Infinity, -Infinity, 1.5, 0, -1, 4])('отклоняет глубину %s без побочных эффектов', (tier) => {
    const state = newGame(NOW);
    state.heroes[0]!.status = 'wounded';
    state.heroes[0]!.woundedUntil = NOW - 1;
    const before = serialize(state);
    expect(canStartRun(state, NOW, tier).ok).toBe(false);
    expect(() => startRun(state, NOW, tier)).toThrow();
    expect(serialize(state)).toBe(before);
  });

  it('не разрешает повторно использовать одного героя без загрузки сейва', () => {
    const state = newGame(NOW);
    state.party = Array(3).fill(state.party[0]);
    expect(canStartRun(state, NOW, 1).ok).toBe(false);
    expect(() => startRun(state, NOW, 1)).toThrow();
    expect(state.stats.expeditionsStarted).toBe(0);
  });

  it('не принимает отряд сверх лимита, даже если в нём ровно три разных героя', () => {
    const state = newGame(NOW);
    state.party.push(state.party[0]!);
    expect(canStartRun(state, NOW, 1).ok).toBe(false);
  });
});

describe('проверка активного забега', () => {
  const corruptions: Array<[string, (run: Run) => void]> = [
    ['нет героев', (r) => { delete (r as Partial<Run>).heroes; }],
    ['нет снимка участника', (r) => { delete r.heroes[r.members[0]!.heroId]; }],
    ['участники повторяются', (r) => { r.members[1]!.heroId = r.members[0]!.heroId; }],
    ['здоровье вне диапазона', (r) => { r.members[0]!.frac = 2; }],
    ['битый RNG', (r) => { Object.assign(r, { rng: { __gosRngState: -1 } }); }],
    ['несуществующая текущая точка', (r) => { r.currentNodeId = 'missing'; }],
    ['битая ссылка карты', (r) => { r.map[0]!.next = ['missing']; }],
    ['петля карты', (r) => { r.map[0]!.next = [r.map[0]!.id]; }],
    ['дубли узлов', (r) => { r.map[1]!.id = r.map[0]!.id; }],
    ['отсутствует список павших', (r) => { delete (r as Partial<Run>).fallen; }],
    ['павший участник не учтён', (r) => { r.members[0]!.alive = false; r.members[0]!.frac = 0; }],
    ['активный забег без живых участников', (r) => {
      for (const m of r.members) { m.alive = false; m.frac = 0; }
      r.fallen = r.members.map((m) => m.heroId);
    }],
    ['пустой сундук', (r) => { r.stage = 'chest'; r.chestOffers = []; }],
    ['сундук без предложений', (r) => { r.stage = 'chest'; r.chestOffers = null; }],
    ['событие без данных', (r) => { r.stage = 'event'; }],
    ['результат события без данных', (r) => { r.stage = 'eventResult'; }],
    ['завершённый забег без результата', (r) => { r.stage = 'ended'; }],
    ['применённые итоги без кеша', (r) => { r.stage = 'ended'; r.result = 'victory'; r.finished = true; }],
  ];
  it.each(corruptions)('отклоняет: %s', (_name, corrupt) => {
    const run = fresh();
    corrupt(run);
    expect(deserializeRun(serializeRun(run))).toBeNull();
  });

  it.each(['queue', 'current', 'doubleCurrent', 'hero', 'stats', 'intent', 'log', 'missingActor'] as const)('отклоняет повреждённое поле боя: %s', (field) => {
    const run = atNode('battle');
    const b = run.battle!;
    if (field === 'queue') b.queue.push('missing');
    if (field === 'current') b.current = 'missing';
    if (field === 'doubleCurrent') b.queue.push(b.current!);
    if (field === 'hero') b.units.find((u) => u.side === 'hero')!.heroId = 'missing';
    if (field === 'stats') b.units[0]!.stats.maxHp = 0;
    if (field === 'intent') b.units[0]!.intent = { id: 'cleaver', name: 'Удар', mult: 1, aoe: false, targetId: 'missing' };
    if (field === 'log') b.log.push({ t: 'heal', actor: 'missing', target: b.units[0]!.id, amount: 1, skill: 'Лечение' });
    if (field === 'missingActor') b.log.push({ t: 'heal', target: b.units[0]!.id, amount: 1, skill: 'Лечение' } as never);
    expect(deserializeRun(serializeRun(run))).toBeNull();
  });

  it('принимает все стадии, включая оконченный бой до подтверждения', () => {
    const runs = [fresh(), atNode('battle'), atNode('event'), atNode('chest'), atNode('camp'), atNode('boss')];
    const event = atNode('event');
    chooseEventOption(event, eventChoices(event).find((c) => c.available)!.choice.id);
    runs.push(event);
    const boss = atNode('boss');
    chooseBossPrep(boss, 'ward');
    runAuto(boss.battle!);
    runs.push(deserializeRun(serializeRun(boss))!);
    finishBattle(boss);
    runs.push(boss);
    for (const run of runs) {
      const copy = deserializeRun(serializeRun(run));
      expect(copy).not.toBeNull();
      expect(serializeRun(copy!)).toBe(serializeRun(run));
    }
  });

  it('после полной загрузки GameState не выдаёт награды и статистику повторно', () => {
    const state = newGame(NOW);
    const run = startRun(state, NOW, 1);
    run.stage = 'ended';
    run.result = 'victory';
    const summary = finishRun(run, state, NOW);
    summary.doubled = true;
    state.gold += summary.gold;
    state.activeRun = serializeRun(run);
    const loaded = deserialize(serialize(state), NOW);
    if (!loaded.ok) throw new Error('load');
    const before = serialize(loaded.state);
    expect(finishRun(deserializeRun(loaded.state.activeRun)!, loaded.state, NOW)).toEqual(summary);
    expect(serialize(loaded.state)).toBe(before);
  });

  it('проходит разные карты и составы с перезагрузкой после каждого действия', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const state = newGame(seed * 7919);
      state.expeditionsCompleted = 3;
      if (seed % 2 === 0) state.party = state.heroes.filter((h) => h.identity !== 'rook').map((h) => h.id);
      for (const h of state.heroes) h.level = 8;
      let run = startRun(state, NOW, 1);
      let steps = 0;
      for (;;) {
        const restored = deserializeRun(serializeRun(run));
        expect(restored, `seed=${seed}, stage=${run.stage}, step=${steps}`).not.toBeNull();
        run = restored!;
        if (run.stage === 'ended') break;
        if (++steps > 2000) throw new Error('run did not finish');
        switch (run.stage) {
          case 'map': enterNode(run, defaultChoose(run, availableNodes(run)).id); break;
          case 'battle': {
            const b = run.battle!;
            const actor = advance(b);
            if (actor) applyAction(b, autoAction(b, actor));
            else finishBattle(run);
            break;
          }
          case 'event': chooseEventOption(run, eventChoices(run).find((c) => c.available)!.choice.id); break;
          case 'eventResult': continueFromEvent(run); break;
          case 'chest': chooseChest(run, run.chestOffers![0]!.id); break;
          case 'camp': chooseCamp(run, 'rest'); break;
          case 'prep': chooseBossPrep(run, 'heal'); break;
        }
      }
      finishRun(run, state, NOW);
      expect(deserializeRun(serializeRun(run))).not.toBeNull();
    }
  });
});
