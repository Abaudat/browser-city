import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, chunkKey } from "../../../src/world/chunk";

describe("chunkKey", () => {
  it("two cells in the same chunk pack to the same key", () => {
    expect(chunkKey(3, 5, 0)).toBe(chunkKey(31, 0, 0));
  });

  it("a cell one chunk over packs to a different key", () => {
    expect(chunkKey(31, 0, 0)).not.toBe(chunkKey(32, 0, 0));
  });

  it("negative coordinates chunk by floor division, not truncation", () => {
    expect(chunkKey(-1, 0, 0)).toBe(chunkKey(-CHUNK_SIZE, 0, 0));
    expect(chunkKey(-1, 0, 0)).not.toBe(chunkKey(0, 0, 0));
  });

  it("floor is part of the key", () => {
    expect(chunkKey(0, 0, 0)).not.toBe(chunkKey(0, 0, 1));
    expect(chunkKey(0, 0, 0)).not.toBe(chunkKey(0, 0, -1));
  });

  it("agrees with the shared conformance fixture's building_area chunk_key", () => {
    // fixtures/world-conformance.v1.json: rect (10,1)-(15,6), floor 0,
    // declares chunk_key 0 -- both origin cells fall in chunk (0, 0).
    expect(chunkKey(10, 1, 0)).toBe(0n);
  });

  it("never throws for any i32-range coordinate or i8-range floor", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }),
        fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }),
        fc.integer({ min: -128, max: 127 }),
        (x, y, floor) => {
          expect(() => chunkKey(x, y, floor)).not.toThrow();
        },
      ),
    );
  });
});
