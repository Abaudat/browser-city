// Story 1.10 (AC5, FR61): the composite cache keys by the packed tuple
// (plus uniform override), counts references, and evicts least-recently
// used entries past an engineering cap. Pure: the factory/dispose
// functions are injected, so this needs no Pixi and no canvas.
import { describe, expect, it, vi } from "vitest";
import { AppearanceCache } from "../../../../src/render/appearance/appearance-cache";

interface FakeTexture {
  readonly id: number;
  destroyed: boolean;
}

function makeFactory() {
  let nextId = 0;
  const created: FakeTexture[] = [];
  const factory = vi.fn((_key: string): FakeTexture => {
    const texture = { id: nextId++, destroyed: false };
    created.push(texture);
    return texture;
  });
  const dispose = vi.fn((texture: FakeTexture) => {
    texture.destroyed = true;
  });
  return { factory, dispose, created };
}

describe("inv_composite_cache_one_texture_per_tuple", () => {
  it("returns the same texture instance for the same key and calls the factory once", () => {
    const { factory, dispose } = makeFactory();
    const cache = new AppearanceCache<FakeTexture>({ factory, dispose, capacity: 10 });

    const a = cache.acquire("tuple-1");
    const b = cache.acquire("tuple-1");

    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("gives different tuples different entries", () => {
    const { factory, dispose } = makeFactory();
    const cache = new AppearanceCache<FakeTexture>({ factory, dispose, capacity: 10 });

    const a = cache.acquire("tuple-1");
    const b = cache.acquire("tuple-2");

    expect(a).not.toBe(b);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("releases a texture's reference when a character leaves the view, without disposing it while capacity allows it to stay cached", () => {
    const { factory, dispose } = makeFactory();
    const cache = new AppearanceCache<FakeTexture>({ factory, dispose, capacity: 10 });

    const a = cache.acquire("tuple-1");
    cache.acquire("tuple-1"); // a second character sharing the same look
    cache.release("tuple-1");
    expect(dispose).not.toHaveBeenCalled();

    cache.release("tuple-1");
    expect(dispose).not.toHaveBeenCalled();
    expect(a.destroyed).toBe(false);
  });

  it("reuses a fully-released entry on a later acquire, rather than rebuilding it, as long as it was never evicted", () => {
    const { factory, dispose } = makeFactory();
    const cache = new AppearanceCache<FakeTexture>({ factory, dispose, capacity: 10 });

    const a = cache.acquire("tuple-1");
    cache.release("tuple-1");
    const b = cache.acquire("tuple-1");

    expect(b).toBe(a);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("releasing a key with no outstanding reference is a no-op, never an underflow", () => {
    const { dispose } = makeFactory();
    const { factory } = makeFactory();
    const cache = new AppearanceCache<FakeTexture>({ factory, dispose, capacity: 10 });
    expect(() => cache.release("never-acquired")).not.toThrow();
    expect(dispose).not.toHaveBeenCalled();
  });

  // The trace-matrix-registered name (docs/trace-matrix.md,
  // scripts/ci/check-trace-matrix.sh): the property in one assertion,
  // the cases above are what pin its behaviour precisely.
  it("inv_composite_cache_one_texture_per_tuple", () => {
    const { factory, dispose } = makeFactory();
    const cache = new AppearanceCache<FakeTexture>({ factory, dispose, capacity: 10 });

    const keys = ["a", "b", "c"];
    const acquiredTwice = keys.map((k) => [cache.acquire(k), cache.acquire(k)] as const);
    for (const [first, second] of acquiredTwice) {
      expect(first).toBe(second);
    }
    const distinct = new Set(acquiredTwice.map(([t]) => t));
    expect(distinct.size).toBe(keys.length);
    expect(factory).toHaveBeenCalledTimes(keys.length);
  });
});

describe("inv_composite_cache_bounded", () => {
  it("never holds more than its declared capacity of entries with no outstanding reference", () => {
    const { factory, dispose } = makeFactory();
    const cache = new AppearanceCache<FakeTexture>({ factory, dispose, capacity: 3 });

    for (let i = 0; i < 5; i++) {
      cache.acquire(`tuple-${i}`);
      cache.release(`tuple-${i}`);
    }

    expect(cache.size).toBeLessThanOrEqual(3);
  });

  it("evicts the least-recently-used entry first, disposing it", () => {
    const { factory, dispose } = makeFactory();
    const cache = new AppearanceCache<FakeTexture>({ factory, dispose, capacity: 2 });

    const a = cache.acquire("a");
    cache.release("a");
    const b = cache.acquire("b");
    cache.release("b");
    // touch "a" again so "b" becomes the least-recently-used one
    cache.acquire("a");
    cache.release("a");

    cache.acquire("c"); // pushes the cache over capacity
    cache.release("c");

    expect(dispose).toHaveBeenCalledExactlyOnceWith(b);
    expect(a.destroyed).toBe(false);
  });

  it("never evicts an entry that still has an outstanding reference", () => {
    const { factory, dispose } = makeFactory();
    const cache = new AppearanceCache<FakeTexture>({ factory, dispose, capacity: 1 });

    const a = cache.acquire("a"); // still held (no release)
    cache.acquire("b");
    cache.release("b");

    expect(dispose).not.toHaveBeenCalledWith(a);
    expect(a.destroyed).toBe(false);
  });

  // The trace-matrix-registered name -- see the comment on
  // `inv_composite_cache_one_texture_per_tuple` above.
  it("inv_composite_cache_bounded", () => {
    const { factory, dispose } = makeFactory();
    const capacity = 4;
    const cache = new AppearanceCache<FakeTexture>({ factory, dispose, capacity });

    for (let i = 0; i < 50; i++) {
      cache.acquire(`tuple-${i}`);
      cache.release(`tuple-${i}`);
      expect(cache.size).toBeLessThanOrEqual(capacity);
    }
  });
});
