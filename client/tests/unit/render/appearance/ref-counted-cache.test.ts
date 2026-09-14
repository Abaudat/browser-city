// The generic ref-counted in-flight cache `part-sheets.ts` and
// `test-street/compare-pipeline-vs-stack.ts` each build their own instance of.
// Pure: `load`/`close` are injected fakes, so this needs no `fetch` and
// no `ImageBitmap`.
import { describe, expect, it, vi } from "vitest";
import { createRefCountedCache } from "../../../../src/render/appearance/ref-counted-cache";

interface FakeBitmap {
  readonly id: number;
  closed: boolean;
}

function makeLoader() {
  let nextId = 0;
  const pending = new Map<
    string,
    { resolve: (v: FakeBitmap) => void; reject: (e: Error) => void }
  >();
  const load = vi.fn(
    (key: string) =>
      new Promise<FakeBitmap>((resolve, reject) => {
        pending.set(key, { resolve, reject });
      }),
  );
  const close = vi.fn((bitmap: FakeBitmap) => {
    bitmap.closed = true;
  });
  function resolve(key: string): FakeBitmap {
    const bitmap = { id: nextId++, closed: false };
    pending.get(key)?.resolve(bitmap);
    pending.delete(key);
    return bitmap;
  }
  function reject(key: string): void {
    pending.get(key)?.reject(new Error(`load failed for '${key}'`));
    pending.delete(key);
  }
  return { load, close, resolve, reject };
}

describe("createRefCountedCache", () => {
  it("two concurrent acquires of one key share one load call", () => {
    const { load, close } = makeLoader();
    const cache = createRefCountedCache(load, close);

    const a = cache.acquire("sheet-1");
    const b = cache.acquire("sheet-1");

    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("close runs exactly once, only when the last reference is released", async () => {
    const { load, close, resolve } = makeLoader();
    const cache = createRefCountedCache(load, close);

    const pending = cache.acquire("sheet-1");
    cache.acquire("sheet-1"); // a second reference
    const bitmap = resolve("sheet-1");
    await pending;

    cache.release("sheet-1", bitmap);
    expect(close).not.toHaveBeenCalled();

    cache.release("sheet-1", bitmap);
    expect(close).toHaveBeenCalledExactlyOnceWith(bitmap);
  });

  it("a rejected load is evicted, and a later acquire retries", async () => {
    const { load, close, reject, resolve } = makeLoader();
    const cache = createRefCountedCache(load, close);

    const first = cache.acquire("sheet-1");
    reject("sheet-1");
    await expect(first).rejects.toThrow();

    const second = cache.acquire("sheet-1");
    expect(load).toHaveBeenCalledTimes(2);
    const bitmap = resolve("sheet-1");
    await expect(second).resolves.toBe(bitmap);
  });

  it("two different keys never share an entry or interfere with each other's release", async () => {
    const { load, close, resolve } = makeLoader();
    const cache = createRefCountedCache(load, close);

    const a = cache.acquire("sheet-1");
    const b = cache.acquire("sheet-2");
    expect(a).not.toBe(b);

    const bitmapA = resolve("sheet-1");
    const bitmapB = resolve("sheet-2");
    await Promise.all([a, b]);

    cache.release("sheet-1", bitmapA);
    expect(close).toHaveBeenCalledExactlyOnceWith(bitmapA);
    expect(close).not.toHaveBeenCalledWith(bitmapB);
  });

  it("releasing a key that is not cached is a no-op", () => {
    const { close } = makeLoader();
    const cache = createRefCountedCache(vi.fn(), close);
    const phantom: FakeBitmap = { id: -1, closed: false };
    expect(() => cache.release("never-acquired", phantom)).not.toThrow();
    expect(close).not.toHaveBeenCalled();
  });
});
