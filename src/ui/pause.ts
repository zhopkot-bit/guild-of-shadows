/** Independent pause causes: clearing one must not resume another. */
export class GamePause {
  private reasons = new Set<string>();
  private listeners = new Set<(paused: boolean) => void>();

  get paused(): boolean {
    return this.reasons.size > 0;
  }

  set(reason: string, active: boolean): void {
    const before = this.paused;
    if (active) this.reasons.add(reason);
    else this.reasons.delete(reason);
    if (before !== this.paused) {
      for (const listener of [...this.listeners]) listener(this.paused);
    }
  }

  subscribe(listener: (paused: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.paused);
    return () => { this.listeners.delete(listener); };
  }

  /** Cancel waits when the owning screen is destroyed. */
  waitUntilResumed(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    if (!this.paused) return Promise.resolve(true);
    return new Promise((resolve) => {
      const finish = (resumed: boolean) => {
        this.listeners.delete(onChange);
        signal.removeEventListener('abort', onAbort);
        resolve(resumed);
      };
      const onChange = (paused: boolean) => { if (!paused) finish(true); };
      const onAbort = () => finish(false);
      this.listeners.add(onChange);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
