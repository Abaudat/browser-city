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
  return {
    Assets: { load: (...args: unknown[]) => loadMock(...args) },
    Rectangle: FakeRectangle,
    Texture: FakeTexture,
  };
});

const { AtlasPageLoader } = await import("../../../src/render/atlas-pages");

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
