import { OFFLINE_CAP_SEC } from '../core/config';
import { applyOffline, tick } from '../core/economy';
import { fmt, fmtDuration } from '../core/num';
import { deserialize, serialize } from '../core/save';
import { newGame } from '../core/state';
import type { GameState } from '../core/types';
import type { Platform } from '../platform';
import { deserializeRun, serializeRun, type Run } from '../expedition/run';
import { stopBattleView } from './battleView';
import type { Ctx, ModalButton } from './ctx';
import { clear, h, type Child } from './dom';
import { glyph } from './glyphs';
import { loadArtPack } from '../content/artpack';
import { expeditionScreen } from './expedition';
import { guildScreen } from './guild';
import { squadScreen } from './squad';
import { totalIncome } from '../core/economy';
import { fill, SHARDS_NAME } from '../content/text';
import T from '../content/ui-text.json';

type Tab = 'guild' | 'squad' | 'expedition';
const TABS: Tab[] = ['guild', 'squad', 'expedition'];

const AUTOSAVE_MS = 15_000;
const TICK_MS = 250;
const BACKUP_KEY = 'gos_corrupt_backup';

export async function startApp(platform: Platform, root: HTMLElement): Promise<void> {
  root.replaceChildren(h('div', { class: 'loading' }, T.loading));

  // Финальный арт художника (если поставлен): реестр art-pack.json и пакеты анимаций.
  await loadArtPack();
  const raw = await platform.load();
  const loaded = deserialize(raw, platform.now());
  platform.track('game_start', { platform: platform.name, save_status: loaded.ok ? 'loaded' : loaded.reason });
  let state: GameState;
  let saveEnabled = true;
  let startNotice: { title: string; text: string } | null = null;
  if (loaded.ok) {
    state = loaded.state;
  } else {
    state = newGame(platform.now());
    if (loaded.reason === 'corrupt' && raw) {
      try {
        window.localStorage.setItem(BACKUP_KEY, raw);
      } catch {
        /* хранилище недоступно — резервной копии не будет */
      }
      startNotice = T.notices.corrupt;
    } else if (loaded.reason === 'newer') {
      saveEnabled = false;
      startNotice = T.notices.newer;
    }
  }

  const offline = loaded.ok ? applyOffline(state, platform.now()) : null;

  let tab: Tab = state.activeRun ? 'expedition' : 'guild';
  let live: Array<() => void> = [];
  let run: Run | null = deserializeRun(state.activeRun);
  if (!run) tab = 'guild';
  let paused = false;
  let lastTick = platform.now();

  const main = h('main', { id: 'screen' });
  const goldEl = h('strong', { class: 'num' });
  const rateEl = h('span', { class: 'topbar__rate num' });
  const essenceEl = h('b');
  const essencePill = h('span', { class: 'pill pill--essence', title: SHARDS_NAME }, glyph('ember', 14), ' ', essenceEl);
  const topbar = h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'topbar__brand' },
      h('span', { class: 'topbar__crest', 'aria-hidden': 'true' }, '✦'),
      h('div', { class: 'topbar__brand-copy' },
        h('strong', { class: 'topbar__title' }, T.brand),
        h('span', { class: 'topbar__motto' }, T.motto),
      ),
    ),
    h('div', { class: 'topbar__resources' },
      h('div', { class: 'topbar__gold' }, goldEl, rateEl),
      h('div', { class: 'topbar__row' }, essencePill),
    ),
  );
  const tabButtons = new Map<Tab, HTMLElement>();
  const tabbar = h('nav', { class: 'tabbar' }, h('div', { class: 'tabbar__inner' }));
  const tabInner = tabbar.firstElementChild as HTMLElement;
  for (const id of TABS) {
    const b = h('button', { class: 'tab' }, T.tabs[id]);
    b.addEventListener('click', () => {
      tab = id;
      render();
    });
    tabButtons.set(id, b);
    tabInner.append(b);
  }

  let overlay: HTMLElement | null = null;

  const ctx: Ctx = {
    state,
    platform,
    get run() {
      return run;
    },
    set run(value: Run | null) {
      run = value;
    },
    now: () => platform.now(),
    render,
    live: (fn) => {
      live.push(fn);
    },
    save,
    toast(text) {
      const el = h('div', { class: 'toast', role: 'status' }, text);
      document.body.append(el);
      window.setTimeout(() => el.remove(), 2600);
    },
    modal(title, body, buttons) {
      ctx.closeModal();
      const row = h('div', { class: 'btn-row' });
      for (const b of buttons) row.append(modalButton(b));
      overlay = h('div', { class: 'overlay' }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('h3', null, title), ...body.map(wrap), row));
      document.body.append(overlay);
    },
    closeModal() {
      overlay?.remove();
      overlay = null;
    },
  };

  function wrap(c: Child): Child {
    return typeof c === 'string' ? h('p', null, c) : c;
  }

  function modalButton(b: ModalButton): HTMLElement {
    const el = h('button', { class: b.ghost ? 'btn btn--ghost' : 'btn' }, b.label);
    el.addEventListener('click', () => {
      ctx.closeModal();
      b.onClick?.();
    });
    return el;
  }

  function save(): void {
    if (!saveEnabled) return;
    state.lastSeen = platform.now();
    state.activeRun = run ? serializeRun(run) : null;
    platform.save(serialize(state));
  }

  function updateTopbar(): void {
    goldEl.textContent = fmt(state.gold);
    rateEl.textContent = fill(T.perSecond, { n: fmt(totalIncome(state)) });
    essenceEl.textContent = String(Math.floor(state.essence));
    essencePill.style.display = state.essence > 0 || state.relicarium > 0 ? '' : 'none';
  }

  function render(): void {
    stopBattleView();
    live = [];
    const keepScroll = window.scrollY;
    clear(main);
    const screen = tab === 'guild' ? guildScreen(ctx) : tab === 'squad' ? squadScreen(ctx) : expeditionScreen(ctx);
    main.append(screen);
    for (const [id, el] of tabButtons) {
      if (id === tab) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    }
    updateTopbar();
    // Переходы внутри экспедиции начинаются с верха экрана, остальное остаётся на месте.
    window.scrollTo(0, tab === 'expedition' ? 0 : keepScroll);
  }

  function onTick(): void {
    const now = platform.now();
    const dt = Math.min(Math.max(0, (now - lastTick) / 1000), OFFLINE_CAP_SEC);
    lastTick = now;
    if (paused) return;
    tick(state, dt);
    updateTopbar();
    for (const fn of [...live]) fn();
  }

  platform.onPauseChange((p) => {
    paused = p;
    lastTick = platform.now();
    if (p) void platform.flush();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      save();
      void platform.flush();
    }
  });
  window.addEventListener('pagehide', () => {
    save();
    void platform.flush();
  });

  // Игра только в альбомной ориентации: в портретной CSS показывает эту заставку поверх всего.
  const rotateHint = h('div', { class: 'rotate-hint', role: 'alert' },
    h('div', { class: 'rotate-hint__icon', 'aria-hidden': 'true' }),
    h('strong', null, T.rotate.title),
    h('p', null, T.rotate.text),
  );
  root.replaceChildren(topbar, main, tabbar, rotateHint);
  render();
  window.setInterval(onTick, TICK_MS);
  window.setInterval(save, AUTOSAVE_MS);
  platform.gameReady();

  if (startNotice) ctx.modal(startNotice.title, [startNotice.text], [{ label: T.notices.ok }]);
  else if (offline && offline.seconds >= 60) {
    const text = fill(T.offline.text, { time: fmtDuration(offline.seconds), capped: offline.capped ? T.offline.capped : '', gold: fmt(offline.gold) });
    ctx.modal(T.offline.title, [text], [{ label: T.offline.take }]);
  }
  save();
}
