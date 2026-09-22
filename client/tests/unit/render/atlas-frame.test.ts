import { describe, expect, it } from "vitest";
import { atlasFrameRect, defCellFrameRect } from "../../../src/render/atlas-frame";

describe("atlasFrameRect", () => {
  it("maps an AtlasRect's page-pixel fields to a plain FrameRect, gutter already excluded", () => {
    expect(atlasFrameRect({ page: 0, x: 1, y: 1, w: 16, h: 32 })).toEqual({
      x: 1,
      y: 1,
      width: 16,
      height: 32,
    });
  });

  it("is a pure mapping -- same input, same output, page never leaks into the rect", () => {
    const a = atlasFrameRect({ page: 3, x: 10, y: 20, w: 48, h: 64 });
    const b = atlasFrameRect({ page: 3, x: 10, y: 20, w: 48, h: 64 });
    expect(a).toEqual(b);
    expect(a).not.toHaveProperty("page");
  });
});

// Story 2.13, cycle 2 (Tim's direction): the real bug this PR shipped and
// fixed -- a per-cell crop built from the page's own origin instead of the
// object's own whole-sprite placement. Real placements are almost never at
// the page's own `(0, 0)` (the shop counter alone got that spot); every
// other object's own whole-sprite crop starts somewhere else on the shared
// page, so both fixtures below place `whole` away from the origin (`x: 87,
// y: 1`, a real measured `shop_window` placement) -- a crop that silently
// drops that offset and reads from the page's own origin instead fails
// here, not only on a real mounted scene.
describe("defCellFrameRect", () => {
  const TILE_SIZE_PX = 16;
  const WHOLE = { x: 87, y: 1, width: 48, height: 32 };

  it("a one-cell def's single cell crops to the whole sprite's own placement, unmoved", () => {
    expect(defCellFrameRect(WHOLE, 0, TILE_SIZE_PX)).toEqual({
      x: 87,
      y: 1,
      width: TILE_SIZE_PX,
      height: 32,
    });
  });

  it("a wide def's own cells slice across the whole sprite, each offset by its own placement", () => {
    expect([0, 1, 2].map((col) => defCellFrameRect(WHOLE, col, TILE_SIZE_PX))).toEqual([
      { x: 87, y: 1, width: TILE_SIZE_PX, height: 32 },
      { x: 103, y: 1, width: TILE_SIZE_PX, height: 32 },
      { x: 119, y: 1, width: TILE_SIZE_PX, height: 32 },
    ]);
  });

  it("is a pure mapping -- same input, same output", () => {
    const a = defCellFrameRect(WHOLE, 1, TILE_SIZE_PX);
    const b = defCellFrameRect(WHOLE, 1, TILE_SIZE_PX);
    expect(a).toEqual(b);
  });
});
