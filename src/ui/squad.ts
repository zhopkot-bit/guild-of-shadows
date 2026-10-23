import { CLASSES, SKILLS, heroStats } from '../combat/data';
import { identityDef, roleName } from '../content/roster';
import { PARTY_SIZE } from '../core/config';
import { heroLevelCap, heroUpgradeCost, refreshHeroes } from '../core/economy';
import { fmt, fmtDuration } from '../core/num';
import type { Hero } from '../core/types';
import type { Ctx } from './ctx';
import { h } from './dom';
import { glyph } from './glyphs';
import { heroPortrait } from './portrait';

function stat(label: string, value: number, icon: Parameters<typeof glyph>[0]): HTMLElement {
  return h('div', { class: 'stat' }, glyph(icon, 14), h('span', { class: 'stat__label' }, label), h('b', { class: 'num' }, String(value)));
}

export function squadScreen(ctx: Ctx): HTMLElement {
  const { state } = ctx;
  refreshHeroes(state, ctx.now());
  const root = h('section', { class: 'screen screen--squad' },
    h('div', { class: 'squad-hero' },
      h('img', { class: 'squad-hero__art', src: './art/scenes/hero-lineup.webp', alt: 'Бран, Мира, Рук и Нора в полный рост', draggable: 'false', fetchpriority: 'high' }),
      h('div', { class: 'squad-hero__shade', 'aria-hidden': 'true' }),
      h('div', { class: 'squad-hero__content' },
        h('span', { class: 'eyebrow' }, 'КЛЯТВА ГИЛЬДИИ'),
        h('h2', null, 'Отряд героев'),
        h('p', null, `В экспедицию идут ${PARTY_SIZE} героя из четырёх. Раненые отдыхают и возвращаются сами.`),
      ),
    ),
  );

  const slots = h('div', { class: 'slots', 'aria-label': 'Состав экспедиции' });
  for (let i = 0; i < PARTY_SIZE; i++) {
    const hero = state.heroes.find((x) => x.id === state.party[i]);
    slots.append(hero
      ? h('div', { class: 'slot' }, heroPortrait(hero, 96), h('div', { class: 'slot__name' }, hero.name), h('div', { class: 'slot__role' }, roleName(hero)))
      : h('div', { class: 'slot slot--empty' }, h('div', { class: 'slot__empty' }), h('div', { class: 'slot__name' }, 'Свободно')));
  }
  root.append(slots);

  const grid = h('div', { class: 'hero-grid' });
  for (const hero of state.heroes.filter((x) => x.status !== 'lost')) grid.append(heroCard(ctx, hero));
  root.append(grid);
  return root;
}

function heroCard(ctx: Ctx, hero: Hero): HTMLElement {
  const { state } = ctx;
  const inParty = state.party.includes(hero.id);
  const stats = heroStats(hero);
  const cls = CLASSES[hero.cls];
  const skill = SKILLS[cls.skill];
  const epithet = hero.identity ? identityDef(hero.identity).epithet : 'Новобранец';

  const status = h('span', { class: 'tag' });
  const upBtn = h('button', { class: 'btn btn--small', type: 'button' });
  const partyBtn = h('button', { class: `btn btn--small ${inParty ? 'btn--ghost' : ''}`, type: 'button' }, inParty ? 'Убрать из отряда' : 'В отряд');
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
    if (hero.level >= heroLevelCap(state) || state.gold < heroUpgradeCost(hero)) return;
    state.gold -= heroUpgradeCost(hero);
    hero.level += 1;
    ctx.save();
    ctx.render();
  });

  const update = () => {
    const cap = heroLevelCap(state);
    if (hero.status === 'wounded') {
      status.className = 'tag tag--warn';
      status.textContent = `Ранен: ещё ${fmtDuration((hero.woundedUntil - ctx.now()) / 1000)}`;
      if (ctx.now() >= hero.woundedUntil) ctx.render();
    } else {
      status.className = `tag ${inParty ? 'tag--party' : 'tag--ok'}`;
      status.textContent = inParty ? 'В отряде' : 'Готов';
    }
    if (hero.level >= cap) {
      upBtn.textContent = `Предел ${cap} ур.`;
      (upBtn as HTMLButtonElement).disabled = true;
    } else {
      const cost = heroUpgradeCost(hero);
      upBtn.textContent = `Усилить · ${fmt(cost)}`;
      (upBtn as HTMLButtonElement).disabled = state.gold < cost;
    }
    (partyBtn as HTMLButtonElement).disabled = !inParty && hero.status !== 'ready';
  };
  update();
  ctx.live(update);

  return h('article', { class: `hero-card-lg${inParty ? ' is-party' : ''} role-${hero.cls}`, 'data-hero': hero.identity ?? hero.id },
    h('div', { class: 'hero-card-lg__top' },
      heroPortrait(hero, 128),
      h('div', { class: 'hero-card-lg__id' },
        h('h3', null, hero.name),
        h('span', { class: 'hero-card-lg__epithet' }, epithet),
        h('span', { class: 'hero-card-lg__role' }, glyph(hero.cls, 14), roleName(hero)),
        h('span', { class: 'hero-card-lg__lvl num' }, `Уровень ${hero.level}`),
        status,
      ),
    ),
    h('div', { class: 'hero-card-lg__stats' }, stat('HP', stats.maxHp, 'heart'), stat('АТК', stats.atk, 'sword'), stat('ЗАЩ', stats.def, 'shield'), stat('СКР', stats.spd, 'fast')),
    h('div', { class: 'hero-card-lg__skill' },
      h('strong', null, skill?.name ?? ''), h('span', null, cls.blurb),
      h('em', null, cls.passive),
    ),
    h('div', { class: 'hero-card-lg__actions' }, upBtn, partyBtn),
  );
}
