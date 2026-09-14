// The street scene's own collision world, assembled the way `scene.ts`
// assembles it (real `defs/objects` colliders plus the fixture's walls
// and boundary) but with no PixiJS -- shared by `drawables.test.ts`'s
// containment property, `golden.ts`'s walked-south position and the
// defs-driven lamppost tests. Reading the committed
// `client/public/defs/defs.json` here is deliberate: the street's collision
// must be tested against the same document the browser fetches, never a
// synthetic def.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDefs } from "../../../src/defs/parse";
import type { Defs } from "../../../src/defs/types";
import {
  STREET_BUILDING_AREAS,
  STREET_ROOM_AREAS,
  streetColliderSources,
  streetPlacedRows,
  LAMPPOST_CELL,
  LAMPPOST_DEF_ID,
} from "../../../src/test-street/fixture";
import type { MovementConfig } from "../../../src/world/movement";
import { loadMovementConfig } from "../../../src/world/movement-config";
import type { ObjectSource } from "../../../src/world/object-defs";
import { objectDefsById, windowDefIds } from "../../../src/world/object-defs";
import { OwnershipIndex } from "../../../src/world/ownership";
import { WorldIndex } from "../../../src/world/world-index";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export function committedDefs(): Defs {
  return parseDefs(
    JSON.parse(readFileSync(`${REPO_ROOT}client/public/defs/defs.json`, "utf-8")) as unknown,
  );
}

export function streetMovementConfig(): MovementConfig {
  return loadMovementConfig(committedDefs());
}

/** The street's own ownership index (story 1.7), built from `fixture.ts`'s
 * committed `STREET_BUILDING_AREAS`/`STREET_ROOM_AREAS` -- shared by every
 * test that needs to resolve a drawable's `ownerBuildingId` the same way
 * `scene.ts` does. */
export function streetOwnershipIndex(): OwnershipIndex {
  return new OwnershipIndex(STREET_BUILDING_AREAS, STREET_ROOM_AREAS);
}

/** The street's own window def ids (FR121), read from the committed
 * `defs.json` -- never a literal restated in a test. */
export function streetWindowDefIds(): ReadonlySet<number> {
  return windowDefIds(committedDefs());
}

/** Every def source the street scene indexes: `defs/objects` (footprints,
 * colliders and FR148 reach rects) plus the fixture's own walls and
 * boundary, exactly as `scene.ts` composes them. */
export function streetObjectSources(): ReadonlyMap<number, ObjectSource> {
  const config = streetMovementConfig();
  return new Map<number, ObjectSource>([
    ...objectDefsById(committedDefs()),
    ...streetColliderSources(config.subcellsPerCell),
  ]);
}

/** The derived world the street scene runs against -- collision grid and
 * footprint index together, fed through the one `insert` the scene uses,
 * so a test can never exercise a combination the game cannot reach. */
export function streetWorldIndex(): WorldIndex {
  const config = streetMovementConfig();
  const world = new WorldIndex(config.subcellsPerCell, streetObjectSources());
  for (const row of streetPlacedRows()) world.insert(row);
  return world;
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
