import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Footprint } from "../../../src/render/decompose";
import { decomposeFootprint } from "../../../src/render/decompose";

describe("decomposeFootprint", () => {
  // FR125/FR127: for any extent up to the FR127 ~8x8 cap, decomposition
  // yields exactly width*height drawables, one per cell, anchors covering
  // the footprint exactly once, and the union of anchors equal to the
  // footprint.
  it("inv_multicell_prop_covers_footprint_once", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        (x, y, width, height) => {
          const footprint: Footprint = { x, y, width, height };
          const cells = decomposeFootprint(footprint);

          expect(cells).toHaveLength(width * height);

          const seen = new Set<string>();
          for (const cell of cells) {
            const key = `${cell.x},${cell.y}`;
            expect(seen.has(key)).toBe(false);
            seen.add(key);
          }

          const expectedAnchors = new Set<string>();
          for (let dy = 0; dy < height; dy++) {
            for (let dx = 0; dx < width; dx++) {
              expectedAnchors.add(`${x + dx},${y + dy}`);
            }
          }
          expect(seen).toEqual(expectedAnchors);
        },
      ),
    );
  });

  // The worked example a reviewer will want to read: a 3-wide counter
  // (FR126's `shop_counter` object def, `defs/objects/city-props.toml`)
  // anchored at (10, 5) decomposes into three per-cell drawables, one per
  // cell of the counter, each with its own anchor and its own column
  // within the source art.
  it("a 3-wide counter decomposes into three per-cell drawables covering its footprint", () => {
    const cells = decomposeFootprint({ x: 10, y: 5, width: 3, height: 1 });

    expect(cells).toEqual([
      { x: 10, y: 5, sourceCol: 0, sourceRow: 0 },
      { x: 11, y: 5, sourceCol: 1, sourceRow: 0 },
      { x: 12, y: 5, sourceCol: 2, sourceRow: 0 },
    ]);
  });

  it("a 1x1 footprint decomposes into exactly one drawable at its own anchor", () => {
    const cells = decomposeFootprint({ x: 3, y: 4, width: 1, height: 1 });
    expect(cells).toEqual([{ x: 3, y: 4, sourceCol: 0, sourceRow: 0 }]);
  });

  it("rejects a non-positive width or height", () => {
    expect(() => decomposeFootprint({ x: 0, y: 0, width: 0, height: 1 })).toThrow(RangeError);
    expect(() => decomposeFootprint({ x: 0, y: 0, width: 1, height: -1 })).toThrow(RangeError);
  });

  it("rejects a non-integer extent", () => {
    expect(() => decomposeFootprint({ x: 0, y: 0, width: 1.5, height: 1 })).toThrow(RangeError);
  });

  it("rejects a non-integer anchor", () => {
    expect(() => decomposeFootprint({ x: 0.5, y: 0, width: 1, height: 1 })).toThrow(RangeError);
  });
});
