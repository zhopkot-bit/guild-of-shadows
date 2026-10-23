import { HP_SCALE, MAX_TIER, PARTY_SIZE } from '../core/config';
import { fmt } from '../core/num';
import type { Hero } from '../core/types';
import { moduleDef } from '../expedition/modules';
import { ENEMIES } from '../combat/data';
import { shards } from '../content/text';
import type { MapNode } from '../expedition/map';
import {
  availableNodes,
  canRevive,
  canStartRun,
  BOSS_PREP_HEAL,
  chooseBossPrep,
  chooseCamp,
  chooseChest,
  encounterPreview,
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
import { enemyPortrait, heroPortrait } from './portrait';
import { glyph } from './glyphs';
import { roleName } from '../content/roster';

let selectedTier = 1;
let summary: RunSummary | null = null;

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
    case 'prep':
      root.append(prepView(ctx, run));
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
        ? h('div', { class: 'slot' }, heroPortrait(hero, 96), h('div', { class: 'slot__name' }, hero.name), h('div', { class: 'slot__role' }, roleName(hero)))
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

function moduleChips(run: Run): HTMLElement | null {
  if (run.relics.length === 0) return null;
  return h('div', { class: 'modules', 'aria-label': 'Модули экспедиции' },
    ...run.relics.map((id) => {
      const d = moduleDef(id);
      return h('span', { class: 'module-chip', title: `${d.name}: ${d.text}` }, glyph(d.glyph, 16), h('span', null, d.name));
    }));
}

function runHead(ctx: Ctx, run: Run): HTMLElement {
  const head = h('div', { class: 'run-head' });
  for (const m of run.members) {
    const hero = run.heroes[m.heroId] as Hero;
    const max = memberStats(run, m).maxHp;
    const hp = memberHp(run, m);
    head.append(
      h('div', { class: m.alive ? 'member' : 'member is-dead' },
        heroPortrait(hero, 48),
        h('div', { class: 'member__info' },
          h('div', { class: 'member__name' }, hero.name),
          h('div', { class: m.frac < 0.3 ? 'bar is-low' : 'bar' }, h('i', { style: `width:${Math.round((hp / max) * 100)}%` })),
          h('div', { class: 'bar-text num' }, `${hp} из ${max}`),
        ),
      ),
    );
  }
  const wrap = h('div', { class: 'run-head-wrap' }, head);
  const chips = moduleChips(run);
  if (chips) wrap.append(chips);
  if (canRevive(run)) {
    wrap.append(
      h('div', { style: 'margin-top:10px' },
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
  const reveal = run.relics.includes('pathfinderMap');
  const visited = new Set(run.visited);
  const layers = new Map<number, MapNode[]>();
  for (const n of run.map) layers.set(n.layer, [...(layers.get(n.layer) ?? []), n]);
  const maxLayer = Math.max(...layers.keys());

  const map = h('div', { class: 'map', style: "background-image: linear-gradient(180deg, rgba(6, 9, 14, 0.72), rgba(6, 9, 14, 0.88)), url('./art/v17/arena/crypt.webp'); background-size: cover; background-position: center;" });
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
      const label = h('span', { class: 'node-label' }, node.type === 'boss' ? 'Костяной король' : NODE_NAME[node.type]);
      // Карта следопыта (MOD06): состав противников доступных боёв виден заранее.
      if (reveal && canGo) {
        const kinds = encounterPreview(run, node);
        if (kinds) {
          const counts = new Map<string, number>();
          for (const k of kinds) counts.set(ENEMIES[k].name, (counts.get(ENEMIES[k].name) ?? 0) + 1);
          label.append(h('small', { class: 'node-scout' }, [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ')));
        }
      }
      row.append(h('div', { class: 'node-wrap' }, b, label));
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
  ctx.modal('Покинуть подземелье?', ['Экспедиция завершится поражением: награда будет меньше, павшие герои получат временную травму.'], [
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
  for (const { choice, hint, available } of eventChoices(run)) {
    const b = h('button', { class: 'btn btn--ghost' }, choice.label, hint ? h('small', null, hint) : null);
    if (!available) (b as HTMLButtonElement).disabled = true;
    b.addEventListener('click', () => {
      if (!available) return;
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
  const list = h('div', { class: 'offer-grid' });
  for (const offer of run.chestOffers ?? []) {
    let title: string;
    let text: string;
    let icon: Parameters<typeof glyph>[0];
    let tag: string;
    if (offer.kind === 'module') {
      const d = moduleDef(offer.module);
      title = d.name;
      text = d.text;
      icon = d.glyph;
      tag = `Модуль · ${d.category}`;
    } else if (offer.kind === 'heal') {
      title = 'Лечебный настой';
      text = `Отряд восстанавливает ${Math.round(offer.pct * 100)}% здоровья`;
      icon = 'heart';
      tag = 'Сразу';
    } else {
      title = 'Осколки реликвий';
      text = `+${shards(offer.amount)} после забега`;
      icon = 'ember';
      tag = 'Награда';
    }
    const b = h('button', { class: 'offer', type: 'button' }, h('span', { class: 'offer__icon' }, glyph(icon, 34, 1.5)), h('span', { class: 'offer__tag' }, tag), h('strong', null, title), h('span', { class: 'offer__text' }, text));
    b.addEventListener('click', () => {
      ctx.toast(chooseChest(run, offer.id));
      ctx.save();
      ctx.render();
    });
    list.append(b);
  }
  const elite = (run.chestOffers ?? []).length > 0 && (run.chestOffers ?? []).every((o) => o.kind !== 'heal');
  return h('div', { class: 'stage stage--panel' },
    h('h3', null, elite ? 'Трофеи элитного стража' : 'Тайник'),
    h('p', null, 'Заберите одну вещь: модули действуют до конца экспедиции и не складываются.'),
    list);
}

function campView(ctx: Ctx, run: Run): HTMLElement {
  const heal = Math.round((0.4 + run.postBonus.campHeal) * 100);
  const potion = run.relics.includes('healingPotion');
  const go = (opt: 'rest' | 'train') => () => {
    ctx.toast(chooseCamp(run, opt));
    ctx.save();
    ctx.render();
  };
  return h('div', { class: 'stage stage--panel' },
    h('h3', null, 'Лагерь'),
    h('p', null, 'Короткий привал у затухающего костра. Можно перевести дух или потренироваться.'),
    h('div', { class: 'offer-grid' },
      h('button', { class: 'offer', type: 'button', onclick: go('rest') }, h('span', { class: 'offer__icon' }, glyph('heart', 34, 1.5)), h('span', { class: 'offer__tag' }, 'Отдых'), h('strong', null, 'Отдохнуть'), h('span', { class: 'offer__text' }, `Отряд восстанавливает ${heal}% здоровья${potion ? ` и ещё ${Math.round(15 * HP_SCALE)} HP (Зелье восстановления)` : ''}`)),
      h('button', { class: 'offer', type: 'button', onclick: go('train') }, h('span', { class: 'offer__icon' }, glyph('sword', 34, 1.5)), h('span', { class: 'offer__tag' }, 'Тренировка'), h('strong', null, 'Потренироваться'), h('span', { class: 'offer__text' }, '+10% АТК до конца забега')),
    ),
  );
}

/** Подготовка к боссу (Combat Spec v0.3): лечение ИЛИ защита от первой спецатаки. */
function prepView(ctx: Ctx, run: Run): HTMLElement {
  const go = (opt: 'heal' | 'ward') => () => {
    ctx.toast(chooseBossPrep(run, opt));
    ctx.save();
    ctx.render();
  };
  return h('div', { class: 'stage stage--panel stage--prep' },
    h('div', { class: 'prep-head' },
      enemyPortrait('boneKing', 'Костяной король', 128),
      h('div', null,
        h('span', { class: 'eyebrow' }, 'ТРОННЫЙ СКЛЕП'),
        h('h3', null, 'Перед боем с Костяным королём'),
        h('p', null, 'За дверью — древний король в тяжёлых доспехах. Сначала он бьёт тяжёлым клинком по одной цели, а когда доспехи треснут — призрачной волной по всему отряду. Подготовьтесь к одному из ударов.'),
      ),
    ),
    h('div', { class: 'offer-grid' },
      h('button', { class: 'offer', type: 'button', onclick: go('heal') }, h('span', { class: 'offer__icon' }, glyph('heart', 34, 1.5)), h('span', { class: 'offer__tag' }, 'Лечение'), h('strong', null, 'Перевязать раны'), h('span', { class: 'offer__text' }, `Каждый живой герой восстанавливает ${Math.round(BOSS_PREP_HEAL * 100)}% здоровья`)),
      h('button', { class: 'offer', type: 'button', onclick: go('ward') }, h('span', { class: 'offer__icon' }, glyph('cover', 34, 1.5)), h('span', { class: 'offer__tag' }, 'Защита'), h('strong', null, 'Сомкнуть щиты'), h('span', { class: 'offer__text' }, 'Первая спецатака короля (клинок или волна) наносит вдвое меньше урона')),
    ),
  );
}

// ---------- Итоги ----------

function countUp(el: HTMLElement, to: number, format: (n: number) => string): void {
  const start = performance.now();
  const dur = 900;
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / dur);
    el.textContent = format(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

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

  const goldNum = h('b', { class: 'num' }, '0');
  const shardNum = h('b', { class: 'num' }, '0');
  countUp(goldNum, s.doubled ? s.gold * 2 : s.gold, (n) => `+${fmt(Math.round(n))}`);
  countUp(shardNum, s.essence, (n) => `+${Math.round(n)}`);
  const rewards = h('div', { class: 'reward-tiles' },
    h('div', { class: 'reward-tile reward-tile--gold' }, glyph('crown', 30, 1.5), goldNum, h('span', null, 'золота')),
    h('div', { class: 'reward-tile reward-tile--shards' }, glyph('ember', 30, 1.5), shardNum, h('span', null, 'осколков реликвий')),
    h('div', { class: 'reward-tile' }, glyph('target', 30, 1.5), h('b', { class: 'num' }, String(s.nodesCleared)), h('span', null, 'пройдено узлов')),
  );

  const fallen = new Set(s.survivors.map((x) => x.id));
  const heroes = h('div', { class: 'summary-heroes' },
    ...Object.values(run.heroes).map((hero) => {
      const wounded = fallen.has(hero.id) && !s.safe;
      return h('div', { class: `summary-hero${fallen.has(hero.id) ? ' is-fallen' : ''}` },
        heroPortrait(hero, 96),
        h('strong', null, hero.name),
        h('span', { class: `tag ${wounded ? 'tag--warn' : 'tag--ok'}` }, wounded ? 'Ранен · отдых 30 мин' : fallen.has(hero.id) ? 'Пал, но без травмы' : 'В строю'),
      );
    }),
  );

  const notes = h('ul', { class: 'summary__list' });
  if (s.safe) notes.append(h('li', null, 'Защитное благословение первых экспедиций: павшие герои возвращаются без травм.'));
  if (s.unlockedTier) notes.append(h('li', null, `Открыто подземелье ${s.unlockedTier}. Предел уровня героев вырос.`));
  if (run.relics.length) notes.append(h('li', null, `Модули экспедиции: ${run.relics.map((id) => moduleDef(id).name).join(', ')}.`));

  const actions = h('div', { class: 'btn-row summary__actions' });
  // Флаг удвоения хранится в самих итогах забега: перезагрузка страницы не даёт удвоить повторно.
  if (s.gold > 0 && !s.doubled) {
    const dbl = btn('Удвоить золото за рекламу', async () => {
      const ok = await ctx.platform.showRewarded('double_gold');
      if (!ok || s.doubled) return;
      s.doubled = true;
      ctx.state.gold += s.gold;
      ctx.save();
      countUp(goldNum, s.gold * 2, (n) => `+${fmt(Math.round(n))}`);
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
  }, 'btn btn--primary'));

  return h('div', { class: `summary summary--${win ? 'win' : 'lose'}` },
    h('div', { class: 'summary__banner' },
      h('span', { class: 'eyebrow' }, `ПОДЗЕМЕЛЬЕ ${s.tier}`),
      h('h2', null, win ? 'Экспедиция удалась' : 'Экспедиция провалена'),
      h('p', null, win ? 'Костяной король повержен. Гильдия встречает отряд с добычей.' : 'Отряд отступил. Часть добычи удалось сохранить.'),
    ),
    rewards,
    heroes,
    notes,
    actions,
  );
}
