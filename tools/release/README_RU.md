# R-02 — проверки production-сборки

Владелец: T6. Задача: [#23](https://github.com/zhopkot-bit/guild-of-shadows/issues/23).
Изменения ограничены `.github/` и `tools/release/`. Игровая логика, lockfile,
общие реестры и сценарии T5 не изменяются.

## CI

`Release verification` запускается для pull request, push в `main`,
`release/**`, `integration/**` и вручную. Node.js 22, зависимости через `npm ci`.

1. `build`: typecheck, игровые тесты, отрицательные проверки релизных gates,
   production build, строгий реестр в `public` **и в `dist`**, инвентаризация.
2. `smoke`: четыре независимых задания — 1920×1080 и 667×375, WebGL и Canvas 2D.
   Проверяются новая игра, экран Миры, ориентация, реальный удар, сохранение и
   восстановление HP/раунда/хода, обычный бой и обе фазы босса. Проверяется
   фактически выбранный renderer, ошибки JavaScript/сети и отсутствие прокрутки.
3. `e2e`: существующий `tools/qa/e2e.mjs` на 1366×768, затем обязательная
   проверка отчёта. Нужны ручные атака/умение, reload, подготовка к боссу,
   обе фазы, итоги и возврат с завершённой экспедицией. Пустого `issues` мало.

Браузеры получают **готовый build-артефакт**, не пересобирают его. Инвентарь
содержит размер и SHA-256 каждого файла; после загрузки проверяется совпадение
со всем исходным инвентарём, включая JS/CSS. Все ресурсы `public/` должны
побайтно присутствовать в `dist/`. Проверяются HTML/CSS-ссылки и буквальные
пути арта в JS; динамические пути дополняются строгим реестром и сетевой
проверкой браузера. Исходники/мастера/карты исходного кода в `dist` запрещены.

Артефакты именуются SHA проверенного checkout; на pull request это тестовый
merge-коммит GitHub. Срок хранения — 14 дней. В отчётах браузера записываются
SHA, признак незакоммиченных изменений, версия Node/Chromium и хеш инвентаря.
Отчёты, логи и скриншоты сохраняются и при ошибке. Просроченное доказательство
нужно повторить, а необходимое для выпуска — перенести в архив приёмки.

## Локальное воспроизведение

Нужны Node.js 22+ и Chromium. Установка браузера в CI:

```bash
npm ci
node node_modules/playwright-core/cli.js install --with-deps chromium
```

При готовом системном Chromium можно передать `CHROME=/usr/bin/chromium`.
Для проверки сборки:

```bash
npm run typecheck
npm test
node --test tools/release/gate-checks.mjs
npm run build
mkdir -p qa-out/release
node tools/art/validate_pack.mjs public/art/v17/art-pack.json --strict
node tools/release/verify-dist.mjs dist public qa-out/release/dist-inventory.json
node tools/art/validate_pack.mjs dist/art/v17/art-pack.json --strict
node --import tsx tools/qa/make-saves.ts qa-saves/release
CHROME=/usr/bin/chromium node tools/release/browser-smoke.mjs qa-out/release/webgl-desktop 1920 1080 webgl
CHROME=/usr/bin/chromium node tools/release/browser-smoke.mjs qa-out/release/webgl-phone 667 375 webgl
CHROME=/usr/bin/chromium node tools/release/browser-smoke.mjs qa-out/release/canvas-desktop 1920 1080 canvas2d
CHROME=/usr/bin/chromium node tools/release/browser-smoke.mjs qa-out/release/canvas-phone 667 375 canvas2d
CHROME=/usr/bin/chromium node tools/release/run-e2e.mjs qa-out/release/e2e 1366 768
```

Скрипты сами запускают Vite preview на свободном loopback-порту и останавливают
его после проверки. Для повторного E2E нужен новый каталог: старый отчёт
не может подтвердить новый запуск. Ошибка/таймаут процесса, отсутствующий,
некорректный или неполный отчёт дают ненулевой код завершения.

Для сравнения скачанного артефакта с исходным инвентарём:

```bash
node tools/release/verify-dist.mjs dist public qa-out/release/downloaded.json qa-out/release/dist-inventory.json
```

`gate-checks.mjs` проверяет положительные и отрицательные сценарии:
отсутствующий/изменённый ресурс, испорченная ссылка, исходник в сборке,
выход пути за корень, подмена JS после сборки, ошибочный/неполный E2E-отчёт.
Имя файла намеренно не соответствует шаблону Vitest: эти проверки выполняет
встроенный Node test runner и они не меняют общую конфигурацию тестов.

## Границы результата

Это CI и локальная браузерная проверка. У локального preview отсутствует
`/sdk.js`; этот точный endpoint исключён из ожидаемых локальных сетевых ошибок.
SDK не подменяется, `platformAcceptance` остаётся `not_run`. Настоящее облако,
реклама, iframe платформы и реальные телефоны принимаются T4/T5 отдельно.
Программный WebGL не подтверждает FPS на реальном устройстве.

Наличие workflow-файла не означает, что GitHub Actions уже исполнил проверки
или что включены обязательные status checks в правилах ветки. Их настройка,
приёмка T5 и результаты на объединённой базе остаются отдельными шагами.
Этот пакет не закрывает художественные блокеры PR #16, R-01 или R-03–R-05.
Публикация игры требует решения владельца.
