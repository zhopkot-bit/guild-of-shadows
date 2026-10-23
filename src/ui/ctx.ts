import type { GameState } from '../core/types';
import type { Platform } from '../platform';
import type { Run } from '../expedition/run';
import type { Child } from './dom';

export interface ModalButton {
  label: string;
  ghost?: boolean;
  onClick?: () => void;
}

/** Всё, что экраны получают от приложения. Экраны ничего не знают друг о друге. */
export interface Ctx {
  state: GameState;
  platform: Platform;
  run: Run | null;
  now(): number;
  /** Полная перерисовка текущего экрана (после структурных изменений). */
  render(): void;
  /** Регистрирует функцию, которая обновляет живые значения (таймеры, доступность кнопок) каждые 250 мс. */
  live(fn: () => void): void;
  /** Сохранить прогресс (в очередь платформы). */
  save(): void;
  toast(text: string): void;
  modal(title: string, body: Child[], buttons: ModalButton[]): void;
  closeModal(): void;
}
