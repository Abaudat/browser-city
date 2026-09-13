// The client-side half of the shared conformance fixture (Tim's
// direction, story 1.8 and story 1.7): `fixtures/world-conformance.v1.json`
// is the same file `server/sim/tests/world_conformance.rs` reads. Chunk
// addressing, whole-cell collision, floor transitions and building/room
// ownership are all checked here now (story 1.7 ports the last two,
// closing trace-matrix row 116).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chunkKey } from "../../../src/world/chunk";
import type { ColliderSource } from "../../../src/world/collision-grid";
import { CollisionGrid } from "../../../src/world/collision-grid";
import { NO_OWNER, type OwnershipArea, OwnershipIndex } from "../../../src/world/ownership";
import { TransitionIndex, type TransitionSpec } from "../../../src/world/transitions";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** `defs/`'s own generated `COLLIDER_SUBCELLS_PER_CELL`, read from the
 * committed document rather than restated -- the drift that constant was
 * generated to prevent. */
const SUBCELLS_PER_CELL: number = (
  JSON.parse(readFileSync(`${REPO_ROOT}client/public/defs/defs.json`, "utf-8")) as {
    collider_subcells_per_cell: number;
  }
).collider_subcells_per_cell;

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

interface TransitionDoc {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly target_x: number;
  readonly target_y: number;
  readonly target_floor: number;
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
  readonly transitions: readonly TransitionDoc[];
  readonly building_areas: readonly AreaSpec[];
  readonly room_areas: readonly AreaSpec[];
  readonly cases: readonly Case[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(`${REPO_ROOT}fixtures/world-conformance.v1.json`, "utf-8"),
);

/** One synthetic `PlacedObject`-shaped row per fixture collider, each
 * with a def built from that collider's own real width and height -- a
 * multi-cell collider appearing in the fixture later must widen the def,
 * not be silently truncated to one cell. */
function buildGridFromFixture(): CollisionGrid {
  const defs = new Map<number, ColliderSource>();
  const rows: { defId: number; collider: Rect; floor: number }[] = [];
  for (const floorSpec of fixture.floors) {
    for (const collider of floorSpec.colliders) {
      const width = collider.x1 - collider.x0;
      const height = collider.y1 - collider.y0;
      const defId = defs.size + 1;
      defs.set(defId, {
        width,
        height,
        collider: {
          x0: 0,
          y0: 0,
          x1: width * SUBCELLS_PER_CELL,
          y1: height * SUBCELLS_PER_CELL,
        },
      });
      rows.push({ defId, collider, floor: floorSpec.floor });
    }
  }
  const grid = new CollisionGrid(SUBCELLS_PER_CELL, defs);
  let objectId = 1n;
  for (const { defId, collider, floor } of rows) {
    grid.insert({
      objectId: objectId++,
      defId,
      x: collider.x0,
      y: collider.y0,
      floor,
      layer: 0,
      orientation: 0,
      chunkKey: 0n,
    });
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

  it("a cell blocked on one floor is blocked on another only if that floor declares its own collider there", () => {
    const grid = buildGridFromFixture();
    const declaredFloors = fixture.floors.map((f) => f.floor);
    expect(declaredFloors.length).toBeGreaterThan(1);

    const blockedCases = fixture.cases.filter((c) => c.expect_blocked);
    expect(blockedCases.length).toBeGreaterThan(0);

    for (const blocked of blockedCases) {
      for (const floor of declaredFloors) {
        // What the fixture itself says about that cell on that floor --
        // the Rust oracle's own answer, re-derived from the collider list
        // rather than assumed.
        const declaredHere = fixture.floors
          .filter((f) => f.floor === floor)
          .some((f) =>
            f.colliders.some(
              (r) => blocked.x >= r.x0 && blocked.x < r.x1 && blocked.y >= r.y0 && blocked.y < r.y1,
            ),
          );
        const isBlocked = grid.entriesInCell(floor, blocked.x, blocked.y).length > 0;
        expect(isBlocked, `(${blocked.x}, ${blocked.y}) on floor ${floor}`).toBe(declaredHere);
      }
    }
  });

  function buildOwnershipIndex(): OwnershipIndex {
    const buildingAreas: OwnershipArea[] = fixture.building_areas.map((a) => ({
      ownerId: BigInt(a.owner_id),
      floor: a.floor,
      rect: a.rect,
    }));
    const roomAreas: OwnershipArea[] = fixture.room_areas.map((a) => ({
      ownerId: BigInt(a.owner_id),
      floor: a.floor,
      rect: a.rect,
    }));
    return new OwnershipIndex(buildingAreas, roomAreas);
  }

  it("story 1.7: the TS ownership port agrees with the Rust oracle on every conformance case", () => {
    const index = buildOwnershipIndex();
    const ownershipCases = fixture.cases.filter(
      (c) => c.expect_building_id !== 0 || c.expect_room_id !== 0,
    );
    expect(ownershipCases.length).toBeGreaterThan(0);
    for (const c of fixture.cases) {
      const ownership = index.ownershipAt(c.x, c.y, c.floor);
      expect(ownership.buildingId, `(${c.x}, ${c.y}, floor ${c.floor}).buildingId`).toBe(
        BigInt(c.expect_building_id),
      );
      expect(ownership.roomId, `(${c.x}, ${c.y}, floor ${c.floor}).roomId`).toBe(
        BigInt(c.expect_room_id),
      );
    }
    // NO_OWNER is 0n -- an unowned cell in the fixture must resolve to it.
    const unowned = fixture.cases.find((c) => c.expect_building_id === 0);
    expect(unowned).toBeDefined();
    if (unowned) {
      expect(index.ownershipAt(unowned.x, unowned.y, unowned.floor).buildingId).toBe(NO_OWNER);
    }
  });

  it("story 1.7: the TS transition port agrees with the Rust oracle on every conformance case", () => {
    const specs: TransitionSpec[] = fixture.transitions.map((t) => ({
      x: t.x,
      y: t.y,
      floor: t.floor,
      targetX: t.target_x,
      targetY: t.target_y,
      targetFloor: t.target_floor,
    }));
    const index = new TransitionIndex(specs);
    const transitionCases = fixture.cases.filter((c) => c.expect_transition !== null);
    expect(transitionCases.length).toBeGreaterThan(0);
    for (const c of fixture.cases) {
      const transition = index.transitionAt(c.x, c.y, c.floor);
      if (c.expect_transition === null) {
        expect(transition, `(${c.x}, ${c.y}, floor ${c.floor})`).toBeUndefined();
      } else {
        const [tx, ty, tf] = c.expect_transition;
        expect(transition, `(${c.x}, ${c.y}, floor ${c.floor})`).toEqual({
          x: tx,
          y: ty,
          floor: tf,
        });
      }
    }
  });
});
