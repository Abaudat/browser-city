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
import { type DemoCitizensFixture, parseDemoCitizens } from "../../../src/demo/citizens";
import {
  DEMO_BUILDING_AREAS,
  DEMO_ROOM_AREAS,
  demoColliderSources,
  demoPlacedRows,
  LAMPPOST_CELL,
  LAMPPOST_DEF_ID,
} from "../../../src/demo/fixture";
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

/** The demo's own committed street-crowd fixture -- `server/sim/tests/
 * demo_citizens_fixture.rs`'s generated output, read the same way the
 * browser fetches it. Shared by `tests/unit/demo/citizens.test.ts` and
 * `tests/e2e/appearance.spec.ts`. */
export function committedDemoCitizens(): DemoCitizensFixture {
  return parseDemoCitizens(
    JSON.parse(readFileSync(`${REPO_ROOT}client/public/demo-citizens.json`, "utf-8")) as unknown,
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

/** Every def source the demo scene indexes: `defs/objects` (footprints,
 * colliders and FR148 reach rects) plus the fixture's own walls and
 * boundary, exactly as `scene.ts` composes them. */
export function demoObjectSources(): ReadonlyMap<number, ObjectSource> {
  const config = demoMovementConfig();
  return new Map<number, ObjectSource>([
    ...objectDefsById(committedDefs()),
    ...demoColliderSources(config.subcellsPerCell),
  ]);
}

/** The derived world the demo scene runs against -- collision grid and
 * footprint index together, fed through the one `insert` the scene uses,
 * so a test can never exercise a combination the game cannot reach. */
export function demoWorldIndex(): WorldIndex {
  const config = demoMovementConfig();
  const world = new WorldIndex(config.subcellsPerCell, demoObjectSources());
  for (const row of demoPlacedRows()) world.insert(row);
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
