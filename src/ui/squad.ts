import { CLASSES, RARITY_NAME, heroStats } from '../combat/data';
import { PARTY_SIZE } from '../core/config';
import { heroLevelCap, heroUpgradeCost, recruitCost, recruitHero, refreshHeroes } from '../core/economy';
import { fmt, fmtDuration } from '../core/num';
import type { Hero } from '../core/types';
import type { Ctx } from './ctx';
import { h } from './dom';
import { portrait } from './portrait';

function heroPortrait(hero: Hero, size: 'sm' | 'md' | 'lg'): HTMLElement {
  return portrait({ kind: hero.cls, name: hero.name, size, rarity: hero.rarity });
}

export function squadScreen(ctx: Ctx): HTMLElement {
  const { state } = ctx;
  refreshHeroes(state, ctx.now());
  const root = h('section', { class: 'screen screen--squad' },
    h('div', { class: 'squad-hero' },
      h('img', { class: 'squad-hero__art', src: './art/scenes/hero-lineup.webp', alt: 'Герои гильдии: воин, следопыт и заклинатель', draggable: 'false', fetchpriority: 'high' }),
      h('div', { class: 'squad-hero__shade', 'aria-hidden': 'true' }),
      h('div', { class: 'squad-hero__content' },
        h('span', { class: 'eyebrow' }, 'КЛЯТВА ГИЛЬДИИ'),
        h('h2', null, 'Отряд героев'),
        h('p', null, `В экспедицию идут ${PARTY_SIZE} героя. Раненые отдыхают и возвращаются сами.`),
      ),
    ),
  );

  const slots = h('div', { class: 'slots' });
  for (let i = 0; i < PARTY_SIZE; i++) {
    const hero = state.heroes.find((x) => x.id === state.party[i]);
    if (!hero) {
      slots.append(h('div', { class: 'slot' }, h('div', { class: 'slot__empty' }), h('div', { class: 'slot__name' }, 'Пусто')));
      continue;
    }
    slots.append(h('div', { class: 'slot' }, heroPortrait(hero, 'md'), h('div', { class: 'slot__name' }, hero.name)));
  }
  root.append(slots);

  const list = state.heroes.filter((x) => x.status !== 'lost');
  for (const hero of list) {
    const inParty = state.party.includes(hero.id);
    const stats = heroStats(hero);
    const cls = CLASSES[hero.cls];

    const status = h('span', { class: 'tag' });
    const upBtn = h('button', { class: 'btn btn--small' });
    const partyBtn = h('button', { class: 'btn btn--small btn--ghost' }, inParty ? 'Убрать из отряда' : 'В отряд');
    partyBtn.addEventListener('click', () => {
      if (inParty) state.party = state.party.filter((id) => id !== hero.id);
      else if (state.party.length < PARTY_SIZE) state.party.push(hero.id);
      else {
        ctx.toast('Отряд полон: сначала уберите кого-нибудь');
        return;
      }
      ctx.save();
      ctx.render();
    });
    upBtn.addEventListener('click', () => {
      if (hero.level >= heroLevelCap(state)) return;
      if (state.gold < heroUpgradeCost(hero)) return;
      state.gold -= heroUpgradeCost(hero);
      hero.level += 1;
      ctx.save();
      ctx.render();
    });

    const update = () => {
      const cap = heroLevelCap(state);
      if (hero.status === 'wounded') {
        status.className = 'tag tag--warn';
        status.textContent = `Ранен ещё ${fmtDuration((hero.woundedUntil - ctx.now()) / 1000)}`;
        if (ctx.now() >= hero.woundedUntil) ctx.render();
      } else {
        status.className = 'tag tag--ok';
        status.textContent = 'Готов';
      }
      if (hero.level >= cap) {
        upBtn.textContent = `Предел: ${cap} ур.`;
        (upBtn as HTMLButtonElement).disabled = true;
      } else {
        const cost = heroUpgradeCost(hero);
        upBtn.textContent = `Усилить за ${fmt(cost)}`;
        (upBtn as HTMLButtonElement).disabled = state.gold < cost;
      }
    };
    update();
    ctx.live(update);

    root.append(
      h(
        'div',
        { class: 'entry', style: 'grid-template-columns:auto 1fr' },
        heroPortrait(hero, 'md'),
        h(
          'div',
          { class: 'entry__body' },
          h('div', { class: 'entry__title' }, h('h3', null, hero.name), h('span', { class: 'entry__lvl num' }, `ур. ${hero.level}`)),
          h('div', { class: 'entry__meta' }, `${cls.name}, `, h('span', { class: `rarity-text rar-${hero.rarity}` }, RARITY_NAME[hero.rarity].toLowerCase())),
          h('div', { class: 'entry__meta num' }, `HP ${stats.maxHp}, АТК ${stats.atk}, ЗАЩ ${stats.def}, СКР ${stats.spd}`),
          h('div', { class: 'entry__meta' }, status),
        ),
        h('div', { class: 'entry__actions btn-row' }, upBtn, hero.status === 'ready' || inParty ? partyBtn : null),
      ),
    );
  }

  const recruit = h('button', { class: 'btn btn--small' });
  recruit.addEventListener('click', () => {
    const hero = recruitHero(state);
    if (!hero) return;
    ctx.save();
    ctx.toast(`В гильдию пришёл ${hero.name}: ${CLASSES[hero.cls].name.toLowerCase()}`);
    ctx.render();
  });
  const upd = () => {
    const cost = recruitCost(state);
    recruit.textContent = `Нанять бойца за ${fmt(cost)}`;
    (recruit as HTMLButtonElement).disabled = state.gold < cost;
  };
  upd();
  ctx.live(upd);
  root.append(h('div', { class: 'lobby', style: 'margin-top:16px' }, h('p', { class: 'hint' }, 'Новобранцы приходят обычными, редкие находятся в экспедициях.'), recruit));
  return root;
}
