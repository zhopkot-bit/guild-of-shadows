# Technology — Гильдия Теней

ENGINE: web
ENGINE VERSION: Vite 5
DIMENSION: 2D
LANGUAGE: TypeScript
PLATFORMS: браузер, Яндекс Игры

## Decision
Существующие бой, сохранения и два рендера уже работают. Главу реализуем в модели забега и на знакомых экранах. Сборку для проверки на Windows доставляем отдельным автономным HTML.

## Project structure
`src/core` хранит состояние и формат сохранений, `src/expedition` задаёт узлы и итоги, `src/ui` показывает результат. Платформенные сохранения обслуживает `src/platform`.
