export type PauseReason = 'platform' | 'hidden' | 'modal' | 'ad';

/** Independent pause owners cannot resume each other's work. */
export class PauseController {
  private reasons = new Set<PauseReason>();
  private listeners = new Set<(paused: boolean) => void>();

  get active(): boolean {
    return this.reasons.size > 0;
  }

  set(reason: PauseReason, paused: boolean): void {
    const before = this.active;
    if (paused) this.reasons.add(reason);
    else this.reasons.delete(reason);
    if (before !== this.active) for (const listener of [...this.listeners]) listener(this.active);
  }

  subscribe(listener: (paused: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.active);
    return () => { this.listeners.delete(listener); };
  }

  /** Cancellation releases suspended views; recheck when two owners change in the same turn. */
  async wait(signal: AbortSignal): Promise<boolean> {
    while (this.active && !signal.aborted) {
      await new Promise<void>((resolve) => {
        const done = () => { off(); signal.removeEventListener('abort', done); resolve(); };
        const off = this.subscribe((paused) => { if (!paused) done(); });
        signal.addEventListener('abort', done, { once: true });
      });
    }
    return !signal.aborted;
  }
}
