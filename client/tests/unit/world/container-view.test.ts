// Story 6.10 (FR94): the container view's pure half -- cell rects in grid
// space, where the view sits over its object, and when it closes. No Pixi,
// no network: the Pixi half only draws what these return.

import { describe, expect, it } from "vitest";
import {
  type ContainerObject,
  type HeldRow,
  layoutRects,
  openView,
  rectsInGrid,
  shouldClose,
  viewOriginPx,
} from "../../../src/world/container-view";

const BULK = new Map<number, { width: number; height: number }>([
  [9, { width: 1, height: 1 }],
  [12, { width: 1, height: 2 }],
  [14, { width: 3, height: 2 }],
]);
const bulkOf = (defId: number) => BULK.get(defId);

function row(instanceId: bigint, defId: number, slotX: number, slotY: number, orientation = 0) {
  return { instanceId, defId, slotX, slotY, orientation } satisfies HeldRow;
}

describe("layoutRects", () => {
  it("a 3x2 item at a slot is a 3x2 rect there, and 2x3 when rotated a quarter turn", () => {
    expect(layoutRects([row(1n, 14, 1, 0)], bulkOf)).toEqual([
      { instanceId: 1n, defId: 14, x: 1, y: 0, w: 3, h: 2, quarterTurns: 0 },
    ]);
    expect(layoutRects([row(1n, 14, 1, 0, 1)], bulkOf)).toEqual([
      { instanceId: 1n, defId: 14, x: 1, y: 0, w: 2, h: 3, quarterTurns: 1 },
    ]);
    // Orientations 2 and 3 cover what 0 and 1 cover, and keep their facing.
    expect(layoutRects([row(1n, 14, 0, 0, 2)], bulkOf)[0]).toMatchObject({ w: 3, h: 2 });
    expect(layoutRects([row(1n, 14, 0, 0, 3)], bulkOf)[0]).toMatchObject({ w: 2, h: 3 });
  });

  it("a row whose item def this client does not know draws nothing", () => {
    expect(layoutRects([row(1n, 999, 0, 0)], bulkOf)).toEqual([]);
  });

  it("is in instance order, whatever order the rows arrived in", () => {
    const rects = layoutRects([row(3n, 9, 2, 0), row(1n, 9, 0, 0), row(2n, 12, 1, 0)], bulkOf);
    expect(rects.map((r) => r.instanceId)).toEqual([1n, 2n, 3n]);
  });
});

describe("rectsInGrid", () => {
  const grid = { width: 4, height: 3 };

  it("keeps rects wholly inside the grid", () => {
    const rects = layoutRects([row(1n, 14, 1, 0), row(2n, 9, 3, 2)], bulkOf);
    expect(rectsInGrid(rects, grid)).toEqual(rects);
  });

  it("skips a rect a defs retune left outside the grid, never throwing or yielding NaN", () => {
    const rects = layoutRects(
      [row(1n, 14, 2, 0), row(2n, 9, 4, 0), row(3n, 12, 0, 2), row(4n, 9, -1, 0), row(5n, 9, 0, 0)],
      bulkOf,
    );
    const kept = rectsInGrid(rects, grid);
    expect(kept.map((r) => r.instanceId)).toEqual([5n]);
    for (const r of kept) {
      for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("draws overlapping rects as they stand, one over the other", () => {
    const rects = layoutRects([row(1n, 14, 0, 0), row(2n, 9, 1, 1)], bulkOf);
    expect(rectsInGrid(rects, grid)).toHaveLength(2);
  });

  it("skips a rect with a non-finite position", () => {
    const rects = layoutRects([row(1n, 9, Number.NaN, 0)], bulkOf);
    expect(rectsInGrid(rects, grid)).toEqual([]);
  });
});

const TILE = 16;
const CUPBOARD: ContainerObject = {
  objectId: 82n,
  defId: 71,
  anchorX: 10,
  anchorY: 5,
  floor: 0,
  width: 2,
  height: 1,
  spriteHeightPx: 32,
};

describe("viewOriginPx", () => {
  it("is centred on the footprint with its bottom edge one tile above the sprite's top", () => {
    // Footprint x 10..12 -> centre 11 tiles = 176px; a 4x3 grid is 64x48px.
    // Sprite bottom = (5 + 1) * 16 = 96, top = 96 - 32 = 64; view bottom = 48.
    expect(viewOriginPx(CUPBOARD, { width: 4, height: 3 }, TILE)).toEqual({
      x: 176 - 32,
      y: 48 - 48,
    });
  });

  it("is a whole pixel for any grid and footprint width", () => {
    for (const g of [1, 2, 3, 4, 5, 8]) {
      for (const w of [1, 2, 3, 4]) {
        const o = viewOriginPx({ ...CUPBOARD, width: w }, { width: g, height: 2 }, TILE);
        expect(Number.isInteger(o.x)).toBe(true);
        expect(Number.isInteger(o.y)).toBe(true);
      }
    }
  });
});

describe("openView", () => {
  it("an intent on a def with a grid opens a view bound to that object", () => {
    const view = openView({ objectId: 82n, defId: 71 }, (d) =>
      d === 71 ? { width: 4, height: 3 } : undefined,
    );
    expect(view).toEqual({ objectId: 82n, defId: 71, grid: { width: 4, height: 3 } });
  });

  it("an intent on a def without a grid opens nothing", () => {
    expect(openView({ objectId: 1n, defId: 1 }, () => undefined)).toBeUndefined();
  });
});

// The cupboard's `interact_at` is -4..36 x -4..20 sub-cells (16 per cell):
// the footprint plus a quarter-cell skirt.
const REACH = { x0: -4, y0: -4, x1: 36, y1: 20 };
const DEF = { width: 2, height: 1, interactAt: REACH };
const STILL_OPEN = {
  object: CUPBOARD,
  def: DEF,
  subcellsPerCell: 16,
  present: true,
  visible: true,
  bodyOpen: true,
};

describe("shouldClose", () => {
  const at = (x: number, y: number, floor = 0) => ({ ...STILL_OPEN, player: { x, y, floor } });

  it("stays open while the feet are inside the reach, and closes on the first sub-cell outside", () => {
    // x reach: origin 10 cells -> sub-cells 160 - 4 = 156 .. 160 + 36 = 196.
    expect(shouldClose(at(156 / 16, 5.5))).toBe(false);
    expect(shouldClose(at(195 / 16, 5.5))).toBe(false);
    expect(shouldClose(at(155 / 16, 5.5))).toBe(true);
    expect(shouldClose(at(196 / 16, 5.5))).toBe(true);
  });

  it("closes the frame the feet cross the boundary sub-cell, both ways", () => {
    // y reach: anchor row 5 -> 80 - 4 = 76 .. 80 + 20 = 100.
    expect(shouldClose(at(11, 76 / 16))).toBe(false);
    expect(shouldClose(at(11, 75 / 16))).toBe(true);
    expect(shouldClose(at(11, 99 / 16))).toBe(false);
    expect(shouldClose(at(11, 100 / 16))).toBe(true);
  });

  it("closes on a floor change", () => {
    expect(shouldClose(at(11, 5.5, 1))).toBe(true);
  });

  it("closes when the object is gone, hidden or the body closed", () => {
    const inside = at(11, 5.5);
    expect(shouldClose(inside)).toBe(false);
    expect(shouldClose({ ...inside, present: false })).toBe(true);
    expect(shouldClose({ ...inside, visible: false })).toBe(true);
    expect(shouldClose({ ...inside, bodyOpen: false })).toBe(true);
  });

  it("does not depend on the pointer: the rule has no pointer input", () => {
    expect(Object.keys(at(11, 5.5))).not.toContain("pointer");
  });
});
