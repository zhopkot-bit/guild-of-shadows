import { CLASSES, SKILLS, heroStats } from '../combat/data';
import { heroArt, identityDef, roleName } from '../content/roster';
import { ARENAS } from '../content/arenas';
import { ArenaScene } from './arena/scene';
import { artFor } from '../content/artpack';
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

  const open = h('button', { class: 'hero-card-lg__open', type: 'button', 'aria-label': `Открыть героя: ${hero.name}` }, heroPortrait(hero, 128));
  open.addEventListener('click', () => heroSheet(hero));

  return h('article', { class: `hero-card-lg${inParty ? ' is-party' : ''} role-${hero.cls}`, 'data-hero': hero.identity ?? hero.id },
    h('div', { class: 'hero-card-lg__top' },
      open,
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

const ROLE_GLOW: Record<string, [number, number, number]> = {
  defender: [0.55, 0.75, 1],
  scout: [0.6, 1, 0.6],
  shooter: [1, 0.8, 0.45],
  healer: [0.75, 1, 0.7],
};

/** Экран героя: живая фигура на WebGL-сцене (та же, что в бою) + биография, характеристики, умения. */
function heroSheet(hero: Hero): void {
  const art = heroArt(hero);
  const def = hero.identity ? identityDef(hero.identity) : null;
  const stats = heroStats(hero);
  const cls = CLASSES[hero.cls];
  const skill = SKILLS[cls.skill];
  const stage = h('div', { class: 'hero-sheet__stage' });
  const close = h('button', { class: 'hero-sheet__close', type: 'button', 'aria-label': 'Закрыть' }, glyph('close', 22));
  const overlay = h('div', { class: 'overlay hero-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': hero.name },
    h('div', { class: `hero-sheet__panel role-${hero.cls}` },
      stage,
      h('div', { class: 'hero-sheet__info' },
        h('span', { class: 'eyebrow' }, def ? 'Герой гильдии' : 'Новобранец'),
        h('h2', null, hero.name),
        h('span', { class: 'hero-card-lg__epithet' }, def?.epithet ?? 'Боец гильдии'),
        h('span', { class: 'hero-card-lg__role' }, glyph(hero.cls, 14), roleName(hero), ' · ', `уровень ${hero.level}`),
        def ? h('p', { class: 'hero-sheet__bio' }, def.bio) : null,
        h('div', { class: 'hero-card-lg__stats' }, stat('HP', stats.maxHp, 'heart'), stat('АТК', stats.atk, 'sword'), stat('ЗАЩ', stats.def, 'shield'), stat('СКР', stats.spd, 'fast')),
        h('div', { class: 'hero-sheet__skill' }, glyph(hero.cls === 'defender' ? 'cover' : hero.cls === 'scout' ? 'lunge' : hero.cls === 'shooter' ? 'aimedShot' : 'healingLight', 30, 1.5),
          h('div', null, h('strong', null, `Умение: ${skill?.name ?? ''}`), h('span', null, `${cls.blurb} Перезарядка — ${skill?.cooldown ?? 0} хода.`))),
        h('div', { class: 'hero-sheet__skill' }, glyph('ember', 30, 1.5), h('div', null, h('strong', null, 'Пассивная черта'), h('span', null, cls.passive))),
      ),
      close,
    ),
  );
  document.body.append(overlay);
  let scene: ArenaScene | null = null;
  if (art.sprite) {
    const pack = hero.identity ? artFor('heroes', hero.identity) : null;
    scene = new ArenaScene(stage, { ...ARENAS.crypt, showcase: true }, [{
      id: hero.id, side: 'hero', sprite: art.sprite, flip: false, style: art.attackStyle, boss: false, wide: false,
      anim: pack?.anim ?? null, rig: pack?.rig ?? null,
      idle: { breath: 0.014, sway: 1.2, bob: 0.8, hover: 0, speed: 0.9 },
    }]);
    scene.showcaseLoop(hero.id, ROLE_GLOW[hero.cls] ?? [1, 1, 1]);
  }
  const shut = () => {
    scene?.destroy();
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') shut();
  };
  document.addEventListener('keydown', onKey);
  close.addEventListener('click', shut);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) shut();
  });
  window.setTimeout(() => close.focus(), 30);
}
