import type { GameState } from '../core/types';
import { deserializeRun, type Run } from './run';

export type RestoredRun =
  | { status: 'loaded'; run: Run }
  | { status: 'empty' | 'recovered' | 'blocked'; run: null };

/** A damaged expedition may be cleared only after the original save has been preserved. */
export function restoreActiveRun(state: GameState, preserveOriginal: () => void): RestoredRun {
  if (state.activeRun === null) return { status: 'empty', run: null };
  const run = deserializeRun(state.activeRun);
  if (run && run.members.every((member) => state.heroes.some((h) => h.id === member.heroId))) {
    return { status: 'loaded', run };
  }
  try {
    preserveOriginal();
  } catch {
    return { status: 'blocked', run: null };
  }
  state.activeRun = null;
  return { status: 'recovered', run: null };
}
