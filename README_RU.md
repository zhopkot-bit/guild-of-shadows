# «Гильдия Теней» — исходный код v1.7 (Dark Fantasy)

Браузерная игра: развитие гильдии, канонический отряд (Бран, Мира, Рук, Нора), экспедиции по карте
катакомб, тактические бои с телеграфами и двухфазный босс Костяной король.

## Быстрый старт
Нужен Node.js 20+ (проверено на 22.22).

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # tsc --noEmit (src + tests + tools)
npm test             # vitest, 89 тестов
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
| `src/expedition/` | Карта, забег, события EV01–EV06, реликвии, миграция активного забега v1→v2 |
| `src/core/` | Состояние, экономика, сохранения v2 + миграции |
| `src/ui/arena/` | WebGL-сцена боя (деформация спрайтов, свет, частицы, эффекты) + Canvas 2D запасной путь |
| `src/ui/battleView.ts` | Контроллер боя и HUD |
| `src/ui/portrait.ts` | Портрет 48/64/96/128 по личности героя |
| `public/art/v17/` | Производственные ассеты v1.7 + `asset-manifest.json` (provenance) |
| `tests/` | Юнит- и интеграционные тесты |
| `tools/art/build_assets.py` | Воспроизводимый конвейер ассетов из Concept Art Pack v1.1 |
| `tools/qa/` | Браузерная приёмка: сейвы, скриншоты с аудитом вёрстки, сквозной сценарий, запись видео |

## Браузерная приёмка (Playwright + Chromium)
```bash
npm run build && npx vite preview --port 4173 &
npm run qa:saves                                    # сейвы: бой, элита, босс I/II
npm run qa:e2e                                      # гильдия → отряд → экспедиция → босс → итоги
node tools/qa/shot.mjs "http://127.0.0.1:4173/?qa=1" qa-saves/boss-phase2.json out.png 1920 1080
```
`CHROME=/путь/к/chrome` — если Chromium лежит не в `/opt/pw-browsers/chromium`.

## Ассеты
`python tools/art/build_assets.py <concept_art_dir> <legacy_scenes_dir> public/art/v17`
(нужны pillow, numpy, opencv-python-headless, rembg[cpu]; модель isnet-general-use).
