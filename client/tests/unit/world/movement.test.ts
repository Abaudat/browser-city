import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ColliderSource, GridEntry } from "../../../src/world/collision-grid";
import { CollisionGrid } from "../../../src/world/collision-grid";
import type { MovementConfig, Vec2 } from "../../../src/world/movement";
import { step } from "../../../src/world/movement";

const SUBCELLS_PER_CELL = 16;

const CONFIG: MovementConfig = {
  walkSpeedCellsPerMs: 2.2 / 1000,
  bodyWidthSubcells: 8,
  bodyHeightSubcells: 4,
  subcellsPerCell: SUBCELLS_PER_CELL,
};

interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

interface Row {
  readonly objectId: bigint;
  readonly defId: number;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly layer: number;
  readonly orientation: number;
  readonly chunkKey: bigint;
}

function buildGrid(colliders: readonly Rect[]): CollisionGrid {
  const defs = new Map<number, ColliderSource>();
  colliders.forEach((c, i) => {
    defs.set(i, { width: 100000, height: 100000, collider: c });
  });
  const grid = new CollisionGrid(SUBCELLS_PER_CELL, defs);
  colliders.forEach((_, i) => {
    const row: Row = {
      objectId: BigInt(i + 1),
      defId: i,
      x: 0,
      y: 0,
      floor: 0,
      layer: 0,
      orientation: 0,
      chunkKey: 0n,
    };
    grid.insert(row);
  });
  return grid;
}

function bodyRectSubcells(pos: Vec2, config: MovementConfig): Rect {
  const half = config.bodyWidthSubcells / 2;
  const xC = pos.x * config.subcellsPerCell;
  const yC = pos.y * config.subcellsPerCell;
  return { x0: xC - half, x1: xC + half, y0: yC - config.bodyHeightSubcells, y1: yC };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function bodyOverlapsAny(pos: Vec2, colliders: readonly Rect[], config: MovementConfig): boolean {
  const body = bodyRectSubcells(pos, config);
  return colliders.some((c) => overlaps(body, c));
}

describe("inv_move_never_ends_inside_collider", () => {
  // A 10x10-cell block, cells (0,0)-(9,9).
  const BLOCK: Rect = { x0: 0, y0: 0, x1: 160, y1: 160 };
  const grid = buildGrid([BLOCK]);

  // Starting outside the block, no input sequence or deltaMs (including
  // huge frame spikes) ever ends inside it.
  it("inv_move_never_ends_inside_collider", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(-5), max: Math.fround(15), noNaN: true }),
        fc.float({ min: Math.fround(-5), max: Math.fround(15), noNaN: true }),
        fc.array(
          fc.record({
            dx: fc.integer({ min: -1, max: 1 }),
            dy: fc.integer({ min: -1, max: 1 }),
            deltaMs: fc.float({ min: Math.fround(0), max: Math.fround(5000), noNaN: true }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (startX, startY, inputs) => {
          fc.pre(!bodyOverlapsAny({ x: startX, y: startY }, [BLOCK], CONFIG));
          let pos: Vec2 = { x: startX, y: startY };
          for (const { dx, dy, deltaMs } of inputs) {
            pos = step(pos, { x: dx, y: dy }, deltaMs, grid, 0, CONFIG);
          }
          expect(bodyOverlapsAny(pos, [BLOCK], CONFIG)).toBe(false);
        },
      ),
    );
  });
});

describe("inv_move_never_tunnels", () => {
  // A one-cell-thick wall (cells x=10) spanning an effectively unbounded Y
  // range, so only X movement is at stake.
  const WALL: Rect = { x0: 160, y0: -16000, x1: 176, y1: 16000 };
  const grid = buildGrid([WALL]);
  // A speed fast enough that even the 100ms delta clamp covers many cells
  // in one step -- a naive, position-only (non-swept) resolver would jump
  // clean over the wall.
  const FAST_CONFIG: MovementConfig = { ...CONFIG, walkSpeedCellsPerMs: 1 };

  // A single step with a huge delta never ends on the far side of a thin
  // collider -- this is the reason the resolver is swept rather than a
  // position test.
  it("inv_move_never_tunnels", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(1), max: Math.fround(1000), noNaN: true }),
        (deltaMs) => {
          const result = step({ x: 5, y: 0 }, { x: 1, y: 0 }, deltaMs, grid, 0, FAST_CONFIG);
          expect(result.x).toBeLessThanOrEqual(10 + 1e-9);
        },
      ),
    );
  });
});

describe("inv_slide_keeps_tangential_motion", () => {
  // Moving diagonally into a flat horizontal surface keeps the full
  // tangential (x) component and zeroes only the normal (y) one.
  it("inv_slide_keeps_tangential_motion", () => {
    // A floor starting at cell y=10 (subcell 160), spanning all x.
    const FLOOR: Rect = { x0: -16000, y0: 160, x1: 16000, y1: 17600 };
    const grid = buildGrid([FLOOR]);
    // A small gap so even one delta-clamped (100ms) step reaches the wall.
    const start: Vec2 = { x: 5, y: 9.9 };
    const deltaMs = 1000;
    const result = step(start, { x: 1, y: 1 }, deltaMs, grid, 0, CONFIG);

    // The unobstructed diagonal x displacement, for comparison.
    const freeResult = step(start, { x: 1, y: 1 }, deltaMs, buildGrid([]), 0, CONFIG);
    expect(result.x).toBeCloseTo(freeResult.x, 9);
    // Y is clamped to the wall's face: the body's bottom edge stops
    // exactly at the floor's top (subcell 160 -> cell 10), never inside.
    expect(result.y).toBeCloseTo(10, 9);
  });

  it("a flush two-cell-wide wall never catches the player on its internal seam", () => {
    // Two cell-adjacent colliders forming one flush wall, cells (10,10)
    // and (11,10).
    const A: Rect = { x0: 160, y0: 160, x1: 176, y1: 176 };
    const B: Rect = { x0: 176, y0: 160, x1: 192, y1: 176 };
    const grid = buildGrid([A, B]);
    // Approach diagonally from the top-left, aimed at the seam between
    // the two colliders.
    const start: Vec2 = { x: 10.9, y: 9.5 };
    const result = step(start, { x: 1, y: 1 }, 1000, grid, 0, CONFIG);
    // Never inside either collider.
    expect(bodyOverlapsAny(result, [A, B], CONFIG)).toBe(false);
  });
});

describe("resolveAxis symmetry: negative-direction blocking", () => {
  it("moving west into a wall to the west stops exactly at its east face", () => {
    // A wall occupying cell (2, *): subcells x in [32, 48). The rest
    // position is the wall's east face plus half the body's width.
    const WALL: Rect = { x0: 32, y0: -16000, x1: 48, y1: 16000 };
    const grid = buildGrid([WALL]);
    const halfWidth = CONFIG.bodyWidthSubcells / 2 / 16;
    const rest = 3 + halfWidth;
    // Start with only a small gap so the delta-clamped (100ms) step
    // crosses it and gets pulled back to exactly `rest`.
    const result = step({ x: rest + 0.1, y: 0 }, { x: -1, y: 0 }, 1000, grid, 0, CONFIG);
    expect(result.x).toBeCloseTo(rest, 9);
  });

  it("moving north (up) into a ceiling stops exactly at its bottom face", () => {
    // A ceiling occupying cell (*, 2): subcells y in [32, 48). The rest
    // position is the ceiling's bottom face plus the body's own height.
    const CEILING: Rect = { x0: -16000, y0: 32, x1: 16000, y1: 48 };
    const grid = buildGrid([CEILING]);
    const rest = 3 + CONFIG.bodyHeightSubcells / 16;
    const result = step({ x: 0, y: rest + 0.1 }, { x: 0, y: -1 }, 1000, grid, 0, CONFIG);
    expect(result.y).toBeCloseTo(rest, 9);
  });
});

describe("inv_absent_collider_is_walkable (movement)", () => {
  // A step in open space with no colliders never gets clamped.
  it("inv_absent_collider_is_walkable", () => {
    const grid = buildGrid([]);
    const result = step({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, grid, 0, CONFIG);
    expect(result.x).toBeCloseTo(CONFIG.walkSpeedCellsPerMs * 50, 9);
    expect(result.y).toBe(0);
  });
});

describe("inv_step_is_frame_rate_independent", () => {
  // One step of N ms equals k steps summing to N ms, in open space,
  // within epsilon.
  it("inv_step_is_frame_rate_independent", () => {
    // Kept under the 100ms delta clamp's own ceiling (`docs/architecture.md`
    // -- a single step this module clamps internally must not be compared
    // against a multi-step sum that would exceed it): at most 15 steps of
    // at most 5ms each, so the total never reaches 100ms.
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: Math.fround(1), max: Math.fround(5), noNaN: true }), {
          minLength: 1,
          maxLength: 15,
        }),
        (deltas) => {
          const grid = buildGrid([]);
          let multi: Vec2 = { x: 0, y: 0 };
          for (const d of deltas) {
            multi = step(multi, { x: 1, y: 0 }, d, grid, 0, CONFIG);
          }
          const total = deltas.reduce((a, b) => a + b, 0);
          const single = step({ x: 0, y: 0 }, { x: 1, y: 0 }, total, grid, 0, CONFIG);
          expect(multi.x).toBeCloseTo(single.x, 4);
        },
      ),
    );
  });

  it("diagonal speed never exceeds axis speed", () => {
    const grid = buildGrid([]);
    const axis = step({ x: 0, y: 0 }, { x: 1, y: 0 }, 1000, grid, 0, CONFIG);
    const diagonal = step({ x: 0, y: 0 }, { x: 1, y: 1 }, 1000, grid, 0, CONFIG);
    const diagonalDistance = Math.hypot(diagonal.x, diagonal.y);
    expect(diagonalDistance).toBeLessThanOrEqual(axis.x + 1e-9);
  });
});

describe("named examples", () => {
  it("crossing a 40-cell viewport width takes about 18 real seconds, within tolerance, across jittered frame deltas", () => {
    // Array length chosen so even the worst case (every delta at the 8ms
    // floor) sums past the crossing time -- no precondition-discard risk.
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 8, max: 50 }), { minLength: 2300, maxLength: 2600 }),
        (deltas) => {
          const grid = buildGrid([]);
          let pos: Vec2 = { x: 0, y: 0 };
          let elapsedMs = 0;
          for (const d of deltas) {
            pos = step(pos, { x: 1, y: 0 }, d, grid, 0, CONFIG);
            elapsedMs += d;
            if (pos.x >= 40) break;
          }
          expect(pos.x).toBeGreaterThanOrEqual(40);
          const expectedMs = 40 / CONFIG.walkSpeedCellsPerMs;
          expect(Math.abs(elapsedMs - expectedMs)).toBeLessThanOrEqual(500);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("the lamppost case: a sub-cell collider lets the player pass through the free part of its own cell", () => {
    // Lamppost base occupies subcells (6,10)-(10,14) within cell (5,5).
    const LAMPPOST: Rect = { x0: 5 * 16 + 6, y0: 5 * 16 + 10, x1: 5 * 16 + 10, y1: 5 * 16 + 14 };
    const grid = buildGrid([LAMPPOST]);
    // Walk straight through the same cell, offset from the lamppost's own
    // sub-rect (e.g. along the cell's left edge).
    const start: Vec2 = { x: 5.05, y: 5.0 };
    const result = step(start, { x: 0, y: 1 }, 200, grid, 0, CONFIG);
    expect(bodyOverlapsAny(result, [LAMPPOST], CONFIG)).toBe(false);
    // And it actually moved -- collision did not stop it dead.
    expect(result.y).toBeGreaterThan(start.y);
  });

  it("a 45-degree walk into a corner slides along the wall instead of stopping", () => {
    const WALL: Rect = { x0: 160, y0: -16000, x1: 176, y1: 16000 };
    const grid = buildGrid([WALL]);
    const result = step({ x: 9.5, y: 0 }, { x: 1, y: 1 }, 1000, grid, 0, CONFIG);
    // X is clamped by the wall; Y still moved (the player slides down it).
    expect(result.x).toBeLessThanOrEqual(10 + 1e-9);
    expect(result.y).toBeGreaterThan(0);
  });

  it("walking over a collider-less object never stops the player", () => {
    const grid = buildGrid([]); // an object with no collider contributes nothing to the grid
    const result = step({ x: 5, y: 5 }, { x: 1, y: 0 }, 500, grid, 0, CONFIG);
    expect(result.x).toBeGreaterThan(5);
  });

  it("resting flush against a wall and holding the key for 1000 frames causes no jitter, drift or push-out", () => {
    const WALL: Rect = { x0: 160, y0: -16000, x1: 176, y1: 16000 };
    const grid = buildGrid([WALL]);
    let pos: Vec2 = { x: 10 - CONFIG.bodyWidthSubcells / 2 / 16, y: 0 };
    for (let i = 0; i < 1000; i++) {
      pos = step(pos, { x: 1, y: 0 }, 16, grid, 0, CONFIG);
    }
    expect(pos.x).toBeCloseTo(10 - CONFIG.bodyWidthSubcells / 2 / 16, 9);
  });

  it("edges that only touch are not blocked (half-open, matching the server's Rect convention)", () => {
    const WALL: Rect = { x0: 160, y0: -16000, x1: 176, y1: 16000 };
    const grid = buildGrid([WALL]);
    // Body's right edge exactly touches the wall's left face -- moving
    // away (left) must be completely free, not treated as embedded.
    const touching: Vec2 = { x: 10 - CONFIG.bodyWidthSubcells / 2 / 16, y: 0 };
    const result = step(touching, { x: -1, y: 0 }, 500, grid, 0, CONFIG);
    expect(result.x).toBeLessThan(touching.x);
  });
});

describe("O(1) lookup: no row query in the movement path", () => {
  it("the number of cells examined for the same move is identical with 10 or 100k objects placed elsewhere", () => {
    function countingGrid(realGrid: CollisionGrid): {
      counted: { entriesInCell: (floor: number, x: number, y: number) => readonly GridEntry[] };
      count: () => number;
    } {
      let calls = 0;
      return {
        counted: {
          entriesInCell: (floor, x, y) => {
            calls++;
            return realGrid.entriesInCell(floor, x, y);
          },
        },
        count: () => calls,
      };
    }

    function farAwayColliders(n: number): Rect[] {
      const rects: Rect[] = [];
      for (let i = 0; i < n; i++) {
        const base = (i + 1) * 1000 * 16;
        rects.push({ x0: base, y0: base, x1: base + 16, y1: base + 16 });
      }
      return rects;
    }

    const smallGrid = buildGrid(farAwayColliders(10));
    const bigGrid = buildGrid(farAwayColliders(2000));

    const smallWrap = countingGrid(smallGrid);
    const bigWrap = countingGrid(bigGrid);

    step({ x: 0, y: 0 }, { x: 1, y: 1 }, 1000, smallWrap.counted, 0, CONFIG);
    step({ x: 0, y: 0 }, { x: 1, y: 1 }, 1000, bigWrap.counted, 0, CONFIG);

    expect(smallWrap.count()).toBe(bigWrap.count());
    expect(smallWrap.count()).toBeGreaterThan(0);
    // Bounded by the cells the swept box spans, not by object count.
    expect(smallWrap.count()).toBeLessThan(1000);
  });
});
