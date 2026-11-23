// Real browser playthrough. A fixed calendar makes the second expedition map repeatable.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const [entry, out = 'qa-out/story'] = process.argv.slice(2);
assert(entry, 'Usage: node tools/release/check-story.mjs <URL or HTML> [out]');
const url = /^(?:https?|file):/i.test(entry) ? new URL(entry) : pathToFileURL(resolve(entry));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const shots = [], rows = [];
const button = (page, name) => page.getByRole('button', { name, exact: true });
const state = page => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('gos.save'));
  return { rescue: s.rescue, completed: s.expeditionsCompleted, won: s.stats.expeditionsWon,
    essence: s.essence, run: s.activeRun ? JSON.parse(s.activeRun) : null };
});
async function shot(page, id, caption, anchor) {
  await anchor.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const bytes = await page.screenshot({ path: join(out, id + '.png'), animations: 'disabled' });
  shots.push({ id, caption, image: bytes.toString('base64') });
}
async function start(page, chapter) {
  const guild = page.locator('.guild-hero[data-rescue-stage="' + chapter + '"]');
  await guild.waitFor();
  await guild.locator('.rescue-cta').click();
  await button(page, 'Начать экспедицию').click();
  await page.locator('.screen--stage-map').waitFor();
}
async function fight(page, manual = false) {
  const coach = page.locator('.coach:not([hidden]) button');
  if (manual) {
    await page.locator('.action--attack').waitFor();
    if (await coach.isVisible()) await coach.click();
    await page.locator('.action--attack').click();
    await page.locator('.plate--enemy.is-target').first().click();
    await page.waitForFunction(() => {
      const b = JSON.parse(JSON.parse(localStorage.getItem('gos.save')).activeRun).battle;
      return b.log.some(e => e.t === 'hit' && b.units.some(u => u.side === 'hero' && u.id === e.actor));
    });
  }
  const finish = button(page, 'Досчитать');
  if (await coach.isVisible()) await coach.click();
  await finish.click();
  const result = page.locator('.hud__result .result-card');
  await result.waitFor();
  assert(await result.evaluate(el => el.classList.contains('result-card--win')), 'Battle was lost');
  await result.getByRole('button').click();
}
async function nextNode(page) {
  for (const kind of ['camp', 'chest', 'event', 'battle', 'elite', 'boss']) {
    const node = page.locator('.node--' + kind + '.is-reachable').first();
    if (await node.count()) { await node.click(); return; }
  }
  throw Error('No reachable node');
}
async function reachKing(page) {
  let boss = false;
  for (let count = 0; count < 40; count++) {
    const { run } = await state(page);
    switch (run.stage) {
      case 'map': await nextNode(page); break;
      case 'battle':
        if (run.battleKind === 'boss') boss = true;
        await fight(page);
        break;
      case 'event': {
        const available = page.locator('.choice-list button:enabled');
        const safe = available.filter({ hasText: /Обойти безопасно|Забрать только припасы|Помочь и исцелить|Осторожно отключить|Выбрать безопасный маршрут|Отступить и обойти/ }).first();
        await (await safe.count() ? safe : available.first()).click();
        break;
      }
      case 'eventResult': await button(page, 'Дальше').click(); break;
      case 'chest': await page.locator('.offer').first().click(); break;
      case 'camp': await page.getByRole('button', { name: /Отдохнуть/ }).click(); break;
      case 'prep':
        await page.getByRole('button', { name: run.members.some(m => m.alive && m.frac < 0.75) ? /Перевязать раны/ : /Сомкнуть щиты/ }).click();
        break;
      case 'ended':
        assert(boss && run.result === 'victory' && run.nodesCleared === 7);
        assert.equal((await state(page)).rescue.stage, 'home');
        return;
      default: throw Error('Unexpected game stage ' + run.stage);
    }
  }
  throw Error('The expedition did not finish');
}
async function route(kind, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'ru-RU' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45_000);
  await page.clock.setFixedTime(new Date('2026-11-23T12:00:00Z'));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(url.href);
    await start(page, 'search');
    const choices = page.locator('button[data-rescue-route]');
    const plan = await choices.allInnerTexts();
    assert.equal(plan.length, 2);
    assert(plan.some(s => s.includes('Удержать лестницу')) && plan.some(s => s.includes('Запустить лебёдку')));
    if (kind === 'stairs') await shot(page, '01-choice', 'Первый поход · выбор пути', choices.first());
    await page.locator('button[data-rescue-route="' + kind + '"]').click();
    if (kind === 'stairs') {
      await fight(page, true);
    } else {
      const before = (await state(page)).run;
      assert.equal(before.event.id, 'EV06');
      const dismantle = page.getByRole('button', { name: /Разобрать ядро/ });
      assert.match(await dismantle.innerText(), /15\s*HP/i);
      await dismantle.click();
      await page.locator('.outcome').waitFor();
      const after = (await state(page)).run;
      assert.equal(after.essenceEarned - before.essenceEarned, 3);
      assert(after.members.every((m, i) => m.frac < before.members[i].frac));
      assert.match(await page.locator('.outcome').innerText(), /15\s*HP/i);
      await button(page, 'Дальше').click();
    }
    const note = page.locator('.rescue-note[data-rescue-outcome="' + kind + '"]');
    await note.waitFor();
    const consequence = await note.innerText();
    const done = (await state(page)).run;
    assert.equal(done.rescue.outcome, kind);
    assert.equal(done.nodesCleared, 1);
    await page.reload();
    await note.waitFor();
    assert.equal(await note.innerText(), consequence);
    assert.deepEqual((await state(page)).run.completedNodes, done.completedNodes);
    await button(page, 'Покинуть подземелье').click();
    await button(page, 'Уйти').click();
    await page.locator('.summary .rescue-note').waitFor();
    const returned = await state(page);
    assert.equal(returned.run.result, 'defeat');
    assert.equal(returned.rescue.stage, 'trail');
    assert.equal(returned.rescue.route, kind);
    await page.reload();
    await page.locator('.summary .rescue-note').waitFor();
    const reloaded = await state(page);
    for (const field of ['completed', 'essence', 'won', 'rescue']) assert.deepEqual(reloaded[field], returned[field]);
    assert.deepEqual(reloaded.run.summary, returned.run.summary, 'Reload changed the paid-out summary');
    await button(page, 'В гильдию').click();
    const guild = page.locator('.guild-hero[data-rescue-stage="trail"]');
    await guild.waitFor();
    assert.equal((await state(page)).run, null);
    const promise = await guild.innerText();
    await shot(page, kind === 'stairs' ? '02-stairs' : '03-winch', kind === 'stairs' ? 'Гильдия после боя' : 'Гильдия после лебёдки', guild.locator('.rescue-cta'));
    await start(page, 'trail');
    await page.locator('.rescue-note[data-rescue-stage="trail"]').waitFor();
    const trail = (await state(page)).run;
    const item = kind === 'stairs' ? 'wardenShield' : 'pathfinderMap';
    assert.deepEqual(trail.relics, [item]);
    assert.equal(trail.rescue.route, kind);
    const equipment = await page.locator('.module-chip').innerText();
    assert.equal(equipment.trim(), kind === 'stairs' ? 'Щит хранителя' : 'Карта следопыта');
    const availableBattle = page.locator('.node--battle.is-reachable').first();
    await availableBattle.waitFor();
    const scout = await page.locator('.node-scout').allInnerTexts();
    if (kind === 'winch') assert(scout.some(text => text.trim()), 'Scout map should reveal an encounter');
    else {
      assert.equal(scout.length, 0);
      await availableBattle.click();
      const firstBattle = (await state(page)).run.battle;
      assert.equal(firstBattle.mods.wardenLeft, 8, 'Shield must absorb the first blow');
      await reachKing(page);
      await button(page, 'В гильдию').click();
      const home = page.locator('.guild-hero[data-rescue-stage="home"]');
      await home.waitFor();
      await shot(page, '04-home', 'Возвращение после Костяного короля', home);
      await start(page, 'home');
      assert.deepEqual((await state(page)).run.relics, []);
    }
    assert.deepEqual(errors, []);
    rows.push({ kind, width, height, consequence, promise, equipment, scout });
  } catch (error) {
    await page.screenshot({ path: join(out, 'failure-' + kind + '.png') }).catch(() => {});
    throw error;
  } finally { await ctx.close(); }
}
async function makeSheet() {
  const page = await browser.newPage();
  const sorted = [...shots].sort((a, b) => a.id.localeCompare(b.id));
  const images = await page.evaluate(async shots => {
    const canvas = document.createElement('canvas'); canvas.width = 1360; canvas.height = 820;
    const gc = canvas.getContext('2d'); gc.fillStyle = '#11151a'; gc.fillRect(0, 0, 1360, 820);
    gc.font = 'bold 18px sans-serif';
    for (let i = 0; i < shots.length; i++) {
      const picture = new Image(); picture.src = 'data:image/png;base64,' + shots[i].image; await picture.decode();
      const x = (i % 2) * 680, y = Math.floor(i / 2) * 410;
      gc.fillStyle = '#efdfbd'; gc.fillText(shots[i].caption, x + 8, y + 22);
      gc.drawImage(picture, x, y + 28, 680, 382);
    }
    const thumb = document.createElement('canvas'); thumb.width = 960; thumb.height = 579;
    thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
    return [canvas.toDataURL('image/jpeg', .88), thumb.toDataURL('image/jpeg', .72)].map(s => s.split(',')[1]);
  }, sorted);
  writeFileSync(join(out, 'story-sheet.jpg'), Buffer.from(images[0], 'base64'));
  const parts = images[1].match(/.{1,1800}/g);
  parts.forEach((data, i) => console.log(['STORY_PREVIEW', i, parts.length, data].join('|')));
  await page.close();
}
try {
  await route('stairs', 1366, 768);
  await route('winch', 667, 375);
  assert.notEqual(rows[0].consequence, rows[1].consequence);
  assert.notEqual(rows[0].promise, rows[1].promise);
  await makeSheet();
  writeFileSync(join(out, 'story.json'), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify({ ok: true, rows }));
} finally { await browser.close(); }
