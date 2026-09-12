import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type PlayerBounds, stepPlayer } from "../../../src/demo/player-step";
import { toSortUnits } from "../../../src/render/sort-units";

const BOUNDS: PlayerBounds = { x0: 2, x1: 9, y0: 1, y1: 7 };

const boundedStart = fc.record({
  x: fc.float({ min: BOUNDS.x0, max: BOUNDS.x1, noNaN: true }),
  y: fc.float({ min: BOUNDS.y0, max: BOUNDS.y1, noNaN: true }),
});
const direction = fc.record({
  dx: fc.integer({ min: -1, max: 1 }),
  dy: fc.integer({ min: -1, max: 1 }),
});

describe("stepPlayer", () => {
  it("never leaves the given bounds, for any start position, direction or delta time", () => {
    fc.assert(
      fc.property(
        boundedStart,
        direction,
        fc.float({ min: Math.fround(0), max: Math.fround(2000), noNaN: true }),
        ({ x, y }, { dx, dy }, deltaMs) => {
          const result = stepPlayer(x, y, dx, dy, 3, deltaMs, BOUNDS);
          expect(result.x).toBeGreaterThanOrEqual(BOUNDS.x0);
          expect(result.x).toBeLessThanOrEqual(BOUNDS.x1);
          expect(result.y).toBeGreaterThanOrEqual(BOUNDS.y0);
          expect(result.y).toBeLessThanOrEqual(BOUNDS.y1);
        },
      ),
    );
  });

  it("with no input, is a true no-op and never reports a sort-key change", () => {
    fc.assert(
      fc.property(
        boundedStart,
        fc.float({ min: Math.fround(0), max: Math.fround(2000), noNaN: true }),
        ({ x, y }, deltaMs) => {
          const result = stepPlayer(x, y, 0, 0, 3, deltaMs, BOUNDS);
          expect(result.x).toBe(x);
          expect(result.y).toBe(y);
          expect(result.sortKeyChanged).toBe(false);
        },
      ),
    );
  });

  it("sortKeyChanged is true exactly when the quantised (sort-unit) position actually changed", () => {
    fc.assert(
      fc.property(
        boundedStart,
        direction,
        fc.float({ min: Math.fround(0), max: Math.fround(2000), noNaN: true }),
        ({ x, y }, { dx, dy }, deltaMs) => {
          const result = stepPlayer(x, y, dx, dy, 3, deltaMs, BOUNDS);
          const moved =
            toSortUnits(result.x) !== toSortUnits(x) || toSortUnits(result.y) !== toSortUnits(y);
          expect(result.sortKeyChanged).toBe(moved);
        },
      ),
    );
  });

  it("does not exceed the configured speed even on a diagonal", () => {
    const result = stepPlayer(5, 5, 1, 1, 3, 1000, BOUNDS);
    const distance = Math.hypot(result.x - 5, result.y - 5);
    expect(distance).toBeLessThanOrEqual(3 + 1e-9);
  });

  it("moves the full configured distance along a single axis", () => {
    const result = stepPlayer(5, 5, 1, 0, 3, 1000, BOUNDS);
    expect(result.x).toBeCloseTo(8, 9);
    expect(result.y).toBe(5);
  });
});
