import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { floorOffsetPx, screenPositionPx } from "../../../src/render/screen-position";

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
