// Сквозной игровой цикл в настоящем браузере: node tools/qa/e2e.mjs <baseUrl> <outDir> [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base, outDir, W = '1920', H = '1080'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: +W, height: +H } });
const page = await ctx.newPage();
const issues = [];
const steps = [];
page.on('pageerror', (e) => issues.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) issues.push(`console: ${m.text()}`); });
page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/sdk.js')) issues.push(`http ${r.status()} ${r.url()}`); });
const step = (s) => { steps.push(s); console.log('•', s); };
const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png` });
const tab = (name) => page.locator('.tab', { hasText: name }).click();
const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('gos.save') ?? 'null'));

// ARTPACK=/путь/к/art-pack.json — прогон с тестовым артом (нужен dev-сервер: qa-fixtures не входит в сборку).
await page.goto(`${base}?qa=1${process.env.ARTPACK ? `&artpack=${process.env.ARTPACK}` : ''}`, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
step('новая игра: экран гильдии');
await shot('01-guild');

await tab('Отряд');
await page.waitForTimeout(600);
const cards = await page.locator('.hero-card-lg').evaluateAll((els) => els.map((e) => ({ hero: e.getAttribute('data-hero'), name: e.querySelector('h3')?.textContent, img: e.querySelector('.portrait img')?.getAttribute('src') })));
step(`отряд: карточки ${JSON.stringify(cards)}`);
for (const c of cards) if (!c.img?.includes(`/heroes/${c.hero}/portrait`)) issues.push(`портрет не соответствует герою: ${JSON.stringify(c)}`);
await shot('02-squad');
// Замена в отряде: убрать Нору, добавить Миру, вернуть как было.
await page.locator('.hero-card-lg[data-hero="nora"] button', { hasText: 'Убрать из отряда' }).click();
await page.locator('.hero-card-lg[data-hero="mira"] button', { hasText: 'В отряд' }).click();
let s = await save();
step(`состав после замены: ${s.party.map((id) => s.heroes.find((h) => h.id === id).name).join(', ')}`);
await page.locator('.hero-card-lg[data-hero="mira"] button', { hasText: 'Убрать из отряда' }).click();
await page.locator('.hero-card-lg[data-hero="nora"] button', { hasText: 'В отряд' }).click();
// Экран героя: живая фигура на сцене, биография, закрытие по Esc.
await page.locator('.hero-card-lg[data-hero="mira"] .hero-card-lg__open').click();
await page.waitForTimeout(1200);
const sheet = await page.locator('.hero-sheet').evaluate((e) => ({ name: e.querySelector('h2')?.textContent, bio: !!e.querySelector('.hero-sheet__bio'), canvas: !!e.querySelector('canvas') }));
step(`экран героя: ${JSON.stringify(sheet)}`);
if (sheet.name !== 'Мира' || !sheet.bio || !sheet.canvas) issues.push(`экран героя неполный: ${JSON.stringify(sheet)}`);
await shot('02b-hero-sheet');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
if (await page.locator('.hero-sheet').count()) issues.push('экран героя не закрылся по Esc');

await tab('Экспедиция');
await page.waitForTimeout(500);
await shot('03-expedition-lobby');
await page.getByRole('button', { name: 'Начать экспедицию' }).click();
await page.waitForTimeout(700);
step('экспедиция начата: карта');
await shot('04-map');

const goldBefore = (await save()).gold;
let manualDone = false;
let reloadDone = false;
let bossSeen = false;
const tipsShot = new Set();
const shotStages = new Set();
for (let guard = 0; guard < 400; guard++) {
  const stage = await page.evaluate(() => document.querySelector('.screen--expedition')?.className ?? document.querySelector('main section')?.className ?? '');
  if (stage.includes('stage-map')) {
    const nodes = page.locator('.node.is-reachable');
    const n = await nodes.count();
    if (!n) { issues.push('карта: нет доступных узлов'); break; }
    // Предпочитаем бой, чтобы проверить больше боёв; иначе — первый доступный узел.
    let pick = nodes.first();
    for (let i = 0; i < n; i++) if ((await nodes.nth(i).getAttribute('class')).includes('node--battle')) { pick = nodes.nth(i); break; }
    await pick.click();
    await page.waitForTimeout(500);
    continue;
  }
  if (stage.includes('stage-battle')) {
    const coach = page.locator('.coach:not([hidden])');
    if (await coach.count()) {
      const title = (await coach.locator('strong').innerText()).trim();
      if (!tipsShot.has(title)) {
        tipsShot.add(title);
        step(`подсказка обучения: «${title}»`);
        await shot(`05t-coach-${tipsShot.size}`);
      }
      await coach.locator('button').click().catch(() => {});
    }
    const boss = await page.locator('.boss-bar').count();
    if (boss && !bossSeen) {
      bossSeen = true;
      step('бой с Костяным королём');
      await page.waitForTimeout(2500);
      await shot('08-boss-start');
    }
    if (!manualDone) {
      // Ручной ход: атака → выбор цели на арене (плашка врага), затем умение.
      await page.waitForSelector('.action--attack', { timeout: 30000 });
      await shot('05-battle-manual-turn');
      await page.locator('.action--attack').click();
      await page.waitForTimeout(300);
      await shot('06-battle-target-select');
      await page.locator('.plate--enemy.is-target').first().click();
      step('ручная атака по выбранной цели');
      await page.waitForTimeout(450);
      await shot('07-battle-attack-anim');
      await page.waitForSelector('.action--attack', { timeout: 30000 });
      const skill = page.locator('.action--skill.is-ready');
      if (await skill.count()) {
        await skill.click();
        await page.waitForTimeout(200);
        const target = page.locator('.plate--enemy.is-target, .hero-card.is-target').first();
        await target.click();
        step('ручное умение');
        await page.waitForTimeout(1500);
      }
      manualDone = true;
      continue;
    }
    if (!reloadDone) {
      const before = await page.evaluate(() => { const b = window.__gosArena?.battle(); return b ? { round: b.round, hp: b.units.map((u) => u.hp), current: b.current } : null; });
      await page.waitForTimeout(400);
      const persisted = await save();
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      const after = await page.evaluate(() => { const b = window.__gosArena?.battle(); return b ? { round: b.round, hp: b.units.map((u) => u.hp), current: b.current } : null; });
      step(`перезагрузка посреди боя: до ${JSON.stringify(before)} → после ${JSON.stringify(after)}`);
      if (!after) issues.push('после перезагрузки бой не восстановлен');
      void persisted;
      reloadDone = true;
      // Дальше — автобой на скорости ×4.
      await page.locator('.segmented button', { hasText: 'Авто' }).click();
      await page.locator('.segmented button', { hasText: '×4' }).click();
      continue;
    }
    const res = page.locator('.hud__result:not([hidden]) .btn');
    if (await res.count()) {
      if (bossSeen) await shot('09-boss-result');
      await res.click();
      await page.waitForTimeout(600);
      continue;
    }
    if (bossSeen && !(await page.locator('.boss-bar.is-phase-two').count()) === false) {
      // фаза II уже видна
    }
    await page.waitForTimeout(700);
    if (bossSeen && (await page.locator('.boss-bar.is-phase-two').count()) && !steps.some((x) => x.includes('фаза II'))) {
      step('фаза II Костяного короля');
      await shot('08b-boss-phase2');
    }
    continue;
  }
  if (stage.includes('stage-prep')) {
    const prep = await page.locator('.stage--prep').innerText();
    step(`подготовка к боссу: ${prep.replace(/\s+/g, ' ').slice(0, 160)}`);
    await shot('07p-boss-prep');
    await page.locator('.stage--prep .btn, .stage--prep .offer').first().click();
    await page.waitForTimeout(600);
    continue;
  }
  if (stage.includes('stage-eventResult') || stage.includes('stage-chest') || stage.includes('stage-camp')) {
    const kind = stage.match(/stage-(\w+)/)?.[1];
    if (kind && !shotStages.has(kind)) {
      shotStages.add(kind);
      await shot(`10${kind === 'chest' ? 'c' : kind === 'camp' ? 'k' : 'r'}-${kind}`);
      if (kind === 'chest') step(`сундук: ${(await page.locator('.stage').innerText()).replace(/\s+/g, ' ').slice(0, 160)}`);
    }
    const b = page.locator('.stage .btn, .stage .offer').first();
    await b.click();
    await page.waitForTimeout(400);
    continue;
  }
  if (/stage-event(\s|$)/.test(stage)) {
    const btns = page.locator('.choice-list .btn:not([disabled])');
    await shot('10-event');
    await btns.first().click();
    await page.waitForTimeout(400);
    continue;
  }
  if (stage.includes('stage-ended')) {
    await page.waitForTimeout(600);
    await shot('11-summary');
    const text = await page.locator('.summary').innerText();
    step(`итоги: ${text.replace(/\s+/g, ' ').slice(0, 220)}`);
    const goldAfter = (await save()).gold;
    // Перезагрузка на экране итогов не должна начислить награду повторно.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const goldReload = (await save()).gold;
    step(`золото: до ${goldBefore} → после итогов ${goldAfter} → после перезагрузки ${goldReload}`);
    if (Math.abs(goldReload - goldAfter) > goldAfter * 0.01 + 50) issues.push('после перезагрузки итогов золото изменилось сверх фонового дохода');
    await page.getByRole('button', { name: 'В гильдию' }).click();
    await page.waitForTimeout(600);
    s = await save();
    step(`возврат в гильдию: activeRun=${s.activeRun === null ? 'null' : 'есть'}, экспедиций завершено ${s.expeditionsCompleted}`);
    await shot('12-guild-after');
    break;
  }
  await page.waitForTimeout(300);
}
if (!tipsShot.size) issues.push('подсказки обучения первого боя не показались');
if (!steps.some((x) => x.startsWith('подготовка к боссу'))) issues.push('экран подготовки к боссу не пройден');
writeFileSync(`${outDir}/e2e-report.json`, JSON.stringify({ viewport: `${W}x${H}`, steps, issues }, null, 2));
console.log(JSON.stringify({ issues }, null, 1));
await browser.close();
