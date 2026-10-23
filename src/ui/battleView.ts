import { autoAction, enemyKind, previewEnemyAction } from '../combat/ai';
import { advance, aliveUnits, applyAction, intentDamage, legalActions, turnOrder, unitById } from '../combat/battle';
import { ENEMIES } from '../combat/data';
import type { Action, Battle, BattleEvent, HitInfo, Intent, Unit } from '../combat/types';
import { ARENAS } from '../content/arenas';
import { BOSS_EMISSIVE, ENEMY_ART, heroArt, roleName } from '../content/roster';
import { artFor, arenaLayers } from '../content/artpack';
import type { HeroClass } from '../core/types';
import { finishBattle } from '../expedition/run';
import { ASH, ArenaScene, DANGER, SPECTRAL, type ActorScreen, type ActorSpec, type AttackStyle } from './arena/scene';
import type { Rgb } from './arena/backend';
import type { Ctx } from './ctx';
import { h } from './dom';
import { glyph, type GlyphName } from './glyphs';
import { enemyPortrait, heroPortrait } from './portrait';
import { sfx } from './sfx';

/** Настройки боя живут дольше одного боя: выбрали «Авто» — так и останется. */
export const battlePrefs = { manual: true, speed: 1 as 1 | 2 | 4 };

interface View {
  dead: boolean;
  fast: boolean;
  scene: ArenaScene;
  choice: ((a: Action) => void) | null;
  pending: { kind: 'attack' | 'skill'; targets: string[]; actor: string } | null;
  cleanup: Array<() => void>;
}

let current: View | null = null;

/** Для QA-скриптов (?qa=1): состояние рендерера и боя без доступа к внутренностям модулей. */
declare global {
  interface Window {
    __gosArena?: { stats: () => ReturnType<ArenaScene['stats']>; battle: () => Battle | null };
  }
}

export function stopBattleView(): void {
  const v = current;
  current = null;
  if (!v) return;
  v.dead = true;
  document.body.classList.remove('is-battle');
  for (const fn of v.cleanup) fn();
  v.scene.destroy();
  if (v.choice) v.choice = null;
}

const INTENT_COLOR: Record<Intent['id'], Rgb> = { cleaver: DANGER, heavyBlow: DANGER, ashBolt: ASH, spectralWave: SPECTRAL };

const SKILL_GLYPH: Record<string, GlyphName> = { cover: 'cover', lunge: 'lunge', aimedShot: 'aimedShot', healingLight: 'healingLight' };
const ATTACK_GLYPH: Record<string, GlyphName> = { melee: 'sword', bow: 'bow', crossbow: 'crossbow', staff: 'staff' };

function idleFor(u: Unit): ActorSpec['idle'] {
  if (u.side === 'hero') {
    const base: Record<HeroClass, ActorSpec['idle']> = {
      defender: { breath: 0.012, sway: 0.7, bob: 0.6, hover: 0, speed: 0.9 },
      scout: { breath: 0.014, sway: 1.1, bob: 0.9, hover: 0, speed: 1.05 },
      shooter: { breath: 0.012, sway: 1.0, bob: 0.7, hover: 0, speed: 0.95 },
      healer: { breath: 0.013, sway: 1.3, bob: 0.8, hover: 0, speed: 0.85 },
    };
    return base[u.kind as HeroClass] ?? base.defender;
  }
  switch (enemyKind(u)) {
    case 'ashWolf':
      return { breath: 0.03, sway: 0.5, bob: 1.2, hover: 0, speed: 1.7 };
    case 'ashMage':
      return { breath: 0.012, sway: 1.5, bob: 0.8, hover: 3, speed: 0.9 };
    case 'goblinRaider':
      return { breath: 0.02, sway: 0.8, bob: 1.4, hover: 0, speed: 1.4 };
    case 'boneKing':
      return { breath: 0.01, sway: 0.9, bob: 0.5, hover: 0, speed: 0.7 };
    default:
      return { breath: 0.008, sway: 0.6, bob: 0.4, hover: 0, speed: 0.8 };
  }
}

function attackStyle(u: Unit): AttackStyle {
  if (u.side === 'hero') return heroArt({ identity: u.identity ?? null, cls: u.kind as HeroClass }).attackStyle;
  const k = enemyKind(u);
  return k ? ENEMY_ART[k].attackStyle : 'melee';
}

function spriteFor(u: Unit): string {
  if (u.side === 'hero') {
    const art = heroArt({ identity: u.identity ?? null, cls: u.kind as HeroClass });
    // Безымянный новобранец старого сейва: нейтральный силуэт без чужого лица.
    return art.sprite ?? '';
  }
  const k = enemyKind(u);
  return k ? ENEMY_ART[k].sprite : ENEMY_ART.goblinRaider.sprite;
}

/** Буквы для одинаковых противников в одном бою: «Гоблин-налётчик А», «… Б». */
const DUP_LETTERS = ['А', 'Б', 'В', 'Г'];
const dupSuffix = new WeakMap<Unit, string>();

function labelDuplicates(b: Battle): void {
  const groups = new Map<string, Unit[]>();
  for (const u of b.units) {
    if (u.side !== 'enemy' || u.boss) continue;
    const list = groups.get(u.kind) ?? [];
    list.push(u);
    groups.set(u.kind, list);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.forEach((u, i) => dupSuffix.set(u, DUP_LETTERS[i] ?? String(i + 1)));
  }
}

function displayName(u: Unit): string {
  const base = u.name.replace(/ \(элита\)$/, '');
  const suffix = dupSuffix.get(u);
  return suffix ? `${base} ${suffix}` : base;
}

function hpText(u: Unit): string {
  return `${u.hp} / ${u.stats.maxHp}`;
}

function eventLine(b: Battle, e: BattleEvent): string | null {
  const name = (id: string) => displayName(unitById(b, id));
  switch (e.t) {
    case 'hit':
      return `${name(e.actor)}${e.skill ? ` · ${e.skill}` : ''} → ${name(e.target)}: −${e.dmg}${e.mitigated ? ` (поглощено ${e.mitigated})` : ''}${e.killed ? ', выбывает' : ''}`;
    case 'heal':
      return `${name(e.actor)} · ${e.skill} → ${name(e.target)}: +${e.amount}`;
    case 'cover':
      return `${name(e.actor)} прикрывает: ${name(e.target)} (следующий удар −${Math.round(e.pct * 100)}%)`;
    case 'prepare':
      return `${name(e.actor)} готовит «${e.intent.name}»${e.intent.aoe ? ' по всему отряду' : e.intent.targetId ? ` → ${name(e.intent.targetId)}` : ''}`;
    case 'cancel':
      return `«${e.intent.name}» отменён: ${name(e.actor)} не успел ударить`;
    case 'retarget':
      return `Цель выбыла — удар переходит на ${name(e.to)}`;
    case 'phoenix':
      return `Перо Феникса возвращает в строй: ${name(e.target)}`;
    case 'bossPhase':
      return `${e.name}: доспехи трескаются, начинается II фаза`;
    case 'aftercare':
      return `${name(e.actor)}: мягкое восстановление → ${name(e.target)} +${e.amount}`;
    case 'ward':
      return `Сомкнутые щиты: «${e.intent.name}» ослаблен вдвое`;
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
  const isBoss = run.battleKind === 'boss';
  labelDuplicates(battle);

  // ---------- Каркас ----------
  const arenaEl = h('div', { class: `arena${isBoss ? ' arena--boss' : ''}` });
  const hud = h('div', { class: 'hud' });
  const topBar = h('div', { class: 'hud__top' });
  const turnsEl = h('div', { class: 'turns', 'aria-label': 'Порядок ходов' });
  const intentsEl = h('div', { class: 'intents', 'aria-live': 'polite' });
  const platesEl = h('div', { class: 'plates' });
  const floatsEl = h('div', { class: 'floats', 'aria-hidden': 'true' });
  const bannerEl = h('div', { class: 'hud__banner', 'aria-live': 'assertive' });
  const promptEl = h('div', { class: 'hud__prompt', 'aria-live': 'polite' });
  const resultEl = h('div', { class: 'hud__result' });
  const coachEl = h('div', { class: 'coach', role: 'status', 'aria-live': 'polite' });
  coachEl.hidden = true;
  resultEl.hidden = true;
  hud.append(topBar, turnsEl, intentsEl, platesEl, floatsEl, bannerEl, promptEl, coachEl, resultEl);
  arenaEl.append(hud);

  const partyEl = h('div', { class: 'party-cards' });
  const actionsEl = h('div', { class: 'action-bar' });
  const controlsEl = h('div', { class: 'battle-controls' });
  const logList = h('ol', { class: 'battle-log__list' });
  const logEl = h('details', { class: 'battle-log' }, h('summary', null, 'Журнал боя'), logList);
  const dock = h('div', { class: 'battle-dock' }, partyEl, h('div', { class: 'battle-dock__right' }, actionsEl, controlsEl));
  const root = h('section', { class: 'stage stage--battle' }, arenaEl, dock, logEl);

  // ---------- Сцена ----------
  const specs: ActorSpec[] = battle.units.map((u) => {
    const k = u.side === 'enemy' ? enemyKind(u) : null;
    const pack = u.side === 'hero' ? (u.identity ? artFor('heroes', u.identity) : null) : k ? artFor('enemies', k) : null;
    return {
      anim: pack?.anim ?? null,
      sprite2: pack?.phase2Sprite ?? null,
      anim2: pack?.phase2Anim ?? null,
      rig: pack?.rig ?? null,
      rig2: pack?.phase2Rig ?? null,
      id: u.id,
      side: u.side,
      sprite: spriteFor(u),
      emissive: u.boss ? BOSS_EMISSIVE : undefined,
      flip: k === 'goblinRaider',
      style: attackStyle(u),
      boss: !!u.boss,
      wide: k === 'ashWolf',
      idle: idleFor(u),
      variant: dupSuffix.has(u) ? DUP_LETTERS.indexOf(dupSuffix.get(u) as string) : 0,
      dead: !u.alive,
      phase2: !!u.boss && u.bossPhase === 2,
    } as ActorSpec;
  });
  const arenaId = isBoss ? 'boss' : 'crypt';
  const scene = new ArenaScene(arenaEl, { ...ARENAS[arenaId], layers: arenaLayers(arenaId) }, specs);
  scene.speed = battlePrefs.speed;

  const view: View = { dead: false, fast: false, scene, choice: null, pending: null, cleanup: [] };
  current = view;
  document.body.classList.add('is-battle');
  if (new URLSearchParams(window.location.search).has('qa')) {
    window.__gosArena = { stats: () => scene.stats(), battle: () => (current === view ? battle : null) };
  }
  const alive = () => !view.dead && current === view && ctx.run === run && run.battle === battle;

  // ---------- Плашки и позиции ----------
  const screenPos = new Map<string, ActorScreen>();
  const plates = new Map<string, { el: HTMLElement; fill: HTMLElement; ghost: HTMLElement; hp: HTMLElement; tags: HTMLElement }>();
  for (const u of battle.units) {
    if (u.boss) continue; // у босса — крупная полоса здоровья сверху
    const fill = h('i');
    const ghost = h('b');
    const hp = h('span', { class: 'plate__hp num' });
    const tags = h('span', { class: 'plate__tags' });
    const el = h('button', { class: `plate plate--${u.side}${u.elite ? ' plate--elite' : ''}`, type: 'button', tabindex: '-1' },
      h('span', { class: 'plate__name' }, displayName(u), u.elite ? h('em', null, 'элита') : null),
      h('span', { class: 'plate__bar' }, ghost, fill),
      hp,
      tags,
    );
    el.addEventListener('click', () => onTarget(u.id));
    el.addEventListener('mouseenter', () => scene.setStatus(u.id, { hovered: true }));
    el.addEventListener('mouseleave', () => scene.setStatus(u.id, { hovered: false }));
    plates.set(u.id, { el, fill, ghost, hp, tags });
    platesEl.append(el);
  }
  // Плашки не должны уходить под HUD: если голова бойца оказалась под панелью намерений или
  // верхней полосой, плашка опускается ниже панели.
  let frameNo = 0;
  let blockers: DOMRect[] = [];
  scene.onFrame((list) => {
    if (frameNo++ % 15 === 0) {
      const base = arenaEl.getBoundingClientRect();
      blockers = [intentsEl, topBar.firstElementChild as HTMLElement | null]
        .filter((e): e is HTMLElement => !!e && e.offsetParent !== null)
        .map((e) => {
          const r = e.getBoundingClientRect();
          return new DOMRect(r.left - base.left, r.top - base.top, r.width, r.height);
        });
    }
    for (const s of list) {
      screenPos.set(s.id, s);
      const p = plates.get(s.id);
      if (!p) continue;
      const pw = p.el.offsetWidth || 120;
      const ph = p.el.offsetHeight || 48;
      let y = s.top;
      for (const r of blockers) {
        const overlapX = s.x + pw / 2 > r.left && s.x - pw / 2 < r.right;
        if (overlapX && y - ph < r.bottom && y > r.top) y = r.bottom + ph + 6;
      }
      p.el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    }
  });

  const floatText = (id: string, text: string, cls: string) => {
    if (view.fast) return;
    const s = screenPos.get(id);
    if (!s) return;
    const el = h('span', { class: `float ${cls} num` }, text);
    el.style.left = `${s.x + (Math.random() - 0.5) * s.w * 0.3}px`;
    el.style.top = `${s.top + s.h * 0.25}px`;
    floatsEl.append(el);
    window.setTimeout(() => el.remove(), 1400);
  };

  let bannerTimer = 0;
  const banner = (text: string, tone: 'foe' | 'hero' | 'phase' | 'info', ms = 1300) => {
    if (view.fast) return;
    window.clearTimeout(bannerTimer);
    bannerEl.className = `hud__banner hud__banner--${tone} is-on`;
    bannerEl.textContent = text;
    bannerTimer = window.setTimeout(() => bannerEl.classList.remove('is-on'), ms / battlePrefs.speed);
  };

  // ---------- Отрисовка состояния ----------
  const boss = battle.units.find((u) => u.boss);
  const bossBar = (() => {
    if (!boss) return null;
    const fill = h('i');
    const ghost = h('b');
    const name = h('strong', { class: 'boss-bar__name' });
    const phase = h('span', { class: 'boss-bar__phase' });
    const hp = h('span', { class: 'boss-bar__hp num' });
    const el = h('div', { class: 'boss-bar' },
      enemyPortrait(boss.kind, boss.name, 64),
      h('div', { class: 'boss-bar__body' }, h('div', { class: 'boss-bar__row' }, name, phase), h('div', { class: 'boss-bar__track' }, ghost, fill, h('span', { class: 'boss-bar__mark', title: 'Порог II фазы — 50%' })), hp),
    );
    topBar.append(el);
    return { el, fill, ghost, name, phase, hp };
  })();
  if (!boss) {
    const kindName = run.battleKind === 'elite' ? 'Элитная угроза' : run.battleKind === 'ambush' ? 'Засада' : 'Бой в катакомбах';
    topBar.append(h('div', { class: 'encounter-bar' }, h('strong', null, kindName), h('span', null, `Глубина ${['I', 'II', 'III'][run.tier - 1] ?? run.tier}`)));
  }

  const cards = new Map<string, { el: HTMLElement; fill: HTMLElement; hp: HTMLElement; cd: HTMLElement; badge: HTMLElement }>();
  for (const u of battle.units.filter((x) => x.side === 'hero')) {
    const fill = h('i');
    const hp = h('span', { class: 'hero-card__hp num' });
    const cd = h('span', { class: 'hero-card__cd' });
    const badge = h('span', { class: 'hero-card__badge' });
    const el = h('button', { class: 'hero-card', type: 'button', tabindex: '-1' },
      heroPortrait({ identity: u.identity ?? null, cls: u.kind as HeroClass, name: u.name }, 64),
      h('span', { class: 'hero-card__body' },
        h('span', { class: 'hero-card__name' }, u.name),
        h('span', { class: 'hero-card__role' }, roleName({ cls: u.kind as HeroClass })),
        h('span', { class: 'hero-card__bar' }, fill),
        h('span', { class: 'hero-card__meta' }, hp, cd),
      ),
      badge,
    );
    el.addEventListener('click', () => onTarget(u.id));
    cards.set(u.id, { el, fill, hp, cd, badge });
    partyEl.append(el);
  }

  const paintIntents = () => {
    intentsEl.replaceChildren();
    const foes = aliveUnits(battle, 'enemy');
    if (foes.length === 0) return;
    intentsEl.append(h('div', { class: 'intents__title' }, glyph('warning', 16), 'Намерения врагов'));
    for (const f of foes) {
      const row = h('div', { class: `intent${f.intent ? ' intent--armed' : ''}${f.intent?.aoe ? ' intent--aoe' : ''}` });
      if (f.intent) {
        const target = f.intent.targetId ? battle.units.find((u) => u.id === f.intent?.targetId) : null;
        const victims = f.intent.aoe ? aliveUnits(battle, 'hero') : target ? [target] : [];
        const dmg = victims.map((v) => Math.round(intentDamage(f, f.intent as Intent, v)));
        row.append(
          glyph(f.intent.aoe ? 'wave' : 'target', 18),
          h('span', { class: 'intent__text' },
            h('strong', null, `${displayName(f)}: ${f.intent.name}`),
            h('span', null, f.intent.aoe ? `Весь отряд, ≈${Math.min(...dmg)}–${Math.max(...dmg)} каждому` : `Цель — ${target ? target.name : '—'}, ≈${dmg[0] ?? 0} урона`),
            h('em', null, f.intent.aoe ? 'Ответ: Прикрытие, лечение заранее' : 'Ответ: Прикрытие на цель или добить врага'),
          ),
        );
      } else {
        const next = previewEnemyAction(battle, f);
        let text = '';
        if (next?.kind === 'prepare' && next.intent) text = next.intent.aoe ? `Следующий ход: готовит «${next.intent.name}» по отряду` : `Следующий ход: готовит «${next.intent.name}»`;
        else if (next?.kind === 'attack' && next.targetId) text = `Следующий ход: удар → ${unitById(battle, next.targetId).name}`;
        row.append(glyph(f.boss ? 'crown' : 'sword', 18), h('span', { class: 'intent__text' }, h('strong', null, displayName(f)), h('span', null, text)));
      }
      if (f.boss && f.bossPhase === 2 && !f.intent) {
        const t = (f.phaseTurns ?? 0) % 3;
        const left = t === 0 ? 1 : t === 1 ? 0 : 2;
        row.append(h('span', { class: 'intent__cycle' }, left <= 1 ? 'Волна готовится следующим ходом' : `До подготовки волны: ${left} хода`));
      }
      intentsEl.append(row);
    }
  };

  const paintTurns = () => {
    const { now, next } = turnOrder(battle);
    turnsEl.replaceChildren();
    const chip = (id: string, isNow: boolean) => {
      const u = unitById(battle, id);
      const p = u.side === 'hero' ? heroPortrait({ identity: u.identity ?? null, cls: u.kind as HeroClass, name: u.name }, 48) : enemyPortrait(u.kind, displayName(u), 48);
      return h('div', { class: `turns__chip${u.side === 'enemy' ? ' is-foe' : ''}${isNow ? ' is-now' : ''}${u.intent ? ' is-armed' : ''}`, title: displayName(u) }, p);
    };
    now.forEach((id, i) => turnsEl.append(chip(id, i === 0 && battle.current === id)));
    if (next.length) {
      turnsEl.append(h('div', { class: 'turns__sep', title: 'Следующий раунд' }));
      for (const id of next.slice(0, Math.max(0, 7 - now.length))) turnsEl.append(chip(id, false));
    }
  };

  const syncScene = () => {
    const armedSingle = new Set<string>();
    let aoe = false;
    for (const f of aliveUnits(battle, 'enemy')) {
      if (!f.intent) continue;
      if (f.intent.aoe) aoe = true;
      else if (f.intent.targetId) armedSingle.add(f.intent.targetId);
    }
    for (const u of battle.units) {
      scene.syncAlive(u.id, u.alive);
      if (u.boss && u.bossPhase === 2) scene.setPhase2(u.id);
      scene.setStatus(u.id, {
        active: battle.current === u.id && battle.result === 'ongoing',
        cover: (u.cover ?? 0) > 0,
        charging: u.alive && u.intent ? INTENT_COLOR[u.intent.id] : null,
        threatened: u.side === 'hero' && u.alive ? (armedSingle.has(u.id) ? 'single' : aoe ? 'aoe' : null) : null,
        targetable: view.pending?.targets.includes(u.id) ? (u.side === 'enemy' ? 'foe' : 'ally') : null,
      });
    }
  };

  const paintAll = () => {
    for (const u of battle.units) {
      const pct = `${Math.max(0, (u.hp / u.stats.maxHp) * 100)}%`;
      const p = plates.get(u.id);
      if (p) {
        p.fill.style.width = pct;
        window.setTimeout(() => (p.ghost.style.width = pct), 350);
        p.hp.textContent = hpText(u);
        p.el.classList.toggle('is-dead', !u.alive);
        p.el.classList.toggle('is-target', !!view.pending?.targets.includes(u.id));
        p.el.classList.toggle('is-active', battle.current === u.id);
        p.el.setAttribute('tabindex', view.pending?.targets.includes(u.id) ? '0' : '-1');
        p.el.setAttribute('aria-label', `${displayName(u)}${u.elite ? ', элита' : ''}: ${u.alive ? `${u.hp} из ${u.stats.maxHp} HP` : 'выбыл'}`);
        p.tags.replaceChildren();
        if ((u.cover ?? 0) > 0) p.tags.append(h('span', { class: 'tag-ico tag-ico--cover', title: 'Прикрыт: следующий удар −30%' }, glyph('shield', 14)));
        if (u.intent) p.tags.append(h('span', { class: 'tag-ico tag-ico--armed', title: `Готовит: ${u.intent.name}` }, glyph(u.intent.aoe ? 'wave' : 'target', 14)));
        const threatened = aliveUnits(battle, 'enemy').some((f) => f.intent && (f.intent.aoe || f.intent.targetId === u.id));
        if (u.side === 'hero' && u.alive && threatened) p.tags.append(h('span', { class: 'tag-ico tag-ico--danger', title: 'Под угрозой подготовленного удара' }, glyph('warning', 14)));
      }
      const c = cards.get(u.id);
      if (c) {
        c.fill.style.width = pct;
        c.hp.textContent = u.alive ? hpText(u) : 'Выбыл';
        c.cd.textContent = !u.alive || !u.skill ? '' : u.cd === 0 ? `${u.skill.name}: готово` : `${u.skill.name}: ${u.cd} ход.`;
        c.el.classList.toggle('is-active', battle.current === u.id);
        c.el.classList.toggle('is-dead', !u.alive);
        c.el.classList.toggle('is-low', u.alive && u.hp / u.stats.maxHp < 0.35);
        c.el.classList.toggle('is-target', !!view.pending?.targets.includes(u.id));
        c.el.setAttribute('tabindex', view.pending?.targets.includes(u.id) ? '0' : '-1');
        c.badge.replaceChildren();
        if ((u.cover ?? 0) > 0) c.badge.append(h('span', { class: 'tag-ico tag-ico--cover', title: 'Прикрыт' }, glyph('shield', 14)));
      }
    }
    if (bossBar && boss) {
      const pct = `${Math.max(0, (boss.hp / boss.stats.maxHp) * 100)}%`;
      bossBar.fill.style.width = pct;
      window.setTimeout(() => (bossBar.ghost.style.width = pct), 450);
      bossBar.name.textContent = boss.name;
      bossBar.phase.textContent = boss.bossPhase === 2 ? 'ФАЗА II · Пробуждение трона' : 'ФАЗА I · Королевские доспехи';
      bossBar.el.classList.toggle('is-phase-two', boss.bossPhase === 2);
      bossBar.hp.textContent = `${hpText(boss)} HP`;
    }
    paintIntents();
    syncScene();
  };

  const addLog = (events: BattleEvent[]) => {
    for (const e of events) {
      const line = eventLine(battle, e);
      if (line) logList.append(h('li', null, line));
    }
    while (logList.children.length > 40) logList.firstElementChild?.remove();
  };

  // ---------- Применение действий с подачей на арене ----------
  const performAction = async (actor: Unit, action: Action) => {
    let events: BattleEvent[] = [];
    let applied = false;
    const pendingAnims: Array<Promise<void>> = [];
    let phaseShift = false;
    const shown = new Set<BattleEvent>();
    const present = (filter: (e: BattleEvent) => boolean = () => true) => {
      for (const e of events) {
        if (shown.has(e) || !filter(e)) continue;
        shown.add(e);
        if (e.t === 'hit') presentHit(e);
        else if (e.t === 'heal') {
          floatText(e.target, `+${e.amount}`, 'float--heal');
          sfx.heal();
        } else if (e.t === 'aftercare') floatText(e.target, `+${e.amount}`, 'float--heal');
        else if (e.t === 'bossPhase') phaseShift = true;
        else if (e.t === 'phoenix') {
          floatText(e.target, 'Феникс!', 'float--label');
          pendingAnims.push(scene.revive(e.target));
        } else if (e.t === 'retarget') banner(`Цель выбыла — удар по ${unitById(battle, e.to).name}`, 'foe');
        else if (e.t === 'cancel') floatText(e.actor, 'Удар сорван', 'float--label');
        else if (e.t === 'ward') banner('Сомкнутые щиты: удар ослаблен вдвое', 'hero');
      }
      paintAll();
    };
    const presentHit = (e: HitInfo) => {
      const target = unitById(battle, e.target);
      const attacker = unitById(battle, e.actor);
      const heavy = e.via === 'intent' || e.dmg >= target.stats.maxHp * 0.22;
      const magic: Rgb | undefined = e.intentId === 'spectralWave' ? SPECTRAL : e.intentId === 'ashBolt' || enemyKind(attacker) === 'ashMage' ? ASH : undefined;
      scene.hit(e.target, { heavy, covered: e.covered, magic, color: magic, fromDir: attacker.side === 'hero' ? 1 : -1 });
      floatText(e.target, `−${e.dmg}`, heavy ? 'float--crit' : 'float--dmg');
      if (e.mitigated) floatText(e.target, e.covered ? `Прикрытие −${e.mitigated}` : e.warden ? `Щит хранителя −${e.mitigated}` : `Заслон −${e.mitigated}`, 'float--block');
      if (e.pierced) floatText(e.target, 'Пробитие', 'float--label');
      sfx.hit(heavy);
      if (e.killed && !target.alive) {
        sfx.die();
        pendingAnims.push(scene.die(e.target));
      }
    };
    const apply = () => {
      if (applied) return;
      applied = true;
      events = applyAction(battle, action);
      addLog(events);
      ctx.save(); // сохранение после каждого боевого действия (Combat Spec: восстановление без повторной выдачи)
    };
    const impact = () => {
      apply();
      present();
    };

    const style = attackStyle(actor);
    const target = action.targetId ? unitById(battle, action.targetId) : null;
    if (action.kind === 'attack' && target) {
      if (style === 'melee') await scene.melee(actor.id, target.id, impact);
      else if (style === 'pounce') await scene.pounce(actor.id, target.id, impact);
      else await scene.shoot(actor.id, target.id, style === 'bow' ? 'arrow' : style === 'crossbow' ? 'bolt' : style === 'spell' ? 'ash' : 'light', impact);
    } else if (action.kind === 'skill' && actor.skill && target) {
      const skill = actor.skill;
      banner(`${actor.name}: ${skill.name}`, 'hero');
      if (skill.effect === 'cover') {
        await scene.gesture(actor.id, [0.55, 0.75, 1]);
        await scene.coverFx(actor.id, target.id);
        impact();
      } else if (skill.effect === 'heal') {
        await scene.gesture(actor.id, [0.75, 1, 0.7]);
        await scene.heal(actor.id, target.id, 0);
        impact();
      } else if (skill.id === 'aimedShot') {
        await scene.shoot(actor.id, target.id, 'bolt', impact, true);
      } else {
        await scene.melee(actor.id, target.id, impact, { double: true, color: [1, 0.9, 0.6] });
      }
    } else if (action.kind === 'prepare' && action.intent) {
      apply();
      const it = action.intent;
      const victim = it.targetId ? unitById(battle, it.targetId).name : '';
      banner(it.aoe ? `${displayName(actor)} готовит «${it.name}» — удар по всему отряду!` : `${displayName(actor)} готовит «${it.name}» → ${victim}`, 'foe', 1900);
      present();
      await scene.prepare(actor.id, INTENT_COLOR[it.id]);
    } else if (action.kind === 'release' && actor.intent) {
      const it = actor.intent;
      banner(`${displayName(actor)}: ${it.name}!`, 'foe');
      if (it.aoe) {
        apply();
        await scene.wave(actor.id, aliveUnits(battle, 'hero').map((u) => u.id).concat(events.filter((e): e is HitInfo => e.t === 'hit' && e.killed).map((e) => e.target)).filter((v, i, arr) => arr.indexOf(v) === i), (id) => present((e) => e.t === 'hit' && e.target === id));
        present();
      } else {
        const tgt = it.targetId ? battle.units.find((u) => u.id === it.targetId && u.alive) : undefined;
        const victimId = tgt?.id ?? aliveUnits(battle, 'hero')[0]?.id;
        if (style === 'spell' && victimId) await scene.shoot(actor.id, victimId, 'ash', impact, true);
        else if (victimId) await scene.melee(actor.id, victimId, impact, { heavy: true, color: INTENT_COLOR[it.id] });
        else impact();
      }
    } else {
      impact();
    }
    if (!applied) impact();
    await Promise.all(pendingAnims);
    if (phaseShift && boss && alive()) {
      banner('ФАЗА II — Пробуждение трона', 'phase', 2200);
      await scene.bossPhase2(boss.id);
      paintAll();
    }
  };

  // ---------- Выбор игрока ----------
  const setPending = (p: View['pending']) => {
    view.pending = p;
    actionsEl.classList.toggle('is-targeting', !!p);
    paintAll();
  };

  function onTarget(id: string): void {
    const p = view.pending;
    if (!p || !p.targets.includes(id) || !view.choice) return;
    const resolve = view.choice;
    view.choice = null;
    setPending(null);
    promptEl.classList.remove('is-on');
    resolve({ actorId: p.actor, kind: p.kind, targetId: id });
  }

  const onCanvasClick = (ev: MouseEvent) => {
    const id = scene.hitTest(ev.clientX, ev.clientY);
    if (id) onTarget(id);
  };
  let hovered: string | null = null;
  const onCanvasMove = (ev: MouseEvent) => {
    const id = scene.hitTest(ev.clientX, ev.clientY);
    if (id === hovered) return;
    if (hovered) scene.setStatus(hovered, { hovered: false });
    hovered = id;
    if (id) scene.setStatus(id, { hovered: true });
    scene.canvas.style.cursor = id && view.pending?.targets.includes(id) ? 'pointer' : 'default';
  };
  scene.canvas.addEventListener('click', onCanvasClick);
  scene.canvas.addEventListener('mousemove', onCanvasMove);

  const actionButton = (icon: GlyphName, label: string, sub: string, cls: string, disabled: boolean, onClick: () => void, key: string) => {
    const b = h('button', { class: `action ${cls}`, type: 'button', 'aria-keyshortcuts': key }, h('span', { class: 'action__icon' }, glyph(icon, 30, 1.6)), h('span', { class: 'action__label' }, label), h('small', { class: 'action__sub' }, sub), h('kbd', null, key));
    if (disabled) (b as HTMLButtonElement).disabled = true;
    b.addEventListener('click', onClick);
    return b;
  };

  let hotkeys: Record<string, () => void> = {};
  const onKey = (ev: KeyboardEvent) => {
    const fn = hotkeys[ev.key];
    if (fn && !(ev.target instanceof HTMLInputElement)) {
      ev.preventDefault();
      fn();
    }
  };
  document.addEventListener('keydown', onKey);

  const askPlayer = (actor: Unit): Promise<Action> =>
    new Promise((resolve) => {
      view.choice = resolve;
      const legal = legalActions(battle, actor);
      const attackTargets = legal.filter((a) => a.kind === 'attack').map((a) => a.targetId as string);
      const skill = actor.skill;
      const skillTargets = legal.filter((a) => a.kind === 'skill').map((a) => a.targetId as string);
      const pick = (kind: 'attack' | 'skill') => {
        const targets = kind === 'attack' ? attackTargets : skillTargets;
        const ally = kind === 'skill' && skill?.target === 'ally';
        promptEl.textContent = ally ? `${skill?.name}: выберите союзника на арене или в карточках` : `${kind === 'skill' ? skill?.name : 'Атака'}: выберите противника`;
        promptEl.classList.add('is-on');
        setPending({ kind, targets, actor: actor.id });
        renderButtons(kind);
      };
      const cancel = () => {
        setPending(null);
        promptEl.classList.remove('is-on');
        renderButtons(null);
      };
      const renderButtons = (selected: 'attack' | 'skill' | null) => {
        actionsEl.replaceChildren(h('div', { class: 'action-bar__who' }, h('strong', null, actor.name), h('span', null, selected ? 'выбор цели' : 'ваш ход')));
        const style = attackStyle(actor);
        const atk = actionButton(ATTACK_GLYPH[style] ?? 'sword', 'Атака', style === 'melee' ? 'Ближний бой' : 'Дальний бой', `action--attack${selected === 'attack' ? ' is-selected' : ''}`, attackTargets.length === 0, () => pick('attack'), '1');
        actionsEl.append(atk);
        if (skill) {
          const ready = actor.cd === 0 && skillTargets.length > 0;
          const sub = ready ? (skill.target === 'ally' ? 'Союзник' : 'Одна цель') : `Перезарядка: ${actor.cd}`;
          const btn = actionButton(SKILL_GLYPH[skill.id] ?? 'sword', skill.name, sub, `action--skill${ready ? ' is-ready' : ''}${selected === 'skill' ? ' is-selected' : ''}`, !ready, () => pick('skill'), '2');
          if (!ready) btn.append(h('span', { class: 'action__cd num' }, String(actor.cd)));
          actionsEl.append(btn);
        }
        if (selected) {
          const c = actionButton('close', 'Отмена', 'Esc', 'action--cancel', false, cancel, 'Esc');
          actionsEl.append(c);
        }
        hotkeys = { '1': () => attackTargets.length && pick('attack'), '2': () => skill && actor.cd === 0 && skillTargets.length && pick('skill'), Escape: cancel };
      };
      renderButtons(null);
      paintAll();
    });

  const waitingBar = (actor: Unit) => {
    actionsEl.replaceChildren(h('div', { class: 'action-bar__who action-bar__who--wait' }, h('strong', null, displayName(actor)), h('span', null, actor.side === 'enemy' ? 'ход противника' : 'автобой')));
    hotkeys = {};
  };

  // ---------- Управление ----------
  const resolveWithAuto = () => {
    if (view.choice && battle.current) {
      const resolve = view.choice;
      view.choice = null;
      setPending(null);
      promptEl.classList.remove('is-on');
      resolve(autoAction(battle, unitById(battle, battle.current)));
    }
  };
  const seg = (labels: string[], pressed: number, on: (i: number) => void, label: string) => {
    const wrap = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
    labels.forEach((text, i) => {
      const b = h('button', { type: 'button', 'aria-pressed': i === pressed ? 'true' : 'false' }, text);
      b.addEventListener('click', () => {
        on(i);
        [...wrap.children].forEach((c, j) => c.setAttribute('aria-pressed', j === i ? 'true' : 'false'));
      });
      wrap.append(b);
    });
    return wrap;
  };
  const speeds: Array<1 | 2 | 4> = [1, 2, 4];
  const finishBtn = h('button', { class: 'btn btn--ghost btn--small', type: 'button', title: 'Мгновенно доиграть бой автобоем' }, 'Досчитать');
  finishBtn.addEventListener('click', () => {
    view.fast = true;
    scene.finishAll();
    resolveWithAuto();
  });
  const soundBtn = h('button', { class: 'btn btn--ghost btn--small', type: 'button', 'aria-pressed': sfx.enabled ? 'true' : 'false' }, sfx.enabled ? 'Звук' : 'Без звука');
  soundBtn.addEventListener('click', () => {
    sfx.setEnabled(!sfx.enabled);
    soundBtn.textContent = sfx.enabled ? 'Звук' : 'Без звука';
    soundBtn.setAttribute('aria-pressed', sfx.enabled ? 'true' : 'false');
  });
  controlsEl.append(
    seg(['Вручную', 'Авто'], battlePrefs.manual ? 0 : 1, (i) => {
      battlePrefs.manual = i === 0;
      if (!battlePrefs.manual) resolveWithAuto();
    }, 'Режим боя'),
    seg(['×1', '×2', '×4'], speeds.indexOf(battlePrefs.speed), (i) => {
      battlePrefs.speed = speeds[i] ?? 1;
      scene.speed = battlePrefs.speed;
    }, 'Скорость'),
    finishBtn,
    soundBtn,
  );

  // Пауза при уходе со вкладки: бой замирает на безопасной границе (анимации ждут RAF).
  const onVis = () => {
    scene.paused = document.visibilityState === 'hidden';
  };
  document.addEventListener('visibilitychange', onVis);
  view.cleanup.push(() => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
    window.clearTimeout(bannerTimer);
  });

  // ---------- Финал ----------
  const finishUi = async () => {
    promptEl.classList.remove('is-on');
    setPending(null);
    paintAll();
    paintTurns();
    const win = battle.result === 'victory';
    hotkeys = {};
    scene.fast = false;
    if (win) {
      sfx.win();
      await scene.victory(battle.units.filter((u) => u.side === 'hero').map((u) => u.id));
    } else {
      sfx.lose();
      await scene.defeat();
    }
    if (!alive()) return;
    const survivors = battle.units.filter((u) => u.side === 'hero');
    const next = h('button', { class: 'btn btn--block btn--primary', type: 'button' }, win ? (isBoss ? 'Забрать награду' : 'Продолжить путь') : 'К итогам экспедиции');
    next.addEventListener('click', () => {
      if (run.battle !== battle) return;
      finishBattle(run);
      stopBattleView();
      ctx.save();
      ctx.render();
    });
    resultEl.replaceChildren(
      h('div', { class: `result-card ${win ? 'result-card--win' : 'result-card--lose'}` },
        h('h3', null, win ? (isBoss ? 'Костяной король повержен' : 'Победа') : 'Отряд разбит'),
        h('ul', { class: 'result-card__heroes' }, ...survivors.map((u) => h('li', { class: u.alive ? '' : 'is-dead' },
          heroPortrait({ identity: u.identity ?? null, cls: u.kind as HeroClass, name: u.name }, 48),
          h('span', null, u.name), h('span', { class: 'num' }, u.alive ? hpText(u) : 'ранен'),
        ))),
        next,
      ),
    );
    resultEl.hidden = false;
    actionsEl.replaceChildren();
    window.setTimeout(() => next.focus(), 50);
  };

  // ---------- Обучение ----------
  // Подсказки показываются один раз каждая (state.tipsSeen) и не блокируют бой.
  const TIPS: Record<string, { title: string; text: string; anchor: 'actions' | 'intents' | 'center' }> = {
    turn: { title: 'Ваш ход', text: 'Выберите действие внизу (клавиши 1 и 2), затем цель — щелчком по фигуре на арене или по плашке над ней.', anchor: 'actions' },
    telegraph: { title: 'Подготовленный удар', text: 'Красный контур и метка на полу — враг готовит сильный удар по этой цели. Цель и ожидаемый урон — в панели «Намерения врагов». Ответ: Прикрытие Брана на цель или добить врага до его хода.', anchor: 'intents' },
    cover: { title: 'Прикрытие', text: 'Бран может прикрыть союзника: следующий удар по нему будет слабее на 30%. Лучший момент — когда цель подготовленного удара известна.', anchor: 'actions' },
    heal: { title: 'Свет исцеления', text: 'Нора восстанавливает союзнику 22% здоровья. Лечите до сильного удара, а не после.', anchor: 'actions' },
    wave: { title: 'Призрачная волна', text: 'Во II фазе король бьёт по всему отряду раз в три хода. Прикрытие защитит одного, поэтому держите здоровье отряда высоким заранее.', anchor: 'intents' },
  };
  let coachTimer = 0;
  const tip = (id: keyof typeof TIPS) => {
    if (view.fast || ctx.state.tipsSeen.includes(id)) return;
    ctx.state.tipsSeen.push(id);
    ctx.save();
    const t = TIPS[id];
    if (!t) return;
    coachEl.className = `coach coach--${t.anchor}`;
    const ok = h('button', { class: 'btn btn--small', type: 'button' }, 'Понятно');
    ok.addEventListener('click', () => (coachEl.hidden = true));
    coachEl.replaceChildren(h('strong', null, t.title), h('p', null, t.text), ok);
    coachEl.hidden = false;
    window.clearTimeout(coachTimer);
    coachTimer = window.setTimeout(() => (coachEl.hidden = true), 14000);
  };
  const checkTips = (actor: Unit | null) => {
    const armed = aliveUnits(battle, 'enemy').filter((f) => f.intent);
    if (armed.some((f) => f.intent?.aoe)) tip('wave');
    else if (armed.length) tip('telegraph');
    if (!actor || actor.side !== 'hero' || !battlePrefs.manual) return;
    if (actor.kind === 'defender' && armed.length && actor.cd === 0) tip('cover');
    else if (actor.kind === 'healer' && actor.cd === 0 && aliveUnits(battle, 'hero').some((u) => u.hp < u.stats.maxHp * 0.6)) tip('heal');
    else tip('turn');
  };
  view.cleanup.push(() => window.clearTimeout(coachTimer));

  // ---------- Ход боя ----------
  const loop = async () => {
    await scene.ready;
    if (!alive()) return;
    paintAll();
    paintTurns();
    if (scene.errors.length) ctx.toast('Часть иллюстраций не загрузилась — показаны заглушки');
    if (battle.round === 0 && battle.current) {
      banner(isBoss ? 'Костяной король пробуждается' : 'Бой начинается', isBoss ? 'phase' : 'info', 1600);
      await scene.wait(isBoss ? 1100 : 600);
    }
    while (alive()) {
      const logStart = battle.log.length;
      const actor = advance(battle);
      addLog(battle.log.slice(logStart));
      if (!actor) break;
      paintAll();
      paintTurns();
      checkTips(actor);
      let action: Action;
      if (actor.side === 'hero' && battlePrefs.manual && !view.fast) action = await askPlayer(actor);
      else {
        waitingBar(actor);
        action = autoAction(battle, actor);
      }
      if (!alive()) return;
      waitingBar(actor);
      await performAction(actor, action);
      if (!alive()) return;
      if (!view.fast) await scene.wait(260);
    }
    if (alive()) void finishUi();
  };

  // Восстановленный бой: показать сразу верное состояние.
  paintAll();
  paintTurns();
  void loop();
  return root;
}

// Экспорт для тестов отображения: подписи событий и имя для плашек.
export const __test = { eventLine, displayName, ENEMIES };
