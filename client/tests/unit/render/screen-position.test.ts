import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  cellBottomCentre,
  floorOffsetPx,
  snapToScreenPx,
  subcellRectPx,
  visibleCellBounds,
  worldCellFromScreenPx,
  worldPointFromScreenPx,
  worldPointPx,
} from "../../../src/render/screen-position";
import type { MovementConfig } from "../../../src/world/movement";
import { bodyRect } from "../../../src/world/movement";
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

// Story 15.4 (Tim/Quentin's direction): `worldPointPx` is the *only*
// world-to-screen projection -- a plain scale-and-floor-offset, with no
// anchor terms of its own. Passing a cell straight into it (rather than
// through `cellBottomCentre` first) is exactly Adrian's Sprint 4 offset
// (#333): a continuous feet point and a cell index are not the same
// thing, and this function never tells them apart -- the caller must.
describe("worldPointPx", () => {
  it("is a plain scale-and-offset projection: no anchor terms of its own", () => {
    expect(worldPointPx(0, 0, 0, 16, 48, 1)).toEqual({ x: 0, y: 0 });
    expect(worldPointPx(5, 3, 0, 16, 48, 1)).toEqual({ x: 80, y: 48 });
  });

  it("draws a cell's own bottom-centre through cellBottomCentre, never a restated +0.5/+1", () => {
    const centre = cellBottomCentre(5, 3);
    expect(worldPointPx(centre.x, centre.y, 0, 16, 48, 1)).toEqual({ x: 88, y: 64 });
  });

  it("offsets a higher floor upward by exactly floorOffsetPx, nothing else changing", () => {
    const ground = worldPointPx(5, 3, 0, 16, 48, 1);
    const upstairs = worldPointPx(5, 3, 1, 16, 48, 1);
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
          const pos = worldPointPx(x, y, floor, tileSizePx, storeyHeightPx, 1);
          expect(Number.isInteger(pos.x)).toBe(true);
          expect(Number.isInteger(pos.y)).toBe(true);
        },
      ),
    );
  });

  it("is worldPointFromScreenPx's exact algebraic inverse (no anchor term to undo either way)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000, max: 100_000 }),
        fc.integer({ min: -100_000, max: 100_000 }),
        fc.integer({ min: -3, max: 3 }),
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 1, max: 256 }),
        (screenX, screenY, floor, tileSizePx, storeyHeightPx) => {
          // Starting from a whole screen pixel (zoom 1, so `worldPointPx`'s
          // own snap is a no-op on the way back): the world point
          // `worldPointFromScreenPx` reports projects straight back to the
          // same pixel, with no anchor term on either leg of the round
          // trip to reintroduce error.
          const world = worldPointFromScreenPx(screenX, screenY, floor, tileSizePx, storeyHeightPx);
          const screen = worldPointPx(world.x, world.y, floor, tileSizePx, storeyHeightPx, 1);
          expect(screen).toEqual({ x: screenX, y: screenY });
        },
      ),
    );
  });
});

// Story 15.4 (Tim's direction): the one place a cell becomes the point a
// bottom-centre-anchored sprite is drawn at -- a one-line pure function,
// integer inputs only, so a continuous feet position can never be run
// through it by mistake.
describe("cellBottomCentre", () => {
  it("is +0.5 cell in x and +1 cell in y", () => {
    expect(cellBottomCentre(0, 0)).toEqual({ x: 0.5, y: 1 });
    expect(cellBottomCentre(5, 3)).toEqual({ x: 5.5, y: 4 });
    expect(cellBottomCentre(-2, -1)).toEqual({ x: -1.5, y: 0 });
  });

  it("refuses a non-integer cell, the way snapToScreenPx refuses a non-integer zoom", () => {
    expect(() => cellBottomCentre(1.5, 0)).toThrow(/integer/);
    expect(() => cellBottomCentre(0, 1.5)).toThrow(/integer/);
  });
});

describe("snapToScreenPx", () => {
  it("snaps to the nearest 1/zoom of a world pixel", () => {
    expect(snapToScreenPx(10.2, 3)).toBeCloseTo(31 / 3, 12);
    expect(snapToScreenPx(10.2, 1)).toBe(10);
    expect(snapToScreenPx(-0.4, 2)).toBeCloseTo(-0.5, 12);
  });

  it("lands on a whole screen pixel, within half a screen pixel of the input", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.integer({ min: 1, max: 8 }),
        (v, zoom) => {
          const snapped = snapToScreenPx(v, zoom) * zoom;
          expect(Math.abs(snapped - Math.round(snapped))).toBeLessThan(1e-6);
          expect(Math.abs(snapped - v * zoom)).toBeLessThanOrEqual(0.5 + 1e-6);
        },
      ),
    );
  });

  // A non-integer zoom breaks `(k / zoom) * zoom === k`, which the camera's
  // constant player point relies on.
  it("refuses a non-integer or non-positive zoom", () => {
    for (const zoom of [3.5, 0.25, 0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => snapToScreenPx(1, zoom)).toThrow(/zoom/);
      expect(() => worldPointPx(1, 1, 0, 16, 48, zoom)).toThrow(/zoom/);
    }
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
  // (`cellBottomCentre`, projected through `worldPointPx`), so the screen
  // rect a cell actually occupies is one tile wide, centred on that
  // anchor's x, and one tile tall, ending at that anchor's y. Picking
  // must land on the same cell the renderer drew there, for every pixel
  // of that rect.
  it("inv_pick_inverts_screen_position", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -40, max: 40 }),
        fc.integer({ min: -40, max: 40 }),
        fc.integer({ min: -3, max: 3 }),
        // Even tile sizes only: `worldPointPx` rounds its own half-tile
        // anchor term to a whole pixel, so on an odd tile size the anchor
        // is half a pixel off the cell's true centre and this test's
        // reconstruction of the drawn rect from that anchor would be
        // measuring the rounding, not the projection. Every real
        // `render.tile_size_px` is a power of two.
        fc.integer({ min: 1, max: 32 }).map((n) => n * 2),
        fc.integer({ min: 1, max: 256 }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        (cellX, cellY, floor, tileSizePx, storeyHeightPx, alongX, alongY) => {
          const centre = cellBottomCentre(cellX, cellY);
          const anchor = worldPointPx(centre.x, centre.y, floor, tileSizePx, storeyHeightPx, 1);
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
    const centre = cellBottomCentre(3, 2);
    const anchor = worldPointPx(centre.x, centre.y, -1, tileSizePx, storeyHeightPx, 1);
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
// `worldPointFromScreenPx` inverts and `worldPointPx` is -- never
// `cellBottomCentre`'s own bottom-centre anchor, which is where a
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

// Story 15.4 (Quentin's direction, AC1/AC2): the whole story's own red
// test. `worldPointPx(feetX, feetY, ...)` is what the scene draws the
// player's sprite at (`test-street/scene.ts`'s `positionSprite`, through
// the player's own continuous feet position, never a cell); the pixel it
// lands on must be the bottom-centre of the exact body rect
// `world/movement.ts`'s `step` resolves against (`bodyRect`), for any
// feet position, floor, tile size, storey height and integer zoom --
// within the snap's own half-screen-pixel slack, since `subcellRectPx`
// (which the body goes through) is deliberately unrounded while
// `worldPointPx` snaps. Before this story's fix, the player was drawn
// through the cell-anchor placement instead, which fails this by exactly
// `(tile/2, tile)` -- the offset Adrian's Sprint 4 demo (#333) found.
describe("inv_player_sprite_feet_sit_on_body", () => {
  it("inv_player_sprite_feet_sit_on_body", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.integer({ min: -3, max: 3 }),
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 1, max: 256 }),
        fc.integer({ min: 1, max: 8 }),
        fc.constantFrom(8, 16, 32),
        (feetX, feetY, floor, tileSizePx, storeyHeightPx, zoom, subcellsPerCell) => {
          const config: MovementConfig = {
            walkSpeedCellsPerMs: 1,
            bodyWidthSubcells: Math.max(1, Math.floor(subcellsPerCell / 2)),
            bodyHeightSubcells: Math.max(1, Math.floor(subcellsPerCell / 4)),
            subcellsPerCell,
          };
          const actor = worldPointPx(feetX, feetY, floor, tileSizePx, storeyHeightPx, zoom);
          const body = subcellRectPx(
            bodyRect({ x: feetX, y: feetY }, config),
            floor,
            subcellsPerCell,
            tileSizePx,
            storeyHeightPx,
          );
          const bodyBottomCentre = { x: body.x + body.width / 2, y: body.y + body.height };
          const tolerance = 0.5 / zoom + 1e-9;
          expect(Math.abs(actor.x - bodyBottomCentre.x)).toBeLessThanOrEqual(tolerance);
          expect(Math.abs(actor.y - bodyBottomCentre.y)).toBeLessThanOrEqual(tolerance);
        },
      ),
      { numRuns: 300 },
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
