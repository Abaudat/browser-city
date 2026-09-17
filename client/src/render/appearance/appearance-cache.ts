// Story 1.10 (AC5): one composite texture per unique appearance tuple
// (plus uniform override), reference-counted so many characters sharing a
// look share one texture, and bounded by an engineering cap so a busy
// street's worth of distinct tuples can never leak GPU memory
// unboundedly. Pure over an injected `factory`/`dispose` pair -- no
// `pixi.js`, no canvas -- so this is testable with a fake texture type.
//
// Eviction policy: least-recently-used among entries with *no* outstanding
// reference. A key with a reference
// still held is never evicted, however far past capacity the cache
// temporarily sits (a live character never has its own texture pulled
// out from under it); a fully-released entry stays cached for reuse
// until capacity pressure actually requires reclaiming it -- releasing a
// tuple to 0 references is not itself a reason to dispose it, since the
// same tuple reappearing a moment later (a character walking back into
// view) should not pay to rebuild.
//
// Eviction runs *before* `build`, not after (Quentin/Tim's direction,
// story 2.7 cycle 1): when `dispose` frees an externally-limited resource
// (a composite-page slot, `appearance-texture.ts`'s own use), the build
// that needed that resource must see it freed in time to claim it --
// evicting after insertion let a full, but mostly-unreferenced, pool
// reject every other new look forever (`REJECTED, ok, REJECTED, ok, ...`
// once the pool first filled), since the slot a build needed was not
// freed until *after* that same build had already failed to claim one.
// `dispose` itself must therefore be synchronous here too -- never a
// `.then(...)` deferred to a microtask, which would free the resource one
// tick too late for the very `build()` call this eviction pass is making
// room for.

export interface AppearanceCacheOptions<T> {
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

  /** Returns `key`'s cached value, calling `build` on a miss, and
   * increments its reference count. Touching an entry (hit or miss) marks
   * it most-recently-used. `build` is the caller's own, taking `key` as a
   * closure rather than this cache decoding it back into whatever the
   * caller built it from -- there is only ever one encoding of a key to
   * keep in sync this way, the caller's own.
   *
   * On a miss, room is made *before* `build` runs (see the eviction-
   * ordering note above the class): a fully-released, unreferenced entry
   * is evicted first, synchronously, if inserting one more would put this
   * cache over capacity. */
  acquire(key: string, build: () => T): T {
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

    this.makeRoomForOneMore();
    const value = build();
    this.entries.set(key, { value, refCount: 1 });
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

  /** Unconditionally removes `key`, regardless of its reference count,
   * without calling `dispose` -- for a `build` that itself failed: the
   * value was never really cached (there is nothing to dispose), and it
   * must not sit in the map as a dead entry a later `acquire` would just
   * hand back again. Never the normal path out of the cache; `release`
   * plus eviction is.
   *
   * Identity-guarded on `value`: a no-op unless `key` still maps to
   * exactly this `value`. Without that guard, a stale rejection racing a
   * fresh rebuild would delete whatever now sits under `key` -- built,
   * released, evicted while its own fetch was still in flight, re-
   * acquired (a fresh entry now under the same key), and only then does
   * the first build's rejection arrive. `forget`ing unconditionally would
   * delete the fresh entry, leaking its value and leaving a third
   * `acquire` to build yet another one for the same tuple. */
  forget(key: string, value: T): void {
    if (this.entries.get(key)?.value === value) this.entries.delete(key);
  }

  /** Evicts least-recently-used, unreferenced entries until inserting one
   * more would not exceed capacity -- called *before* `build()`, not
   * after (see the class's own doc comment). */
  private makeRoomForOneMore(): void {
    while (this.entries.size >= this.options.capacity) {
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
