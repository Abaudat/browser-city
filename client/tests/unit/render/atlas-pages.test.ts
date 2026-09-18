// Story 2.6, Artie's direction: `AtlasPageLoader` evicts a rejected load
// from its own cache so a later demand retries, instead of replaying the
// same rejection forever (one dropped request on a flaky link must not
// permanently hide every prop on that page). `atlas-pages.ts` itself is
// excluded from the coverage gate (needs `Assets.load`'s real
// browser-only Image-decode runtime) -- this test mocks `pixi.js`
// entirely so the retry-on-rejection behaviour is still proven directly,
// without a real image ever loading.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasPageDef, Defs, ObjectDef } from "../../../src/defs/types";

const loadMock = vi.fn();

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
    source: { scaleMode?: string; autoGenerateMipmaps?: boolean };
    constructor(opts: { source: { scaleMode?: string; autoGenerateMipmaps?: boolean } }) {
      this.source = opts.source;
    }
  }
  class FakeSprite {
    children: unknown[] = [];
    constructor(public texture: FakeTexture) {}
  }
  return {
    Assets: { load: (...args: unknown[]) => loadMock(...args) },
    Rectangle: FakeRectangle,
    Texture: FakeTexture,
    Sprite: FakeSprite,
  };
});

const { AtlasPageLoader, countAllBoundTextureSources, countBoundAtlasPages } = await import(
  "../../../src/render/atlas-pages"
);
const { Sprite } = await import("pixi.js");

function fakeSourceTexture() {
  return { source: { scaleMode: undefined, autoGenerateMipmaps: undefined } };
}

const PAGE: AtlasPageDef = { file: "street-abc.png", group: "street", width: 2048, height: 32 };

function defsWith(pages: readonly AtlasPageDef[]): Defs {
  return { atlasPages: pages } as unknown as Defs;
}

const OBJECT: ObjectDef = {
  id: 1,
  key: "shop_counter",
  atlas: { page: 0, x: 1, y: 1, w: 48, h: 64 },
} as unknown as ObjectDef;

beforeEach(() => {
  loadMock.mockReset();
});

describe("AtlasPageLoader", () => {
  it("caches a page's texture across repeated demand (loads it once)", async () => {
    loadMock.mockResolvedValue(fakeSourceTexture());
    const loader = new AtlasPageLoader("/atlas/");
    const defs = defsWith([PAGE]);

    await loader.objectTexture(defs, OBJECT);
    await loader.objectTexture(defs, OBJECT);

    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(loadMock).toHaveBeenCalledWith("/atlas/street-abc.png");
  });

  it("reports the page as bound only after it actually resolves", async () => {
    loadMock.mockResolvedValue(fakeSourceTexture());
    const loader = new AtlasPageLoader("/atlas/");
    expect(loader.boundPageCount()).toBe(0);

    await loader.objectTexture(defsWith([PAGE]), OBJECT);

    expect(loader.boundPageCount()).toBe(1);
  });

  it("evicts a rejected page load so the next demand retries instead of replaying the rejection forever", async () => {
    loadMock.mockRejectedValueOnce(new Error("network drop"));
    const loader = new AtlasPageLoader("/atlas/");
    const defs = defsWith([PAGE]);

    await expect(loader.objectTexture(defs, OBJECT)).rejects.toThrow("network drop");
    expect(loader.boundPageCount()).toBe(0);

    loadMock.mockResolvedValueOnce(fakeSourceTexture());
    await expect(loader.objectTexture(defs, OBJECT)).resolves.toBeDefined();
    expect(loadMock).toHaveBeenCalledTimes(2);
    expect(loader.boundPageCount()).toBe(1);
  });

  it("rejects naming the object when its atlas.page indexes no real page, without caching the rejection against a page", async () => {
    const loader = new AtlasPageLoader("/atlas/");
    const defs = defsWith([]);

    await expect(loader.objectTexture(defs, OBJECT)).rejects.toThrow(/shop_counter/);
    expect(loadMock).not.toHaveBeenCalled();
  });
});

// biome-ignore lint/suspicious/noExplicitAny: a minimal structural stand-in for a Pixi Container, not the real class
type FakeContainer = { children: any[] };

describe("countBoundAtlasPages", () => {
  it("counts a sprite whose texture source came from this loader, anywhere in the tree", async () => {
    loadMock.mockResolvedValue(fakeSourceTexture());
    const loader = new AtlasPageLoader("/atlas/");
    const texture = await loader.objectTexture(defsWith([PAGE]), OBJECT);

    const sprite = new Sprite(texture);
    const nested: FakeContainer = { children: [sprite] };
    const root: FakeContainer = { children: [{ children: [] }, nested] };

    // biome-ignore lint/suspicious/noExplicitAny: FakeContainer stands in for a real Pixi Container here
    expect(countBoundAtlasPages(root as any, loader)).toBe(1);
  });

  it("never counts a sprite whose texture came from somewhere other than this loader", () => {
    const loader = new AtlasPageLoader("/atlas/");
    const unrelatedSprite = new Sprite({ source: { scaleMode: "linear" } } as never);
    const root: FakeContainer = { children: [unrelatedSprite] };

    // biome-ignore lint/suspicious/noExplicitAny: FakeContainer stands in for a real Pixi Container here
    expect(countBoundAtlasPages(root as any, loader)).toBe(0);
  });

  it("counts one distinct page even when several sprites crop the same page's source", async () => {
    loadMock.mockResolvedValue(fakeSourceTexture());
    const loader = new AtlasPageLoader("/atlas/");
    const textureA = await loader.objectTexture(defsWith([PAGE]), OBJECT);
    const otherObject = { ...OBJECT, id: 2, key: "other" };
    const textureB = await loader.objectTexture(defsWith([PAGE]), otherObject);

    const root: FakeContainer = { children: [new Sprite(textureA), new Sprite(textureB)] };

    // biome-ignore lint/suspicious/noExplicitAny: FakeContainer stands in for a real Pixi Container here
    expect(countBoundAtlasPages(root as any, loader)).toBe(1);
  });
});

// Quentin's direction, cycle 1 (NFR12): unlike `countBoundAtlasPages`,
// never narrowed to a caller-supplied set of "known page" sources -- a
// regression back to one standalone texture per composited look would
// move this count, where the filtered one would not.
describe("countAllBoundTextureSources", () => {
  it("counts every sprite's own texture source, even one no provider ever named", () => {
    const unrelatedSprite = new Sprite({ source: { scaleMode: "linear" } } as never);
    const root: FakeContainer = { children: [unrelatedSprite] };

    // biome-ignore lint/suspicious/noExplicitAny: FakeContainer stands in for a real Pixi Container here
    expect(countAllBoundTextureSources(root as any)).toBe(1);
  });

  it("counts one distinct source shared by several sprites, at any depth", () => {
    const source = { scaleMode: "linear" };
    const a = new Sprite({ source } as never);
    const b = new Sprite({ source } as never);
    const nested: FakeContainer = { children: [b] };
    const root: FakeContainer = { children: [a, nested] };

    // biome-ignore lint/suspicious/noExplicitAny: FakeContainer stands in for a real Pixi Container here
    expect(countAllBoundTextureSources(root as any)).toBe(1);
  });

  it("is zero for a tree with no sprites", () => {
    const root: FakeContainer = { children: [{ children: [] }] };

    // biome-ignore lint/suspicious/noExplicitAny: FakeContainer stands in for a real Pixi Container here
    expect(countAllBoundTextureSources(root as any)).toBe(0);
  });
});
