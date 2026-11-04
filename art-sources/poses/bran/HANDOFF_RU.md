# A-01 — техническая передача принятого Брана

04.11.2026. Ответственный: Codex, команда T3 (art lead).
Ветка: `art/t3-bran-handoff`. База: `17d707071767b24e963a0014b2721a330bbec544`.
Задача команды: [#20](https://github.com/zhopkot-bit/guild-of-shadows/issues/20), исходная задача: [#7](https://github.com/zhopkot-bit/guild-of-shadows/issues/7).

## Источники и границы

Семь поз из [PR #11](https://github.com/zhopkot-bit/guild-of-shadows/pull/11),
commit `1f0144fa83b74ea6a428a1482aad46265780e43d`:
`idle`, `windup`, `strike`, `cast`, `hit`, `down`, `victory`.
[Рецензия](https://github.com/zhopkot-bit/guild-of-shadows/pull/11#pullrequestreview-5679303279)
приняла облик и пластику и оставила конкретные доработки.

Все семь PNG побайтно сохранены. Размеры: 1086×1448 RGBA, без увеличения и
перерисовки. Исторические provenance, запросы генерации и первые варианты
сохранены. SHA-256 исходников и канонических референсов — `source-sha256.json`.
Портрет, канонический спрайт и групповой арт не менялись; их хеши проверяются.

## Экспорт

В `proposals/poses.json` добавлены параметры существующего сборщика:
`alignFeet: true`, `poseScale.victory: 1.09` из рецензии и общие поля
`canvasPadding: [8, 16, 8, 8]`, включая запас у поднятого меча.

Подготовленный холст — 1102×1621, игровой — 522×768; стойка — 80,63% холста.
Семь WebP — 623174 байта (608,6 КиБ). Проверяются минимум 4 px поля при
альфе >24, ступни стоящих поз в пределах 1,5% высоты, вынос `down` от опоры
≤0,60 высоты стойки, бюджеты 160 КиБ/позу и 1200 КиБ/набор.
`check-art.py --rebuild` повторяет экспорт и сравнивает все выходные байты.

## Передача интегратору

Файлы: `public/art/v17/poses/bran/`. Фрагмент для T6: `art-pack.fragment.json`.
Интегратор добавляет `heroes.bran.poses = "poses/bran/poses.json"` в общий
реестр, сохраняя остальные поля и записи. Здесь общий реестр не меняется.
`qa-registry.json` — только для dev-проверки через `?artpack=`; включает
передаваемого Брана и существующие позы Миры.

T2/T5 принимают статичные позы, движение и настоящий цикл. Браузерные сценарии
адаптированы из существующих проверок Миры: `check-browser.mjs` проверяет
границы альфа-силуэта с деформацией и камерой; `check-flow.mjs` — реальные
кнопки атаки/прикрытия и событие `cover`, перезагрузку без изменения HP/раунда/хода,
раунд автобоя, штатный досчёт босса, возврат в гильдию и экран героя.
Программный WebGL и эмуляция окна не заменяют реальные устройства и замер FPS.
T6 повторяет применимые проверки на объединённой базе с PR #16.

## Открытые замечания PR #11

Эта техническая передача не закрывает все художественные замечания:

- Усиление `hit`, положение щита в `strike`, уточнение лица и хвата остаются
  отдельными художественными правками из рецензии; здесь PNG сохранены.
- PSD/KRA с ручной доводкой отсутствует. Источники 1448 px приняты для игры;
  источники 2048 px для промо не создавались.
- Дополнительные кадры, glow, wounded и альтернативный hit не входят в этот набор.

Пакет передаётся в `review`, не в `verified`/`done`. Закрытие исходной задачи
и активация набора требуют учёта этих замечаний и приёмки T2/T5.
PR #11 автоматически не закрывается. Слияние и публикация здесь не выполняются.

## Воспроизведение

Из корня репозитория; нужны Pillow и зависимости Node по lockfile:

```bash
python3 tools/art/build_poses.py art-sources/poses/bran/proposals public/art/v17/poses/bran
python3 art-sources/poses/bran/check-art.py --rebuild
node tools/art/validate_pack.mjs art-sources/poses/bran/qa-registry.json --strict
npm test
npm run build
node --import tsx tools/qa/make-saves.ts qa-saves/bran
```

При запущенном `npm run dev -- --host 127.0.0.1 --port 5173`:

```bash
CHROME=/usr/bin/chromium node art-sources/poses/bran/check-browser.mjs
NO_WEBGL=1 VIEWPORTS=1920x1080,667x375 CHROME=/usr/bin/chromium node art-sources/poses/bran/check-browser.mjs http://127.0.0.1:5173/ qa-saves/bran/battle.json work/t3-bran/canvas2d
CHROME=/usr/bin/chromium node art-sources/poses/bran/check-flow.mjs
CHROME=/usr/bin/chromium node tools/qa/action-strip.mjs 'http://127.0.0.1:5173/?qa=1&artpack=/art-sources/poses/bran/qa-registry.json' qa-saves/bran/battle.json work/t3-bran/strike h1 e1 melee 26 1280 720
```

Production smoke использует временный объединённый реестр в `dist/`:

```bash
node --input-type=module -e 'import fs from "node:fs"; const r=JSON.parse(fs.readFileSync("dist/art/v17/art-pack.json")); r.heroes.bran={...r.heroes.bran,poses:"poses/bran/poses.json"}; fs.writeFileSync("dist/art/v17/bran-review.json",JSON.stringify(r));'
# В другом терминале: npm run preview -- --host 127.0.0.1 --port 4173
QA_REGISTRY=./art/v17/bran-review.json CHROME=/usr/bin/chromium node art-sources/poses/bran/check-flow.mjs http://127.0.0.1:4173/ work/t3-bran/production
```

Компактные результаты проверки — `review/`. Большие промежуточные кадры остаются
в `work/t3-bran/` и в Git не добавляются.
