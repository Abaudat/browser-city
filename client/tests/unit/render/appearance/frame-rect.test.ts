// Story 1.10 (FR61): pure pixel math over an `AppearanceLayoutDef` --
// picking a source rect out of a part's own full sheet, and packing the
// frames Browser City actually uses into a compact composite strip.
import { describe, expect, it } from "vitest";
import type { AppearanceLayoutDef } from "../../../../src/defs/types";
import {
  compositeCellRect,
  compositeSheetSize,
  sourceFrameRect,
} from "../../../../src/render/appearance/frame-rect";

const LAYOUT: AppearanceLayoutDef = {
  id: 1,
  key: "adult",
  family: "adult",
  cellWidth: 16,
  cellHeight: 32,
  directions: ["right", "up", "left", "down"],
  rows: [
    { animation: "idle", row: 1, framesPerDirection: 6 },
    { animation: "walk", row: 2, framesPerDirection: 6 },
  ],
  acceptedSizes: [{ width: 896, height: 656 }],
};

describe("sourceFrameRect", () => {
  it("picks the declared row's y and the direction-block-plus-frame's x, in the sheet's own pixel grid", () => {
    // idle, direction "up" (index 1), frame 3 -> column 1*6+3 = 9
    const rect = sourceFrameRect(LAYOUT, "idle", "up", 3);
    expect(rect).toEqual({ x: 9 * 16, y: 1 * 32, width: 16, height: 32 });
  });

  it("walk row uses row 2's y", () => {
    const rect = sourceFrameRect(LAYOUT, "walk", "down", 0);
    // direction "down" is index 3 -> column 3*6+0 = 18
    expect(rect).toEqual({ x: 18 * 16, y: 2 * 32, width: 16, height: 32 });
  });

  it("throws on an animation the layout does not declare", () => {
    expect(() => sourceFrameRect(LAYOUT, "run", "down", 0)).toThrow(/run/);
  });

  it("throws on a direction the layout does not declare", () => {
    expect(() => sourceFrameRect(LAYOUT, "idle", "north", 0)).toThrow(/north/);
  });

  it("throws on a frame index outside the row's own frame count", () => {
    expect(() => sourceFrameRect(LAYOUT, "idle", "down", 6)).toThrow(/frame/);
    expect(() => sourceFrameRect(LAYOUT, "idle", "down", -1)).toThrow(/frame/);
  });
});

describe("compositeSheetSize", () => {
  it("is exactly rows*cellHeight tall and framesPerDirection*directions*cellWidth wide -- never the sheet's own overhang", () => {
    // 2 rows (idle, walk) x 32px, 6 frames x 4 directions x 16px
    expect(compositeSheetSize(LAYOUT)).toEqual({ width: 6 * 4 * 16, height: 2 * 32 });
  });
});

describe("compositeCellRect", () => {
  it("packs rows in declaration order, starting at (0,0) of the compact strip", () => {
    expect(compositeCellRect(LAYOUT, "idle", "right", 0)).toEqual({
      x: 0,
      y: 0,
      width: 16,
      height: 32,
    });
    expect(compositeCellRect(LAYOUT, "walk", "right", 0)).toEqual({
      x: 0,
      y: 32,
      width: 16,
      height: 32,
    });
  });

  it("two different (animation, direction, frame) triples never share a cell", () => {
    const seen = new Set<string>();
    for (const row of LAYOUT.rows) {
      for (const direction of LAYOUT.directions) {
        for (let frame = 0; frame < row.framesPerDirection; frame++) {
          const cell = compositeCellRect(LAYOUT, row.animation, direction, frame);
          const key = `${cell.x},${cell.y}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
    }
  });
});
