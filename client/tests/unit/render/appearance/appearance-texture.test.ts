// Story 2.7 (Quentin/Tim's direction, cycle 1): `appearance-texture.ts`
// owns real logic of its own (the slot exhaustion/staleness plumbing,
// the release-on-failure catch, the build-once-per-slot frame cache), so
// it stays inside the coverage gate -- `pixi.js` mocked (`atlas-pages.
// test.ts`'s own idiom: no real `OffscreenCanvas`/`fetch` needed), and
// `CompositePageProvider`/`CharacterPageLoader` both injected as fakes.

import type { Texture as PixiTexture, TextureSource } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type {
  AccessoryDef,
  AppearanceLayoutDef,
  BodyDef,
  Defs,
  EyesDef,
  HairstyleDef,
  OutfitDef,
} from "../../../../src/defs/types";
import type { CanvasLike } from "../../../../src/render/appearance/composite";
import type { CompositePageProvider } from "../../../../src/render/appearance/composite-pages";

vi.mock("pixi.js", () => {
  class FakeRectangle {
    constructor(
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) {}
  }
  class FakeTexture {
    source: unknown;
    frame: unknown;
    constructor(opts: { source: unknown; frame: unknown }) {
      this.source = opts.source;
      this.frame = opts.frame;
    }
  }
  return { Rectangle: FakeRectangle, Texture: FakeTexture };
});

const { AppearanceTextureCache } = await import(
  "../../../../src/render/appearance/appearance-texture"
);
const { Texture } = await import("pixi.js");

// --- fakes ------------------------------------------------------------

// A fake `TextureSource` identity -- never a real pixi.js source (this
// file mocks pixi.js entirely), just something with its own object
// identity for `pageSources()`/`Set` equality to key off.
type FakeTextureSource = { readonly __fakeSource: true };

interface FakePage {
  readonly source: FakeTextureSource;
}

class FakeCompositePages implements CompositePageProvider {
  readonly pageCount: number;
  private readonly pages: FakePage[];
  readonly clearCalls: { page: number; x: number; y: number; width: number; height: number }[] = [];
  readonly drawCalls: { page: number; image: unknown }[] = [];
  flushCalls = 0;

  constructor(pageCount: number) {
    this.pageCount = pageCount;
    this.pages = Array.from(
      { length: pageCount },
      () => ({ source: { __fakeSource: true } }) as FakePage,
    );
  }

  texture(pageIndex: number): PixiTexture {
    const page = this.pages[pageIndex];
    if (!page) throw new Error(`FakeCompositePages: page ${pageIndex} does not exist`);
    return new Texture({
      source: page.source,
      frame: undefined,
    } as unknown as ConstructorParameters<typeof Texture>[0]) as unknown as PixiTexture;
  }

  pageSources(): ReadonlySet<TextureSource> {
    return new Set(this.pages.map((p) => p.source)) as unknown as ReadonlySet<TextureSource>;
  }

  clearSlot(page: number, x: number, y: number, width: number, height: number): void {
    this.clearCalls.push({ page, x, y, width, height });
  }

  contextFor(page: number): CanvasLike {
    return {
      imageSmoothingEnabled: true,
      drawImage: (image: unknown) => {
        this.drawCalls.push({ page, image });
      },
    };
  }

  flush(): void {
    this.flushCalls++;
  }
}

/** A page loader whose `acquire` resolves immediately, except for files
 * named in `heldFiles`, which stay pending until `resolveAll` is called
 * for that exact file -- lets a test interleave an eviction with a
 * still-in-flight build for one specific layer, deterministically,
 * without every other layer's load blocking the interleave too. */
class DeferredPageLoader {
  readonly acquireCalls: string[] = [];
  readonly releaseCalls: string[] = [];
  private readonly pending = new Map<string, { resolve: (bitmap: unknown) => void }[]>();
  private readonly heldFiles = new Set<string>();

  acquire(file: string): Promise<unknown> {
    this.acquireCalls.push(file);
    if (!this.heldFiles.has(file)) return Promise.resolve({ file });
    return new Promise((resolve) => {
      const list = this.pending.get(file) ?? [];
      list.push({ resolve });
      this.pending.set(file, list);
    });
  }

  release(file: string, _image: unknown): void {
    this.releaseCalls.push(file);
  }

  /** From this call on, `acquire` of any of these files returns promises
   * that only settle once `resolveAll` is called for that same file. */
  holdPending(...files: string[]): void {
    for (const file of files) this.heldFiles.add(file);
  }

  resolveAll(file: string): void {
    for (const { resolve } of this.pending.get(file) ?? []) resolve({ file });
    this.pending.delete(file);
  }
}

// --- defs fixture -------------------------------------------------------

const LAYOUT: AppearanceLayoutDef = {
  id: 1,
  key: "adult",
  family: "adult",
  cellWidth: 16,
  cellHeight: 32,
  directions: ["down"],
  rows: [{ animation: "idle", row: 0, framesPerDirection: 1 }],
  acceptedSizes: [{ width: 16, height: 32 }],
};

const KID_LAYOUT: AppearanceLayoutDef = { ...LAYOUT, id: 2, key: "kid", family: "kid" };
const DIFFERENT_GEOMETRY_LAYOUT: AppearanceLayoutDef = {
  ...LAYOUT,
  id: 3,
  key: "robot",
  family: "kid",
  rows: [{ animation: "walk", row: 0, framesPerDirection: 1 }],
};

function atlas(page: number) {
  return { page, x: 0, y: 0, w: 16, h: 32 };
}

// A single-slot family: one page, one 2000x2000 cell, so exactly one
// look at a time can occupy the whole pool -- used only by the
// mid-build eviction race test, which needs a forced, deterministic
// eviction rather than exhausting a large real pool.
const SINGLE_SLOT_LAYOUT: AppearanceLayoutDef = {
  id: 4,
  key: "giant",
  family: "adult",
  cellWidth: 2000,
  cellHeight: 2000,
  directions: ["down"],
  rows: [{ animation: "idle", row: 0, framesPerDirection: 1 }],
  acceptedSizes: [{ width: 2000, height: 2000 }],
};

function body(id: number, family: "adult" | "kid" = "adult", sheet = "x.png"): BodyDef {
  return { id, key: `body_${id}`, family, sheet, pool: "civilian", atlas: atlas(0) };
}
function eyes(id: number, family: "adult" | "kid" = "adult"): EyesDef {
  return { id, key: `eyes_${id}`, family, sheet: "x.png", pool: "civilian", atlas: atlas(1) };
}
function outfit(id: number, family: "adult" | "kid" = "adult"): OutfitDef {
  return {
    id,
    key: `outfit_${id}`,
    family,
    sheet: "x.png",
    pool: "civilian",
    hidesHairstyle: false,
    atlas: atlas(2),
  };
}
function hairstyle(id: number, family: "adult" | "kid" = "adult"): HairstyleDef {
  return {
    id,
    key: `hair_${id}`,
    family,
    sheet: "x.png",
    style: 1,
    color: 1,
    rare: false,
    atlas: atlas(3),
  };
}
function accessory(id: number, family: "adult" | "kid" = "adult"): AccessoryDef {
  return {
    id,
    key: `accessory_${id}`,
    family,
    sheet: "x.png",
    pool: "civilian",
    slot: "head",
    atlas: atlas(4),
  };
}

function defsWith(overrides: Partial<Defs> = {}): Defs {
  return {
    defsVersion: "test",
    colliderSubcellsPerCell: 16,
    interactAtMaxReachCells: 2,
    maxFootprintCells: 8,
    atlasMaxPagesPerGroup: 2,
    characterCompositePages: 2,
    atlasPages: [
      { file: "character_body.png", group: "character_body", width: 2048, height: 2048 },
      { file: "character_eyes.png", group: "character_eyes", width: 2048, height: 2048 },
      { file: "character_outfit.png", group: "character_outfit", width: 2048, height: 2048 },
      { file: "character_hairstyle.png", group: "character_hairstyle", width: 2048, height: 2048 },
      { file: "character_accessory.png", group: "character_accessory", width: 2048, height: 2048 },
    ],
    objects: [],
    items: [],
    recipes: [],
    professions: [],
    chains: [],
    balance: [],
    bodies: [body(1), body(11, "kid")],
    eyes: [eyes(1), eyes(11, "kid")],
    hairstyles: [hairstyle(1), hairstyle(11, "kid")],
    outfits: [outfit(1), outfit(11, "kid")],
    accessories: [accessory(1), accessory(11, "kid")],
    appearanceLayouts: [LAYOUT, KID_LAYOUT],
    uniforms: [],
    tags: [],
    ...overrides,
  };
}

const TUPLE = { body: 1, eyes: 1, outfit: 1, hairstyle: 1, accessory: 1 };

// A single-slot family (one page, one giant cell): forces real eviction
// pressure on the very next distinct acquire, deterministically, rather
// than exhausting the large real pool `LAYOUT`'s geometry gives every
// other test in this file.
function singleSlotDefs(): Defs {
  return defsWith({
    characterCompositePages: 1,
    appearanceLayouts: [SINGLE_SLOT_LAYOUT],
    bodies: [body(1), body(2)],
    eyes: [eyes(1)],
    outfits: [outfit(1)],
    hairstyles: [hairstyle(1)],
    accessories: [accessory(1)],
  });
}

describe("AppearanceTextureCache", () => {
  it("acquires a composite for a tuple, drawing every declared cell into the shared page", async () => {
    const compositePages = new FakeCompositePages(2);
    const pageLoader = new DeferredPageLoader();
    const cache = new AppearanceTextureCache(defsWith(), "", compositePages, pageLoader);

    const frames = await cache.acquire(TUPLE);
    expect(frames.frame("idle", "down", 0)).toBeDefined();
    expect(compositePages.clearCalls).toHaveLength(1);
    expect(compositePages.drawCalls.length).toBeGreaterThan(0);
  });

  it("the same tuple+override returns the same CompositeFrames, built once", async () => {
    const compositePages = new FakeCompositePages(2);
    const pageLoader = new DeferredPageLoader();
    const cache = new AppearanceTextureCache(defsWith(), "", compositePages, pageLoader);

    const a = await cache.acquire(TUPLE);
    const b = await cache.acquire(TUPLE);
    expect(b).toBe(a);
    expect(compositePages.clearCalls).toHaveLength(1);
  });

  // Tim's direction, cycle 1: a slot's own frame `Texture`s are built
  // once and reused by every later occupant -- proven here by reusing
  // the *same* Texture object identity across two distinct looks that
  // are forced into the same reclaimed slot.
  it("a slot's own frame textures are built once and reused by the next occupant of that same slot", async () => {
    const compositePages = new FakeCompositePages(1);
    const pageLoader = new DeferredPageLoader();
    const cache = new AppearanceTextureCache(singleSlotDefs(), "", compositePages, pageLoader);

    const first = await cache.acquire(TUPLE);
    const firstTexture = first.frame("idle", "down", 0);
    cache.release(TUPLE);

    // A distinct tuple: at capacity 1, the only evictable entry (the
    // just-released `TUPLE`) is reclaimed before this build runs, so
    // this look lands in the exact same slot index `TUPLE` just left.
    const second = await cache.acquire({ ...TUPLE, body: 2 });
    expect(second.frame("idle", "down", 0)).toBe(firstTexture);
  });

  // Quentin's direction, cycle 1: a stale look can never show through --
  // once A's own cache entry is evicted, A's own key is gone from the
  // cache too, so a later acquire of that exact key rebuilds fresh
  // (drawing over whatever B left there) rather than handing back A's
  // now-meaningless `CompositeFrames`.
  it("look A's own cache entry is gone once evicted, even though its slot's own frame textures outlive it", async () => {
    const compositePages = new FakeCompositePages(1);
    const pageLoader = new DeferredPageLoader();
    const cache = new AppearanceTextureCache(singleSlotDefs(), "", compositePages, pageLoader);

    const lookA = await cache.acquire(TUPLE);
    cache.release(TUPLE);

    // At capacity 1: evicts A's entry and lands B in A's exact slot.
    const lookB = await cache.acquire({ ...TUPLE, body: 2 });
    expect(lookB).not.toBe(lookA);
    cache.release({ ...TUPLE, body: 2 });

    // Re-acquiring A's own key is a fresh build (a new `CompositeFrames`,
    // never the stale one that was evicted) -- A is simply not in the
    // cache to be found. This also evicts B in turn (still capacity 1),
    // proving the pool keeps cycling rather than wedging on a stale
    // entry.
    const lookAAgain = await cache.acquire(TUPLE);
    expect(lookAAgain).not.toBe(lookA);
  });

  it("a build failure releases its slot so a later acquire can still succeed, never leaking the failed one", async () => {
    const compositePages = new FakeCompositePages(2);
    const pageLoader = new DeferredPageLoader();
    const originalAcquire = pageLoader.acquire.bind(pageLoader);
    let failNext = true;
    pageLoader.acquire = (file: string) => {
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error("network drop"));
      }
      return originalAcquire(file);
    };
    const cache = new AppearanceTextureCache(defsWith(), "", compositePages, pageLoader);

    await expect(cache.acquire(TUPLE)).rejects.toThrow("network drop");

    // A retry of the exact same tuple must not replay the same
    // rejection forever, and must not find its slot already taken by a
    // leaked failed entry.
    const frames = await cache.acquire(TUPLE);
    expect(frames.frame("idle", "down", 0)).toBeDefined();
  });

  // Tim's direction, cycle 2: exhaustion is known synchronously too (the
  // slot claim itself, inside `acquire`'s own `build` closure), and must
  // surface as a rejection the same way a geometry mismatch does, never
  // as an exception escaping `acquire` itself.
  it("exhaustion (every slot still referenced) rejects by name, and never throws synchronously", async () => {
    const compositePages = new FakeCompositePages(1);
    const pageLoader = new DeferredPageLoader();
    const cache = new AppearanceTextureCache(singleSlotDefs(), "", compositePages, pageLoader);

    // Never released -- the pool's own one slot stays referenced.
    await cache.acquire(TUPLE);

    let rejection: Promise<unknown> | undefined;
    expect(() => {
      rejection = cache.acquire({ ...TUPLE, body: 2 });
    }).not.toThrow();
    await expect(rejection).rejects.toThrow(/every slot is in use/);
  });

  // Tim's direction, cycle 2: a promise-returning method rejects, it
  // never throws -- even a failure known synchronously (the slot claim
  // itself, inside `acquire`'s own `build` closure) must still surface
  // as a rejection, never as an exception escaping `acquire` itself.
  it("a second family with a different cell geometry rejects by name, never silently sharing the pool, and never throws synchronously", async () => {
    const defs = defsWith({
      appearanceLayouts: [LAYOUT, DIFFERENT_GEOMETRY_LAYOUT],
    });
    const compositePages = new FakeCompositePages(2);
    const pageLoader = new DeferredPageLoader();
    const cache = new AppearanceTextureCache(defs, "", compositePages, pageLoader);

    await cache.acquire(TUPLE);
    const kidTuple = { body: 11, eyes: 11, outfit: 11, hairstyle: 11, accessory: 11 };
    let rejection: Promise<unknown> | undefined;
    expect(() => {
      rejection = cache.acquire(kidTuple);
    }).not.toThrow();
    await expect(rejection).rejects.toThrow(/robot/);
  });

  // Tim's direction, cycle 1: an entry evicted (its slot reassigned)
  // while its own async build is still awaiting pages must never draw
  // into that slot once it belongs to someone else -- it must abort
  // instead, and release the bitmaps it did load rather than leak them.
  it("a look whose slot is reassigned mid-build aborts rather than drawing into another look's slot", async () => {
    const compositePages = new FakeCompositePages(1);
    const pageLoader = new DeferredPageLoader();
    // Every tuple in this test resolves to the same body page
    // ("character_body.png", `body`'s always-page-0 fixture atlas) --
    // holding just that one file back lets both builds' `body` loads
    // stay in flight together, released by one `resolveAll` call.
    pageLoader.holdPending("character_body.png");
    const cache = new AppearanceTextureCache(singleSlotDefs(), "", compositePages, pageLoader);

    // Starts building TUPLE into the pool's one slot -- stuck awaiting
    // its own body page.
    const firstAcquire = cache.acquire(TUPLE);
    // Never referenced past this call, so it is immediately evictable.
    cache.release(TUPLE);

    // A distinct tuple, at capacity 1: evicts TUPLE's still-building
    // entry synchronously (bumping its slot's generation token) before
    // this build itself starts, then claims that exact same slot index
    // and starts its own body load -- also stuck, behind the same held
    // file.
    const secondAcquire = cache.acquire({ ...TUPLE, body: 2 });

    // Wakes both held loads at once: TUPLE's own draw must now observe
    // its claim is stale and abort; the second tuple's draw is not
    // stale and must complete normally, into the slot TUPLE just lost.
    pageLoader.resolveAll("character_body.png");

    await expect(firstAcquire).rejects.toThrow(/slot reassigned/);
    const second = await secondAcquire;
    expect(second.frame("idle", "down", 0)).toBeDefined();
    // Both TUPLE's own aborted build and the second look's successful
    // one release their own body bitmap -- TUPLE's on the abort path,
    // never left referenced once its build gave up.
    expect(pageLoader.releaseCalls.filter((f) => f === "character_body.png")).toHaveLength(2);
  });
});
