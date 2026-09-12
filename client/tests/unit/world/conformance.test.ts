// The client-side half of the shared conformance fixture (Tim's
// direction, story 1.8): `fixtures/world-conformance.v1.json` is the same
// file `server/sim/tests/world_conformance.rs` reads. Chunk addressing and
// whole-cell collision are checked here; floor transitions and ownership
// stay `deferred` in `docs/trace-matrix.md` until their own story wires
// them into the client.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chunkKey } from "../../../src/world/chunk";
import type { ColliderSource } from "../../../src/world/collision-grid";
import { CollisionGrid } from "../../../src/world/collision-grid";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SUBCELLS_PER_CELL = 16;

interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

interface FloorSpec {
  readonly floor: number;
  readonly bounds: Rect;
  readonly colliders: readonly Rect[];
}

interface AreaSpec {
  readonly owner_id: number;
  readonly floor: number;
  readonly rect: Rect;
  readonly chunk_key: number;
}

interface Case {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly expect_blocked: boolean;
  readonly expect_transition: readonly [number, number, number] | null;
  readonly expect_building_id: number;
  readonly expect_room_id: number;
}

interface Fixture {
  readonly floors: readonly FloorSpec[];
  readonly building_areas: readonly AreaSpec[];
  readonly room_areas: readonly AreaSpec[];
  readonly cases: readonly Case[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(`${REPO_ROOT}fixtures/world-conformance.v1.json`, "utf-8"),
);

/** Every collider in the fixture is a whole cell (`x1 === x0 + 1`, `y1 ===
 * y0 + 1`) -- this builds one synthetic `PlacedObject`-shaped row per
 * collider cell, anchored at the cell itself, with a def whose own
 * collider fills the entire cell. */
function buildGridFromFixture(): CollisionGrid {
  const wholeCell: ColliderSource = {
    width: 1,
    height: 1,
    collider: { x0: 0, y0: 0, x1: SUBCELLS_PER_CELL, y1: SUBCELLS_PER_CELL },
  };
  const grid = new CollisionGrid(SUBCELLS_PER_CELL, new Map([[1, wholeCell]]));
  let objectId = 1n;
  for (const floorSpec of fixture.floors) {
    for (const collider of floorSpec.colliders) {
      grid.insert({
        objectId: objectId++,
        defId: 1,
        x: collider.x0,
        y: collider.y0,
        floor: floorSpec.floor,
        layer: 0,
        orientation: 0,
        chunkKey: 0n,
      });
    }
  }
  return grid;
}

describe("world conformance fixture", () => {
  it("the fixture is non-empty", () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
    expect(fixture.floors.length).toBeGreaterThan(0);
  });

  it("chunk keys match the Rust oracle's for every declared ownership area", () => {
    for (const area of [...fixture.building_areas, ...fixture.room_areas]) {
      expect(chunkKey(area.rect.x0, area.rect.y0, area.floor)).toBe(BigInt(area.chunk_key));
    }
  });

  it("the grid built from the fixture's whole-cell colliders blocks exactly the cells the Rust oracle reports", () => {
    const grid = buildGridFromFixture();
    for (const c of fixture.cases) {
      const blocked = grid.entriesInCell(c.floor, c.x, c.y).length > 0;
      expect(blocked, `(${c.x}, ${c.y}, floor ${c.floor})`).toBe(c.expect_blocked);
    }
  });

  it("inv_collision_only_within_floor: a cell blocked on one floor is never blocked on another", () => {
    const grid = buildGridFromFixture();
    // (4, 0, floor 1) is blocked in the fixture; floor 0 at the same (x,
    // y) is not.
    expect(grid.entriesInCell(1, 4, 0).length).toBeGreaterThan(0);
    expect(grid.entriesInCell(0, 4, 0)).toEqual([]);
  });
});
