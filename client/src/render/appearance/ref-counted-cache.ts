// A generic, ref-counted, in-flight-shared cache over an injected
// `load`/`close` pair -- pure (no `fetch`, no `pixi.js`, nothing
// browser-specific), so this is testable with fake async functions.
// `part-sheets.ts` is the one production instance (`load` resolves and
// fetches a vendor sheet, `close` calls `ImageBitmap.close()`);
// `demo/compare-pipeline-vs-stack.ts` builds its own, entirely separate
// instance over the same `load` function, so the e2e harness never shares
// cache state with the production pipeline it is checking.

export interface RefCountedCache<T> {
  /** Returns `key`'s in-flight or already-resolved value, calling `load`
   * on a miss, and increments its reference count. Two concurrent
   * `acquire`s of a key with no entry yet share the one `load` call. */
  acquire(key: string): Promise<T>;
  /** Drops one reference on `key`, taken by a matching `acquire`. Once
   * every caller sharing the value has released it, `close` runs exactly
   * once and the entry is dropped. A release for a key that is not
   * cached is a no-op. */
  release(key: string, value: T): void;
}

interface CacheEntry<T> {
  readonly promise: Promise<T>;
  refCount: number;
}

export function createRefCountedCache<T>(
  load: (key: string) => Promise<T>,
  close: (value: T) => void,
): RefCountedCache<T> {
  const entries = new Map<string, CacheEntry<T>>();

  function acquire(key: string): Promise<T> {
    let entry = entries.get(key);
    if (!entry) {
      const promise = load(key);
      entry = { promise, refCount: 0 };
      entries.set(key, entry);
      // A rejected load must never poison this key for the rest of the
      // session -- a later caller gets a fresh attempt, not the same dead
      // promise. Identity-guarded on `entry`, not merely on `key`: a
      // stale rejection arriving after this key was already released,
      // evicted and re-acquired must never delete the newer entry now
      // sitting there.
      promise.catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
    }
    entry.refCount += 1;
    return entry.promise;
  }

  function release(key: string, value: T): void {
    const entry = entries.get(key);
    if (!entry) return;
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      entries.delete(key);
      close(value);
    }
  }

  return { acquire, release };
}
