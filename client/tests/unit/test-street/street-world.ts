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
  BOLLARD_COLLIDER,
  BRIDGE_DECK_Y,
  BRIDGE_UNDER_CURB_X,
  BRIDGE_UNDER_EXIT_Y,
  BRIDGE_UNDER_PILLAR_X,
  LAMPPOST_CELL,
  LAMPPOST_DEF_ID,
  PLAYER_START,
  SHOPFRONT_EXIT_Y,
  STAIRS_Y,
  STREET_BUILDING_AREAS,
  STREET_ROOM_AREAS,
  STREET_TRANSITIONS,
  STREET_WALK_DIRECTIONS,
  type StreetWalkInputs,
  type StreetWalkSegment,
  streetColliderSources,
  streetPlacedRows,
  streetWalkUntilMet,
  TRASH_BIN_DEF_ID,
} from "../../../src/test-street/fixture";

import {
  type FloorWalkResult,
  initialFloorWalkState,
  stepAndTransition,
} from "../../../src/world/floor-walk";
import type { MovementConfig } from "../../../src/world/movement";
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

/** The street's own `TransitionIndex`. Pair symmetry (both halves: real
 * mirrored pairing and standability) is checked unconditionally by the
 * constructor itself (story 15.2, cycle 2, Quentin's finding 5) -- this
 * call supplies `isStandable` to opt into the standability half on top of
 * that; `world/floor-walk.test.ts`'s own mutually-targeting-pair cases are
 * the ones that need the named escape hatch (`skipPairSymmetry: true`),
 * because they deliberately construct the one shape a real committed
 * scene must never have. */
export function streetTransitionIndex(): TransitionIndex {
  const world = streetWorldIndex();
  const config = streetMovementConfig();
  return new TransitionIndex(STREET_TRANSITIONS, {
    isStandable: (x, y, floor) => isCellStandable(world, config, x, y, floor),
  });
}

/** Where the player comes to rest walking straight out of the door
 * (story 2.13; story 15.2, cycle 2, Quentin's finding 3): the top face of
 * the real trash bin's own base collider (FR148, story 1.9), directly
 * south of the door -- a real, drawn rest replacing the old, undrawn
 * `SHOPFRONT_EXIT_REST_COLLIDER`, immune to release lag the exact same
 * way that invisible rect always was (once resting against a real
 * collider, holding the key longer moves nothing further). Also clears
 * the wall above by construction: the bin's own top face already sits
 * south of the wall's own row. */
export function shopfrontExitRestY(): number {
  const defs = committedDefs();
  const bin = defs.objects.find((object) => object.id === TRASH_BIN_DEF_ID);
  if (!bin?.collider) {
    throw new Error(`shopfrontExitRestY: def ${TRASH_BIN_DEF_ID} has no collider in defs.json`);
  }
  return SHOPFRONT_EXIT_Y + bin.collider.y0 / defs.colliderSubcellsPerCell;
}

/** Where the walk's own eastward approach to the lamppost turns south
 * (story 2.13; story 15.2, cycle 2, Quentin's finding 3): a waypoint,
 * not a rest -- nothing real on the approach row stops a walk there, and
 * no real prop's own collider face lands inside the window below at
 * cell granularity. The next, southward segment only rests on the
 * lamppost's own base collider if the body still overlaps that collider
 * in x, so every position from here to `lamppostApproachMaxX` works and
 * anything past it walks straight by. This is the *first* sub-cell column
 * that overlaps (the collider's own west face, less the body's own
 * half-width, plus one sub-cell), not the collider's centre, so all of
 * the window's width is left for release lag to overshoot into. */
export function lamppostApproachX(): number {
  const defs = committedDefs();
  const config = streetMovementConfig();
  const lamppost = defs.objects.find((object) => object.id === LAMPPOST_DEF_ID);
  if (!lamppost?.collider) {
    throw new Error(`lamppostApproachX: def ${LAMPPOST_DEF_ID} has no collider in defs.json`);
  }
  const halfWidth = config.bodyWidthSubcells / 2 / config.subcellsPerCell;
  return LAMPPOST_CELL.x + (lamppost.collider.x0 + 1) / defs.colliderSubcellsPerCell - halfWidth;
}

/** The far edge of `lamppostApproachX`'s own window: the last `x` whose
 * body still overlaps the lamppost's own base collider (its east face
 * plus the body's own half-width, exclusive). */
export function lamppostApproachMaxX(): number {
  const defs = committedDefs();
  const config = streetMovementConfig();
  const lamppost = defs.objects.find((object) => object.id === LAMPPOST_DEF_ID);
  if (!lamppost?.collider) {
    throw new Error(`lamppostApproachMaxX: def ${LAMPPOST_DEF_ID} has no collider in defs.json`);
  }
  const halfWidth = config.bodyWidthSubcells / 2 / config.subcellsPerCell;
  return LAMPPOST_CELL.x + lamppost.collider.x1 / defs.colliderSubcellsPerCell + halfWidth;
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

/** Where the underpass checkpoint's own column is fixed: approaching the
 * pillar from the west (walking east), the body's own east edge stops at
 * the support pillar's own west face (`BOLLARD_COLLIDER.x0`, story 15.2,
 * cycle 2 -- the same real bollard shape every bollard in the fixture
 * uses), so the body's own centre (`pos.x`) lands that far short by the
 * body's own half-width. */
export function bridgeUnderRestX(): number {
  const config = streetMovementConfig();
  const halfWidth = config.bodyWidthSubcells / 2 / config.subcellsPerCell;
  return BRIDGE_UNDER_PILLAR_X + BOLLARD_COLLIDER.x0 / config.subcellsPerCell - halfWidth;
}

/** The first column whose body overlaps the underpass bollard's own
 * collider (its west face, less the body's half-width, plus one
 * sub-cell) -- a waypoint, leaving the whole overlap window for release
 * lag, like `lamppostApproachX`. */
export function underpassTurnX(): number {
  const config = streetMovementConfig();
  const halfWidth = config.bodyWidthSubcells / 2 / config.subcellsPerCell;
  return BRIDGE_UNDER_CURB_X + (BOLLARD_COLLIDER.x0 + 1) / config.subcellsPerCell - halfWidth;
}

/** The far edge of `underpassTurnX`'s own window. */
export function underpassTurnMaxX(): number {
  const config = streetMovementConfig();
  const halfWidth = config.bodyWidthSubcells / 2 / config.subcellsPerCell;
  return BRIDGE_UNDER_CURB_X + BOLLARD_COLLIDER.x1 / config.subcellsPerCell + halfWidth;
}

/** Walking north onto the deck's row, the body's top rests on the
 * underpass bollard's own south face (the bollard stands one row north). */
export function onUnderpassRowY(): number {
  const config = streetMovementConfig();
  return BRIDGE_DECK_Y - 1 + BOLLARD_COLLIDER.y1 / config.subcellsPerCell + bodyHeightCells();
}

/** The body's own height, in cells (feet-anchored: it extends upward
 * from `pos.y`). */
function bodyHeightCells(): number {
  const config = streetMovementConfig();
  return config.bodyHeightSubcells / config.subcellsPerCell;
}

/** The first `y` in `BRIDGE_UNDER_EXIT_Y` whose body clears the support
 * pillar's own row. */
export function bridgeUnderExitClearY(): number {
  return BRIDGE_UNDER_EXIT_Y + bodyHeightCells();
}

/** The first `y` in the stairwell's tread row whose body clears the
 * stairwell's upper railing. */
export function subwayTreadRowY(): number {
  return STAIRS_Y + bodyHeightCells();
}

/** Every real value [`streetWalkRoute`] needs, assembled once -- the one
 * call site every unit test and e2e spec goes through. */
export function streetWalkInputs(): StreetWalkInputs {
  return {
    shopfrontExitRestY: shopfrontExitRestY(),
    lamppostApproachX: lamppostApproachX(),
    lamppostRestY: lamppostRestY(),
    underpassTurnX: underpassTurnX(),
    onUnderpassRowY: onUnderpassRowY(),
    bridgeUnderRestX: bridgeUnderRestX(),
    bridgeUnderExitClearY: bridgeUnderExitClearY(),
    subwayTreadRowY: subwayTreadRowY(),
  };
}

/** Whether a whole cell can be stood on, on its own floor: the real
 * player body, centred in the cell the way a floor transition lands it,
 * overlaps no collider entry in the real grid (half-open, so touching a
 * face is not overlapping). An overlap test, not a probe step: the
 * resolver never blocks a body that already overlaps a collider, so a
 * probe reads a cell inside a wall as standable. */
export function isCellStandable(
  world: WorldIndex,
  config: MovementConfig,
  x: number,
  y: number,
  floor: number,
): boolean {
  const s = config.subcellsPerCell;
  const halfWidth = config.bodyWidthSubcells / 2;
  const cx = (x + 0.5) * s;
  const feet = (y + 0.5) * s;
  const body = {
    x0: cx - halfWidth,
    x1: cx + halfWidth,
    y0: feet - config.bodyHeightSubcells,
    y1: feet,
  };
  for (let cy = Math.floor(body.y0 / s); cy <= Math.floor((body.y1 - 1) / s); cy++) {
    for (let cellX = Math.floor(body.x0 / s); cellX <= Math.floor((body.x1 - 1) / s); cellX++) {
      for (const { rect } of world.entriesInCell(floor, cellX, cy)) {
        if (rect.x0 < body.x1 && body.x0 < rect.x1 && rect.y0 < body.y1 && body.y0 < rect.y1) {
          return false;
        }
      }
    }
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
  const transitions = streetTransitionIndex();

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
