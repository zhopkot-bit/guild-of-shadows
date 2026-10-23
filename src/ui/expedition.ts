import { CLASSES } from '../combat/data';
import { MAX_TIER, PARTY_SIZE } from '../core/config';
import { fmt } from '../core/num';
import type { Hero } from '../core/types';
import { relicDef } from '../expedition/relics';
import type { MapNode } from '../expedition/map';
import {
  availableNodes,
  canRevive,
  canStartRun,
  chooseCamp,
  chooseChest,
  chooseEventOption,
  continueFromEvent,
  enterNode,
  eventChoices,
  finishRun,
  memberHp,
  memberStats,
  partyHeroes,
  reviveFallen,
  startRun,
  type Run,
  type RunSummary,
} from '../expedition/run';
import { battleScreen, stopBattleView } from './battleView';
import type { Ctx } from './ctx';
import { h } from './dom';
import { NODE_NAME, nodeIcon } from './icons';
import { portrait } from './portrait';

let selectedTier = 1;
let summary: RunSummary | null = null;
let summaryDoubled = false;

function btn(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  const b = h('button', { class: cls }, label);
  b.addEventListener('click', onClick);
  return b;
}

export function expeditionScreen(ctx: Ctx): HTMLElement {
  const run = ctx.run;
  if (!run) return lobby(ctx);
  const root = h('section', { class: `screen screen--expedition screen--stage-${run.stage}` });
  if (run.stage !== 'ended' && run.stage !== 'battle') root.append(runHead(ctx, run)); // в бою здоровье видно на самих юнитах
  switch (run.stage) {
    case 'map':
      root.append(mapView(ctx, run));
      break;
    case 'battle':
      root.append(battleScreen(ctx));
      break;
    case 'event':
      root.append(eventView(ctx, run));
      break;
    case 'eventResult':
      root.append(eventResultView(ctx, run));
      break;
    case 'chest':
      root.append(chestView(ctx, run));
      break;
    case 'camp':
      root.append(campView(ctx, run));
      break;
    case 'ended':
      root.append(summaryView(ctx, run));
      break;
  }
  return root;
}

// ---------- Лобби ----------

function lobby(ctx: Ctx): HTMLElement {
  const { state } = ctx;
  const root = h('section', { class: 'screen screen--expedition-lobby' },
    h('div', { class: 'expedition-hero' },
      h('img', { class: 'expedition-hero__art', src: './art/scenes/ruins_dusk.webp', alt: 'Забытые готические руины', draggable: 'false', fetchpriority: 'high' }),
      h('div', { class: 'expedition-hero__shade', 'aria-hidden': 'true' }),
      h('div', { class: 'expedition-hero__content' },
        h('span', { class: 'eyebrow' }, 'ЗА ПРЕДЕЛАМИ СТЕН'),
        h('h2', null, 'Экспедиция'),
        h('p', null, 'Там, где гаснут факелы, начинаются истории, за которые платят золотом.'),
      ),
    ),
  );
  const maxOpen = Math.min(state.maxTier, MAX_TIER);
  if (selectedTier > maxOpen) selectedTier = maxOpen;

  root.append(h('p', { class: 'hint' }, 'Выберите, куда идти дальше на карте. Бой можно вести самим или доверить его отряду.'));

  const slots = h('div', { class: 'slots' });
  const party = partyHeroes(state);
  for (let i = 0; i < PARTY_SIZE; i++) {
    const hero: Hero | undefined = party[i];
    slots.append(
      hero
        ? h('div', { class: 'slot' }, portrait({ kind: hero.cls, name: hero.name, size: 'md', rarity: hero.rarity }), h('div', { class: 'slot__name' }, hero.name))
        : h('div', { class: 'slot' }, h('div', { class: 'slot__empty' }), h('div', { class: 'slot__name' }, 'Пусто')),
    );
  }
  root.append(slots);

  if (maxOpen > 1) {
    const seg = h('div', { class: 'segmented' });
    for (let t = 1; t <= maxOpen; t++) {
      const b = h('button', { 'aria-pressed': t === selectedTier ? 'true' : 'false' }, `Подземелье ${t}`);
      b.addEventListener('click', () => {
        selectedTier = t;
        ctx.render();
      });
      seg.append(b);
    }
    root.append(h('div', { style: 'margin:12px 0' }, seg));
  }

  const reason = h('p', { class: 'hint' });
  const startBtn = h('button', { class: 'btn btn--block' }, 'Начать экспедицию');
  startBtn.addEventListener('click', () => {
    const check = canStartRun(state, ctx.now(), selectedTier);
    if (!check.ok) {
      ctx.toast(check.reason);
      return;
    }
    ctx.run = startRun(state, ctx.now(), selectedTier);
    summary = null;
    summaryDoubled = false;
    ctx.platform.gameplayStart();
    ctx.platform.track('run_start', { tier: selectedTier });
    ctx.save();
    ctx.render();
  });

  const update = () => {
    const check = canStartRun(state, ctx.now(), selectedTier);
    reason.textContent = check.ok ? '' : check.reason;
    (startBtn as HTMLButtonElement).disabled = !check.ok;
  };
  update();
  ctx.live(update);

  root.append(h('div', { class: 'lobby' }, reason, startBtn));
  return root;
}

// ---------- Шапка забега ----------

function runHead(ctx: Ctx, run: Run): HTMLElement {
  const head = h('div', { class: 'run-head' });
  for (const m of run.members) {
    const hero = run.heroes[m.heroId] as Hero;
    const max = memberStats(run, m).maxHp;
    const hp = memberHp(run, m);
    head.append(
      h(
        'div',
        { class: m.alive ? 'member' : 'member is-dead' },
        portrait({ kind: hero.cls, name: hero.name, size: 'sm', rarity: hero.rarity }),
        h(
          'div',
          { class: 'member__info' },
          h('div', { class: 'member__name' }, hero.name),
          h('div', { class: m.frac < 0.3 ? 'bar is-low' : 'bar' }, h('i', { style: `width:${Math.round((hp / max) * 100)}%` })),
          h('div', { class: 'bar-text num' }, `${hp} из ${max}`),
        ),
      ),
    );
  }
  const wrap = h('div', null, head);
  if (run.relics.length > 0) {
    wrap.append(h('div', { class: 'relics' }, ...run.relics.map((id) => h('span', { class: 'relic', title: relicDef(id).text }, relicDef(id).name))));
  }
  if (canRevive(run)) {
    wrap.append(
      h(
        'div',
        { style: 'margin-top:10px' },
        btn('Воскресить павшего за рекламу', async () => {
          const ok = await ctx.platform.showRewarded('revive');
          if (!ok) return;
          const hero = reviveFallen(run);
          if (hero) ctx.toast(`${hero.name} вернулся в строй`);
          ctx.render();
        }, 'btn btn--small btn--ghost'),
      ),
    );
  }
  return wrap;
}

// ---------- Карта ----------

function mapView(ctx: Ctx, run: Run): HTMLElement {
  const reachable = new Set(availableNodes(run).map((n) => n.id));
  const visited = new Set(run.visited);
  const layers = new Map<number, MapNode[]>();
  for (const n of run.map) layers.set(n.layer, [...(layers.get(n.layer) ?? []), n]);
  const maxLayer = Math.max(...layers.keys());

  const map = h('div', { class: 'map' });
  const svgNS = 'http://www.w3.org/2000/svg';
  const lines = document.createElementNS(svgNS, 'svg');
  lines.setAttribute('class', 'map__lines');
  map.append(lines);
  const nodeEls = new Map<string, HTMLElement>();

  for (let layer = maxLayer; layer >= 1; layer--) {
    const row = h('div', { class: 'map__row' });
    for (const node of layers.get(layer) ?? []) {
      const classes = ['node', `node--${node.type}`];
      const canGo = reachable.has(node.id);
      if (canGo) classes.push('is-reachable');
      if (visited.has(node.id)) classes.push('is-visited');
      if (run.currentNodeId === node.id) classes.push('is-current');
      const b = h('button', { class: classes.join(' '), 'aria-label': NODE_NAME[node.type] }, nodeIcon(node.type));
      (b as HTMLButtonElement).disabled = !canGo;
      b.addEventListener('click', () => {
        enterNode(run, node.id);
        ctx.render();
      });
      nodeEls.set(node.id, b);
      row.append(h('div', { class: 'node-wrap' }, b, h('span', { class: 'node-label' }, node.type === 'boss' ? 'Страж гробницы' : NODE_NAME[node.type])));
    }
    map.append(row);
  }

  // Линии рисуем после раскладки: координаты берём у реальных кнопок.
  const drawLines = () => {
    const box = map.getBoundingClientRect();
    if (box.width === 0) return;
    lines.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    lines.replaceChildren();
    for (const node of run.map) {
      const from = nodeEls.get(node.id);
      if (!from) continue;
      const a = from.getBoundingClientRect();
      for (const nextId of node.next) {
        const to = nodeEls.get(nextId);
        if (!to) continue;
        const c = to.getBoundingClientRect();
        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', String(a.left + a.width / 2 - box.left));
        line.setAttribute('y1', String(a.top + a.height / 2 - box.top));
        line.setAttribute('x2', String(c.left + c.width / 2 - box.left));
        line.setAttribute('y2', String(c.top + c.height / 2 - box.top));
        if (visited.has(node.id) && visited.has(nextId)) line.setAttribute('class', 'is-walked');
        lines.append(line);
      }
    }
  };
  window.requestAnimationFrame(drawLines);
  window.addEventListener('resize', drawLines, { once: true });

  const stage = h(
    'div',
    { class: 'stage' },
    h('h3', null, `Подземелье ${run.tier}`),
    h('p', { class: 'hint' }, run.currentNodeId === null ? 'Выберите, с чего начать путь.' : 'Выберите следующий узел.'),
    map,
    h('div', { class: 'btn-row', style: 'margin-top:8px' }, btn('Покинуть подземелье', () => abandon(ctx, run), 'btn btn--ghost btn--small')),
  );
  return stage;
}

function abandon(ctx: Ctx, run: Run): void {
  ctx.modal('Покинуть подземелье?', ['Жетон не вернётся, награда будет меньше. Павшие герои могут не выжить.'], [
    { label: 'Остаться', ghost: true },
    {
      label: 'Уйти',
      onClick: () => {
        run.stage = 'ended';
        run.result = 'defeat';
        ctx.render();
      },
    },
  ]);
}

// ---------- События, сундуки, лагерь ----------

function eventView(ctx: Ctx, run: Run): HTMLElement {
  const ev = run.event;
  if (!ev) return h('div');
  const list = h('div', { class: 'choice-list' });
  for (const { choice, hint } of eventChoices(run)) {
    const b = h('button', { class: 'btn btn--ghost' }, choice.label, hint ? h('small', null, hint) : null);
    b.addEventListener('click', () => {
      chooseEventOption(run, choice.id);
      ctx.render();
    });
    list.append(b);
  }
  return h('div', { class: 'stage' }, h('h3', null, ev.title), h('p', null, ev.text), list);
}

function eventResultView(ctx: Ctx, run: Run): HTMLElement {
  const res = run.eventResult;
  if (!res) return h('div');
  return h(
    'div',
    { class: 'stage' },
    h('h3', null, run.event?.title ?? 'Событие'),
    h('div', { class: 'outcome' }, h('p', null, res.text), res.lines.length > 0 ? h('ul', null, ...res.lines.map((l) => h('li', null, l))) : null),
    btn('Дальше', () => {
      continueFromEvent(run);
      ctx.render();
    }, 'btn btn--block'),
  );
}

function chestView(ctx: Ctx, run: Run): HTMLElement {
  const list = h('div', { class: 'choice-list' });
  for (const offer of run.chestOffers ?? []) {
    let label: string;
    let small: string;
    if (offer.kind === 'relic') {
      const r = relicDef(offer.relic);
      label = r.name;
      small = r.text;
    } else if (offer.kind === 'heal') {
      label = 'Лечебный настой';
      small = `Отряд восстанавливает ${Math.round(offer.pct * 100)}% здоровья`;
    } else {
      label = 'Эссенция';
      small = `+${offer.amount} Эссенции после забега`;
    }
    const b = h('button', { class: 'btn btn--ghost' }, label, h('small', null, small));
    b.addEventListener('click', () => {
      ctx.toast(chooseChest(run, offer.id));
      ctx.render();
    });
    list.append(b);
  }
  return h('div', { class: 'stage' }, h('h3', null, 'Сундук'), h('p', null, 'Заберите одну вещь: на всё сразу времени нет.'), list);
}

function campView(ctx: Ctx, run: Run): HTMLElement {
  const heal = Math.round((0.4 + run.postBonus.campHeal) * 100);
  const go = (opt: 'rest' | 'train') => () => {
    ctx.toast(chooseCamp(run, opt));
    ctx.render();
  };
  return h(
    'div',
    { class: 'stage' },
    h('h3', null, 'Лагерь'),
    h('p', null, 'Можно перевести дух или потренироваться.'),
    h(
      'div',
      { class: 'choice-list' },
      h('button', { class: 'btn btn--ghost', onclick: go('rest') }, 'Отдохнуть', h('small', null, `Отряд восстанавливает ${heal}% здоровья`)),
      h('button', { class: 'btn btn--ghost', onclick: go('train') }, 'Потренироваться', h('small', null, '+10% АТК до конца забега')),
    ),
  );
}

// ---------- Итоги ----------

function summaryView(ctx: Ctx, run: Run): HTMLElement {
  if (!summary) {
    const wasAlreadyFinished = run.finished;
    summary = finishRun(run, ctx.state, ctx.now());
    if (!wasAlreadyFinished) {
      ctx.platform.gameplayStop();
      ctx.platform.track('run_end', { result: summary.result, tier: summary.tier, nodes: summary.nodesCleared });
    }
    ctx.save();
  }
  const s = summary;
  const win = s.result === 'victory';
  const list = h('ul', { class: 'summary__list' });
  const goldLine = h('li', null, 'Золото: ', h('b', { class: 'num' }, `+${fmt(s.gold)}`));
  list.append(goldLine, h('li', null, 'Эссенция: ', h('b', { class: 'num' }, `+${s.essence}`)), h('li', null, `Пройдено узлов: ${s.nodesCleared}`));
  for (const hero of s.recruits) list.append(h('li', null, `Новый боец: ${hero.name}, ${CLASSES[hero.cls].name.toLowerCase()}`));
  if (s.safe) list.append(h('li', null, 'Защитное благословение первых экспедиций: павшие герои возвращаются без травм.'));
  for (const hero of s.survivors) {
    if (!s.safe) list.append(h('li', null, h('span', { class: 'tag tag--warn' }, 'Ранен'), ` ${hero.name} выжил и отдыхает 30 минут`));
  }
  for (const hero of s.lost) list.append(h('li', null, h('span', { class: 'tag tag--warn' }, 'Погиб'), ` ${hero.name} не вернулся`));
  if (s.unlockedTier) list.append(h('li', null, `Открыто подземелье ${s.unlockedTier}. Герои могут расти выше.`));

  const actions = h('div', { class: 'btn-row' });
  if (s.gold > 0 && !summaryDoubled) {
    const dbl = btn('Удвоить золото за рекламу', async () => {
      const ok = await ctx.platform.showRewarded('double_gold');
      if (!ok || summaryDoubled) return;
      summaryDoubled = true;
      ctx.state.gold += s.gold;
      ctx.save();
      goldLine.replaceChildren('Золото: ', h('b', { class: 'num' }, `+${fmt(s.gold * 2)}`));
      dbl.remove();
    }, 'btn btn--ghost');
    actions.append(dbl);
  }
  actions.append(btn('В гильдию', () => {
    ctx.run = null;
    summary = null;
    stopBattleView();
    ctx.save();
    ctx.render();
  }));

  return h(
    'div',
    { class: 'summary' },
    h('div', { class: win ? 'banner banner--win' : 'banner banner--lose' }, h('h3', null, win ? 'Экспедиция удалась' : 'Экспедиция провалена')),
    list,
    actions,
  );
}

