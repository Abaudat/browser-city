// Story 2.13, Tim's direction (cycle 2): `def-texture.ts` is now pure
// `defId -> ObjectDef` lookup, no `pixi.js` at all -- the per-cell crop and
// its own cache moved onto `AtlasPageLoader.objectCellTexture`
// (`atlas-pages.test.ts` covers that; `atlas-frame.test.ts` covers the pure
// crop math it shares). This file only proves the index this module builds
// once per mount, and the named-failure lookup against it.
import { describe, expect, it } from "vitest";
import type { Defs, ObjectDef } from "../../../src/defs/types";
import { buildObjectDefIndex, objectDefById } from "../../../src/render/def-texture";

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

describe("buildObjectDefIndex", () => {
  it("keys every defs/objects entry by its own id", () => {
    const a = objectDef({ id: 5 });
    const b = objectDef({ id: 7, key: "bridge_deck" });
    const defs = { objects: [a, b] } as unknown as Defs;

    const index = buildObjectDefIndex(defs);

    expect(index.get(5)).toBe(a);
    expect(index.get(7)).toBe(b);
    expect(index.size).toBe(2);
  });
});

describe("objectDefById", () => {
  it("finds the object a defId names in an already-built index", () => {
    const object = objectDef({ id: 7 });
    const index = buildObjectDefIndex({ objects: [object] } as unknown as Defs);
    expect(objectDefById(index, 7)).toBe(object);
  });

  it("throws naming the id when the index has no such object", () => {
    const index = buildObjectDefIndex({ objects: [] } as unknown as Defs);
    expect(() => objectDefById(index, 42)).toThrow(/42/);
  });
});
