// Story 1.10 (AC5): one composite texture per unique appearance tuple
// (plus uniform override), reference-counted so many characters sharing a
// look share one texture, and bounded by an engineering cap so a busy
// street's worth of distinct tuples can never leak GPU memory
// unboundedly. Pure over an injected `factory`/`dispose` pair -- no
// `pixi.js`, no canvas -- so this is testable with a fake texture type.
//
// Eviction policy (Tim's direction, this story): least-recently-used
// among entries with *no* outstanding reference. A key with a reference
// still held is never evicted, however far past capacity the cache
// temporarily sits (a live character never has its own texture pulled
// out from under it); a fully-released entry stays cached for reuse
// until capacity pressure actually requires reclaiming it -- releasing a
// tuple to 0 references is not itself a reason to dispose it, since the
// same tuple reappearing a moment later (a character walking back into
// view) should not pay to rebuild.

export interface AppearanceCacheOptions<T> {
  readonly factory: (key: string) => T;
  readonly dispose: (value: T) => void;
  readonly capacity: number;
}

interface CacheEntry<T> {
  value: T;
  refCount: number;
}

export class AppearanceCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly options: AppearanceCacheOptions<T>;

  constructor(options: AppearanceCacheOptions<T>) {
    this.options = options;
  }

  /** The number of entries currently cached (referenced or not). */
  get size(): number {
    return this.entries.size;
  }

  /** Returns `key`'s cached texture, building it via the factory on a
   * miss, and increments its reference count. Touching an entry (hit or
   * miss) marks it most-recently-used. */
  acquire(key: string): T {
    const existing = this.entries.get(key);
    if (existing) {
      // Re-insert to move this key to the end of the Map's iteration
      // order -- the cheapest "mark most-recently-used" idiom over a
      // plain Map, no separate linked list needed.
      this.entries.delete(key);
      existing.refCount += 1;
      this.entries.set(key, existing);
      return existing.value;
    }

    const value = this.options.factory(key);
    this.entries.set(key, { value, refCount: 1 });
    this.evictOverCapacity();
    return value;
  }

  /** Drops one reference on `key`. A release past zero, or of a key that
   * was never acquired, is a no-op rather than an underflow -- a caller
   * is never trusted to pair every release with exactly one prior
   * acquire perfectly. */
  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.refCount = Math.max(0, entry.refCount - 1);
  }

  private evictOverCapacity(): void {
    while (this.entries.size > this.options.capacity) {
      const lruKey = this.leastRecentlyUsedEvictableKey();
      if (lruKey === undefined) return; // every entry is still referenced
      const entry = this.entries.get(lruKey);
      this.entries.delete(lruKey);
      if (entry) this.options.dispose(entry.value);
    }
  }

  private leastRecentlyUsedEvictableKey(): string | undefined {
    for (const [key, entry] of this.entries) {
      if (entry.refCount === 0) return key;
    }
    return undefined;
  }
}
