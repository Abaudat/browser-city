// Story 1.10 (FR61) / Story 2.7: pure pixel math packing the frames
// Browser City actually uses into a compact composite strip -- both
// inside a packed atlas part strip (gutter 0) and inside one composite-
// page slot (a positive gutter, story 2.7). The strip's own total size
// is `defs/composite-strip.ts`'s own `compositeStripSize`, tested there
// directly (`tests/unit/defs/composite-strip.test.ts`), not re-tested
// here through a forwarder this module no longer has.
import { describe, expect, it } from "vitest";
import type { AppearanceLayoutDef } from "../../../../src/defs/types";
import { compositeCellRect } from "../../../../src/render/appearance/frame-rect";

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

  it("throws on an animation the layout does not declare", () => {
    expect(() => compositeCellRect(LAYOUT, "run", "down", 0)).toThrow(/run/);
  });

  it("throws on a direction the layout does not declare", () => {
    expect(() => compositeCellRect(LAYOUT, "idle", "north", 0)).toThrow(/north/);
  });

  it("throws on a frame index outside the row's own frame count", () => {
    expect(() => compositeCellRect(LAYOUT, "idle", "down", 6)).toThrow(/frame/);
    expect(() => compositeCellRect(LAYOUT, "idle", "down", -1)).toThrow(/frame/);
  });

  it("with a gutter, offsets every cell's own origin by the gutter and widens the pitch, keeping the cell's own width/height unchanged", () => {
    // idle, "up" (index 1), frame 3 -> column 1*6+3 = 9
    const tight = compositeCellRect(LAYOUT, "idle", "up", 3);
    const gutter = compositeCellRect(LAYOUT, "idle", "up", 3, 1);
    expect(gutter).toEqual({
      x: 9 * 18 + 1,
      y: 0 * 34 + 1,
      width: 16,
      height: 32,
    });
    expect(gutter.width).toBe(tight.width);
    expect(gutter.height).toBe(tight.height);
  });

  it("with a gutter, no two cells' own padded footprints (cell plus gutter halo) overlap", () => {
    const gutter = 1;
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const row of LAYOUT.rows) {
      for (const direction of LAYOUT.directions) {
        for (let frame = 0; frame < row.framesPerDirection; frame++) {
          const cell = compositeCellRect(LAYOUT, row.animation, direction, frame, gutter);
          const box = {
            x0: cell.x - gutter,
            y0: cell.y - gutter,
            x1: cell.x + cell.width + gutter,
            y1: cell.y + cell.height + gutter,
          };
          for (const other of boxes) {
            const overlap =
              box.x0 < other.x1 && other.x0 < box.x1 && box.y0 < other.y1 && other.y0 < box.y1;
            expect(overlap).toBe(false);
          }
          boxes.push(box);
        }
      }
    }
  });
});
