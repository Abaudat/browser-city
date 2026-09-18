// Story 1.10 (AC5, FR61): the composite cache keys by the packed tuple
// (plus uniform override), counts references, and evicts least-recently
// used entries past an engineering cap. Pure: the build/dispose functions
// are injected, so this needs no Pixi and no canvas.
import { describe, expect, it, vi } from "vitest";
import { AppearanceCache } from "../../../../src/render/appearance/appearance-cache";

interface FakeTexture {
  readonly id: number;
  destroyed: boolean;
}

function makeBuilder() {
  let nextId = 0;
  const created: FakeTexture[] = [];
  const build = vi.fn((): FakeTexture => {
    const texture = { id: nextId++, destroyed: false };
    created.push(texture);
    return texture;
  });
  const dispose = vi.fn((texture: FakeTexture) => {
    texture.destroyed = true;
  });
  return { build, dispose, created };
}

describe("inv_composite_cache_one_texture_per_tuple", () => {
  it("returns the same texture instance for the same key and calls build once", () => {
    const { build, dispose } = makeBuilder();
    const cache = new AppearanceCache<FakeTexture>({ dispose, capacity: 10 });

    const a = cache.acquire("tuple-1", build);
    const b = cache.acquire("tuple-1", build);

    expect(a).toBe(b);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("gives different tuples different entries", () => {
    const { build, dispose } = makeBuilder();
    const cache = new AppearanceCache<FakeTexture>({ dispose, capacity: 10 });

    const a = cache.acquire("tuple-1", build);
    const b = cache.acquire("tuple-2", build);

    expect(a).not.toBe(b);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("releases a texture's reference when a character leaves the view, without disposing it while capacity allows it to stay cached", () => {
    const { build, dispose } = makeBuilder();
    const cache = new AppearanceCache<FakeTexture>({ dispose, capacity: 10 });

    const a = cache.acquire("tuple-1", build);
    cache.acquire("tuple-1", build); // a second character sharing the same look
    cache.release("tuple-1");
    expect(dispose).not.toHaveBeenCalled();

    cache.release("tuple-1");
    expect(dispose).not.toHaveBeenCalled();
    expect(a.destroyed).toBe(false);
  });

  it("reuses a fully-released entry on a later acquire, rather than rebuilding it, as long as it was never evicted", () => {
    const { build, dispose } = makeBuilder();
    const cache = new AppearanceCache<FakeTexture>({ dispose, capacity: 10 });

    const a = cache.acquire("tuple-1", build);
    cache.release("tuple-1");
    const b = cache.acquire("tuple-1", build);

    expect(b).toBe(a);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("releasing a key with no outstanding reference is a no-op, never an underflow", () => {
    const { dispose } = makeBuilder();
    const cache = new AppearanceCache<FakeTexture>({ dispose, capacity: 10 });
    expect(() => cache.release("never-acquired")).not.toThrow();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("forget removes an entry outright, without calling dispose, regardless of its reference count", () => {
    const { build, dispose } = makeBuilder();
    const cache = new AppearanceCache<FakeTexture>({ dispose, capacity: 10 });

    const a = cache.acquire("a", build);
    cache.acquire("a", build); // a second outstanding reference
    cache.forget("a", a);

    expect(cache.size).toBe(0);
    expect(dispose).not.toHaveBeenCalled();

    // A later acquire of the same key builds fresh -- forget left nothing behind.
    cache.acquire("a", build);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("forgetting a key that was never acquired is a no-op", () => {
    const { dispose } = makeBuilder();
    const cache = new AppearanceCache<FakeTexture>({ dispose, capacity: 10 });
    const phantom: FakeTexture = { id: -1, destroyed: false };
    expect(() => cache.forget("never-acquired", phantom)).not.toThrow();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("a stale forget never evicts a fresher entry built after the one it names (Quentin's cycle-3 regression)", () => {
    const { build, dispose } = makeBuilder();
    const cache = new AppearanceCache<FakeTexture>({ dispose, capacity: 1 });

    // Build P1 for "x", release it, then evict it via capacity pressure
    // (a second key at capacity 1 pushes it out) -- exactly the sequence
    // a build whose own fetch is still stalled while its last reference
    // already left would produce.
    const p1 = cache.acquire("x", build);
    cache.release("x");
    cache.acquire("y", build);
    cache.release("y");
    expect(dispose).toHaveBeenCalledExactlyOnceWith(p1);

    // "x" walks back into view: a fresh P2 is built under the same key.
    const p2 = cache.acquire("x", build);

    // P1's own (late) rejection/cleanup arrives now and tries to forget
    // "x" -- but the value it names (p1) is no longer what "x" maps to.
    cache.forget("x", p1);

    // P2 must survive untouched, and no third build for "x" must happen.
    const p3 = cache.acquire("x", build);
    expect(p3).toBe(p2);
    expect(build).toHaveBeenCalledTimes(3); // x(P1), y, x(P2) -- never a P3
  });

  // The trace-matrix-registered name (docs/trace-matrix.md,
  // scripts/ci/check-trace-matrix.sh): the property in one assertion,
  // the cases above are what pin its behaviour precisely.
  it("inv_composite_cache_one_texture_per_tuple", () => {
    const { build, dispose } = makeBuilder();
    const cache = new AppearanceCache<FakeTexture>({ dispose, capacity: 10 });

    const keys = ["a", "b", "c"];
    const acquiredTwice = keys.map(
      (k) => [cache.acquire(k, build), cache.acquire(k, build)] as const,
    );
    for (const [first, second] of acquiredTwice) {
      expect(first).toBe(second);
    }
    const distinct = new Set(acquiredTwice.map(([t]) => t));
    expect(distinct.size).toBe(keys.length);
    expect(build).toHaveBeenCalledTimes(keys.length);
  });
});

describe("inv_composite_cache_bounded", () => {
  it("never holds more than its declared capacity of entries with no outstanding reference", () => {
    const { build, dispose } = makeBuilder();
    const cache = new AppearanceCache<FakeTexture>({ dispose, capacity: 3 });

    for (let i = 0; i < 5; i++) {
      cache.acquire(`tuple-${i}`, build);
      cache.release(`tuple-${i}`);
    }

    expect(cache.size).toBeLessThanOrEqual(3);
  });

  it("evicts the least-recently-used entry first, disposing it", () => {
    const { build, dispose } = makeBuilder();
    const cache = new AppearanceCache<FakeTexture>({ dispose, capacity: 2 });

    const a = cache.acquire("a", build);
    cache.release("a");
    const b = cache.acquire("b", build);
    cache.release("b");
    // touch "a" again so "b" becomes the least-recently-used one
    cache.acquire("a", build);
    cache.release("a");

    cache.acquire("c", build); // pushes the cache over capacity
    cache.release("c");

    expect(dispose).toHaveBeenCalledExactlyOnceWith(b);
    expect(a.destroyed).toBe(false);
  });

  it("never evicts an entry that still has an outstanding reference", () => {
    const { build, dispose } = makeBuilder();
    const cache = new AppearanceCache<FakeTexture>({ dispose, capacity: 1 });

    const a = cache.acquire("a", build); // still held (no release)
    cache.acquire("b", build);
    cache.release("b");

    expect(dispose).not.toHaveBeenCalledWith(a);
    expect(a.destroyed).toBe(false);
  });

  // Story 2.7 (Quentin/Tim's direction, cycle 1): reproduces the exact
  // regression both leads found -- a full-but-unreferenced pool used to
  // reject every other new key forever, because eviction ran *after*
  // `build()` had already failed to find room. Fill capacity, release
  // every entry (none evicted yet -- eviction only ever runs from
  // `acquire`), then acquire N brand-new keys: every one must succeed,
  // and the cache must never grow past capacity.
  it("a full but entirely-unreferenced pool never rejects a new distinct key, however many are acquired in a row", () => {
    const { build, dispose } = makeBuilder();
    const capacity = 4;
    const cache = new AppearanceCache<FakeTexture>({ dispose, capacity });

    for (let i = 0; i < capacity; i++) {
      cache.acquire(`fill-${i}`, build);
      cache.release(`fill-${i}`);
    }
    expect(cache.size).toBe(capacity);

    for (let i = 0; i < capacity * 3; i++) {
      expect(() => {
        const value = cache.acquire(`new-${i}`, build);
        cache.release(`new-${i}`);
        expect(value).toBeDefined();
      }).not.toThrow();
      expect(cache.size).toBeLessThanOrEqual(capacity);
    }
  });

  // The trace-matrix-registered name -- see the comment on
  // `inv_composite_cache_one_texture_per_tuple` above.
  it("inv_composite_cache_bounded", () => {
    const { build, dispose } = makeBuilder();
    const capacity = 4;
    const cache = new AppearanceCache<FakeTexture>({ dispose, capacity });

    for (let i = 0; i < 50; i++) {
      cache.acquire(`tuple-${i}`, build);
      cache.release(`tuple-${i}`);
      expect(cache.size).toBeLessThanOrEqual(capacity);
    }
  });
});
