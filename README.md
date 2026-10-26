# «Гильдия Теней» — Dark Fantasy браузерная игра

Развитие гильдии, отряд из четырёх героев (Бран, Мира, Рук, Нора), экспедиции по катакомбам, тактические бои
с телеграфами и двухфазный босс Костяной король. Целевая площадка — Яндекс Игры. Текущая версия — **v1.8**.

## С чего начать

| Кто | Что читать |
|---|---|
| Разработчик | [`README_RU.md`](README_RU.md) — сборка, структура кода, QA-скрипты; [`BUILD_AND_CHECK_RU.md`](BUILD_AND_CHECK_RU.md) |
| Художник / аниматор | [`docs/ARTIST_BRIEF_RU.md`](docs/ARTIST_BRIEF_RU.md) — ТЗ; референсы в [`docs/artist/`](docs/artist/); пример поставки в [`qa-fixtures/artpack-demo/`](qa-fixtures/artpack-demo/) |
| QA / продюсер | [`docs/CHANGELOG_v1.8_RU.md`](docs/CHANGELOG_v1.8_RU.md), [`qa/v1.8/QA_REPORT_v1.8_RU.md`](qa/v1.8/QA_REPORT_v1.8_RU.md) |

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # 113 тестов
npm run build   # сборка для Яндекс Игр в dist/
```

## Арт художника

Финальный арт кладётся в `public/art/v17/` и регистрируется в `public/art/v17/art-pack.json` — код менять не нужно.
Перед коммитом: `node tools/art/validate_pack.mjs public/art/v17/art-pack.json --strict`.
В ТЗ пути вида `source/...` соответствуют корню этого репозитория.

Работу художника удобно вести в отдельной ветке (`art/<персонаж>`) и вливать через pull request после проверки в игре.

## Чего нет в репозитории

Скриншоты (≈ 60 МБ), видео игрового процесса и ZIP-комплекты не хранятся в git — они прикладываются к релизу `v1.8`.
