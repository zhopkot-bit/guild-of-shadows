/**
 * Симуляция баланса без интерфейса. Запуск: npm run sim
 *   1) экономика: жадный бот покупает самое выгодное, печатаем, когда открываются посты и сколько доход;
 *   2) экспедиции: процент побед и потерь по уровню героев и подземелью.
 * Цифры из этих таблиц — основа для настройки src/core/config.ts и src/combat/data.ts.
 */
import { POSTS } from '../src/core/config';
import { buyPost, postIncome, tick, totalIncome, upgradeCost } from '../src/core/economy';
import { newGame } from '../src/core/state';
import { fmt, fmtDuration } from '../src/core/num';
import { SAFE_EXPEDITIONS } from '../src/core/config';
import { autoPlayRun, type AutoPlayStats } from '../src/expedition/autoplay';
import { finishRun, startRun } from '../src/expedition/run';
import type { PostId } from '../src/core/types';

function economySim(): void {
  const s = newGame(0);
  let t = 0;
  const marks = [60, 300, 900, 3600, 4 * 3600, 12 * 3600, 24 * 3600];
  let nextMark = 0;
  const unlocked: Record<string, number> = {};
  const upgradeGaps: number[] = [];
  let lastBuy = 0;
  const STEP = 1; // секунда

  console.log('=== Экономика: жадный бот (активная игра) ===');
  while (t < 24 * 3600 && nextMark < marks.length) {
    // Лучшая покупка по окупаемости: цена / прирост дохода.
    let best: { id: PostId; cost: number; score: number } | null = null;
    for (const def of POSTS) {
      const lvl = s.posts[def.id];
      const cost = upgradeCost(def, lvl);
      const gain = postIncome(def, lvl + 1) - postIncome(def, lvl);
      if (gain <= 0) continue;
      const score = cost / gain;
      if (!best || score < best.score) best = { id: def.id, cost, score };
    }
    if (best && s.gold >= best.cost) {
      const before = s.posts[best.id];
      buyPost(s, best.id);
      if (before === 0) unlocked[best.id] = t;
      if (t < 600) upgradeGaps.push(t - lastBuy);
      lastBuy = t;
    } else if (best) {
      // перескочим время до накопления нужной суммы (но не дальше ближайшей отметки)
      const income = totalIncome(s);
      const need = best.cost - s.gold;
      const wait = income > 0 ? Math.max(STEP, Math.ceil(need / income)) : STEP;
      const dt = Math.min(wait, (marks[nextMark] as number) - t > 0 ? (marks[nextMark] as number) - t : STEP);
      tick(s, dt);
      t += dt;
    }
    while (nextMark < marks.length && t >= (marks[nextMark] as number)) {
      console.log(`  через ${fmtDuration(marks[nextMark] as number).padEnd(8)} доход ${fmt(totalIncome(s)).padStart(8)}/с  золото ${fmt(s.gold).padStart(8)}  уровни: ${POSTS.map((p) => s.posts[p.id]).join('/')}`);
      nextMark += 1;
    }
  }
  console.log('  открытие постов:', Object.entries(unlocked).map(([id, sec]) => `${id} ${fmtDuration(sec)}`).join(', '));
  const early = upgradeGaps.slice(0, 10);
  console.log('  паузы между первыми покупками (с):', early.join(', '));
}

/** Оценка длительности забега: ~0.7 с на действие в бою (×1) и ~8 с на каждое решение игрока. */
function estimateMinutes(st: AutoPlayStats, runs: number): number {
  return ((st.actions / runs) * 0.7 + (st.decisions / runs) * 8) / 60;
}

function runSim(): void {
  console.log('\n=== Экспедиции: бот-автобой, 300 забегов на ячейку ===');
  console.log('  подземелье / уровень героев → победы, павшие, пройдено узлов, оценка длительности');
  const N = 300;
  for (const tier of [1, 2, 3]) {
    for (const level of [1, 3, 5, 8, 12, 16]) {
      let wins = 0;
      let fallen = 0;
      let nodes = 0;
      const st: AutoPlayStats = { actions: 0, battles: 0, decisions: 0 };
      for (let i = 0; i < N; i++) {
        const s = newGame(1000 + i * 7919);
        s.tickets.count = 99;
        s.maxTier = 3;
        s.expeditionsCompleted = SAFE_EXPEDITIONS;
        for (const h of s.heroes) h.level = level;
        const run = startRun(s, 0, tier);
        autoPlayRun(run, undefined, st);
        fallen += run.fallen.length;
        nodes += run.nodesCleared;
        if (finishRun(run, s, 0).result === 'victory') wins++;
      }
      console.log(`  подземелье ${tier}, ур. ${String(level).padStart(2)}: победы ${String(Math.round((wins / N) * 100)).padStart(3)}%  павших ${(fallen / N).toFixed(2)}  узлов ${(nodes / N).toFixed(1)}/7  ~${estimateMinutes(st, N).toFixed(1)} мин`);
    }
  }

  console.log('\n=== Обучающие забеги (подземелье 1): свежий отряд, забег №1–3 ===');
  for (let k = 0; k < SAFE_EXPEDITIONS; k++) {
    for (const level of [1, 2, 3, 4]) {
      let wins = 0;
      let nodes = 0;
      for (let i = 0; i < N; i++) {
        const s = newGame(5000 + i * 104729);
        s.tickets.count = 99;
        s.expeditionsCompleted = k;
        for (const h of s.heroes) h.level = level;
        const run = startRun(s, 0, 1);
        autoPlayRun(run);
        nodes += run.nodesCleared;
        if (finishRun(run, s, 0).result === 'victory') wins++;
      }
      console.log(`  забег ${k + 1}, ур. ${level}: победы ${String(Math.round((wins / N) * 100)).padStart(3)}%  узлов ${(nodes / N).toFixed(1)}/7`);
    }
  }
}

economySim();
runSim();
