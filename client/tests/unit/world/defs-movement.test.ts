// Movement and collision measured against the *committed* `defs/`
// document, not a config hand-written in a test: these are the tests a
// deliberate retune has to come and edit. `client/public/defs/defs.json`
// is the same file the browser fetches at runtime.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LAMPPOST_CELL, LAMPPOST_DEF_ID } from "../../../src/test-street/fixture";
import { CollisionGrid } from "../../../src/world/collision-grid";
import type { Vec2 } from "../../../src/world/movement";
import { step } from "../../../src/world/movement";
import { objectDefsById } from "../../../src/world/object-defs";
import { committedDefs, streetMovementConfig } from "../test-street/street-world";

/** FR137/the GDD's own pace: one viewport width is 40 cells, and crossing
 * it takes 18 real seconds. The numbers are the requirement, so they are
 * literals here and derived from `defs/` on the other side of the
 * assertion -- retuning `movement.walk_speed_millicells_per_s` has to
 * fail this test rather than silently redefine the criterion. */
const VIEWPORT_CELLS = 40;
const CROSSING_MS = 18_000;
const CROSSING_TOLERANCE_MS = 500;

describe("the committed walking speed", () => {
  it("crosses a 40-cell viewport in 18 real seconds, within tolerance, across jittered frame deltas", () => {
    const config = streetMovementConfig();
    const emptyGrid = new CollisionGrid(config.subcellsPerCell, new Map());

    fc.assert(
      fc.property(
        // Real-world frame deltas. The array is long enough that even an
        // all-8ms run covers the crossing, so no case is discarded.
        fc.array(fc.integer({ min: 8, max: 50 }), { minLength: 2_400, maxLength: 2_600 }),
        (deltas) => {
          let pos: Vec2 = { x: 0, y: 0 };
          let elapsedMs = 0;
          for (const d of deltas) {
            pos = step(pos, { x: 1, y: 0 }, d, emptyGrid, 0, config);
            elapsedMs += d;
            if (pos.x >= VIEWPORT_CELLS) break;
          }
          expect(pos.x).toBeGreaterThanOrEqual(VIEWPORT_CELLS);
          expect(Math.abs(elapsedMs - CROSSING_MS)).toBeLessThanOrEqual(CROSSING_TOLERANCE_MS);
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe("the committed lamppost def", () => {
  const config = streetMovementConfig();
  const defs = committedDefs();
  const sources = objectDefsById(defs);

  function gridWithLamppost(): CollisionGrid {
    const grid = new CollisionGrid(config.subcellsPerCell, sources);
    grid.insert({
      objectId: 1n,
      defId: LAMPPOST_DEF_ID,
      x: LAMPPOST_CELL.x,
      y: LAMPPOST_CELL.y,
      floor: 0,
      layer: 0,
      orientation: 0,
      chunkKey: 0n,
    });
    return grid;
  }

  const lamppost = defs.objects.find((o) => o.id === LAMPPOST_DEF_ID);

  it("declares a collider smaller than its own cell, so part of the cell stays walkable", () => {
    expect(lamppost?.key).toBe("lamppost");
    const collider = lamppost?.collider;
    expect(collider).toBeDefined();
    if (!collider) throw new Error("unreachable");
    expect(collider.x1 - collider.x0).toBeLessThan(config.subcellsPerCell);
    expect(collider.y1 - collider.y0).toBeLessThan(config.subcellsPerCell);
  });

  it("blocks a walk aimed straight at its base", () => {
    const collider = lamppost?.collider;
    if (!collider) throw new Error("unreachable");
    const grid = gridWithLamppost();
    // Centred on the base, approaching from the north.
    const baseCentreX = LAMPPOST_CELL.x + (collider.x0 + collider.x1) / 2 / config.subcellsPerCell;
    let pos: Vec2 = { x: baseCentreX, y: LAMPPOST_CELL.y };
    for (let i = 0; i < 200; i++) {
      pos = step(pos, { x: 0, y: 1 }, 16, grid, 0, config);
    }
    const restY = LAMPPOST_CELL.y + collider.y0 / config.subcellsPerCell;
    expect(pos.y).toBeCloseTo(restY, 9);
  });

  it("lets the player pass through the free part of its own cell (FR128, sub-tile collision)", () => {
    const collider = lamppost?.collider;
    if (!collider) throw new Error("unreachable");
    const grid = gridWithLamppost();
    // Hugging the west edge of the lamppost's cell, clear of its base in
    // x, so nothing should stop the walk south through that same cell.
    const halfWidth = config.bodyWidthSubcells / 2;
    const clearX = LAMPPOST_CELL.x + (collider.x0 - halfWidth) / config.subcellsPerCell;
    let pos: Vec2 = { x: clearX, y: LAMPPOST_CELL.y };
    for (let i = 0; i < 200; i++) {
      pos = step(pos, { x: 0, y: 1 }, 16, grid, 0, config);
    }
    // Walked clean past the whole cell the lamppost occupies.
    expect(pos.y).toBeGreaterThan(LAMPPOST_CELL.y + 1);
  });

  it("an object whose def declares no collider contributes nothing (FR128)", () => {
    const withoutCollider = defs.objects.find((o) => o.collider === undefined);
    expect(withoutCollider).toBeDefined();
    if (!withoutCollider) throw new Error("unreachable");
    const grid = new CollisionGrid(config.subcellsPerCell, sources);
    grid.insert({
      objectId: 2n,
      defId: withoutCollider.id,
      x: 3,
      y: 3,
      floor: 0,
      layer: 0,
      orientation: 0,
      chunkKey: 0n,
    });
    expect(grid.allocatedChunkCount()).toBe(0);
    expect(grid.entriesInCell(0, 3, 3)).toEqual([]);
  });
});
