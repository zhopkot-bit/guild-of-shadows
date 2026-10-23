/**
 * Всё, что игра хочет от «площадки» (Яндекс.Игры или локальная разработка).
 * Игровая логика знает только этот интерфейс и никогда не обращается к SDK напрямую —
 * поэтому позже сюда же встанет Steam-версия, а тесты идут без браузера.
 */
export interface Platform {
  readonly name: 'local' | 'yandex';

  init(): Promise<void>;

  /** Текущее время в мс. На Яндексе — серверное (игрок не может подкрутить часы). */
  now(): number;

  /** Сырой текст сохранения или null. Разбор и миграции — в core/save.ts. */
  load(): Promise<string | null>;

  /** Ставит сохранение в очередь; реальная отправка ограничена лимитами площадки. */
  save(data: string): void;

  /** Отправить отложенное сохранение немедленно (при сворачивании и закрытии вкладки). */
  flush(): Promise<void>;

  /** true, если игрок досмотрел ролик и награду нужно выдать. */
  showRewarded(placement: string): Promise<boolean>;

  /** Полноэкранная реклама: показывать только в паузах между действиями, не во время игры. */
  showInterstitial(): Promise<void>;

  /** Игра загрузилась и готова к взаимодействию (LoadingAPI.ready). */
  gameReady(): void;

  /** Игровой процесс идёт / остановлен (GameplayAPI.start / stop). */
  gameplayStart(): void;
  gameplayStop(): void;

  /** Платформа просит поставить игру на паузу (реклама, смена вкладки). */
  onPauseChange(cb: (paused: boolean) => void): void;
  isPaused(): boolean;

  /** Двухбуквенный код языка интерфейса: 'ru', 'en', ... */
  getLang(): string;

  /** Событие телеметрии. На Яндексе подключается Метрика отдельно — см. комментарий в yandex.ts. */
  track(event: string, params?: Record<string, unknown>): void;
}
