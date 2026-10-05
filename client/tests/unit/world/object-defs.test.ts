// Story 2.13, Tim's direction (cycle 2): `buildObjectDefIndex`/
// `objectDefById` moved here from the now-deleted `render/def-texture.ts`
// -- an `id -> ObjectDef` index is exactly what this module already
// builds for `objectDefsById`, just keyed to a different shape, so both
// live beside each other rather than in a second, `render/`-only file
// with nothing left to do with textures.
import { describe, expect, it } from "vitest";
import type { Defs, ObjectDef } from "../../../src/defs/types";
import { buildObjectDefIndex, objectDefById } from "../../../src/world/object-defs";

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
