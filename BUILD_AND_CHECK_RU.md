# Сборка и проверки — v1.8, стабилизация рантайма

Актуальная проверка: 04.11.2026, Node.js 24.19.0. Для разработки требуется Node.js 20+;
CI настроен на Node.js 22. Исторические результаты от 23.10.2026 сохранены в `qa/v1.8/`.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run build:yandex
node tools/art/validate_pack.mjs public/art/v17/art-pack.json --strict
npm run sim
```

Проверены: TypeScript без ошибок; 16 тестовых файлов / 167 тестов; обе production-сборки;
основной арт-реестр без ошибок и предупреждений; симуляция баланса.
JS — 182,25 КБ (67,07 КБ gzip), CSS — 42,15 КБ.

Браузерная проверка требует Chromium и запущенного `npm run preview -- --port 4173`:

```bash
QA_PARTY=mira,rook,nora npm run qa:saves
CHROME=/usr/bin/chromium npm run qa:platform
NO_WEBGL=1 CHROME=/usr/bin/chromium npm run qa:platform -- http://127.0.0.1:4173/ qa-saves/battle.json qa-out/platform-canvas2d
CHROME=/usr/bin/chromium node tools/qa/e2e.mjs http://127.0.0.1:4173/ qa-out/e2e-667x375 667 375
```

`qa:platform` проверяет сборку на 1920×1080 и 667×375 с имитацией SDK.
Сквозной цикл финальной сборки проверен на этих же разрешениях с `QA_FINISH_BOSS=1`:
после перехода босса во II фазу используется штатная кнопка «Досчитать».
Размещение боя проверено на всех пяти поддерживаемых альбомных разрешениях.
Проверка внутри настоящих Яндекс Игр и производительность реальных телефонов ею не заменяются.
Подробности и оставшиеся задачи: `docs/RUNTIME_STABILIZATION_RU.md`.

Продолжение приёмки SDK, ошибок сети и наград описано в `docs/PLATFORM_RELIABILITY_RU.md`.
Для него нужны оба preview-сервера (обычный на 4173 и `dist-yandex/` на 4174):

```bash
npm run preview -- --port 4174 --outDir dist-yandex
CHROME=/usr/bin/chromium npm run qa:reliability -- http://127.0.0.1:4173/ qa-saves qa-out/reliability http://127.0.0.1:4174/
```
