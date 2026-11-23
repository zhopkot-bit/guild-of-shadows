# Первое решение и возвращение домой

23 ноября 2026. Исходная игровая сборка `786bd05924b510372008fb85886e2b8f2a20b032`.

- В [гильдии](https://github.com/zhopkot-bit/guild-of-shadows/blob/786bd05924b510372008fb85886e2b8f2a20b032/src/ui/guild.ts) приветствие обещает «возвращать свет». [Экран похода](https://github.com/zhopkot-bit/guild-of-shadows/blob/786bd05924b510372008fb85886e2b8f2a20b032/src/ui/expedition.ts) сразу меняет цель на заработок золота, а на карте предлагает категории узлов.
- Первый seed 1337 даёт бой и событие. [Голем](https://github.com/zhopkot-bit/guild-of-shadows/blob/786bd05924b510372008fb85886e2b8f2a20b032/src/expedition/events.ts) уже предлагает взять меньшую добычу или рискнуть здоровьем ради большей. Первую развилку можно строить на игре, которая уже есть.
- [Карта следопыта и Щит хранителя](https://github.com/zhopkot-bit/guild-of-shadows/blob/786bd05924b510372008fb85886e2b8f2a20b032/src/expedition/modules.ts) дают разные игровые преимущества. Для героя, пережившего первую развилку, это доступный способ изменить вторую экспедицию.
- Метод проверки первых 60 секунд и следующей сессии взят из [studioigor](https://github.com/studioigor/studioigor-skill/blob/14d9d09b9a36371a9f038cfe02d882ff8b11dc19/references/design.md). Снимки интерфейса показывают доступность выбора. Субъективный итог требует игры владельца.
