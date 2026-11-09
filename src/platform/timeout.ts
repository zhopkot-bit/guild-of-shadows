/** Bound SDK reads without leaving timers or unhandled late rejections behind.
 * Never use this to overlap timed-out cloud writes: they may still reach the server.
 */
export function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: number;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error('SDK request timed out')), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(operation), timeout]).finally(() => window.clearTimeout(timer));
}
