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
  isDefStreetProp,
  LAMPPOST_CELL,
  LAMPPOST_DEF_ID,
  PLATFORM_LANDING_X,
  PLATFORM_LANDING_Y,
  PLATFORM_UP_ANCHOR_X,
  PLAYER_START,
  SHOPFRONT_EXIT_Y,
  STAIRS_X,
  STAIRS_Y,
  STAIRWELL_BOTTOM_RAILING_DEF_ID,
  STREET_BUILDING_AREAS,
  STREET_FLOOR,
  STREET_PROPS,
  STREET_ROOM_AREAS,
  STREET_STAIRWELL_ROWS,
  STREET_TRANSITIONS,
  STREET_WALK_DIRECTIONS,
  type StreetWalkInputs,
  type StreetWalkSegment,
  SUBWAY_ENTRANCE_X0,
  SUBWAY_FLOOR,
  streetBollardRoute,
  streetBridgeLapRoute,
  streetColliderSources,
  streetFootbridgeRoute,
  streetNearRailingPressRoute,
  streetPlacedRows,
  streetSubwayApproachRoute,
  streetSubwayWallWalkRoute,
  streetWalkRoute,
  streetWalkUntilMet,
  TRASH_BIN_DEF_ID,
} from "../../../src/test-street/fixture";

import {
  type FloorWalkResult,
  initialFloorWalkState,
  stepAndTransition,
} from "../../../src/world/floor-walk";
import { footprintCells, footprintOrigin } from "../../../src/world/footprint";
import type { MovementConfig } from "../../../src/world/movement";
import { loadMovementConfig } from "../../../src/world/movement-config";
import type { ObjectSource } from "../../../src/world/object-defs";
import { objectDefsById, thresholdDefIds, windowDefIds } from "../../../src/world/object-defs";
import { OwnershipIndex } from "../../../src/world/ownership";
import { isBodyClear, isCellStandable } from "../../../src/world/standable";
import {
  forwardOpenNeighbor,
  pairTransitions,
  reverseOpenNeighbor,
  TransitionIndex,
} from "../../../src/world/transitions";
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

/** The def ids carrying the `threshold` role in the committed defs. */
export function streetThresholdDefIds() {
  return thresholdDefIds(committedDefs());
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

let cachedStreetWorld: WorldIndex | undefined;
/** Whether a body can stand in a whole cell of the street: the one predicate
 * `buildFlights` is given for the real street. */
export function streetStandable(x: number, y: number, floor: number): boolean {
  cachedStreetWorld ??= streetWorldIndex();
  return isCellStandable(cachedStreetWorld, streetMovementConfig(), x, y, floor);
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
    entryBand: {
      subcellsPerCell: config.subcellsPerCell,
      isBodyClear: (floor, cx, feet) => isBodyClear(world, config, floor, cx, feet),
    },
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
 * whose feet position is inside the collider (its own west face plus one
 * sub-cell), not the collider's centre, so all of the window's width is
 * left for release lag to overshoot into -- and the feet are in the
 * lamppost's own cell, never the neighbour's. */
export function lamppostApproachX(): number {
  const defs = committedDefs();
  const lamppost = defs.objects.find((object) => object.id === LAMPPOST_DEF_ID);
  if (!lamppost?.collider) {
    throw new Error(`lamppostApproachX: def ${LAMPPOST_DEF_ID} has no collider in defs.json`);
  }
  return LAMPPOST_CELL.x + (lamppost.collider.x0 + 1) / defs.colliderSubcellsPerCell;
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

/** Where a body pressed south on the tread row rests: the top face of the
 * near railing's own collider, read from `defs/`. */
export function nearRailingRestY(): number {
  const defs = committedDefs();
  const rail = defs.objects.find((o) => o.id === STAIRWELL_BOTTOM_RAILING_DEF_ID);
  if (!rail?.collider) throw new Error("nearRailingRestY: no collider on the near railing");
  return STAIRS_Y + 1 + rail.collider.y0 / defs.colliderSubcellsPerCell;
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
    nearRailingRestY: nearRailingRestY(),
  };
}

/** Whether a body can stand in `cell` pressed flush against its edge shared
 * with `toward` (an orthogonal neighbour), centred along that edge: the
 * position from which the next step enters `toward`. A cell whose open part
 * is away from that edge is not standable here, however open the rest is. */
export function isCellStandableAgainst(
  world: WorldIndex,
  config: MovementConfig,
  cell: { readonly x: number; readonly y: number },
  toward: { readonly x: number; readonly y: number },
  floor: number,
): boolean {
  const s = config.subcellsPerCell;
  const dx = toward.x - cell.x;
  const dy = toward.y - cell.y;
  const halfWidth = config.bodyWidthSubcells / 2;
  const cx =
    dx === 0 ? (cell.x + 0.5) * s : dx > 0 ? (cell.x + 1) * s - halfWidth : cell.x * s + halfWidth;
  const feet =
    dy === 0
      ? (cell.y + 0.5) * s
      : dy > 0
        ? (cell.y + 1) * s
        : cell.y * s + config.bodyHeightSubcells;
  return isBodyClear(world, config, floor, cx, feet);
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
     * condition is already met -- the modelled release lag
     * (`RELEASE_LAG` in `test-street/fixture.ts`). Zero is the ideal; a
     * route that only survives zero is not feasible. */
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

// --- stairwells, read from the committed defs (story 15.11) ---------------
// A floor's stairwell is every placed def row on that floor whose def
// carries the `stairs` tag and touches the row under the anchor, edge to
// edge. No def id, row count or floor is named here.
const objectSources = streetObjectSources();
const stairsTag = committedDefs().tags.find((t) => t.key === "stairs");
if (!stairsTag) throw new Error("defs/ declares no `stairs` tag");
const STAIRS_TAG_ID: number = stairsTag.id;
const committed = committedDefs();

export type DefProp = Extract<(typeof STREET_PROPS)[number], { defId: number }>;
export type Cell = { readonly x: number; readonly y: number };

export function propCells(prop: (typeof STREET_PROPS)[number]): Cell[] {
  const extent = isDefStreetProp(prop)
    ? (objectSources.get(prop.defId) ?? { width: 1, height: 1 })
    : (prop.footprint ?? { width: 1, height: 1 });
  return footprintCells(prop.x, prop.y, extent);
}

export function coversCell(prop: (typeof STREET_PROPS)[number], cell: Cell): boolean {
  return propCells(prop).some((c) => c.x === cell.x && c.y === cell.y);
}

export function stairwellRowsAt(anchor: Cell & { readonly floor: number }): DefProp[] {
  const tagged = STREET_PROPS.filter(
    (p): p is DefProp =>
      isDefStreetProp(p) &&
      p.floor === anchor.floor &&
      (committed.objects.find((o) => o.id === p.defId)?.tags ?? []).includes(STAIRS_TAG_ID),
  );
  const group = tagged.filter((p) => coversCell(p, anchor));
  for (let grew = true; grew; ) {
    grew = false;
    const cells = group.flatMap(propCells);
    for (const p of tagged) {
      if (group.includes(p)) continue;
      const touches = propCells(p).some((c) =>
        cells.some((g) => Math.abs(g.x - c.x) + Math.abs(g.y - c.y) <= 1),
      );
      if (touches) {
        group.push(p);
        grew = true;
      }
    }
  }
  return group;
}

/** The tread path: from the anchor back toward the opening while still
 * inside the union footprint, then the entry cell just past it. */
export function treadPath(rows: readonly DefProp[], anchor: Cell, direction: Cell) {
  const cells = rows.flatMap(propCells);
  const inFootprint = (c: Cell) => cells.some((cell) => cell.x === c.x && cell.y === c.y);
  const path: Cell[] = [];
  let c: Cell = { x: anchor.x, y: anchor.y };
  for (; inFootprint(c); c = { x: c.x - direction.x, y: c.y - direction.y }) path.push(c);
  return { cells, path, entry: c };
}

/** Each subway anchor with its own open neighbour, from the pairing's
 * own `d` (never re-derived here). */
export function subwayAnchors() {
  const { pairings } = pairTransitions(STREET_TRANSITIONS);
  const subway = pairings.find(
    (p) =>
      p.forward.x === STAIRS_X &&
      p.forward.y === STAIRS_Y &&
      p.forward.floor === PLAYER_START.floor,
  );
  if (!subway) throw new Error("no mirrored pairing found for the subway's own down transition");
  return [
    { anchor: subway.forward, open: forwardOpenNeighbor(subway) },
    { anchor: subway.reverse, open: reverseOpenNeighbor(subway) },
  ];
}

/** The street stairwell's top railing: its placed row and the absolute
 * rect (whole-cell units) its own def's collider covers -- the foot, read
 * from the def and `footprintOrigin`, never a literal. */
export function topRailingFoot() {
  const prop = STREET_STAIRWELL_ROWS.find(
    (p) => committedDefs().objects.find((o) => o.id === p.defId)?.key === "stairwell_top_railing",
  );
  const source = prop ? objectSources.get(prop.defId) : undefined;
  if (!prop || !source?.collider)
    throw new Error("the street stairwell has no top railing collider");
  const origin = footprintOrigin(prop.x, prop.y, source);
  const sub = streetMovementConfig().subcellsPerCell;
  return {
    prop,
    width: source.width,
    rect: {
      x0: origin.x + source.collider.x0 / sub,
      y0: origin.y + source.collider.y0 / sub,
      x1: origin.x + source.collider.x1 / sub,
      y1: origin.y + source.collider.y1 / sub,
    },
  };
}

/** Where a body walking west from the platform landing comes to rest: the
 * same resolver and collision grid the browser runs, stepped until the
 * blocker holds it. The body's centre x. */
export function platformWestRestX(): number {
  const config = streetMovementConfig();
  const world = streetWorldIndex();
  const transitions = streetTransitionIndex();
  let state: FloorWalkResult = {
    ...initialFloorWalkState(PLATFORM_LANDING_X + 0.5, PLATFORM_LANDING_Y + 0.5, SUBWAY_FLOOR),
    transitioned: false,
  };
  for (let i = 0; i < 4000; i++) {
    const next = stepAndTransition(state, { x: -1, y: 0 }, 16, world, config, transitions);
    if (next.x === state.x) return state.x;
    state = next;
  }
  throw new Error("platformWestRestX: the body never came to rest");
}

// --- the routes the e2e specs walk ----------------------------------------

/** Out of the shopfront door: the walk ends in the trash bin's column and
 * inside its reach, so nothing further is walked. */
export function binReachRoute(): readonly StreetWalkSegment[] {
  return streetWalkRoute(streetWalkInputs()).slice(0, 1);
}

/** The subway approach to the entrance, then west along the pavement to the
 * top railing's middle column and south onto its foot. */
export function railingFootRoute(): readonly StreetWalkSegment[] {
  const foot = topRailingFoot();
  const approach = streetSubwayApproachRoute(streetWalkInputs());
  const toEntrance = approach.findIndex((s) => s.label === "east-to-the-subway-entrance");
  return [
    ...approach.slice(0, toEntrance + 1),
    {
      label: "west-to-the-railing-middle",
      key: "ArrowLeft",
      until: { kind: "x-at-most", value: foot.rect.x0 + 1.5 },
    },
    {
      label: "south-onto-the-railing-foot",
      key: "ArrowDown",
      until: { kind: "y-at-least", value: foot.rect.y0 - 0.001 },
    },
  ];
}

/** Out of the shop and past the lamppost (`streetWalkRoute`'s first four
 * segments), then east to open pavement. */
export function westOpenSpotRoute(): readonly StreetWalkSegment[] {
  return [
    ...streetWalkRoute(streetWalkInputs()).slice(0, 4),
    { label: "east-to-open-pavement", key: "ArrowRight", until: { kind: "x-at-least", value: 10 } },
  ];
}

/** Story 15.15: the walk down and back up the subway stairs, along both
 * edges of the tread path, for the flight-offset e2e. The south edge is the
 * near railing's face; the north edge is walked at the first row the route
 * walks the treads on, reached from the north so the release lag can only
 * carry the body further into the row. Each leg stops short of an anchor
 * cell (whose entry is the floor change) by more than the release bound.
 * The e2e takes its stills by these labels. */
export function flightWalkRoute(): readonly StreetWalkSegment[] {
  const inputs = streetWalkInputs();
  const approach = streetSubwayApproachRoute(inputs);
  const onTreads = approach.findIndex((s) => s.label === "onto-the-subway-treads-row");
  const lastWalkableStreetX = STAIRS_X + 1.9;
  const backToOpenEdgeX = STAIRS_X + 3.3;
  const left = (label: string, until: StreetWalkSegment["until"]): StreetWalkSegment => ({
    label,
    key: "ArrowLeft",
    until,
  });
  const right = (label: string, until: StreetWalkSegment["until"]): StreetWalkSegment => ({
    label,
    key: "ArrowRight",
    until,
  });
  return [
    ...approach.slice(0, onTreads + 1),
    {
      label: "south-edge-press",
      key: "ArrowDown",
      until: { kind: "y-at-least", value: inputs.nearRailingRestY },
    },
    left("south-edge-mid-flight", { kind: "x-at-most", value: STAIRS_X + 2.4 }),
    right("south-edge-reversal", { kind: "x-at-least", value: backToOpenEdgeX }),
    left("south-edge-last-walkable", { kind: "x-at-most", value: lastWalkableStreetX }),
    right("south-edge-back", { kind: "x-at-least", value: backToOpenEdgeX }),
    {
      label: "up-to-the-pavement",
      key: "ArrowUp",
      until: { kind: "y-at-most", value: STAIRS_Y - 1.5 },
    },
    {
      label: "back-to-the-tread-row",
      key: "ArrowDown",
      until: { kind: "y-at-least", value: inputs.subwayTreadRowY },
    },
    left("north-edge-last-walkable", { kind: "x-at-most", value: lastWalkableStreetX }),
    left("down-the-subway-stairs", { kind: "floor", value: SUBWAY_FLOOR }),
    left("platform-west-rest", { kind: "x-at-most", value: platformWestRestX() }),
    right("platform-last-walkable", { kind: "x-at-least", value: PLATFORM_UP_ANCHOR_X - 0.6 }),
    left("platform-back-from-last-walkable", {
      kind: "x-at-most",
      value: PLATFORM_UP_ANCHOR_X - 1.4,
    }),
    right("up-the-platform-stairs", { kind: "floor", value: STREET_FLOOR }),
    right("out-onto-the-entrance", { kind: "x-at-least", value: SUBWAY_ENTRANCE_X0 + 0.5 }),
    {
      label: "out-onto-the-pavement",
      key: "ArrowUp",
      until: { kind: "y-at-most", value: STAIRS_Y - 1.5 },
    },
  ];
}

export interface WalkedRoute {
  readonly name: string;
  readonly segments: readonly StreetWalkSegment[];
  /** Where it starts when not at `PLAYER_START`. */
  readonly start: () => FloorWalkResult | undefined;
}

/** Every route an e2e spec walks. */
export function walkedRoutes(): readonly WalkedRoute[] {
  const inputs = streetWalkInputs();
  const fresh = (): undefined => undefined;
  const afterStreetWalk = (): FloorWalkResult | undefined => {
    const out = simulateStreetWalk(streetWalkRoute(inputs));
    return out[out.length - 1]?.state;
  };
  return [
    { name: "street-walk", segments: streetWalkRoute(inputs), start: fresh },
    { name: "subway-approach", segments: streetSubwayApproachRoute(inputs), start: fresh },
    { name: "near-railing-press", segments: streetNearRailingPressRoute(inputs), start: fresh },
    { name: "subway-wall-walk", segments: streetSubwayWallWalkRoute(inputs), start: fresh },
    {
      name: "bollard",
      segments: streetBollardRoute(inputs, streetMovementConfig()),
      start: fresh,
    },
    { name: "bridge-lap", segments: streetBridgeLapRoute(), start: afterStreetWalk },
    { name: "bin-reach", segments: binReachRoute(), start: fresh },
    { name: "west-open-spot", segments: westOpenSpotRoute(), start: fresh },
    { name: "railing-foot", segments: railingFootRoute(), start: fresh },
    { name: "flight-walk", segments: flightWalkRoute(), start: fresh },
    { name: "footbridge-walk", segments: streetFootbridgeRoute(inputs), start: fresh },
  ];
}
