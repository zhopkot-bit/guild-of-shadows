import { POSTS, type PostDef } from '../core/config';
import { buyPost, buyRelicarium, postIncome, relicariumCost, totalIncome, upgradeCost } from '../core/economy';
import { fmt } from '../core/num';
import { POST_IDS } from '../core/types';
import type { Ctx } from './ctx';
import { h } from './dom';

const MONO: Record<string, string> = { barracks: 'Ка', forge: 'Ку', library: 'Б', tavern: 'Т', alchemy: 'А' };
const POST_ART: Record<string, string> = { barracks: 'barracks', forge: 'forge', library: 'library', tavern: 'tavern', alchemy: 'alchemy' };

function effectText(ctx: Ctx, def: PostDef): string {
  const level = ctx.state.posts[def.id];
  const value = Math.min(def.effect.cap, def.effect.perLevel * level);
  return `${def.effect.label} +${Math.round(value * 100)}%`;
}

export function guildScreen(ctx: Ctx): HTMLElement {
  const root = h('section', { class: 'screen screen--guild' },
    h('div', { class: 'guild-hero' },
      h('img', { class: 'guild-hero__art', src: './art/scenes/citadel.webp', alt: 'Готическая цитадель гильдии', draggable: 'false', fetchpriority: 'high' }),
      h('div', { class: 'guild-hero__shade', 'aria-hidden': 'true' }),
      h('div', { class: 'guild-hero__content' },
        h('span', { class: 'eyebrow' }, 'ЦИТАДЕЛЬ НА КРАЮ ИЗВЕСТНОГО МИРА'),
        h('h1', null, 'Гильдия Теней'),
        h('p', null, 'Собирайте героев. Возвращайте свет в забытые земли.'),
        h('span', { class: 'guild-hero__rule' }, '✦  Укрепляйте убежище  ✦'),
      ),
    ),
    h('div', { class: 'section-heading' }, h('div', null, h('h2', null, 'Постройки гильдии'), h('p', { class: 'hint' }, 'Каждый зал открывает новые возможности. Доход продолжается, пока вас нет.'))),
  );

  const postGrid = h('div', { class: 'post-grid' });
  POSTS.forEach((def, i) => {
    const level = ctx.state.posts[def.id];
    const prev = i === 0 ? 1 : ctx.state.posts[POST_IDS[i - 1] as typeof def.id];
    if (level === 0 && prev === 0) return; // следующие посты не показываем, пока не открыт предыдущий

    const meta = h('div', { class: 'entry__meta' });
    const lvl = h('span', { class: 'entry__lvl num' });
    const btn = h('button', { class: 'btn btn--small' });
    btn.addEventListener('click', () => {
      const wasLocked = ctx.state.posts[def.id] === 0;
      if (!buyPost(ctx.state, def.id)) return;
      ctx.save();
      if (wasLocked) ctx.render();
    });

    const update = () => {
      const lv = ctx.state.posts[def.id];
      const cost = upgradeCost(def, lv);
      if (lv === 0) {
        meta.textContent = def.blurb;
        lvl.textContent = '';
        btn.textContent = `Открыть за ${fmt(cost)}`;
      } else {
        meta.textContent = '';
        meta.append(`Доход `, h('b', { class: 'num' }, `+${fmt(postIncome(def, lv))}/с`), `, ${effectText(ctx, def)}`);
        lvl.textContent = `ур. ${lv}`;
        btn.textContent = `Улучшить за ${fmt(cost)}`;
      }
      (btn as HTMLButtonElement).disabled = ctx.state.gold < cost;
    };
    update();
    ctx.live(update);

    postGrid.append(
      h(
        'div',
        { class: `entry entry--post post-${def.id}${level === 0 ? ' is-locked' : ''}` },
        h('div', { class: 'entry__art-wrap' },
          h('img', { class: 'entry__art', src: `./art/posts/${POST_ART[def.id] ?? 'barracks'}.webp`, alt: '', loading: 'lazy', draggable: 'false' }),
          h('span', { class: 'entry__seal', 'aria-hidden': 'true' }, MONO[def.id] ?? def.name.slice(0, 1)),
        ),
        h('div', { class: 'entry__body' }, h('div', { class: 'entry__title' }, h('h3', null, def.name), lvl), meta),
        h('div', { class: 'entry__actions' }, btn),
      ),
    );
  });
  root.append(postGrid);

  if (ctx.state.essence > 0 || ctx.state.relicarium > 0) {
    const btn = h('button', { class: 'btn btn--small' });
    const meta = h('div', { class: 'entry__meta' });
    btn.addEventListener('click', () => {
      if (buyRelicarium(ctx.state)) ctx.save();
    });
    const update = () => {
      const cost = relicariumCost(ctx.state.relicarium);
      meta.textContent = `Золото гильдии +${ctx.state.relicarium * 5}%. Куплено: ${ctx.state.relicarium}`;
      btn.textContent = `Улучшить за ${cost} эссенции`;
      (btn as HTMLButtonElement).disabled = ctx.state.essence < cost;
    };
    update();
    ctx.live(update);
    root.append(
      h(
        'div',
        { class: 'entry entry--post entry--relicarium' },
        h('div', { class: 'entry__art-wrap' }, h('img', { class: 'entry__art', src: './art/posts/library.webp', alt: '', loading: 'lazy', draggable: 'false' }), h('span', { class: 'entry__seal', 'aria-hidden': 'true' }, 'Р')),
        h('div', { class: 'entry__body' }, h('div', { class: 'entry__title' }, h('h3', null, 'Реликварий')), meta),
        h('div', { class: 'entry__actions' }, btn),
      ),
    );
  }

  const total = h('p', { class: 'hint' });
  ctx.live(() => {
    total.textContent = `Всего ${fmt(totalIncome(ctx.state))} золота в секунду`;
  });
  root.append(total);
  return root;
}
