// Story 2.7 (Tim's direction, cycle 2): `compositeStripSize` is the one
// implementation `defs/parse.ts`'s own AC1 check and
// `render/appearance/composite-slots.ts`'s slot arithmetic both import
// directly -- tested once, here, rather than through either caller.
import { describe, expect, it } from "vitest";
import { compositeStripSize } from "../../../src/defs/composite-strip";
import type { AppearanceLayoutDef } from "../../../src/defs/types";

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

describe("compositeStripSize", () => {
  it("is exactly rows*cellHeight tall and framesPerDirection*directions*cellWidth wide -- never the sheet's own overhang", () => {
    // 2 rows (idle, walk) x 32px, 6 frames x 4 directions x 16px
    expect(compositeStripSize(LAYOUT)).toEqual({ width: 6 * 4 * 16, height: 2 * 32 });
  });

  it("with a gutter, each cell's own pitch widens by 2*gutter on every axis", () => {
    // 24 columns x (16+2)px, 2 rows x (32+2)px
    expect(compositeStripSize(LAYOUT, 1)).toEqual({ width: 24 * 18, height: 2 * 34 });
  });

  it("defaults to gutter 0, identical to calling it with 0 explicitly", () => {
    expect(compositeStripSize(LAYOUT)).toEqual(compositeStripSize(LAYOUT, 0));
  });
});
