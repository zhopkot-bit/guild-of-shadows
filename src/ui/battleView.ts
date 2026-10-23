import { autoAction } from '../combat/ai';
import { advance, applyAction, bossIntent, legalActions, turnOrder, unitById, aliveUnits } from '../combat/battle';
import type { Action, Battle, BattleEvent, Unit } from '../combat/types';
import { finishBattle } from '../expedition/run';
import type { Ctx } from './ctx';
import { h } from './dom';
import { portrait } from './portrait';
import { sfx } from './sfx';

/** Настройки боя живут дольше одного боя: выбрали «Авто» — так и останется. */
export const battlePrefs = { manual: true, speed: 1 as 1 | 2 | 4 };

interface UnitView {
  el: HTMLElement;
  portrait: HTMLElement;
  hp: HTMLElement;
  fill: HTMLElement;
  ghost: HTMLElement;
  bar: HTMLElement;
  cd: HTMLElement;
}

interface View {
  battle: Battle;
  dead: boolean;
  fast: boolean;
  timers: Set<number>;
  wakers: Set<() => void>;
  choice: ((a: Action) => void) | null;
  pending: { kind: 'attack' | 'skill'; targets: string[] } | null;
  units: Map<string, UnitView>;
}

const FIGHTER_ART: Record<string, string> = {
  warrior: 'warrior.webp', mage: 'mage.webp', rogue: 'rogue.webp', priest: 'priest.webp',
  skeleton: 'skeleton.webp', guardian: 'guardian.webp', goblin: 'goblin.webp', troll: 'troll.webp', shaman: 'shaman.webp', hunter: 'hunter.webp',
};

const SKILL_PATHS: Record<string, string> = {
  attack: 'M5 27L22 10M16 7l8 1 1 8M4 23l5 5M10 18l8 8',
  powerStrike: 'M4 27L23 8M16 6l9 1 1 9M5 8l5 5M3 15l5 5',
  fireWave: 'M17 3c1 7-7 8-5 14 1 3 4 3 5 1 2 3-1 7-5 7-6 0-9-7-5-12 2-3 4-4 4-10 3 2 5 5 6 8',
  backstab: 'M21 4L18 19 12 25 10 18 5 15zM5 26l5-5',
  heal: 'M12 3v18M3 12h18M20 21l-3-3M4 21l3-3',
  shamanHeal: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  groundSlam: 'M6 5l12 12M5 4l5-1 1 5M18 16l4 4M11 20l-2 4M5 18l-2 3M20 6l2 2M17 3l-1 3',
};

function skillGlyph(id: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', SKILL_PATHS[id] ?? SKILL_PATHS.attack ?? 'M4 4L28 28');
  svg.append(path);
  return svg;
}

let current: View | null = null;

export function stopBattleView(): void {
  const v = current;
  current = null;
  if (!v) return;
  v.dead = true;
  for (const t of v.timers) window.clearTimeout(t);
  v.timers.clear();
  for (const w of [...v.wakers]) w();
  v.wakers.clear();
}

function eventLine(b: Battle, e: BattleEvent): string | null {
  const name = (id: string) => unitById(b, id).name;
  switch (e.t) {
    case 'hit':
      return `${name(e.actor)}${e.skill ? `: ${e.skill}` : ''} → ${name(e.target)} −${e.dmg}${e.killed ? ' (пал)' : ''}`;
    case 'heal':
      return `${name(e.actor)}: ${e.skill} → ${name(e.target)} +${e.amount}`;
    case 'phoenix':
      return `Перо Феникса возвращает в строй: ${name(e.target)}`;
    case 'bossPhase':
      return `${name(e.unit)} переходит во II фазу: атаки усилились!`;
    default:
      return null;
  }
}

export function battleScreen(ctx: Ctx): HTMLElement {
  stopBattleView();
  const run = ctx.run;
  const maybeBattle = run?.battle;
  if (!run || !maybeBattle) return h('section', { class: 'stage' });
  const battle: Battle = maybeBattle;

  const view: View = { battle, dead: false, fast: false, timers: new Set(), wakers: new Set(), choice: null, pending: null, units: new Map() };
  current = view;

  const turns = h('div', { class: 'turns', 'aria-label': 'Порядок ходов' });
  const status = h('div', { class: 'controls__status', 'aria-live': 'polite' });
  const log = h('ul', { class: 'log battle-log' });
  const actions = h('div', { class: 'battle-actions' });
  const banner = h('div', { class: 'banner' });
  const bossHud = h('div', { class: 'boss-hud', 'aria-live': 'polite' });
  const fx = h('div', { class: 'fx' });
  const arena = h('div', { class: run.battleKind === 'boss' ? 'arena arena--boss' : 'arena' });
  arena.style.setProperty('--arena-art', run.battleKind === 'boss' ? 'url("./art/scenes/boss_phase1.webp")' : 'url("./art/scenes/crypt.webp")');

  // ---------- Построение сцены ----------

  // Фаза босса меняет имя на лету, а элитный суффикс выводим отдельно.
  const unitName = (u: Unit) => {
    if (u.boss && u.bossPhase === 2) return u.name;
    if (u.side === 'enemy' && u.elite) return u.name.replace(/ \(элита\)$/, '');
    return u.name;
  };
  const displayName = (u: Unit) => u.elite ? `${unitName(u)} (элита)` : unitName(u);

  const makeRow = (side: 'enemy' | 'hero') => {
    const row = h('div', { class: `battle__row battle__row--${side}` });
    for (const u of battle.units.filter((x) => x.side === side)) {
      const isFoe = side === 'enemy';
      const fill = h('i');
      const ghost = h('b');
      const bar = h('div', { class: 'bar unit__bar' }, ghost, fill);
      const hp = h('div', { class: 'unit__hp num' });
      const cd = h('div', { class: 'unit__cd' });
      const port = portrait({ kind: u.kind, name: unitName(u), size: 'xs', rarity: u.rarity, foe: isFoe, boss: u.boss });
      const spriteFile = FIGHTER_ART[u.kind] ?? `${u.kind}.webp`;
      const figure = h('img', {
        class: `unit__figure${u.boss ? ' unit__figure--scene-boss' : ''}`,
        src: `./art/sprites/${spriteFile}`,
        alt: '', draggable: 'false', loading: 'eager',
      });
      figure.addEventListener('error', () => {
        figure.classList.add('unit__figure--fallback');
        figure.src = `./art/portraits/${u.kind}.webp`;
      }, { once: true });
      const info = h('div', { class: 'unit__info' },
        h('div', { class: 'unit__name' }, displayName(u)),
        bar,
        hp,
        cd,
      );
      const plate = h('div', { class: 'unit__plate' }, port, info);
      const el = h('div', { class: `unit unit--${side}${u.boss ? ' unit--boss' : ''}`, role: 'button', tabindex: '-1', 'aria-label': displayName(u) }, figure, plate);
      el.addEventListener('click', () => onUnitClick(u.id));
      // A boss is already painted into the phase art; this element is its target hit-area.
      view.units.set(u.id, { el, portrait: u.boss ? el : figure, hp, fill, ghost, bar, cd });
      row.append(el);
    }
    return row;
  };

  const enemyRow = makeRow('enemy');
  const heroRow = makeRow('hero');
  const boss = battle.units.find((u) => u.boss);
  const combatField = h('div', { class: `battle battle--${run.battleKind === 'boss' ? 'boss' : 'regular'}` }, enemyRow, heroRow);
  arena.append(bossHud, combatField, fx);

  // ---------- Отрисовка состояния ----------

  const alive = () => !view.dead && current === view && ctx.run === run && run.battle === battle;

  const paintUnit = (u: Unit) => {
    const v = view.units.get(u.id);
    if (!v) return;
    const pct = `${Math.max(0, (u.hp / u.stats.maxHp) * 100)}%`;
    v.hp.textContent = `${u.hp} из ${u.stats.maxHp}`;
    const name = v.el.querySelector('.unit__name');
    if (name) name.textContent = displayName(u);
    v.portrait.setAttribute('aria-label', displayName(u));
    v.fill.style.width = pct;
    v.ghost.style.width = pct;
    v.bar.classList.toggle('is-low', u.hp / u.stats.maxHp < 0.3);
    if (u.alive) v.el.classList.remove('is-dead', 'is-dying');
    else if (!v.el.classList.contains('is-dying')) v.el.classList.add('is-dead');
    if (u.side === 'hero') v.cd.textContent = !u.alive || !u.skill ? '' : u.cd === 0 ? `${u.skill.name} готово` : `${u.skill.name} через ${u.cd}`;
  };

  const paintBossHud = () => {
    if (!boss) {
      bossHud.hidden = true;
      return;
    }
    bossHud.hidden = !boss.alive;
    if (!boss.alive) return;
    const intent = bossIntent(boss);
    const phaseArt = intent.phase === 2 ? 'boss_phase2.webp' : 'boss_phase1.webp';
    arena.style.setProperty('--arena-art', `url("./art/scenes/${phaseArt}")`);
    bossHud.classList.toggle('is-phase-two', intent.phase === 2);
    bossHud.replaceChildren(
      h('div', { class: 'boss-hud__top' },
        h('strong', null, unitName(boss)),
        h('span', { class: 'boss-hud__phase' }, `ФАЗА ${intent.phase === 2 ? 'II' : 'I'}`),
      ),
      h('div', { class: 'boss-hud__hp-row' },
        h('div', { class: 'boss-hud__hp-bar' }, h('i', { style: `width:${Math.max(0, boss.hp / boss.stats.maxHp * 100)}%` })),
        h('span', { class: 'boss-hud__hp num' }, `${boss.hp} / ${boss.stats.maxHp}`),
      ),
      h('div', { class: 'boss-hud__intent' },
        h('span', { class: 'boss-hud__warning', 'aria-hidden': 'true' }, '⚠'),
        h('span', null, `Готовит: ${intent.label}`),
      ),
      h('div', { class: 'boss-hud__detail' }, intent.detail),
    );
  };

  const paintAll = () => {
    for (const u of battle.units) paintUnit(u);
    paintBossHud();
    for (const [id, v] of view.units) {
      const targetable = view.pending?.targets.includes(id) ?? false;
      const foe = unitById(battle, id).side === 'enemy';
      v.el.classList.toggle('is-active', id === battle.current);
      v.el.classList.toggle('targetable', targetable);
      v.el.classList.toggle('foe-target', targetable && foe);
      v.el.classList.toggle('ally-target', targetable && !foe);
      v.el.setAttribute('tabindex', targetable ? '0' : '-1');
    }
  };

  const chip = (id: string, now: boolean) => {
    const u = unitById(battle, id);
    const isFoe = u.side === 'enemy';
    return h('div', { class: `turns__chip${isFoe ? ' is-foe' : ''}${now ? ' is-now' : ''}`, title: unitName(u) }, portrait({ kind: u.kind, name: unitName(u), size: 'xs', rarity: u.rarity, foe: isFoe, boss: u.boss }));
  };

  const paintTurns = () => {
    const { now, next } = turnOrder(battle);
    turns.replaceChildren();
    now.forEach((id, i) => turns.append(chip(id, i === 0 && battle.current === id)));
    if (next.length > 0) {
      turns.append(h('div', { class: 'turns__sep' }));
      for (const id of next.slice(0, Math.max(0, 8 - now.length))) turns.append(chip(id, false));
    }
    turns.append(h('div', { class: 'turns__label' }, `Р${Math.max(1, battle.round)}`));
  };

  // ---------- Время и эффекты ----------

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      if (view.fast || view.dead) return resolve();
      const id = window.setTimeout(() => {
        view.timers.delete(id);
        view.wakers.delete(resolve);
        resolve();
      }, ms / battlePrefs.speed);
      view.timers.add(id);
      view.wakers.add(resolve);
    });

  /** Относительно сцены: центр, и габариты элемента. */
  const rel = (el: Element) => {
    const a = arena.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - a.left + r.width / 2, y: r.top - a.top + r.height / 2, l: r.left - a.left, t: r.top - a.top, w: r.width, h: r.height };
  };

  const spawn = (cls: string, x: number, y: number, life: number, style?: Partial<CSSStyleDeclaration>): HTMLElement => {
    const el = h('div', { class: cls });
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    if (style) Object.assign(el.style, style);
    fx.append(el);
    window.setTimeout(() => el.remove(), life);
    return el;
  };

  const shake = () => {
    arena.classList.remove('is-shaking');
    void arena.offsetWidth;
    arena.classList.add('is-shaking');
  };

  const floatText = (id: string, text: string, cls: string) => {
    const v = view.units.get(id);
    if (!v) return;
    const f = h('span', { class: `float ${cls} num` }, text);
    v.el.append(f);
    window.setTimeout(() => f.remove(), 1200);
  };

  const banner2 = (text: string, foe: boolean) => {
    const b = spawn(`skill-banner${foe ? ' is-foe' : ''}`, 0, 0, 1000);
    b.textContent = text;
  };

  /** Рывок портрета к цели; onHit вызывается в точке удара. */
  const lunge = async (actor: Unit, targets: Unit[], onHit: () => void) => {
    const a = view.units.get(actor.id);
    const t = targets[0] ? view.units.get(targets[0].id) : undefined;
    if (view.fast || !a || !t) {
      onHit();
      return;
    }
    const from = rel(a.portrait);
    const to = rel(t.portrait);
    const dx = (to.x - from.x) * 0.62;
    const dy = (to.y - from.y) * 0.62;
    a.el.style.zIndex = '5';
    const fwd = a.portrait.animate(
      [{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${dx * -0.08}px,${dy * -0.08}px) scale(1.04)`, offset: 0.25 }, { transform: `translate(${dx}px,${dy}px) scale(1.14)` }],
      { duration: 190 / battlePrefs.speed, easing: 'cubic-bezier(.5,0,.9,.4)', fill: 'forwards' },
    );
    await fwd.finished.catch(() => undefined);
    onHit();
    const back = a.portrait.animate([{ transform: `translate(${dx}px,${dy}px) scale(1.14)` }, { transform: 'translate(0,0) scale(1)' }], { duration: 260 / battlePrefs.speed, easing: 'ease-out', fill: 'forwards' });
    await back.finished.catch(() => undefined);
    fwd.cancel();
    back.cancel();
    a.el.style.zIndex = '';
  };

  const cast = async (actor: Unit, onHit: () => void) => {
    const a = view.units.get(actor.id);
    if (view.fast || !a) {
      onHit();
      return;
    }
    const pulse = a.portrait.animate([{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.22)', filter: 'brightness(1.8)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 420 / battlePrefs.speed, easing: 'ease-in-out' });
    await sleep(210);
    onHit();
    await pulse.finished.catch(() => undefined);
  };

  const vfx = (actor: Unit, skillId: string | null, targets: Unit[], strong: boolean) => {
    const foe = actor.side === 'enemy';
    const els = targets.map((t) => view.units.get(t.id)?.portrait).filter((e): e is HTMLElement => e !== undefined);
    const centers = els.map(rel);
    const slash = (c: { x: number; y: number }, both: boolean) => {
      spawn(`fx-slash${foe ? ' fx-slash--foe' : ''}`, c.x, c.y, 400);
      if (both) spawn(`fx-slash fx-slash--b${foe ? ' fx-slash--foe' : ''}`, c.x, c.y, 500);
    };
    switch (skillId) {
      case 'fireWave': {
        sfx.fire();
        const l = Math.min(...centers.map((c) => c.x - 70));
        const r = Math.max(...centers.map((c) => c.x + 70));
        const y = centers.reduce((s, c) => s + c.y, 0) / Math.max(1, centers.length);
        spawn('fx-fire', l, y - 55, 800, { width: `${r - l}px`, height: '110px' });
        break;
      }
      case 'groundSlam': {
        spawn('fx-flash', 0, 0, 500);
        for (const c of centers) spawn('fx-wave', c.x, c.y + 30, 600);
        shake();
        break;
      }
      case 'powerStrike':
        for (const c of centers) {
          slash(c, true);
          spawn('fx-wave', c.x, c.y, 600);
        }
        break;
      case 'backstab':
        for (const c of centers) slash(c, true);
        break;
      case 'heal':
      case 'shamanHeal':
        for (const c of centers) {
          spawn('fx-glow', c.x, c.y, 900);
          for (let i = 0; i < 6; i++) spawn('fx-spark', c.x - 24 + i * 9, c.y + 10, 1000, { ['--dx' as string]: `${(i - 2.5) * 6}px` } as Partial<CSSStyleDeclaration>);
        }
        break;
      default:
        for (const c of centers) slash(c, strong);
    }
  };

  // ---------- Применение действия ----------

  const addLog = (events: BattleEvent[]) => {
    for (const e of events) {
      const line = eventLine(battle, e);
      if (line) log.append(h('li', null, line));
    }
    while (log.children.length > 3) log.firstElementChild?.remove();
  };

  /** Показывает последствия: числа, полоски, смерти. Возвращает true, если удар «тяжёлый» (нужна пауза). */
  const present = (actor: Unit, base: Action, events: BattleEvent[]): boolean => {
    const skillId = base.kind === 'skill' ? (actor.skill?.id ?? null) : null;
    let heavy = false;
    const hits = events.filter((e): e is Extract<BattleEvent, { t: 'hit' }> => e.t === 'hit');
    const targets = events.flatMap((e) => (e.t === 'hit' || e.t === 'heal' ? [unitById(battle, e.target)] : []));
    if (!view.fast) vfx(actor, skillId, targets, false);
    for (const e of events) {
      if (e.t === 'hit') {
        const target = unitById(battle, e.target);
        const v = view.units.get(e.target);
        const big = e.dmg >= target.stats.maxHp * 0.25;
        if (!view.fast && v) {
          floatText(e.target, `−${e.dmg}`, big && actor.side === 'hero' ? 'float--crit' : 'float--dmg');
          v.el.classList.remove('is-flash');
          void v.el.offsetWidth;
          v.el.classList.add('is-flash');
          sfx.hit(big);
        }
        if (big) heavy = true;
        if (e.killed && !target.alive && v) {
          if (view.fast) v.el.classList.add('is-dead');
          else {
            v.el.classList.add('is-dying');
            sfx.die();
            window.setTimeout(() => {
              v.el.classList.remove('is-dying');
              if (!target.alive) v.el.classList.add('is-dead');
            }, 650);
          }
        }
      } else if (e.t === 'heal') {
        if (!view.fast) {
          floatText(e.target, `+${e.amount}`, 'float--heal');
          sfx.heal();
        }
      } else if (e.t === 'phoenix' && !view.fast) {
        floatText(e.target, 'Феникс!', 'float--label is-good');
      } else if (e.t === 'bossPhase' && !view.fast) {
        banner2('ФАЗА II — ПРОБУЖДЕНИЕ', true);
        heavy = true;
      }
    }
    if (!view.fast && hits.length > 0 && heavy) shake();
    addLog(events);
    return heavy;
  };

  const performAction = async (actor: Unit, base: Action) => {
    const skill = base.kind === 'skill' ? actor.skill : null;
    const isHero = actor.side === 'hero';
    const foes = aliveUnits(battle, isHero ? 'enemy' : 'hero');
    const targets: Unit[] = base.targetId ? [unitById(battle, base.targetId)] : skill?.target === 'allEnemies' ? foes : [];
    const damaging = base.kind === 'attack' || (skill !== null && skill.mult > 0);

    const announcedBossIntent = actor.boss ? bossIntent(actor) : null;
    const bossActionDetail = announcedBossIntent
      ? targets.length > 1
        ? `${announcedBossIntent.label}: удар затронет весь отряд.`
        : targets[0]
          ? `${announcedBossIntent.label}: цель — ${unitName(targets[0])}.`
          : `${announcedBossIntent.label}. ${announcedBossIntent.detail}`
      : '';

    // Tactical turn-based action, matching the concept screens: no timing-ring/QTE minigame.
    if (!view.fast && actor.side === 'enemy' && damaging) {
      status.textContent = actor.boss && announcedBossIntent ? `ВНИМАНИЕ: ${bossActionDetail}` : `${unitName(actor)} готовит удар`;
      if (actor.boss && announcedBossIntent) banner2(announcedBossIntent.label, true);
      const av = view.units.get(actor.id);
      av?.portrait.animate(
        [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-8px) scale(1.06)', filter: 'brightness(1.45)' }, { transform: 'translateY(0) scale(1)' }],
        { duration: 520 / battlePrefs.speed, easing: 'ease-in-out' },
      );
      for (const t of targets) view.units.get(t.id)?.el.classList.add('is-victim');
      if (targets.length > 1) arena.classList.add('arena--incoming-aoe');
      await sleep(actor.boss ? 650 : 360);
    } else if (skill && !view.fast) {
      banner2(skill.name, !isHero);
      await sleep(220);
    }

    status.textContent = '';
    actions.replaceChildren(finishButton());
    let events: BattleEvent[] = [];
    let heavy = false;
    const apply = () => {
      events = applyAction(battle, { ...base });
      heavy = present(actor, base, events);
      paintAll();
    };
    if (damaging && (base.kind === 'attack' || skill?.target === 'enemy')) await lunge(actor, targets, apply);
    else await cast(actor, apply);
    for (const t of targets) view.units.get(t.id)?.el.classList.remove('is-victim');
    arena.classList.remove('arena--incoming-aoe');
    if (heavy && !view.fast) await sleep(120);
  };

  // ---------- Выбор игрока ----------

  const setPending = (kind: 'attack' | 'skill', targets: string[]) => {
    view.pending = { kind, targets };
    paintAll();
  };

  function onUnitClick(id: string): void {
    const p = view.pending;
    const actor = battle.current;
    if (!p || !actor || !p.targets.includes(id) || !view.choice) return;
    const resolve = view.choice;
    view.choice = null;
    view.pending = null;
    resolve({ actorId: actor, kind: p.kind, targetId: id });
  }

  const askPlayer = (actor: Unit): Promise<Action> =>
    new Promise((resolve) => {
      view.choice = resolve;
      view.pending = null;
      status.textContent = `Ход героя: ${actor.name}. Выберите действие.`;
      const legal = legalActions(battle, actor);
      const done = (a: Action) => {
        view.choice = null;
        view.pending = null;
        resolve(a);
      };
      const pick = (kind: 'attack' | 'skill', targets: string[], prompt: string) => {
        if (targets.length === 1) return done({ actorId: actor.id, kind, targetId: targets[0] as string });
        status.textContent = prompt;
        setPending(kind, targets);
      };
      actions.replaceChildren();
      const attackTargets = legal.filter((a) => a.kind === 'attack').map((a) => a.targetId as string);
      const attack = h('button', { class: 'action-card action-card--attack', 'aria-label': 'Обычная атака' },
        h('span', { class: 'action-card__glyph' }, skillGlyph('attack')),
        h('span', { class: 'action-card__name' }, 'Атака'),
        h('small', null, 'Выбрать цель'),
      );
      attack.addEventListener('click', () => pick('attack', attackTargets, 'Выберите врага на арене'));
      actions.append(attack);
      const skill = actor.skill;
      if (skill) {
        const skillActs = legal.filter((a) => a.kind === 'skill');
        const ready = actor.cd === 0 && skillActs.length > 0;
        const labelText = actor.cd > 0 ? `${skill.name} · ${actor.cd}` : skill.name;
        const btn = h('button', { class: `action-card action-card--skill${ready ? ' is-ready' : ''}`, 'aria-label': labelText },
          h('span', { class: 'action-card__glyph' }, skillGlyph(skill.id)),
          h('span', { class: 'action-card__name' }, skill.name),
          h('small', null, actor.cd === 0 ? (skill.target === 'allEnemies' ? 'Все враги' : skill.target === 'ally' ? 'Союзник' : 'Одна цель') : `Перезарядка: ${actor.cd}`),
        );
        if (!ready) (btn as HTMLButtonElement).disabled = true;
        btn.addEventListener('click', () => {
          if (skill.target === 'allEnemies') done({ actorId: actor.id, kind: 'skill' });
          else pick('skill', skillActs.map((a) => a.targetId as string), skill.target === 'ally' ? 'Выберите союзника для лечения' : 'Выберите цель навыка');
        });
        actions.append(btn);
      }
      actions.append(finishButton());
      paintAll();
    });

  // ---------- Ход боя ----------

  const finishButton = () => {
    const b = h('button', { class: 'btn btn--ghost' }, 'Досчитать бой');
    b.addEventListener('click', () => {
      view.fast = true;
      if (view.choice && battle.current) {
        const resolve = view.choice;
        view.choice = null;
        view.pending = null;
        resolve(autoAction(battle, unitById(battle, battle.current)));
      }
      for (const w of [...view.wakers]) w();
    });
    return b;
  };

  const finishUi = () => {
    status.textContent = '';
    paintAll();
    paintTurns();
    const win = battle.result === 'victory';
    if (!view.fast) (win ? sfx.win : sfx.lose)();
    banner.className = `banner ${win ? 'banner--win' : 'banner--lose'}`;
    banner.replaceChildren(h('h3', null, win ? 'Победа' : 'Отряд разбит'));
    const next = h('button', { class: 'btn btn--block' }, win ? 'Продолжить' : 'К итогам');
    next.addEventListener('click', () => {
      finishBattle(run);
      stopBattleView();
      ctx.render();
    });
    actions.replaceChildren(next);
  };

  const loop = async () => {
    await sleep(500);
    while (alive()) {
      const logStart = battle.log.length;
      const actor = advance(battle);
      const advanceEvents = battle.log.slice(logStart).filter((e) => e.t === 'bossPhase');
      if (advanceEvents.length > 0) {
        addLog(advanceEvents);
        paintAll();
      }
      if (!actor) break;
      paintAll();
      paintTurns();
      let base: Action;
      if (actor.side === 'hero' && battlePrefs.manual && !view.fast) base = await askPlayer(actor);
      else base = autoAction(battle, actor);
      if (!alive()) return;
      await performAction(actor, base);
      if (!alive()) return;
      await sleep(240);
    }
    if (alive()) finishUi();
  };

  // ---------- Панель управления ----------

  const seg = (labels: string[], pressed: number, on: (i: number) => void) => {
    const wrap = h('div', { class: 'segmented' });
    labels.forEach((text, i) => {
      const b = h('button', { 'aria-pressed': i === pressed ? 'true' : 'false' }, text);
      b.addEventListener('click', () => {
        on(i);
        [...wrap.children].forEach((c, j) => c.setAttribute('aria-pressed', j === i ? 'true' : 'false'));
      });
      wrap.append(b);
    });
    return wrap;
  };

  const modeSeg = seg(['Авто', 'Вручную'], battlePrefs.manual ? 1 : 0, (i) => {
    battlePrefs.manual = i === 1;
    if (!battlePrefs.manual && view.choice && battle.current) {
      const resolve = view.choice;
      view.choice = null;
      view.pending = null;
      resolve(autoAction(battle, unitById(battle, battle.current)));
    }
  });
  const speeds: Array<1 | 2 | 4> = [1, 2, 4];
  const speedSeg = seg(['×1', '×2', '×4'], speeds.indexOf(battlePrefs.speed), (i) => {
    battlePrefs.speed = speeds[i] ?? 1;
  });
  const soundBtn = h('button', { class: 'btn btn--ghost btn--small', 'aria-pressed': sfx.enabled ? 'true' : 'false' }, sfx.enabled ? 'Звук: да' : 'Звук: нет');
  soundBtn.addEventListener('click', () => {
    sfx.setEnabled(!sfx.enabled);
    soundBtn.textContent = sfx.enabled ? 'Звук: да' : 'Звук: нет';
    soundBtn.setAttribute('aria-pressed', sfx.enabled ? 'true' : 'false');
  });

  const root = h(
    'section',
    { class: 'stage' },
    turns,
    arena,
    banner,
    h('div', { class: 'controls controls--battle' }, h('div', { class: 'controls__top' }, modeSeg, speedSeg, soundBtn), status, actions, log),
  );

  paintAll();
  paintTurns();
  actions.append(finishButton());
  void loop();
  return root;
}
