import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  floorOffsetPx,
  screenPositionPx,
  worldCellFromScreenPx,
  worldPointFromScreenPx,
} from "../../../src/render/screen-position";

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
    expect(
      worldCellFromScreenPx(anchor.x, anchor.y - 1, -1, tileSizePx, storeyHeightPx),
    ).toEqual({ cellX: 3, cellY: 2 });
    // The same pixel on floor 0 is a different cell entirely.
    expect(
      worldCellFromScreenPx(anchor.x, anchor.y - 1, 0, tileSizePx, storeyHeightPx).cellY,
    ).not.toBe(2);
  });

  it("floors toward negative infinity, so a negative cell is never truncated to zero", () => {
    expect(worldCellFromScreenPx(-1, -1, 0, 16, 48)).toEqual({ cellX: -1, cellY: -1 });
  });
});
