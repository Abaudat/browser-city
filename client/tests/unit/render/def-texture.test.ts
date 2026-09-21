// Story 2.13, Quentin's direction: the texture-resolution step a
// `defId`-placed prop draws through, tested against a stubbed loader --
// no real `pixi.js` decode runtime, the same idiom `atlas-pages.test.ts`
// already uses. `def-texture.ts` itself is excluded from the coverage
// gate (needs the real `pixi.js` `Texture`/`Rectangle` constructs this
// mock stands in for).
import { describe, expect, it, vi } from "vitest";
import type { Defs, ObjectDef } from "../../../src/defs/types";

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
    frame?: FakeRectangle;
    height: number;
    constructor(opts: { source: unknown; frame?: FakeRectangle; height?: number }) {
      this.source = opts.source;
      this.frame = opts.frame;
      // A whole-object crop's own height is whatever the caller passed in
      // (the fake page source below); a further per-cell crop (this
      // module's own `new Texture({ frame, ... })` call) carries no
      // explicit height of its own, so it inherits the frame's -- exactly
      // how a real cropped `pixi.js` `Texture` reports `.height`.
      this.height = opts.height ?? opts.frame?.height ?? 0;
    }
  }
  return { Rectangle: FakeRectangle, Texture: FakeTexture };
});

const { defCellTexture, objectDefById } = await import("../../../src/render/def-texture");

function objectDef(overrides: Partial<ObjectDef> = {}): ObjectDef {
  return {
    id: 5,
    key: "shop_window",
    atlas: { page: 0, x: 10, y: 20, w: 48, h: 32 },
    width: 3,
    height: 1,
    ...overrides,
  } as unknown as ObjectDef;
}

const TILE_SIZE_PX = 16;

describe("objectDefById", () => {
  it("finds the object a defId names", () => {
    const object = objectDef({ id: 7 });
    const defs = { objects: [object] } as unknown as Defs;
    expect(objectDefById(defs, 7)).toBe(object);
  });

  it("throws naming the id when defs/ has no such object", () => {
    const defs = { objects: [] } as unknown as Defs;
    expect(() => objectDefById(defs, 42)).toThrow(/42/);
  });
});

describe("defCellTexture", () => {
  it("resolves every defId drawable through the loader's own objectTexture", async () => {
    const object = objectDef();
    const defs = { objects: [object] } as unknown as Defs;
    const loader = {
      objectTexture: vi
        .fn()
        .mockResolvedValue({ source: "page-a", frame: { x: 0, y: 0, height: 32 } }),
    };

    await defCellTexture(defs, object, loader, 0, TILE_SIZE_PX);

    expect(loader.objectTexture).toHaveBeenCalledWith(defs, object);
  });

  // Real placements are almost never at the page's own (0, 0) -- the shop
  // counter alone gets that spot; every other object's own whole-sprite
  // crop starts somewhere else on the shared page. Both fixtures below
  // place their own base texture's `frame` away from the origin
  // (`x: 87, y: 1`, a real measured `shop_window` placement) so a crop
  // that silently drops that offset and reads from the page's own origin
  // instead -- cropping whatever neighbouring object the packer happened
  // to place there -- fails here, not only on a real mounted scene.
  const PAGE_OFFSET = { x: 87, y: 1 };

  it("a one-cell def (the repeat case) yields, per cell, a frame of exactly one tile from the same page source, offset by the object's own page placement -- four placements, one TextureSource, four identical frames", async () => {
    const deckDef = objectDef({ id: 7, key: "bridge_deck", width: 1, height: 1 });
    const defs = { objects: [deckDef] } as unknown as Defs;
    const pageSource = { name: "street-page" };
    const loader = {
      objectTexture: vi
        .fn()
        .mockResolvedValue({ source: pageSource, frame: { ...PAGE_OFFSET, height: 16 } }),
    };

    const frames = await Promise.all(
      [0, 0, 0, 0].map(() => defCellTexture(defs, deckDef, loader, 0, TILE_SIZE_PX)),
    );

    for (const frame of frames) {
      expect(frame.source).toBe(pageSource);
      expect(frame.frame).toEqual({
        x: PAGE_OFFSET.x,
        y: PAGE_OFFSET.y,
        width: TILE_SIZE_PX,
        height: 16,
      });
    }
    // The loader itself is what caches by object id (Artie's direction,
    // `atlas-pages.ts`) -- this module never duplicates that cache, so a
    // real `AtlasPageLoader` calls the network at most once regardless of
    // how many times this function is asked for the same def.
  });

  it("a wide def (the slice case) yields, per cell, a distinct whole-tile frame from the same page source, each offset by the object's own page placement", async () => {
    const windowDef = objectDef({ id: 5, key: "shop_window", width: 3, height: 1 });
    const defs = { objects: [windowDef] } as unknown as Defs;
    const pageSource = { name: "street-page" };
    const loader = {
      objectTexture: vi
        .fn()
        .mockResolvedValue({ source: pageSource, frame: { ...PAGE_OFFSET, height: 32 } }),
    };

    const frames = await Promise.all(
      [0, 1, 2].map((col) => defCellTexture(defs, windowDef, loader, col, TILE_SIZE_PX)),
    );

    expect(frames.map((f) => f.frame)).toEqual([
      { x: PAGE_OFFSET.x, y: PAGE_OFFSET.y, width: TILE_SIZE_PX, height: 32 },
      { x: PAGE_OFFSET.x + 16, y: PAGE_OFFSET.y, width: TILE_SIZE_PX, height: 32 },
      { x: PAGE_OFFSET.x + 32, y: PAGE_OFFSET.y, width: TILE_SIZE_PX, height: 32 },
    ]);
    for (const frame of frames) expect(frame.source).toBe(pageSource);
  });
});
