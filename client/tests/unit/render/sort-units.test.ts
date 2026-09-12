import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fromSortUnits, SORT_SUBDIVISIONS, toSortUnits } from "../../../src/render/sort-units";

describe("toSortUnits / fromSortUnits", () => {
  it("round-trips an exact tile coordinate", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (tile) => {
        expect(fromSortUnits(toSortUnits(tile))).toBe(tile);
      }),
    );
  });

  it("always produces an integer", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(-1000), max: Math.fround(1000), noNaN: true }),
        (coord) => {
          expect(Number.isInteger(toSortUnits(coord))).toBe(true);
        },
      ),
    );
  });

  it("is strictly monotonic in the world coordinate", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 999 }),
        fc.integer({ min: 1, max: 1000 }),
        (tile, delta) => {
          expect(toSortUnits(tile + delta)).toBeGreaterThan(toSortUnits(tile));
        },
      ),
    );
  });

  it("resolves sub-tile movement to a different sort unit before a whole tile is crossed", () => {
    // 1 / SORT_SUBDIVISIONS of a tile is enough to change the sort unit --
    // this is what makes a moving character's anchor effectively
    // continuous rather than snapped to a cell.
    const step = 1 / SORT_SUBDIVISIONS;
    expect(toSortUnits(step)).not.toBe(toSortUnits(0));
  });
});
