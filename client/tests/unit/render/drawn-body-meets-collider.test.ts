// Story 15.4 (Tim's direction, AC4): the resolver's own body meets the
// world's own collider in *drawn pixels*, not merely in sub-cells --
// 15.2's own scripted walks compared `walk.y` to a rest computed in
// sub-cells and stayed green while the sprite was drawn half a tile east
// and a whole tile south of that same body (Adrian's Sprint 4 demo,
// #333). This property runs the real `step`/`bodyRect` and the real
// `subcellRectPx`/`worldPointPx` projection together, so a regression in
// either the resolver or the projection shows up here as a gap or an
// overlap on screen, never only as a sub-cell coordinate matching.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { subcellRectPx } from "../../../src/render/screen-position";
import type { ColliderSource } from "../../../src/world/collision-grid";
import { CollisionGrid } from "../../../src/world/collision-grid";
import type { MovementConfig, Vec2 } from "../../../src/world/movement";
import { bodyRect, MAX_DELTA_MS, step } from "../../../src/world/movement";

const SUBCELLS_PER_CELL = 16;
const TILE_SIZE_PX = 16;
const STOREY_HEIGHT_PX = 48;
const FLOOR = 0;

/** Fast enough that the 100ms delta clamp always covers the gap plus the
 * collider's own thickness -- what lets a single `step` call resolve
 * straight to the final rest (or straight past a miss), the same way
 * `movement.test.ts`'s own "resolveAxis symmetry" tests do. */
const CONFIG: MovementConfig = {
  walkSpeedCellsPerMs: 1,
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

function buildGrid(rect: Rect): CollisionGrid {
  const defs = new Map<number, ColliderSource>([
    [1, { width: 100_000, height: 1, collider: rect }],
  ]);
  const grid = new CollisionGrid(SUBCELLS_PER_CELL, defs);
  grid.insert({
    objectId: 1n,
    defId: 1,
    x: 0,
    y: 0,
    floor: FLOOR,
    layer: 0,
    orientation: 0,
    chunkKey: 0n,
  } as never);
  return grid;
}

function drawn(rect: Rect) {
  return subcellRectPx(rect, FLOOR, SUBCELLS_PER_CELL, TILE_SIZE_PX, STOREY_HEIGHT_PX);
}

const directionArb = fc.constantFrom<readonly [number, number]>([1, 0], [-1, 0], [0, 1], [0, -1]);

describe("inv_drawn_body_meets_drawn_collider", () => {
  it("inv_drawn_body_meets_drawn_collider", () => {
    fc.assert(
      fc.property(
        directionArb,
        fc.integer({ min: 1, max: 40 }), // the collider's own thickness along the approach axis
        fc.integer({ min: 4, max: 40 }), // the collider's own extent along the lateral axis
        fc.integer({ min: 0, max: 60 }), // the gap the body starts clear by (0: starts flush)
        // The collider's own lateral centre, relative to the body's start
        // (which is always lateral-coordinate 0): ranges from squarely
        // overlapping the body's own lateral span to well clear of it, so
        // both branches below are exercised across the run, including the
        // edge -- the collider's own near lateral face landing exactly on
        // the body's own far lateral edge (half-open: still clear).
        fc.integer({ min: -60, max: 60 }),
        ([nx, ny], thickness, lateralExtent, gap, lateralCentre) => {
          const halfWidth = CONFIG.bodyWidthSubcells / 2;
          const bodyHeight = CONFIG.bodyHeightSubcells;
          const normalAxisIsX = nx !== 0;

          // The body's own leading edge on the approach axis, for a body
          // starting at sub-cell (0, 0) (`inv_move_never_tunnels`'s own
          // idiom): the collider's near face sits `gap` sub-cells further
          // along the direction of travel, so the start is always clear.
          const leadingEdge = nx > 0 ? halfWidth : nx < 0 ? -halfWidth : ny > 0 ? 0 : -bodyHeight;
          const nearFace = leadingEdge + (nx > 0 || ny > 0 ? gap : -gap);

          const collider: Rect = normalAxisIsX
            ? {
                x0: nx > 0 ? nearFace : nearFace - thickness,
                x1: nx > 0 ? nearFace + thickness : nearFace,
                y0: lateralCentre - lateralExtent / 2,
                y1: lateralCentre + lateralExtent / 2,
              }
            : {
                y0: ny > 0 ? nearFace : nearFace - thickness,
                y1: ny > 0 ? nearFace + thickness : nearFace,
                x0: lateralCentre - lateralExtent / 2,
                x1: lateralCentre + lateralExtent / 2,
              };

          const bodyLateral = normalAxisIsX
            ? { min: -bodyHeight, max: 0 }
            : { min: -halfWidth, max: halfWidth };
          const colliderLateral = normalAxisIsX
            ? { min: collider.y0, max: collider.y1 }
            : { min: collider.x0, max: collider.x1 };
          const lateralOverlaps =
            bodyLateral.min < colliderLateral.max && colliderLateral.min < bodyLateral.max;

          const grid = buildGrid(collider);
          const start: Vec2 = { x: 0, y: 0 };
          const result = step(start, { x: nx, y: ny }, MAX_DELTA_MS, grid, FLOOR, CONFIG);
          const resultBody = drawn(bodyRect(result, CONFIG));
          const colliderDrawn = drawn(collider);

          if (lateralOverlaps) {
            // A real hit: the drawn body meets the drawn collider on the
            // approach axis with zero gap and zero overlap -- the exact
            // claim AC1 makes about what the player sees.
            if (nx > 0) expect(resultBody.x + resultBody.width).toBeCloseTo(colliderDrawn.x, 9);
            if (nx < 0) expect(resultBody.x).toBeCloseTo(colliderDrawn.x + colliderDrawn.width, 9);
            if (ny > 0) expect(resultBody.y + resultBody.height).toBeCloseTo(colliderDrawn.y, 9);
            if (ny < 0) expect(resultBody.y).toBeCloseTo(colliderDrawn.y + colliderDrawn.height, 9);
          } else {
            // A clean miss: nothing on this collider's own lateral span
            // blocks the body, so it travels the whole, unclamped
            // distance straight through where the collider is drawn.
            const desiredCells = CONFIG.walkSpeedCellsPerMs * MAX_DELTA_MS;
            expect(result.x).toBeCloseTo(nx * desiredCells, 6);
            expect(result.y).toBeCloseTo(ny * desiredCells, 6);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
