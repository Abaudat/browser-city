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
  LAMPPOST_CELL,
  LAMPPOST_DEF_ID,
  PLAYER_START,
  STREET_BUILDING_AREAS,
  STREET_ROOM_AREAS,
  STREET_TRANSITIONS,
  STREET_WALK_DIRECTIONS,
  type StreetWalkSegment,
  streetColliderSources,
  streetPlacedRows,
  streetWalkUntilMet,
} from "../../../src/test-street/fixture";
import {
  type FloorWalkResult,
  initialFloorWalkState,
  stepAndTransition,
} from "../../../src/world/floor-walk";
import type { MovementConfig } from "../../../src/world/movement";
import { step } from "../../../src/world/movement";
import { loadMovementConfig } from "../../../src/world/movement-config";
import type { ObjectSource } from "../../../src/world/object-defs";
import { objectDefsById, windowDefIds } from "../../../src/world/object-defs";
import { OwnershipIndex } from "../../../src/world/ownership";
import { TransitionIndex } from "../../../src/world/transitions";
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

/** Whether a whole cell can be stood on, on its own floor: the real
 * player body, centred in the cell the way a floor transition lands it
 * (`world/floor-walk.ts` puts the player at the cell's own centre), tested
 * against the real collision grid by taking a zero-length step and seeing
 * whether the resolver moved the body at all. Never a second, hand-written
 * overlap test. */
export function isCellStandable(
  world: WorldIndex,
  config: MovementConfig,
  x: number,
  y: number,
  floor: number,
): boolean {
  const centre = { x: x + 0.5, y: y + 0.5 };
  // A tiny probe step in each axis direction: a body already inside a
  // collider is pushed out (or refused) by the resolver, so a standable
  // cell is one where a probe this small changes nothing measurable.
  const probeMs = 1;
  for (const dir of [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ]) {
    const moved = step(centre, dir, probeMs, world, floor, config);
    const expected = config.walkSpeedCellsPerMs * probeMs;
    const actual = Math.hypot(moved.x - centre.x, moved.y - centre.y);
    if (actual < expected - 1e-9) return false;
  }
  return true;
}

/** The scripted walk (`fixture.ts`'s `streetWalkRoute`), simulated against
 * the real `world/floor-walk.ts` resolver and the real collision grid --
 * the same code the browser runs, just stepped by hand instead of by a
 * ticker. Returns the walker's state at the end of each segment, or
 * throws naming the segment that never completed. */
export function simulateStreetWalk(
  route: readonly StreetWalkSegment[],
  options: { readonly stepMs?: number; readonly maxStepsPerSegment?: number } = {},
): { readonly label: string; readonly state: FloorWalkResult }[] {
  const stepMs = options.stepMs ?? 16;
  const maxSteps = options.maxStepsPerSegment ?? 4000;
  const config = streetMovementConfig();
  const world = streetWorldIndex();
  const transitions = new TransitionIndex(STREET_TRANSITIONS);

  let state: FloorWalkResult = {
    ...initialFloorWalkState(PLAYER_START.x, PLAYER_START.y, PLAYER_START.floor),
    transitioned: false,
  };
  const checkpoints: { label: string; state: FloorWalkResult }[] = [];

  for (const segment of route) {
    const direction = STREET_WALK_DIRECTIONS[segment.key];
    let steps = 0;
    while (!streetWalkUntilMet(segment.until, state.x, state.y, state.floor)) {
      if (steps++ > maxSteps) {
        throw new Error(
          `simulateStreetWalk: segment '${segment.label}' never met its release condition ` +
            `(${JSON.stringify(segment.until)}); stuck at (${state.x}, ${state.y}) on floor ${state.floor}`,
        );
      }
      state = stepAndTransition(state, direction, stepMs, world, config, transitions);
    }
    checkpoints.push({ label: segment.label, state });
  }
  return checkpoints;
}
