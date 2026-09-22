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
  BRIDGE_DECK_Y,
  BRIDGE_UNDER_CURB_COLLIDER,
  BRIDGE_UNDER_EXIT_COLLIDER,
  BRIDGE_UNDER_EXIT_Y,
  BRIDGE_UNDER_PILLAR_COLLIDER,
  BRIDGE_UNDER_PILLAR_X,
  LAMPPOST_APPROACH_REST_COLLIDER,
  LAMPPOST_CELL,
  LAMPPOST_DEF_ID,
  PAVEMENT_CROSSING_REST_COLLIDER,
  PAVEMENT_CROSSING_REST_X,
  PLAYER_START,
  SHOPFRONT_EXIT_REST_COLLIDER,
  STREET_BUILDING_AREAS,
  STREET_ROOM_AREAS,
  STREET_TRANSITIONS,
  STREET_WALK_DIRECTIONS,
  type StreetWalkInputs,
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

/** Where the player comes to rest walking straight south out of the door
 * (story 2.13): the south face of `SHOPFRONT_EXIT_REST_COLLIDER`, one row
 * north of the lamppost's own row (`LAMPPOST_CELL.y - 1`) -- that
 * constant's own doc comment says why this rest exists now that the
 * lamppost no longer shares the door's own column. */
export function shopfrontExitRestY(): number {
  const config = streetMovementConfig();
  return LAMPPOST_CELL.y - 1 + SHOPFRONT_EXIT_REST_COLLIDER.y0 / config.subcellsPerCell;
}

/** Where the player comes to rest approaching the lamppost from the west
 * (story 2.13): the west face of `LAMPPOST_APPROACH_REST_COLLIDER`. See
 * that constant's own doc comment for why this leg needs a rest at all. */
export function lamppostApproachRestX(): number {
  const config = streetMovementConfig();
  const halfWidth = config.bodyWidthSubcells / 2 / config.subcellsPerCell;
  return LAMPPOST_CELL.x + LAMPPOST_APPROACH_REST_COLLIDER.x0 / config.subcellsPerCell - halfWidth;
}

/** Where the player comes to rest walking into the lamppost:
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

/** Where the walk's own crossing leg comes to rest: the west face of
 * `PAVEMENT_CROSSING_REST_COLLIDER`, the same "feet/body edge touches
 * the near face" shape every other rest in this file uses, computed from
 * the real collider and the real movement config, never a hand-typed
 * number (story 1.13, cycle 3; `PAVEMENT_CROSSING_REST_X`'s own doc
 * comment says why this leg needs a rest at all). */
export function pavementCrossingRestX(): number {
  const config = streetMovementConfig();
  const halfWidth = config.bodyWidthSubcells / 2 / config.subcellsPerCell;
  return (
    PAVEMENT_CROSSING_REST_X +
    PAVEMENT_CROSSING_REST_COLLIDER.x0 / config.subcellsPerCell -
    halfWidth
  );
}

/** Where the underpass checkpoint's own row is fixed: approaching the
 * curb from the south (walking north, up into the underpass row from the
 * subway stairwell's own row), the body's own top edge -- `bodyHeight`
 * north of `pos.y`, the value that always names the feet, bottom-
 * anchored -- stops at the curb's own south face (`collider.y1`). Not a
 * south approach: the curb's own north face sits exactly on the row's
 * own entrance (`collider.y0` is `0`), so a walker coming from the north
 * side never enters the row at all, and could never leave it southward
 * either, since the same face is in the way both times. Computed from
 * the real collider shape and the real movement config, never a
 * hand-typed number (story 1.13, cycle 3). */
export function bridgeUnderRestY(): number {
  const config = streetMovementConfig();
  const bodyHeight = config.bodyHeightSubcells / config.subcellsPerCell;
  return BRIDGE_DECK_Y + BRIDGE_UNDER_CURB_COLLIDER.y1 / config.subcellsPerCell + bodyHeight;
}

/** Where the underpass checkpoint's own column is fixed: approaching the
 * pillar from the west (walking east), the body's own east edge stops at
 * the pillar's own west face (`collider.x0`), so the body's own centre
 * (`pos.x`) lands that far short by the body's own half-width. */
export function bridgeUnderRestX(): number {
  const config = streetMovementConfig();
  const halfWidth = config.bodyWidthSubcells / 2 / config.subcellsPerCell;
  return (
    BRIDGE_UNDER_PILLAR_X + BRIDGE_UNDER_PILLAR_COLLIDER.x0 / config.subcellsPerCell - halfWidth
  );
}

/** Where leaving the underpass comes to rest: the north face of
 * `BRIDGE_UNDER_EXIT_COLLIDER`, one row south of the checkpoint -- the
 * same "feet touch the near face" shape every rest in this file uses,
 * chosen so the body's own top edge (not only its feet) clears the
 * pillar's own row (`BRIDGE_UNDER_EXIT_COLLIDER`'s own doc comment says
 * why leaving needs a rest at all). */
export function bridgeExitRestY(): number {
  const config = streetMovementConfig();
  return BRIDGE_UNDER_EXIT_Y + BRIDGE_UNDER_EXIT_COLLIDER.y0 / config.subcellsPerCell;
}

/** Every real value [`streetWalkRoute`] needs, assembled once -- the one
 * call site every unit test and e2e spec goes through, so none of them
 * can drift from another about what a rest position actually is. */
export function streetWalkInputs(): StreetWalkInputs {
  return {
    shopfrontExitRestY: shopfrontExitRestY(),
    lamppostApproachRestX: lamppostApproachRestX(),
    lamppostRestY: lamppostRestY(),
    pavementCrossingRestX: pavementCrossingRestX(),
    bridgeUnderRestY: bridgeUnderRestY(),
    bridgeUnderRestX: bridgeUnderRestX(),
    bridgeExitRestY: bridgeExitRestY(),
  };
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
  options: {
    readonly stepMs?: number;
    readonly maxStepsPerSegment?: number;
    /** How many extra steps the walker keeps taking *after* its release
     * condition is already met -- the release lag a real walk always has,
     * because the condition is observed outside the page and the key is
     * released over a round trip while the scene keeps ticking. Zero is
     * the unreachable ideal; a real machine is somewhere above it, and a
     * slow CI runner is further above it than a developer's laptop. A
     * route that only survives zero is a route that fails on CI. */
    readonly releaseLagSteps?: number;
    readonly start?: FloorWalkResult;
  } = {},
): { readonly label: string; readonly state: FloorWalkResult }[] {
  const stepMs = options.stepMs ?? 16;
  const maxSteps = options.maxStepsPerSegment ?? 4000;
  const releaseLagSteps = options.releaseLagSteps ?? 0;
  const config = streetMovementConfig();
  const world = streetWorldIndex();
  const transitions = new TransitionIndex(STREET_TRANSITIONS);

  let state: FloorWalkResult = options.start ?? {
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
    // The key is still down while the release travels; the scene keeps
    // ticking. Everything the next segment relies on has to survive this.
    for (let lag = 0; lag < releaseLagSteps; lag++) {
      state = stepAndTransition(state, direction, stepMs, world, config, transitions);
    }
    checkpoints.push({ label: segment.label, state });
  }
  return checkpoints;
}
