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

/** A speed fast enough that even the 100ms delta clamp covers many cells
 * in one step -- what makes a sweep bug visible at all. */
const FAST_CONFIG: MovementConfig = { ...CONFIG, walkSpeedCellsPerMs: 1 };

/** The clamp `movement.ts` applies to `deltaMs`, restated here so the
 * tests reason about the distance a step can actually cover. */
const MAX_DELTA_MS = 100;

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
    // `height: 1` -- not `width`, which contributes nothing to a
    // collider's absolute position -- because the anchor cell is the
    // footprint's own south (largest-y) row: any height above 1 would
    // shift `c`'s absolute position by `(height - 1)` cells even with
    // `row.y` fixed at 0, which is not this helper's intent (`c` is
    // already an absolute-feeling rect; a fake, oversized footprint is
    // only ever needed to keep FR128's containment check, which
    // `CollisionGrid` itself never runs, out of the way).
    defs.set(i, { width: 100000, height: 1, collider: c });
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

/** Sub-cell rects around the origin, thin ones included (a 1-subcell-wide
 * sliver is the shape a naive resolver tunnels straight through). */
const colliderArb = fc
  .record({
    x0: fc.integer({ min: -80, max: 80 }),
    y0: fc.integer({ min: -80, max: 80 }),
    width: fc.integer({ min: 1, max: 40 }),
    height: fc.integer({ min: 1, max: 40 }),
  })
  .map(({ x0, y0, width, height }) => ({ x0, y0, x1: x0 + width, y1: y0 + height }));

/** Every axis direction plus the diagonals, and non-unit vectors -- `step`
 * normalises, so a length-3 diagonal must behave exactly like a unit one. */
const directionArb = fc
  .record({
    dx: fc.integer({ min: -3, max: 3 }),
    dy: fc.integer({ min: -3, max: 3 }),
  })
  .filter(({ dx, dy }) => dx !== 0 || dy !== 0);

const configArb = fc.constantFrom(CONFIG, FAST_CONFIG);

describe("inv_move_never_ends_inside_collider", () => {
  // Any set of sub-cell colliders, any non-penetrating start, any input
  // sequence, any delta and either speed: the body is never inside a
  // collider, checked after *every* step rather than only at the end.
  it("inv_move_never_ends_inside_collider", () => {
    fc.assert(
      fc.property(
        fc.array(colliderArb, { minLength: 1, maxLength: 8 }),
        fc.record({
          x: fc.integer({ min: -120, max: 120 }).map((v) => v / SUBCELLS_PER_CELL),
          y: fc.integer({ min: -120, max: 120 }).map((v) => v / SUBCELLS_PER_CELL),
        }),
        fc.array(
          fc.record({
            dir: directionArb,
            deltaMs: fc.integer({ min: 0, max: 5_000 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        configArb,
        (colliders, start, inputs, config) => {
          fc.pre(!bodyOverlapsAny(start, colliders, config));
          const grid = buildGrid(colliders);
          let pos: Vec2 = start;
          for (const { dir, deltaMs } of inputs) {
            pos = step(pos, { x: dir.dx, y: dir.dy }, deltaMs, grid, 0, config);
            expect(
              bodyOverlapsAny(pos, colliders, config),
              `inside a collider at (${pos.x}, ${pos.y})`,
            ).toBe(false);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("inv_move_never_tunnels", () => {
  // A wall of any thickness from one sub-cell up, on any of the four
  // sides, approached head-on or diagonally, from any offset: the body
  // never ends up on the far side of it. `FAST_CONFIG` is what makes the
  // step longer than the wall is thick even after the 100ms clamp.
  it("inv_move_never_tunnels", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<readonly [number, number]>([1, 0], [-1, 0], [0, 1], [0, -1]),
        fc.constantFrom(0, 1, -1), // tangential component: head-on, or either diagonal
        fc.integer({ min: 1, max: 40 }), // wall thickness, in sub-cells
        fc.integer({ min: 1, max: 64 }), // gap between body and wall, in sub-cells
        fc.integer({ min: 1, max: 1_000 }),
        ([nx, ny], tangential, thickness, gap, deltaMs) => {
          // A wall across the direction of travel, long enough on its own
          // axis that a diagonal cannot simply go round it. `gap` is
          // measured from the body's own leading edge on that axis (the
          // body is centred in x but bottom-anchored in y), so the start
          // position is always outside the wall -- a start already inside
          // geometry is outside the resolver's contract and would prove
          // nothing.
          const span = 4_000;
          const halfWidth = FAST_CONFIG.bodyWidthSubcells / 2;
          const height = FAST_CONFIG.bodyHeightSubcells;
          const leadingEdge = nx > 0 ? halfWidth : nx < 0 ? -halfWidth : ny > 0 ? 0 : -height;
          const nearFace = leadingEdge + (nx > 0 || ny > 0 ? gap : -gap);
          const wall: Rect =
            nx !== 0
              ? {
                  x0: nx > 0 ? nearFace : nearFace - thickness,
                  x1: nx > 0 ? nearFace + thickness : nearFace,
                  y0: -span,
                  y1: span,
                }
              : {
                  y0: ny > 0 ? nearFace : nearFace - thickness,
                  y1: ny > 0 ? nearFace + thickness : nearFace,
                  x0: -span,
                  x1: span,
                };
          const grid = buildGrid([wall]);
          const dir = { x: nx + (nx === 0 ? tangential : 0), y: ny + (ny === 0 ? tangential : 0) };
          const result = step({ x: 0, y: 0 }, dir, deltaMs, grid, 0, FAST_CONFIG);
          const body = bodyRectSubcells(result, FAST_CONFIG);

          // "Far side" means the whole body has crossed the wall.
          if (nx > 0) expect(body.x0).toBeLessThanOrEqual(wall.x1);
          if (nx < 0) expect(body.x1).toBeGreaterThanOrEqual(wall.x0);
          if (ny > 0) expect(body.y0).toBeLessThanOrEqual(wall.y1);
          if (ny < 0) expect(body.y1).toBeGreaterThanOrEqual(wall.y0);
          expect(bodyOverlapsAny(result, [wall], FAST_CONFIG)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("inv_slide_keeps_tangential_motion", () => {
  // A flush wall split into N adjacent colliders at random split points,
  // in both orientations and on either side of the body: the internal
  // seams must be invisible to the resolver. Starting flush against it
  // and pushing diagonally, the tangential displacement must equal the
  // free-space displacement exactly, and the normal displacement zero.
  it("inv_slide_keeps_tangential_motion", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"north" | "south" | "west" | "east">("north", "south", "west", "east"),
        fc.uniqueArray(fc.integer({ min: -300, max: 300 }), { minLength: 1, maxLength: 6 }),
        fc.constantFrom(1, -1), // which way along the wall the player pushes
        fc.integer({ min: 1, max: 100 }),
        configArb,
        (side, rawSplits, tangentialSign, deltaMs, config) => {
          const splits = [...rawSplits].sort((a, b) => a - b);
          const lo = -4_000;
          const hi = 4_000;
          const edges = [lo, ...splits, hi];
          const thickness = 32;

          // The wall's near face sits exactly on 0 on the normal axis, so
          // the body can start flush against it.
          const vertical = side === "west" || side === "east";
          const segments: Rect[] = [];
          for (let i = 0; i + 1 < edges.length; i++) {
            const from = edges[i] as number;
            const to = edges[i + 1] as number;
            segments.push(
              vertical
                ? {
                    y0: from,
                    y1: to,
                    x0: side === "east" ? 0 : -thickness,
                    x1: side === "east" ? thickness : 0,
                  }
                : {
                    x0: from,
                    x1: to,
                    y0: side === "south" ? 0 : -thickness,
                    y1: side === "south" ? thickness : 0,
                  },
            );
          }
          const grid = buildGrid(segments);

          const halfWidth = config.bodyWidthSubcells / 2;
          const height = config.bodyHeightSubcells;
          // Flush: the body's own leading edge exactly touches the wall.
          const startSub: Vec2 =
            side === "east"
              ? { x: -halfWidth, y: -200 }
              : side === "west"
                ? { x: halfWidth, y: -200 }
                : side === "south"
                  ? { x: -200, y: 0 }
                  : { x: -200, y: height };
          const start: Vec2 = {
            x: startSub.x / config.subcellsPerCell,
            y: startSub.y / config.subcellsPerCell,
          };

          const normal =
            side === "east"
              ? { x: 1, y: 0 }
              : side === "west"
                ? { x: -1, y: 0 }
                : side === "south"
                  ? { x: 0, y: 1 }
                  : { x: 0, y: -1 };
          const dir = vertical
            ? { x: normal.x, y: tangentialSign }
            : { x: tangentialSign, y: normal.y };

          const blocked = step(start, dir, deltaMs, grid, 0, config);
          const free = step(start, dir, deltaMs, buildGrid([]), 0, config);

          if (vertical) {
            // X is the normal axis: pinned. Y is tangential: untouched.
            expect(blocked.x).toBeCloseTo(start.x, 12);
            expect(blocked.y).toBeCloseTo(free.y, 12);
          } else {
            expect(blocked.y).toBeCloseTo(start.y, 12);
            expect(blocked.x).toBeCloseTo(free.x, 12);
          }
          expect(bodyOverlapsAny(blocked, segments, config)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("an inner (concave) L-corner stops both axes without overlapping either wall", () => {
    // Cells (10, 10) and (11, 10) form the top of the L; (10, 11) its
    // side. The body approaches the inside of the corner diagonally.
    const top: Rect = { x0: 160, y0: 160, x1: 192, y1: 176 };
    const sideWall: Rect = { x0: 160, y0: 176, x1: 176, y1: 208 };
    const grid = buildGrid([top, sideWall]);
    // In the corner's free quadrant (x0 >= 176 and y0 >= 176 in
    // sub-cells), moving up-left into the inside of the corner.
    const halfWidth = CONFIG.bodyWidthSubcells / 2;
    const height = CONFIG.bodyHeightSubcells;
    // One sub-cell of clearance, which a single delta-clamped step
    // crosses, so both axes really do reach their faces.
    const start: Vec2 = { x: (176 + halfWidth + 1) / 16, y: (176 + height + 1) / 16 };
    const result = step(start, { x: -1, y: -1 }, 1_000, grid, 0, CONFIG);
    expect(bodyOverlapsAny(result, [top, sideWall], CONFIG)).toBe(false);
    // Both axes are stopped by the corner: each one lands exactly on its
    // own face, and neither slides past the other's wall.
    expect(result.x).toBeCloseTo((176 + halfWidth) / 16, 9);
    expect(result.y).toBeCloseTo((176 + height) / 16, 9);
  });

  it("a convex corner touched exactly at its own corner slides along instead of catching", () => {
    // One block; the body's bottom-left corner exactly touches the
    // block's top-right corner, then pushes up and left along its top.
    const block: Rect = { x0: 160, y0: 160, x1: 176, y1: 176 };
    const grid = buildGrid([block]);
    const halfWidth = CONFIG.bodyWidthSubcells / 2;
    const start: Vec2 = { x: (176 + halfWidth) / 16, y: 160 / 16 };
    const result = step(start, { x: -1, y: -1 }, 100, grid, 0, CONFIG);
    // Touching is not overlapping, so nothing blocks: it slides freely up
    // and to the left, past the block's corner.
    const free = step(start, { x: -1, y: -1 }, 100, buildGrid([]), 0, CONFIG);
    expect(result.x).toBeCloseTo(free.x, 12);
    expect(result.y).toBeCloseTo(free.y, 12);
    expect(bodyOverlapsAny(result, [block], CONFIG)).toBe(false);
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
  // within epsilon. Kept under the 100ms delta clamp's own ceiling: at
  // most 15 steps of at most 5ms each, so the total never reaches 100ms.
  it("inv_step_is_frame_rate_independent", () => {
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

  it("a frame longer than the delta clamp moves exactly one clamp's worth of distance", () => {
    // Deliberate, pinned behaviour: a backgrounded tab's 5000ms frame
    // loses the excess rather than teleporting. A later change to
    // `MAX_DELTA_MS` has to edit this test.
    const grid = buildGrid([]);
    const spike = step({ x: 0, y: 0 }, { x: 1, y: 0 }, 5_000, grid, 0, CONFIG);
    const clamped = step({ x: 0, y: 0 }, { x: 1, y: 0 }, MAX_DELTA_MS, grid, 0, CONFIG);
    expect(spike.x).toBe(clamped.x);
    expect(spike.x).toBeCloseTo(CONFIG.walkSpeedCellsPerMs * MAX_DELTA_MS, 12);
  });
});

describe("named examples", () => {
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

  it("a 45-degree walk into a flat wall slides along it instead of stopping", () => {
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
  it("the number of cells examined for the same move is identical with 10 or 100k objects", () => {
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

    /** `n` colliders packed densely into a handful of chunks far from the
     * player -- 100k rows without 100k chunk allocations, so the test
     * stays cheap while still being the number the trace matrix claims. */
    function farAwayColliders(n: number): Rect[] {
      const rects: Rect[] = [];
      const originSub = 100_000 * SUBCELLS_PER_CELL;
      for (let i = 0; i < n; i++) {
        const x = originSub + (i % 256) * 2;
        const y = originSub + Math.floor(i / 256) * 2;
        rects.push({ x0: x, y0: y, x1: x + 1, y1: y + 1 });
      }
      return rects;
    }

    const smallWrap = countingGrid(buildGrid(farAwayColliders(10)));
    const bigWrap = countingGrid(buildGrid(farAwayColliders(100_000)));

    step({ x: 0, y: 0 }, { x: 1, y: 1 }, 1000, smallWrap.counted, 0, CONFIG);
    step({ x: 0, y: 0 }, { x: 1, y: 1 }, 1000, bigWrap.counted, 0, CONFIG);

    expect(smallWrap.count()).toBe(bigWrap.count());
    expect(smallWrap.count()).toBeGreaterThan(0);
    // Bounded by the cells the swept box spans, not by object count.
    expect(smallWrap.count()).toBeLessThan(1000);
  });
});
