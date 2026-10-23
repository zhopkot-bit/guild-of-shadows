# «Гильдия Теней» — исходный код v1.8 (Dark Fantasy)

Браузерная игра: развитие гильдии, канонический отряд (Бран, Мира, Рук, Нора), экспедиции по карте
катакомб, тактические бои с телеграфами и двухфазный босс Костяной король.

## Быстрый старт
Нужен Node.js 20+ (проверено на 22.22).

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # tsc --noEmit (src + tests + tools)
npm test             # vitest, 113 тестов
npm run sim          # симуляция баланса
npm run build        # production-сборка в dist/
npm run preview      # раздать dist/ локально
```

## Структура
| Путь | Назначение |
|---|---|
| `src/content/roster.ts` | **Единый реестр** heroId → имя → роль → портрет → спрайт; арт врагов; совместимость старых id |
| `src/content/arenas.ts` | Арены: фон, свет свечей, мокрый пол, настроение |
| `src/combat/` | Боевое ядро (Combat Spec v0.3): формула урона, Прикрытие, телеграфы, фазы босса; ИИ |
| `src/expedition/` | Карта, забег, события EV01–EV06, модули MOD01–MOD08, подготовка к боссу, миграция активного забега v1→v2 |
| `src/core/` | Состояние, экономика, сохранения v2 + миграции |
| `src/ui/arena/` | WebGL-сцена боя (деформация спрайтов, свет, частицы, эффекты) + Canvas 2D запасной путь |
| `src/ui/battleView.ts` | Контроллер боя и HUD |
| `src/ui/portrait.ts` | Портрет 48/64/96/128 по личности героя |
| `public/art/v17/` | Производственные ассеты v1.7 + `asset-manifest.json` (provenance) + `art-pack.json` (реестр финального арта художника, пока пустой) |
| `src/content/artpack.ts`, `src/ui/arena/rig.ts` | Загрузка арта художника: скелеты DragonBones, листы кадров, слои арены |
| `tools/art/validate_pack.mjs` | Проверка поставки художника (см. `docs/ARTIST_BRIEF_RU.md` в комплекте) |
| `qa-fixtures/artpack-demo/` | Тестовый пакет арта: манекен DragonBones, лист кадров, передний план |
| `tests/` | Юнит- и интеграционные тесты |
| `tools/art/build_assets.py` | Воспроизводимый конвейер ассетов из Concept Art Pack v1.1 |
| `tools/qa/` | Браузерная приёмка: сейвы, скриншоты с аудитом вёрстки, сквозной сценарий, запись видео |

## Браузерная приёмка (Playwright + Chromium)
```bash
npm run build && npx vite preview --port 4173 &
npm run qa:saves                                    # сейвы: бой, элита, босс I/II
npm run qa:e2e                                      # гильдия → отряд → экспедиция → босс → итоги
node tools/qa/shot.mjs "http://127.0.0.1:4173/?qa=1" qa-saves/boss-phase2.json out.png 1920 1080
node tools/qa/layout-probe.mjs qa-saves/battle.json qa-out/layout http://127.0.0.1:4173/   # зоны боя на 4 разрешениях
```

Проверка арта художника (нужен `npm run dev`, т.к. `qa-fixtures/` не входит в сборку):
```bash
node tools/art/validate_pack.mjs public/art/v17/art-pack.json --strict
# в браузере: http://localhost:5173/?artpack=/qa-fixtures/artpack-demo/art-pack.json
node tools/qa/artpack-shot.mjs http://127.0.0.1:5173/ qa-saves/battle.json qa-out/artpack
```
`CHROME=/путь/к/chrome` — если Chromium лежит не в `/opt/pw-browsers/chromium`.

## Ассеты
`python tools/art/build_assets.py <concept_art_dir> <legacy_scenes_dir> public/art/v17`
(нужны pillow, numpy, opencv-python-headless, rembg[cpu]; модель isnet-general-use).
