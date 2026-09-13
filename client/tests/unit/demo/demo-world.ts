// The demo scene's own collision world, assembled the way `scene.ts`
// assembles it (real `defs/objects` colliders plus the fixture's walls
// and boundary) but with no PixiJS -- shared by `drawables.test.ts`'s
// containment property, `golden.ts`'s walked-south position and the
// defs-driven lamppost tests. Reading the committed
// `client/public/defs/defs.json` here is deliberate: the demo's collision
// must be tested against the same document the browser fetches, never a
// synthetic def.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDefs } from "../../../src/defs/parse";
import type { Defs } from "../../../src/defs/types";
import {
  DEMO_BUILDING_AREAS,
  DEMO_ROOM_AREAS,
  demoColliderSources,
  demoPlacedRows,
  LAMPPOST_CELL,
  LAMPPOST_DEF_ID,
} from "../../../src/demo/fixture";
import type { ColliderSource } from "../../../src/world/collision-grid";
import { CollisionGrid } from "../../../src/world/collision-grid";
import type { MovementConfig } from "../../../src/world/movement";
import { loadMovementConfig } from "../../../src/world/movement-config";
import { objectDefsById, windowDefIds } from "../../../src/world/object-defs";
import { OwnershipIndex } from "../../../src/world/ownership";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export function committedDefs(): Defs {
  return parseDefs(
    JSON.parse(readFileSync(`${REPO_ROOT}client/public/defs/defs.json`, "utf-8")) as unknown,
  );
}

export function demoMovementConfig(): MovementConfig {
  return loadMovementConfig(committedDefs());
}

/** The demo's own ownership index (story 1.7), built from `fixture.ts`'s
 * committed `DEMO_BUILDING_AREAS`/`DEMO_ROOM_AREAS` -- shared by every
 * test that needs to resolve a drawable's `ownerBuildingId` the same way
 * `scene.ts` does. */
export function demoOwnershipIndex(): OwnershipIndex {
  return new OwnershipIndex(DEMO_BUILDING_AREAS, DEMO_ROOM_AREAS);
}

/** The demo's own window def ids (FR121), read from the committed
 * `defs.json` -- never a literal restated in a test. */
export function demoWindowDefIds(): ReadonlySet<number> {
  return windowDefIds(committedDefs());
}

/** The grid the demo scene runs against, built from the same two sources
 * `scene.ts` uses. */
export function demoCollisionGrid(): CollisionGrid {
  const config = demoMovementConfig();
  const sources = new Map<number, ColliderSource>([
    ...objectDefsById(committedDefs()),
    ...demoColliderSources(config.subcellsPerCell),
  ]);
  const grid = new CollisionGrid(config.subcellsPerCell, sources);
  for (const row of demoPlacedRows()) grid.insert(row);
  return grid;
}

/** Where the player comes to rest walking straight south out of the door:
 * the top face of the lamppost's own base collider, read from `defs/` --
 * never a number restated in a test or in the fixture. */
export function lamppostRestY(): number {
  const defs = committedDefs();
  const lamppost = defs.objects.find((object) => object.id === LAMPPOST_DEF_ID);
  if (!lamppost?.collider) {
    throw new Error(`lamppostRestY: def ${LAMPPOST_DEF_ID} has no collider in defs.json`);
  }
  return LAMPPOST_CELL.y + lamppost.collider.y0 / defs.colliderSubcellsPerCell;
}
