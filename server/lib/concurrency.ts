/**
 * Doing a few things at a time, in a way that cannot change the answer.
 *
 * Used by the history search to download attachments a few at a time instead
 * of one by one. The results come back in the order of the items, whatever
 * order the work finished in, and a failure is returned in its place rather
 * than thrown, so the caller decides what an early failure means for the
 * items before it.
 */

export type Settled<R> = { ok: true; value: R } | { ok: false; error: unknown };

/** Runs `fn` over `items`, at most `limit` at once; results are in the items' order. Never throws. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Settled<R>[]> {
  const results: Settled<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { ok: true, value: await fn(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  };
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
