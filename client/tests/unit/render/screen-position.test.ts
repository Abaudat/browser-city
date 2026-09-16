import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  floorOffsetPx,
  screenPositionPx,
  subcellRectPx,
  visibleCellBounds,
  worldCellFromScreenPx,
  worldPointFromScreenPx,
} from "../../../src/render/screen-position";
import { isEmptyCellBounds } from "../../../src/world/world-index";

describe("floorOffsetPx", () => {
  it("is zero at floor 0, for any storey height", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), (storeyHeightPx) => {
        expect(floorOffsetPx(0, storeyHeightPx)).toBe(0);
      }),
    );
  });

  it("is proportional to the floor and the storey height", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: 1, max: 500 }),
        (floor, storeyHeightPx) => {
          expect(floorOffsetPx(floor, storeyHeightPx)).toBe(-floor * storeyHeightPx + 0);
        },
      ),
    );
  });

  it("is strictly monotonic in floor: a higher floor offsets further up the screen (negative)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -20, max: 19 }),
        fc.integer({ min: 1, max: 500 }),
        (floor, storeyHeightPx) => {
          expect(floorOffsetPx(floor + 1, storeyHeightPx)).toBeLessThan(
            floorOffsetPx(floor, storeyHeightPx),
          );
        },
      ),
    );
  });

  it("sourced from the balance key, not a literal: a different storey height changes the offset", () => {
    expect(floorOffsetPx(1, 48)).toBe(-48);
    expect(floorOffsetPx(1, 64)).toBe(-64);
  });
});

describe("screenPositionPx", () => {
  it("places floor 0 at the bottom edge of its own tile, centred horizontally", () => {
    expect(screenPositionPx(0, 0, 0, 16, 48)).toEqual({ x: 8, y: 16 });
    expect(screenPositionPx(5, 3, 0, 16, 48)).toEqual({ x: 88, y: 64 });
  });

  it("offsets a higher floor upward by exactly floorOffsetPx, nothing else changing", () => {
    const ground = screenPositionPx(5, 3, 0, 16, 48);
    const upstairs = screenPositionPx(5, 3, 1, 16, 48);
    expect(upstairs.x).toBe(ground.x);
    expect(upstairs.y).toBe(ground.y - 48);
  });

  it("always returns integer pixels, even for a continuous world position", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(-100), max: Math.fround(100), noNaN: true }),
        fc.float({ min: Math.fround(-100), max: Math.fround(100), noNaN: true }),
        fc.integer({ min: -5, max: 5 }),
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 1, max: 256 }),
        (x, y, floor, tileSizePx, storeyHeightPx) => {
          const pos = screenPositionPx(x, y, floor, tileSizePx, storeyHeightPx);
          expect(Number.isInteger(pos.x)).toBe(true);
          expect(Number.isInteger(pos.y)).toBe(true);
        },
      ),
    );
  });
});

describe("worldPointFromScreenPx", () => {
  it("undoes the tile scale and the floor offset", () => {
    expect(worldPointFromScreenPx(0, 0, 0, 16, 48)).toEqual({ x: 0, y: 0 });
    expect(worldPointFromScreenPx(80, 64, 0, 16, 48)).toEqual({ x: 5, y: 4 });
    // A higher floor draws further up the screen, so the same pixel is a
    // larger world y on it.
    expect(worldPointFromScreenPx(80, 64, 1, 16, 48)).toEqual({ x: 5, y: 7 });
  });

  it("is continuous: a sub-tile pixel is a sub-tile world coordinate", () => {
    expect(worldPointFromScreenPx(8, 8, 0, 16, 48)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("worldCellFromScreenPx", () => {
  // Every drawable is bottom-centre anchored on its own cell
  // (`screenPositionPx`), so the screen rect a cell actually occupies is
  // one tile wide, centred on that anchor's x, and one tile tall, ending
  // at that anchor's y. Picking must land on the same cell the renderer
  // drew there, for every pixel of that rect.
  it("inv_pick_inverts_screen_position", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -40, max: 40 }),
        fc.integer({ min: -40, max: 40 }),
        fc.integer({ min: -3, max: 3 }),
        // Even tile sizes only: `screenPositionPx` rounds its own
        // half-tile anchor term to a whole pixel, so on an odd tile size
        // the anchor is half a pixel off the cell's true centre and this
        // test's reconstruction of the drawn rect from that anchor would
        // be measuring the rounding, not the projection. Every real
        // `render.tile_size_px` is a power of two.
        fc.integer({ min: 1, max: 32 }).map((n) => n * 2),
        fc.integer({ min: 1, max: 256 }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        (cellX, cellY, floor, tileSizePx, storeyHeightPx, alongX, alongY) => {
          const anchor = screenPositionPx(cellX, cellY, floor, tileSizePx, storeyHeightPx);
          // Any pixel inside the cell's own drawn rect: its left edge is
          // half a tile left of the bottom-centre anchor, its top edge a
          // whole tile above that anchor's bottom edge.
          const screenX = anchor.x - tileSizePx / 2 + alongX * tileSizePx;
          const screenY = anchor.y - tileSizePx + alongY * tileSizePx;
          expect(
            worldCellFromScreenPx(screenX, screenY, floor, tileSizePx, storeyHeightPx),
          ).toEqual({ cellX, cellY });
        },
      ),
    );
  });

  it("reuses floorOffsetPx, so a below-ground floor picks its own cells", () => {
    const tileSizePx = 16;
    const storeyHeightPx = 48;
    const anchor = screenPositionPx(3, 2, -1, tileSizePx, storeyHeightPx);
    expect(worldCellFromScreenPx(anchor.x, anchor.y - 1, -1, tileSizePx, storeyHeightPx)).toEqual({
      cellX: 3,
      cellY: 2,
    });
    // The same pixel on floor 0 is a different cell entirely.
    expect(
      worldCellFromScreenPx(anchor.x, anchor.y - 1, 0, tileSizePx, storeyHeightPx).cellY,
    ).not.toBe(2);
  });

  it("floors toward negative infinity, so a negative cell is never truncated to zero", () => {
    expect(worldCellFromScreenPx(-1, -1, 0, 16, 48)).toEqual({ cellX: -1, cellY: -1 });
  });
});

// Story 1.12 (FR165): the sub-cell projection the debug overlays draw
// through. It is the *plain* world-to-screen projection -- the same one
// `worldPointFromScreenPx` inverts -- never the bottom-centre anchor
// placement `screenPositionPx` applies to a sprite, which is where a
// drawable sits within its cell, not where the cell is.
describe("subcellRectPx", () => {
  it("turns a whole cell's worth of sub-cells into exactly one tile", () => {
    const rect = subcellRectPx({ x0: 16, y0: 32, x1: 32, y1: 48 }, 0, 16, 16, 48);
    expect(rect).toEqual({ x: 16, y: 32, width: 16, height: 16 });
  });

  it("applies FR124's floor offset through floorOffsetPx, never a second copy of it", () => {
    const rect = subcellRectPx({ x0: 0, y0: 0, x1: 16, y1: 16 }, 2, 16, 16, 48);
    expect(rect.y).toBe(floorOffsetPx(2, 48));
    expect(rect.x).toBe(0);
  });

  it("keeps a zero-area rect zero-area rather than widening it to something visible", () => {
    const rect = subcellRectPx({ x0: 8, y0: 0, x1: 8, y1: 16 }, 0, 16, 16, 48);
    expect(rect).toEqual({ x: 8, y: 0, width: 0, height: 16 });
  });

  it("never rounds -- a sub-cell that falls between pixels is drawn where it is", () => {
    // Truth beats pixel-snap for a measuring tool: rounding here would
    // draw a collider up to half a pixel away from where collision
    // actually resolves, which is the exact lie this overlay exists to
    // expose.
    const rect = subcellRectPx({ x0: 1, y0: 1, x1: 2, y1: 2 }, 0, 32, 16, 48);
    expect(rect).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  });

  // The overlay must land on the same pixels the renderer draws the cell
  // over, for any cell, floor and projection constants -- expressed
  // against `screen-position.ts`'s own inverse, so the overlay can never
  // acquire a projection constant of its own.
  it("inv_overlay_projection_matches_renderer", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -40, max: 40 }),
        fc.integer({ min: -40, max: 40 }),
        fc.integer({ min: -3, max: 3 }),
        fc.integer({ min: 1, max: 32 }).map((n) => n * 2),
        fc.integer({ min: 1, max: 256 }),
        fc.constantFrom(2, 4, 8, 16, 32),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        (cellX, cellY, floor, tileSizePx, storeyHeightPx, subcellsPerCell, alongX, alongY) => {
          // The sub-cell rect covering exactly cell (cellX, cellY).
          const rect = subcellRectPx(
            {
              x0: cellX * subcellsPerCell,
              y0: cellY * subcellsPerCell,
              x1: (cellX + 1) * subcellsPerCell,
              y1: (cellY + 1) * subcellsPerCell,
            },
            floor,
            subcellsPerCell,
            tileSizePx,
            storeyHeightPx,
          );
          expect(rect.width).toBe(tileSizePx);
          expect(rect.height).toBe(tileSizePx);
          // Every pixel the overlay covers picks back to that same cell.
          expect(
            worldCellFromScreenPx(
              rect.x + alongX * rect.width,
              rect.y + alongY * rect.height,
              floor,
              tileSizePx,
              storeyHeightPx,
            ),
          ).toEqual({ cellX, cellY });
        },
      ),
    );
  });
});

// Story 1.12, cycle 2 (Quentin/Tim's direction): the viewport window every
// debug overlay's cost is bounded by used to live in `main.ts`, outside
// the coverage include and with no test at all -- the one function in that
// change with real decisions in it and no proof. Its failure mode is the
// exact one the story exists to abolish: a collider that is there, not
// drawn, and a developer concluding the collision system is wrong.
describe("visibleCellBounds", () => {
  const CAMERA = { zoom: 1, offsetX: 0, offsetY: 0 };

  it("covers the whole renderer rect at zoom 1, in whole cells", () => {
    // 64x32 px over 16px tiles, so four columns and two rows are drawn --
    // plus the column/row the far edge itself lands on. The window is
    // taken from the renderer's *exclusive* far edge on purpose: at an
    // exact tile boundary that includes one more cell than is strictly
    // visible, and over-covering costs a loop iteration while
    // under-covering is a collider silently not drawn.
    const bounds = visibleCellBounds(64, 32, CAMERA, 0, 16, 48);
    expect(bounds).toEqual({ floor: 0, cellX0: 0, cellY0: 0, cellX1: 4, cellY1: 2 });
  });

  it("shows fewer cells zoomed in and more zoomed out", () => {
    const inward = visibleCellBounds(64, 64, { ...CAMERA, zoom: 2 }, 0, 16, 48);
    const outward = visibleCellBounds(64, 64, { ...CAMERA, zoom: 0.5 }, 0, 16, 48);
    expect(inward.cellX1 - inward.cellX0).toBeLessThan(outward.cellX1 - outward.cellX0);
    expect(inward).toEqual({ floor: 0, cellX0: 0, cellY0: 0, cellX1: 2, cellY1: 2 });
    expect(outward).toEqual({ floor: 0, cellX0: 0, cellY0: 0, cellX1: 8, cellY1: 8 });
  });

  it("follows a camera offset, including a negative one", () => {
    // The world container is pushed right/down, so the cells on screen are
    // the ones west/north of the origin.
    const pushed = visibleCellBounds(64, 64, { zoom: 1, offsetX: 32, offsetY: 32 }, 0, 16, 48);
    expect(pushed).toEqual({ floor: 0, cellX0: -2, cellY0: -2, cellX1: 2, cellY1: 2 });
    const pulled = visibleCellBounds(64, 64, { zoom: 1, offsetX: -32, offsetY: -32 }, 0, 16, 48);
    expect(pulled).toEqual({ floor: 0, cellX0: 2, cellY0: 2, cellX1: 6, cellY1: 6 });
  });

  it("carries the floor it was asked for, and shifts by that floor's own offset (FR124)", () => {
    const upstairs = visibleCellBounds(64, 64, CAMERA, 2, 16, 48);
    expect(upstairs.floor).toBe(2);
    // A floor above the origin is drawn higher up the screen, so the cells
    // the same pixels fall on are further south in world terms.
    const ground = visibleCellBounds(64, 64, CAMERA, 0, 16, 48);
    expect(upstairs.cellY0).toBeGreaterThan(ground.cellY0);
    expect(upstairs.cellX0).toBe(ground.cellX0);
  });

  it("returns an empty window rather than an infinite one for a degenerate camera", () => {
    // `buildCollisionRects` and `WorldIndex.objects` both loop
    // `cellY0..cellY1` with no guard of their own, so a non-finite bound
    // is a hung tab, not a wrong rectangle.
    for (const camera of [
      { zoom: 0, offsetX: 0, offsetY: 0 },
      { zoom: -1, offsetX: 0, offsetY: 0 },
      { zoom: Number.NaN, offsetX: 0, offsetY: 0 },
      { zoom: Number.POSITIVE_INFINITY, offsetX: 0, offsetY: 0 },
      { zoom: 1, offsetX: Number.NaN, offsetY: 0 },
      { zoom: 1, offsetX: 0, offsetY: Number.POSITIVE_INFINITY },
    ]) {
      const bounds = visibleCellBounds(64, 64, camera, 0, 16, 48);
      expect(isEmptyCellBounds(bounds), `camera ${JSON.stringify(camera)}`).toBe(true);
      expect(Number.isFinite(bounds.cellX0) && Number.isFinite(bounds.cellY1)).toBe(true);
    }
  });

  it("returns an empty window for a renderer with no area yet", () => {
    expect(isEmptyCellBounds(visibleCellBounds(0, 0, CAMERA, 0, 16, 48))).toBe(true);
    expect(isEmptyCellBounds(visibleCellBounds(Number.NaN, 64, CAMERA, 0, 16, 48))).toBe(true);
  });

  // The claim that matters: nothing the renderer draws is ever outside the
  // window an overlay is allowed to look at. A cell missing from these
  // bounds is a collider silently not drawn.
  it("inv_visible_bounds_cover_every_drawn_cell", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2000 }),
        fc.integer({ min: 1, max: 2000 }),
        fc.double({ min: 0.25, max: 8, noNaN: true }),
        fc.integer({ min: -2000, max: 2000 }),
        fc.integer({ min: -2000, max: 2000 }),
        fc.integer({ min: -3, max: 3 }),
        fc.integer({ min: 1, max: 32 }).map((n) => n * 2),
        fc.integer({ min: 1, max: 256 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (width, height, zoom, offsetX, offsetY, floor, tileSizePx, storeyHeightPx, atX, atY) => {
          const camera = { zoom, offsetX, offsetY };
          const bounds = visibleCellBounds(
            width,
            height,
            camera,
            floor,
            tileSizePx,
            storeyHeightPx,
          );
          // Never inverted: a window whose end precedes its start would
          // silently draw nothing at all.
          expect(bounds.cellX1).toBeGreaterThanOrEqual(bounds.cellX0);
          expect(bounds.cellY1).toBeGreaterThanOrEqual(bounds.cellY0);

          // Any pixel of the renderer rect, undone through the same
          // camera and the same inverse projection the renderer uses,
          // falls on a cell inside the window.
          const cell = worldCellFromScreenPx(
            (atX * width - offsetX) / zoom,
            (atY * height - offsetY) / zoom,
            floor,
            tileSizePx,
            storeyHeightPx,
          );
          expect(cell.cellX).toBeGreaterThanOrEqual(bounds.cellX0);
          expect(cell.cellX).toBeLessThanOrEqual(bounds.cellX1);
          expect(cell.cellY).toBeGreaterThanOrEqual(bounds.cellY0);
          expect(cell.cellY).toBeLessThanOrEqual(bounds.cellY1);
        },
      ),
      { numRuns: 200 },
    );
  });
});
