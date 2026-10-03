// Story 1.13's cheap guard (Quentin's direction): the hand-laid street
// really does contain every foundational case AC2 names, and the scripted
// walk AC3 drives really is collision-feasible -- both checked here, at
// unit speed, against the real `defs/`, the real collision grid and the
// real `world/floor-walk.ts` resolver. If someone edits the street and
// drops a case, this goes red, not the e2e.
//
// Nothing here re-proves a geometric or ordering fact: those are the
// property tests in `tests/unit/render/**` and `tests/unit/world/**`.
// This file only asserts what is true of *this* street's data.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { buildLayerRankTable, resolveRank } from "../../../src/render/layer-ranks";
import { LAYER_TABLE, layerCodeByName, passOfLayer } from "../../../src/render/layer-table";
import { subcellRectPx, worldPointPx } from "../../../src/render/screen-position";
import { isNearSideWall } from "../../../src/render/visibility";
import { ASSET_URLS } from "../../../src/test-street/assets";
import { buildPropDrawables, isDefPropDrawable } from "../../../src/test-street/drawables";
import {
  BOLLARD_COLLIDER,
  BRIDGE_DECK_DEF_ID,
  BRIDGE_DECK_WIDTH,
  BRIDGE_DECK_Y,
  BRIDGE_FLOOR,
  BRIDGE_UNDER_PILLAR_X,
  BRIDGE_X0,
  BRIDGE_X1,
  furnitureBehindWindows,
  isDefStreetProp,
  LAMPPOST_CELL,
  LAMPPOST_DEF_ID,
  PLATFORM_INTERIOR_X0,
  PLATFORM_INTERIOR_X1,
  PLATFORM_INTERIOR_Y0,
  PLATFORM_INTERIOR_Y1,
  PLATFORM_LANDING_X,
  PLATFORM_LANDING_Y,
  PLATFORM_STAIRWELL_ROWS,
  PLATFORM_UP_ANCHOR_X,
  PLATFORM_UP_ANCHOR_Y,
  PLAYER_START,
  STAIRS_ENTRY_DIRECTION,
  STAIRS_X,
  STAIRS_Y,
  STREET_BOUNDARY,
  STREET_BUILDING_AREAS,
  STREET_EXIT_X,
  STREET_EXIT_Y,
  STREET_GROUND_TILES,
  STREET_PROPS,
  STREET_ROOM_AREAS,
  STREET_STAIRWELL_ROWS,
  STREET_TRANSITIONS,
  SUBWAY_ENTRANCE_X0,
  SUBWAY_FLOOR,
  streetBollardRoute,
  streetBridgeLapRoute,
  streetDefId,
  streetPlacedRows,
  streetSubwayApproachRoute,
  streetWalkRoute,
  streetWalkUntilMet,
  TRASH_BIN_DEF_ID,
  WINDOW_DEF_ID,
} from "../../../src/test-street/fixture";
import {
  type FloorWalkResult,
  initialFloorWalkState,
  stepAndTransition,
} from "../../../src/world/floor-walk";
import { footprintCells, footprintOrigin } from "../../../src/world/footprint";
import { bodyRect, MAX_DELTA_MS, step } from "../../../src/world/movement";
import { cellOf, NO_OWNER } from "../../../src/world/ownership";
import { blockedNeighborsOf } from "../../../src/world/transitions";
import { checkWorldSpec } from "../../../src/world/world-spec";
import {
  type Cell,
  committedDefs,
  coversCell,
  type DefProp,
  isBodyClear,
  isCellStandable,
  isCellStandableAgainst,
  lamppostApproachMaxX,
  lamppostRestY,
  onUnderpassRowY,
  propCells,
  simulateStreetWalk,
  stairwellRowsAt,
  streetMovementConfig,
  streetObjectSources,
  streetOwnershipIndex,
  streetTransitionIndex,
  streetWalkInputs,
  streetWindowDefIds,
  streetWorldIndex,
  subwayAnchors,
  topRailingFoot,
  treadPath,
  underpassTurnMaxX,
} from "./street-world";

const defs = committedDefs();
const objectSources = streetObjectSources();
const config = streetMovementConfig();
const world = streetWorldIndex();
const ownership = streetOwnershipIndex();

function objectDef(defId: number) {
  const def = defs.objects.find((object) => object.id === defId);
  if (!def) throw new Error(`no defs/objects entry with id ${defId}`);
  return def;
}

describe("the hand-laid test street (AC1, AC2)", () => {
  it("is laid from a hardcoded prop list and real defs/objects ids -- no generator", () => {
    expect(STREET_PROPS.length).toBeGreaterThan(0);
    const placedDefIds = new Set(streetPlacedRows().map((row) => row.defId));
    const realDefIds = defs.objects.map((object) => object.id);
    // At least the four cases below are placed by a real `defs/` id, so
    // their physical facts come from `defs/objects`, never from a rect
    // restated in the fixture.
    for (const defId of [LAMPPOST_DEF_ID, WINDOW_DEF_ID, BRIDGE_DECK_DEF_ID]) {
      expect(realDefIds).toContain(defId);
      expect(placedDefIds.has(defId)).toBe(true);
    }
  });

  it("has two drawables at one (x, y) on different floors -- the bridge over the street", () => {
    // The deck's own cells, and the pavement cells directly beneath them,
    // are the same `(x, y)` on two floors. Nothing on either floor
    // contributes collision to the other (FR117), so the span is walkable
    // both over and under.
    for (let x = BRIDGE_X0; x <= BRIDGE_X1; x++) {
      expect(isCellStandable(world, config, x, BRIDGE_DECK_Y, BRIDGE_FLOOR)).toBe(true);
      // The pillar's own column (`BRIDGE_UNDER_PILLAR_X`) is a deliberate,
      // real obstruction on the street floor -- the underpass checkpoint's
      // own rest collider (story 1.13, cycle 3) -- so its dead centre is
      // not standable, even though the walk still passes beside it. The
      // checkpoint's other rest, the curb, sits west of the bridge's own
      // span entirely (`BRIDGE_UNDER_CURB_X`'s own doc comment says why),
      // so every other column under the span is untouched by either.
      if (x === BRIDGE_UNDER_PILLAR_X) continue;
      expect(isCellStandable(world, config, x, BRIDGE_DECK_Y, PLAYER_START.floor)).toBe(true);
    }
    // Story 2.13 (Tim's direction): no `repeat` axis -- `bridge_deck` is a
    // one-cell def, placed `BRIDGE_DECK_WIDTH` times, one per deck column,
    // the same shape the parapet already uses.
    const deck = objectDef(BRIDGE_DECK_DEF_ID);
    expect(deck.width).toBe(1);
    expect(deck.collider).toBeUndefined();
    const deckPlacements = STREET_PROPS.filter(
      (prop) => isDefStreetProp(prop) && prop.defId === BRIDGE_DECK_DEF_ID,
    );
    expect(deckPlacements.length).toBe(BRIDGE_DECK_WIDTH);
  });

  it("has at least one transition cell on each of the floors the walk visits", () => {
    expect(STREET_TRANSITIONS.length).toBeGreaterThan(0);
    const floors = new Set(STREET_TRANSITIONS.map((t) => t.floor));
    expect(floors.has(PLAYER_START.floor)).toBe(true);
    expect(floors.has(BRIDGE_FLOOR)).toBe(true);
  });

  it("has a building whose near-side walls are retractable, keyed on its own enclosure id", () => {
    const wallProps = STREET_PROPS.filter((prop) => prop.layer === "walls");
    const nearSideOwned = wallProps.filter((prop) => {
      const owner = ownership.ownershipAt(prop.x, prop.y, prop.floor).buildingId;
      return owner !== NO_OWNER && isNearSideWall(ownership, prop.x, prop.y, prop.floor, owner);
    });
    expect(nearSideOwned.length).toBeGreaterThan(0);
    // More than one enclosure, so "only the one you are in opens" is a
    // thing this street can actually show.
    expect(new Set(STREET_BUILDING_AREAS.map((a) => a.ownerId)).size).toBeGreaterThan(1);
  });

  it("has at least one window wall tile, placed by its real defs/ id", () => {
    const windows = STREET_PROPS.filter(
      (prop) => isDefStreetProp(prop) && prop.defId === WINDOW_DEF_ID,
    );
    expect(windows.length).toBeGreaterThan(0);
    expect(objectDef(WINDOW_DEF_ID).window).toBe(true);
  });

  it("has furniture directly behind a window, so the window has something to be seen through", () => {
    // The real "behind a window" set (same floor, north of the window's
    // own row, x-overlapping its footprint) -- not merely "any furniture
    // somewhere on the floor", which would pass even if no window sat in
    // front of any of it.
    expect(furnitureBehindWindows(streetObjectSources()).length).toBeGreaterThan(0);
  });

  it("has a prop wider than one cell", () => {
    // A `defId` row's own extent comes from the def, never a `footprint`
    // field it cannot carry (story 2.13, Tim's direction) -- `objectDef`
    // is the same real-`defs.json` lookup this file already uses.
    function widthOf(prop: (typeof STREET_PROPS)[number]): number {
      return isDefStreetProp(prop) ? objectDef(prop.defId).width : (prop.footprint?.width ?? 1);
    }
    function heightOf(prop: (typeof STREET_PROPS)[number]): number {
      return isDefStreetProp(prop) ? objectDef(prop.defId).height : (prop.footprint?.height ?? 1);
    }
    const multiCell = STREET_PROPS.filter((prop) => widthOf(prop) > 1 || heightOf(prop) > 1);
    expect(multiCell.length).toBeGreaterThan(0);
  });

  it("has a prop whose collider is smaller than its footprint, so part of its cell is walkable", () => {
    const lamppost = objectDef(LAMPPOST_DEF_ID);
    const collider = lamppost.collider;
    if (!collider) throw new Error("the lamppost has no collider in defs/");
    const subcells = defs.colliderSubcellsPerCell;
    const footprintArea = lamppost.width * lamppost.height * subcells * subcells;
    const colliderArea = (collider.x1 - collider.x0) * (collider.y1 - collider.y0);
    expect(colliderArea).toBeLessThan(footprintArea);
    expect(
      STREET_PROPS.some((prop) => isDefStreetProp(prop) && prop.defId === LAMPPOST_DEF_ID),
    ).toBe(true);
  });

  it("closes every floor it declares, so the player can never walk off the drawn world", () => {
    const floors = new Set(STREET_BOUNDARY.map((rect) => rect.floor ?? PLAYER_START.floor));
    expect(floors.has(PLAYER_START.floor)).toBe(true);
    expect(floors.has(BRIDGE_FLOOR)).toBe(true);
  });
});

describe("the street as world data (Tim's WorldSpec::build mirror)", () => {
  it("has no overlapping same-kind ownership rects, chunk-confined rects, and standable transition ends", () => {
    expect(
      checkWorldSpec({
        buildingAreas: STREET_BUILDING_AREAS,
        roomAreas: STREET_ROOM_AREAS,
        transitions: STREET_TRANSITIONS,
        isStandable: (x, y, floor) => isCellStandable(world, config, x, y, floor),
        floorRange: { minFloor: defs.minFloor, maxFloor: defs.maxFloor },
      }),
    ).toEqual([]);
  });

  it("never targets a transition anchor with another transition", () => {
    const anchors = new Set(STREET_TRANSITIONS.map((t) => `${t.x}|${t.y}|${t.floor}`));
    for (const t of STREET_TRANSITIONS) {
      expect(anchors.has(`${t.targetX}|${t.targetY}|${t.targetFloor}`)).toBe(false);
    }
  });
});

/** The release lag every scripted walk must survive: the tick that
 * crossed the release condition plus one more, both at the resolver's own
 * delta clamp. */
const RELEASE_LAG = { stepMs: MAX_DELTA_MS, releaseLagSteps: 1 } as const;

describe("the scripted walk (AC3)", () => {
  const checkpoints = simulateStreetWalk(streetWalkRoute(streetWalkInputs()));
  const at = (label: string) => {
    const found = checkpoints.find((checkpoint) => checkpoint.label === label);
    if (!found) throw new Error(`no checkpoint '${label}' in the simulated walk`);
    return found.state;
  };

  it("completes every segment against the real collision grid", () => {
    expect(checkpoints.map((checkpoint) => checkpoint.label)).toEqual(
      streetWalkRoute(streetWalkInputs()).map((segment) => segment.label),
    );
  });

  it("leaves the shop through its door rather than through a wall", () => {
    const outside = at("outside-the-shopfront");
    expect(ownership.ownershipAt(outside.cellX, outside.cellY, outside.floor).buildingId).toBe(
      NO_OWNER,
    );
    expect(
      ownership.ownershipAt(PLAYER_START.x, PLAYER_START.y, PLAYER_START.floor).buildingId,
    ).not.toBe(NO_OWNER);
  });

  it("comes to rest inside the lamppost's own footprint cell but outside its collider", () => {
    const rest = at("part-way-through-the-lamppost");
    expect(rest.cellX).toBe(LAMPPOST_CELL.x);
    expect(rest.cellY).toBe(LAMPPOST_CELL.y);
    // The body's own bottom edge stops exactly on the collider's top
    // face: inside the cell the prop occupies, never inside the prop.
    expect(rest.y).toBeCloseTo(lamppostRestY(), 5);
  });

  it("stops strictly under the bridge span, on the street's own floor", () => {
    const under = at("under-the-bridge");
    expect(under.floor).toBe(PLAYER_START.floor);
    expect(under.cellY).toBe(BRIDGE_DECK_Y);
    expect(under.x).toBeGreaterThanOrEqual(BRIDGE_X0);
    expect(under.x).toBeLessThanOrEqual(BRIDGE_X1);
  });

  it("stops at the exact same position under the bridge whether the key is released on time or one fully clamped tick late", () => {
    // Both axes are rests on real, drawn bollards (the underpass bollard
    // fixes the row, the support pillar the column), so the checkpoint the
    // underpass screenshots are taken at is identical however late the key
    // is released.
    const inputs = streetWalkInputs();
    const onTime = simulateStreetWalk(streetWalkRoute(inputs), { releaseLagSteps: 0 });
    const late = simulateStreetWalk(streetWalkRoute(inputs), RELEASE_LAG);
    const onTimeUnder = onTime.find((c) => c.label === "under-the-bridge")?.state;
    const lateUnder = late.find((c) => c.label === "under-the-bridge")?.state;
    if (!onTimeUnder || !lateUnder) {
      throw new Error("both walks must reach the 'under-the-bridge' checkpoint");
    }
    expect(lateUnder.x).toBeCloseTo(onTimeUnder.x, 9);
    expect(lateUnder.y).toBeCloseTo(onTimeUnder.y, 9);
    expect(lateUnder.floor).toBe(onTimeUnder.floor);
  });

  it("continues past the bridge's own east end to reach the stairs up", () => {
    // This segment's own threshold sits past the up-transition's own
    // anchor column, so holding the key through it climbs onto the deck
    // mid-segment (the ordinary case) -- the next segment ("on-the-bridge-
    // deck") is what actually asserts the climb happened.
    const east = at("east-of-the-bridge");
    expect(east.floor).toBe(BRIDGE_FLOOR);
    expect(east.x).toBeGreaterThan(BRIDGE_X1);
  });

  it("climbs onto the deck by a transition and comes back down to the street", () => {
    expect(at("on-the-bridge-deck").floor).toBe(BRIDGE_FLOOR);
    expect(at("back-on-the-street").floor).toBe(PLAYER_START.floor);
  });

  it("walks a whole lap, and lands back where the lap started, so laps chain", () => {
    // The lap the NFR2 perf harness loops. It must end where it began --
    // a lap that drifted would be measuring a different journey every
    // time round -- and must never wander onto a floor it did not mean
    // to visit.
    const lap = streetBridgeLapRoute();
    const first = simulateStreetWalk(lap, { start: at("back-on-the-street") });
    const home = first[first.length - 1]?.state;
    if (!home) throw new Error("the lap produced no checkpoints");
    expect(home.floor).toBe(PLAYER_START.floor);
    expect(home.cellX).toBe(at("back-on-the-street").cellX);
    expect(home.cellY).toBe(at("back-on-the-street").cellY);

    const second = simulateStreetWalk(lap, { start: home });
    const secondHome = second[second.length - 1]?.state;
    expect(secondHome?.cellX).toBe(home.cellX);
    expect(secondHome?.cellY).toBe(home.cellY);
    expect(secondHome?.floor).toBe(home.floor);
  });

  it("the lamppost approach still engages the lamppost's own collider with one extra, fully clamped tick of release lag", () => {
    // `east-to-the-lamppost` is a waypoint, not a rest (story 15.2, cycle
    // 2): the south leg after it only rests on the lamppost's own collider
    // while the body still overlaps it in x. The e2e walkers release in
    // the page on the frame the condition is met, so a real overshoot is
    // the tick that crossed the threshold plus at most one more; both at
    // the resolver's own delta clamp is the worst case, and it must still
    // land inside the window.
    const out = simulateStreetWalk(streetWalkRoute(streetWalkInputs()).slice(0, 3), RELEASE_LAG);
    const approach = out.find((c) => c.label === "east-to-the-lamppost")?.state;
    const rest = out.find((c) => c.label === "part-way-through-the-lamppost")?.state;
    if (!approach || !rest) throw new Error("the lamppost approach produced no checkpoints");
    expect(approach.x).toBeLessThan(lamppostApproachMaxX());
    expect(rest.y).toBeCloseTo(lamppostRestY(), 9);
  });

  it("the underpass turn still engages the underpass bollard's own collider with one extra, fully clamped tick of release lag", () => {
    const route = streetWalkRoute(streetWalkInputs());
    const end = route.findIndex((s) => s.label === "on-the-underpass-row");
    const out = simulateStreetWalk(route.slice(0, end + 1), RELEASE_LAG);
    const turn = out.find((c) => c.label === "east-along-the-crossing")?.state;
    const rest = out.find((c) => c.label === "on-the-underpass-row")?.state;
    if (!turn || !rest) throw new Error("the underpass turn produced no checkpoints");
    expect(turn.x).toBeLessThan(underpassTurnMaxX());
    expect(rest.y).toBeCloseTo(onUnderpassRowY(), 9);
    expect(rest.cellY).toBe(BRIDGE_DECK_Y);
  });

  it("survives a slow machine: every segment still completes with every key released one fully clamped tick late", () => {
    // The e2e and perf walkers release a key inside the page on the frame
    // its condition is first met, so a real overshoot is the crossing
    // tick plus at most one more; both at the resolver's own delta clamp
    // (`MAX_DELTA_MS`) is the worst case, and every route must survive it.
    const inputs = streetWalkInputs();

    const out = simulateStreetWalk(streetWalkRoute(inputs), RELEASE_LAG);
    const arrived = out[out.length - 1]?.state;
    if (!arrived) throw new Error("the walk produced no checkpoints");
    expect(arrived.floor).toBe(PLAYER_START.floor);
    for (const checkpoint of out) expect(checkpoint.state.floor).not.toBe(SUBWAY_FLOOR);

    let state = arrived;
    for (let lapIndex = 0; lapIndex < 3; lapIndex++) {
      const lap = simulateStreetWalk(streetBridgeLapRoute(), {
        ...RELEASE_LAG,
        start: state,
      });
      for (const checkpoint of lap) expect(checkpoint.state.floor).not.toBe(SUBWAY_FLOOR);
      const end = lap[lap.length - 1]?.state;
      if (!end) throw new Error("the lap produced no checkpoints");
      state = end;
    }
    // Three laps later it is still where a lap starts: the loop is stable.
    expect(state.floor).toBe(PLAYER_START.floor);
    expect(state.cellX).toBe(arrived.cellX);
    expect(state.cellY).toBe(arrived.cellY);
  });

  it("walks from the shop down the subway stairs the demo's own way (left), on time and one fully clamped tick late", () => {
    for (const lag of [{ releaseLagSteps: 0 }, RELEASE_LAG]) {
      const out = simulateStreetWalk(streetSubwayApproachRoute(streetWalkInputs()), lag);
      const onTreads = out.find((c) => c.label === "onto-the-subway-treads-row")?.state;
      const landed = out[out.length - 1]?.state;
      if (!onTreads || !landed) throw new Error("the subway approach produced no checkpoints");
      expect(onTreads.cellY).toBe(STAIRS_Y);
      expect(landed.floor).toBe(SUBWAY_FLOOR);
      expect(landed.cellY).toBe(PLATFORM_LANDING_Y);
    }
  });
});

// Story 15.2 (Quentin's direction): the class of defect a demo watch found
// -- collision geometry nothing draws, and drawn geometry nothing collides
// -- checked generically over the whole committed fixture, never by
// hand-editing the six reported coordinates.
describe("collision/silhouette conformance (FR117, FR128)", () => {
  const world = streetWorldIndex();
  const sources = streetObjectSources();

  /** The one `STREET_BOUNDARY` rect allowed a sub-cell `collider`: the
   * footbridge's own south rail, floor 1. A walker pressed against a
   * whole-cell rail would rest exactly on the deck row's southern
   * boundary, which `Math.floor` reads as the row past it -- where the
   * stairs down are not. */
  const BRIDGE_SOUTH_RAIL_ID = 110n;

  /** Furniture-layer asset rows drawn with no collider, each with its
   * reason. Nothing lands here by default. */
  const UNCOLLIDED_FURNITURE: ReadonlyMap<bigint, string> = new Map([
    [36n, "a produce basket on the floor, small enough to step around -- decoration"],
  ]);

  it("(a) no undrawn collider: every collider cell belongs to a real, drawn prop's own footprint, or to the STREET_BOUNDARY ring", () => {
    const boundaryIds = new Set(STREET_BOUNDARY.map((r) => r.id));
    const failures: string[] = [];
    const xs = [...STREET_PROPS.map((p) => p.x), ...STREET_BOUNDARY.map((r) => r.x)];
    const ys = [...STREET_PROPS.map((p) => p.y), ...STREET_BOUNDARY.map((r) => r.y)];
    const floors = new Set([
      ...STREET_PROPS.map((p) => p.floor),
      ...STREET_BOUNDARY.map((r) => r.floor ?? PLAYER_START.floor),
    ]);
    // Wide enough that every collider is fully inside the scanned window.
    const margin = 12;
    const x0 = Math.min(...xs) - margin;
    const x1 = Math.max(...xs) + margin;
    const y0 = Math.min(...ys) - margin;
    const y1 = Math.max(...ys) + margin;
    for (const floor of floors) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          for (const entry of world.entriesInCell(floor, x, y)) {
            if (boundaryIds.has(entry.objectId)) continue;
            const prop = STREET_PROPS.find((p) => p.id === entry.objectId);
            if (!prop) {
              failures.push(
                `collider at (${x}, ${y}, floor ${floor}) names no real prop or boundary id ${entry.objectId}`,
              );
              continue;
            }
            const defId = isDefStreetProp(prop) ? prop.defId : streetDefId(prop.id);
            const footprint = sources.get(defId) ?? { width: 1, height: 1 };
            const covered = footprintCells(prop.x, prop.y, footprint).some(
              (c) => c.x === x && c.y === y,
            );
            if (!covered) {
              failures.push(
                `prop ${prop.id}'s own collider (object ${entry.objectId}) reaches (${x}, ${y}, floor ${floor}), outside its own drawn footprint`,
              );
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("STREET_BOUNDARY is only the undrawn ring: no rect carries a collider (bar the bridge's south rail, by id), and every cell lies outside every drawn ground pass on its floor", () => {
    const failures: string[] = [];
    expect(STREET_BOUNDARY.some((rect) => rect.id === BRIDGE_SOUTH_RAIL_ID)).toBe(true);
    for (const rect of STREET_BOUNDARY) {
      if (rect.collider && rect.id !== BRIDGE_SOUTH_RAIL_ID) {
        failures.push(`boundary id ${rect.id} carries its own collider -- the ring is whole cells`);
      }
      const floor = rect.floor ?? PLAYER_START.floor;
      for (let dy = 0; dy < rect.height; dy++) {
        for (let dx = 0; dx < rect.width; dx++) {
          const cx = rect.x + dx;
          const cy = rect.y - rect.height + 1 + dy;
          for (const tiles of STREET_GROUND_TILES) {
            if (tiles.floor !== floor) continue;
            if (cx >= tiles.x0 && cx < tiles.x1 && cy >= tiles.y0 && cy < tiles.y1) {
              failures.push(
                `boundary id ${rect.id}'s own cell (${cx}, ${cy}) overlaps drawn ground-tile group '${tiles.assetKey}' -- looks walkable, is not`,
              );
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("(b) no uncollided solid: every walls-layer, furniture-layer or solid row rasterises a real collider in its own footprint, and blocks the whole footprint unless it declares its own collider shape", () => {
    const failures: string[] = [];
    for (const [id] of UNCOLLIDED_FURNITURE) {
      const prop = STREET_PROPS.find((p) => p.id === id);
      if (prop?.layer !== "furniture" || isDefStreetProp(prop) || prop.solid) {
        failures.push(
          `UNCOLLIDED_FURNITURE lists ${id}, which is not an uncollided furniture asset row`,
        );
      }
    }
    for (const prop of STREET_PROPS) {
      const inScope = prop.layer === "walls" || prop.layer === "furniture" || prop.solid === true;
      if (!inScope || UNCOLLIDED_FURNITURE.has(prop.id)) continue;
      const defId = isDefStreetProp(prop) ? prop.defId : streetDefId(prop.id);
      const source = sources.get(defId);
      if (!source) {
        failures.push(
          `prop ${prop.id} (layer '${prop.layer}') has no collider source -- give it one, or list it in UNCOLLIDED_FURNITURE with a reason`,
        );
        continue;
      }
      const cells = footprintCells(prop.x, prop.y, source);
      const collidedCells = cells.filter((cell) =>
        world.entriesInCell(prop.floor, cell.x, cell.y).some((entry) => entry.objectId === prop.id),
      );
      if (collidedCells.length === 0) {
        failures.push(
          `prop ${prop.id} (layer '${prop.layer}'${prop.solid ? ", solid" : ""}) draws a whole footprint at floor ${prop.floor} with no collider anywhere in it`,
        );
        continue;
      }
      // A row declaring its own collider shape (a bollard's post) is
      // held to that shape by the tests below.
      const hasCustomShape = !isDefStreetProp(prop) && prop.collider !== undefined;
      if (!hasCustomShape && collidedCells.length !== cells.length) {
        failures.push(
          `prop ${prop.id} (layer '${prop.layer}'${prop.solid ? ", solid" : ""}) draws over ${cells.length} cell(s) at floor ${prop.floor} but only ${collidedCells.length} collide, with no collider shape declared`,
        );
      }
    }
    expect(failures).toEqual([]);
  });
});

// Story 15.2 (Quentin's direction, AC): the six demo-watch cases, pinned
// as scripted unit walks against the real resolver -- each drives
// `stepAndTransition`/`step` from a named open cell toward the named
// object and asserts the *exact* rest position, derived from the real
// def's own collider and `footprintOrigin`, never a literal. If a future
// edit narrows a collider, widens a footprint, or moves a prop, the
// derived expectation moves with it and only a real regression goes red.
describe("the six collision/transition regressions this story fixes (AC)", () => {
  const world = streetWorldIndex();
  const config = streetMovementConfig();
  const sources = streetObjectSources();
  const halfWidthCells = config.bodyWidthSubcells / 2 / config.subcellsPerCell;
  const bodyHeightCells = config.bodyHeightSubcells / config.subcellsPerCell;

  /** The absolute, whole-cell-unit collider rect a real prop's own def
   * declares, translated by `footprintOrigin` -- never a literal restated
   * here. Throws naming the prop if it declares no collider at all. */
  function propColliderRect(prop: (typeof STREET_PROPS)[number]) {
    const defId = isDefStreetProp(prop) ? prop.defId : streetDefId(prop.id);
    const source = sources.get(defId);
    if (!source?.collider) {
      throw new Error(`propColliderRect: prop ${prop.id} (defId ${defId}) has no collider`);
    }
    const origin = footprintOrigin(prop.x, prop.y, source);
    const subcells = config.subcellsPerCell;
    return {
      x0: origin.x + source.collider.x0 / subcells,
      y0: origin.y + source.collider.y0 / subcells,
      x1: origin.x + source.collider.x1 / subcells,
      y1: origin.y + source.collider.y1 / subcells,
    };
  }

  /** Walks `start` toward `direction` against the real collision grid
   * until movement stops changing the position at all -- a rest, proven
   * to be one by construction (unlike a fixed step count, this cannot
   * mistake "still approaching" for "arrived"). */
  function walkToRest(
    start: { readonly x: number; readonly y: number },
    direction: { readonly x: number; readonly y: number },
    floor: number,
  ): { readonly x: number; readonly y: number } {
    let pos = start;
    for (let i = 0; i < 1000; i++) {
      const next = step(pos, direction, 16, world, floor, config);
      if (next.x === pos.x && next.y === pos.y) return next;
      pos = next;
    }
    throw new Error(
      `walkToRest: never settled from (${start.x}, ${start.y}) toward ${JSON.stringify(direction)}`,
    );
  }

  it("1. the shelf room's own shelf and north wall each stop movement exactly at their own face, never before it", () => {
    const wall = STREET_PROPS.find((p) => p.id === 30n); // shop B's own north wall
    const shelf = STREET_PROPS.find((p) => p.id === 35n); // shop B's own shelf
    if (!wall || !shelf) throw new Error("no prop with id 30 (north wall) or 35 (shelf)");
    const shelfRect = propColliderRect(shelf);
    const wallRect = propColliderRect(wall);
    // Straight at the shelf, from the room's own south row.
    const intoShelf = walkToRest(
      { x: (shelfRect.x0 + shelfRect.x1) / 2, y: wall.y + 4 },
      { x: 0, y: -1 },
      shelf.floor,
    );
    expect(intoShelf.y).toBeCloseTo(shelfRect.y1 + bodyHeightCells, 9);
    // Clear of the shelf, straight at the wall.
    const intoWall = walkToRest(
      { x: shelfRect.x1 + halfWidthCells + 0.5, y: wall.y + 4 },
      { x: 0, y: -1 },
      wall.floor,
    );
    expect(intoWall.y).toBeCloseTo(wallRect.y1 + bodyHeightCells, 9);
  });

  it("1b. shop A's own table stops movement at its own drawn edge", () => {
    const table = STREET_PROPS.find((p) => p.id === 9n);
    if (!table) throw new Error("no prop with id 9 (the table)");
    const rect = propColliderRect(table);
    // Straight south at the table, from the row north of it.
    const fromNorth = walkToRest(
      { x: (rect.x0 + rect.x1) / 2, y: rect.y0 - 1 },
      { x: 0, y: 1 },
      table.floor,
    );
    expect(fromNorth.y).toBeCloseTo(rect.y0, 9);
  });

  it("2. the trash bin's own small base collider stops movement on its real west and south faces -- never an unrelated invisible collider nearby", () => {
    // Two cardinal approaches, not one diagonal: per-axis sliding
    // resolution rests an axis the instant it only *touches* a face
    // (`docs/architecture.md`'s "touching is not blocked"), so a single
    // diagonal walk that reaches one face first then slides past the
    // second, exactly the corner a real player could round the same way.
    // Each cardinal approach below still proves the same real collider.
    const bin = STREET_PROPS.find((p) => isDefStreetProp(p) && p.defId === TRASH_BIN_DEF_ID);
    if (!bin) throw new Error("no trash_bin-defId prop in STREET_PROPS");
    const rect = propColliderRect(bin);
    const fromWest = walkToRest({ x: bin.x - 1, y: bin.y + 0.5 }, { x: 1, y: 0 }, bin.floor);
    expect(fromWest.x).toBeCloseTo(rect.x0 - halfWidthCells, 9);
    const fromSouth = walkToRest(
      { x: bin.x + 0.5, y: rect.y1 + bodyHeightCells + 0.5 },
      { x: 0, y: -1 },
      bin.floor,
    );
    expect(fromSouth.y).toBeCloseTo(rect.y1 + bodyHeightCells, 9);
  });

  it("3. the shopfront window's own collider spans its full declared width -- never narrower than the glass it draws", () => {
    const defs = committedDefs();
    const window = defs.objects.find((o) => o.id === WINDOW_DEF_ID);
    if (!window?.collider) throw new Error("shop_window has no collider in defs.json");
    // The reported "no collision on the right side" shape, checked at the
    // data level: a collider narrower than the def's own width would
    // leave a real, walkable gap this assertion catches by name.
    expect(window.collider.x0).toBe(0);
    expect(window.collider.x1).toBe(window.width * defs.colliderSubcellsPerCell);
    // And the same fact proven by a real walk: approaching from outside
    // (south), straight into the window's own row, stops exactly at its
    // southern face.
    const windowProp = STREET_PROPS.find(
      (p) => isDefStreetProp(p) && p.defId === WINDOW_DEF_ID && p.id === 32n,
    );
    if (!windowProp) throw new Error("no shop_window-defId prop with id 32 in STREET_PROPS");
    const rect = propColliderRect(windowProp);
    const rest = walkToRest(
      { x: windowProp.x + 1, y: windowProp.y + 3 },
      { x: 0, y: -1 },
      windowProp.floor,
    );
    expect(rest.y).toBeCloseTo(rect.y1 + bodyHeightCells, 9);
  });

  it("4. a plain wall segment's own collider spans its full cell -- never clipped through from either side", () => {
    const pier = STREET_PROPS.find((p) => p.id === 41n); // shop B's own east corner pier
    if (!pier) throw new Error("no prop with id 41 (shop B's east corner pier)");
    const rect = propColliderRect(pier);
    // The reported "clipped through more than halfway from its right
    // side" shape: a real approach from the east (the open pavement past
    // the corner) must stop at the wall's own east face, not partway in.
    const rest = walkToRest({ x: pier.x + 2, y: pier.y + 0.5 }, { x: -1, y: 0 }, pier.floor);
    expect(rest.x).toBeCloseTo(rect.x1 + halfWidthCells, 9);
    expect(rect.x1 - rect.x0).toBeCloseTo(1, 9); // the whole cell, not half of it
  });

  it("5. the subway stairwell's own opening is enterable from exactly one side: a step from each of its three other neighbours is refused by the grid, and the entry side is not (Quentin's finding 1)", () => {
    for (const { anchor, open } of subwayAnchors()) {
      const { floor } = anchor;
      // The entry side: walking from the open neighbour's own centre,
      // toward the anchor, actually reaches it.
      const entered = walkToRest(
        { x: open.cell.x + 0.5, y: open.cell.y + 0.5 },
        open.direction,
        floor,
      );
      expect(
        cellOf(entered.x) === anchor.x && cellOf(entered.y) === anchor.y,
        `entering ${JSON.stringify(anchor)} from its own open side ${JSON.stringify(open.cell)} was refused -- ended at (${entered.x}, ${entered.y})`,
      ).toBe(true);

      for (const blocked of blockedNeighborsOf(anchor, open.direction)) {
        // The neighbour cannot be stood in on its edge facing the anchor
        // (a railing standing at its foot leaves the cell's far part open,
        // so only that edge is the opening)...
        expect(
          isCellStandableAgainst(world, config, blocked, anchor, floor),
          `${JSON.stringify(anchor)}'s own non-entry neighbour ${JSON.stringify(blocked)} is standable`,
        ).toBe(false);
        // ...and a walk toward the anchor through it, from the nearest
        // standable cell beyond it, never arrives. (Never from inside a
        // collider: the resolver lets a body already overlapping one walk
        // straight out of it.)
        const direction = { x: anchor.x - blocked.x, y: anchor.y - blocked.y };
        let from = { x: blocked.x - direction.x, y: blocked.y - direction.y };
        for (let i = 0; i < 8 && !isCellStandable(world, config, from.x, from.y, floor); i++) {
          from = { x: from.x - direction.x, y: from.y - direction.y };
        }
        expect(isCellStandable(world, config, from.x, from.y, floor)).toBe(true);
        const result = walkToRest({ x: from.x + 0.5, y: from.y + 0.5 }, direction, floor);
        expect(
          cellOf(result.x) === anchor.x && cellOf(result.y) === anchor.y,
          `entering ${JSON.stringify(anchor)} via its own non-entry neighbour ${JSON.stringify(blocked)} was NOT refused -- ended at (${result.x}, ${result.y})`,
        ).toBe(false);
      }
    }
  });

  it("5b. each subway stairwell's own drawn footprint is solid everywhere but its tread path: every cell off it that is fully solid refuses a standing body, every tread from the opening to the anchor accepts one, and no body in an off-path cell's open part reaches a tread except through the opening (Quentin's finding 2)", () => {
    const failures: string[] = [];
    const s = config.subcellsPerCell;
    const half = config.bodyWidthSubcells / 2;
    const bodyH = config.bodyHeightSubcells;
    /** A body wholly inside `cell` and clear of every collider exists. */
    const hasOpenPart = (cell: Cell, floor: number) => {
      for (let cx = cell.x * s + half; cx <= (cell.x + 1) * s - half; cx++) {
        for (let feet = cell.y * s + bodyH; feet <= (cell.y + 1) * s; feet++) {
          if (isBodyClear(world, config, floor, cx, feet)) return true;
        }
      }
      return false;
    };
    for (const { anchor, open } of subwayAnchors()) {
      const rows = stairwellRowsAt(anchor);
      if (rows.length === 0) {
        failures.push(`no stairs-tagged row covers the anchor ${JSON.stringify(anchor)}`);
        continue;
      }
      const { cells, path, entry } = treadPath(rows, anchor, open.direction);
      expect(path.length).toBeGreaterThanOrEqual(2); // the anchor and a landing
      expect(cells.length).toBeGreaterThan(path.length); // at least one off-path cell
      const inPath = (c: Cell) => path.some((p) => p.x === c.x && p.y === c.y);
      const partial: Cell[] = [];
      for (const cell of cells) {
        const onPath = inPath(cell);
        const standable = isCellStandable(world, config, cell.x, cell.y, anchor.floor);
        if (!onPath && hasOpenPart(cell, anchor.floor)) {
          partial.push(cell);
        } else if (standable !== onPath) {
          failures.push(
            `the stairwell's own cell (${cell.x}, ${cell.y}, floor ${anchor.floor}) is ${standable ? "standable" : "not standable"} but ${onPath ? "is" : "is not"} on the tread path`,
          );
        }
      }
      if (partial.length === 0) continue;
      // Partly open cells: flood the body's position (sub-cell lattice) from
      // every standable cell around the footprint, the opening shut, and
      // require that no tread is ever reached.
      const xs = cells.map((c) => c.x);
      const ys = cells.map((c) => c.y);
      const pad = 3;
      const win = {
        x0: (Math.min(...xs) - pad) * s,
        x1: (Math.max(...xs) + 1 + pad) * s,
        y0: (Math.min(...ys) - pad) * s,
        y1: (Math.max(...ys) + 1 + pad) * s,
      };
      const overlapsEntry = (cx: number, feet: number) =>
        cx + half > entry.x * s &&
        cx - half < (entry.x + 1) * s &&
        feet > entry.y * s &&
        feet - bodyH < (entry.y + 1) * s;
      const free = (cx: number, feet: number) =>
        cx - half >= win.x0 &&
        cx + half <= win.x1 &&
        feet - bodyH >= win.y0 &&
        feet <= win.y1 &&
        !overlapsEntry(cx, feet) &&
        isBodyClear(world, config, anchor.floor, cx, feet);
      const onTread = (cx: number, feet: number) =>
        inPath({ x: Math.floor(cx / s), y: Math.floor((feet - bodyH / 2) / s) });
      const key = (cx: number, feet: number) => `${cx},${feet}`;
      const seen = new Set<string>();
      const queue: [number, number][] = [];
      const boxXs = [Math.min(...xs) - 1, Math.max(...xs) + 1];
      const boxYs = [Math.min(...ys) - 1, Math.max(...ys) + 1];
      for (let cy = boxYs[0] as number; cy <= (boxYs[1] as number); cy++) {
        for (let cx = boxXs[0] as number; cx <= (boxXs[1] as number); cx++) {
          if (cells.some((c) => c.x === cx && c.y === cy)) continue;
          if (
            isCellStandable(world, config, cx, cy, anchor.floor) &&
            free((cx + 0.5) * s, (cy + 0.5) * s)
          ) {
            queue.push([(cx + 0.5) * s, (cy + 0.5) * s]);
            seen.add(key((cx + 0.5) * s, (cy + 0.5) * s));
          }
        }
      }
      expect(queue.length).toBeGreaterThan(0);
      let leak: string | undefined;
      while (queue.length > 0 && !leak) {
        const [cx, feet] = queue.pop() as [number, number];
        if (onTread(cx, feet)) {
          leak = `a body reaches the tread (${cx / s}, ${feet / s}) without the opening`;
          break;
        }
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const next: [number, number] = [cx + dx, feet + dy];
          const k = key(...next);
          if (!seen.has(k) && free(...next)) {
            seen.add(k);
            queue.push(next);
          }
        }
      }
      if (leak) failures.push(`stairwell at floor ${anchor.floor}: ${leak}`);
    }
    expect(failures).toEqual([]);
  });

  it("5b'. the fixture's exported stairwell groups are exactly the stairs-tagged rows read from the defs", () => {
    const ids = (rows: readonly { readonly id: bigint }[]) => rows.map((r) => r.id).sort();
    const found = subwayAnchors().map(({ anchor }) => ({
      floor: anchor.floor,
      ids: ids(stairwellRowsAt(anchor)),
    }));
    expect(found.find((f) => f.floor === SUBWAY_FLOOR)?.ids).toEqual(ids(PLATFORM_STAIRWELL_ROWS));
    expect(found.find((f) => f.floor === PLAYER_START.floor)?.ids).toEqual(
      ids(STREET_STAIRWELL_ROWS),
    );
  });

  it("5c. the finial row north of the street stairwell's top railing is open floor: its three cells are standable", () => {
    const top = STREET_STAIRWELL_ROWS.find(
      (p) => objectDef(p.defId).key === "stairwell_top_railing",
    );
    if (!top) throw new Error("the street stairwell has no top railing row");
    const width = sources.get(top.defId)?.width ?? 0;
    expect(width).toBe(3);
    for (let dx = 0; dx < width; dx++) {
      expect(
        isCellStandable(world, config, top.x + dx, top.y - 1, top.floor),
        `the finial cell (${top.x + dx}, ${top.y - 1}, floor ${top.floor}) is not standable`,
      ).toBe(true);
    }
    // The platform flight has no finial row.
    expect(
      PLATFORM_STAIRWELL_ROWS.some((p) => objectDef(p.defId).key === "stairwell_top_railing"),
    ).toBe(false);
  });

  it("5c'. walking south from each finial cell rests the body's bottom edge exactly on the top railing's collider north face -- strictly south of the cell's north edge, never the full cell", () => {
    const { prop, rect, width } = topRailingFoot();
    for (let dx = 0; dx < width; dx++) {
      const rest = walkToRest(
        { x: prop.x + dx + 0.5, y: prop.y - 0.5 },
        { x: 0, y: 1 },
        prop.floor,
      );
      expect(rest.y).toBeCloseTo(rect.y0, 9);
      expect(rest.y).toBeGreaterThan(prop.y + 1e-9);
    }
  });

  it("5c''. walking south at every sub-cell x across the top railing and half a body past each end never puts the body in the tread row", () => {
    const { prop, rect } = topRailingFoot();
    const s = config.subcellsPerCell;
    const startFeet = (prop.y - 0.5) * s;
    // Strictly inside the touching positions on the east: a body that only
    // touches the east end stands in the open entrance column, which is the
    // opening. The west bound is the first position whose start is clear:
    // the ring's cell west of the well reaches into the finial row, and a
    // walk never starts inside a collider (the resolver lets such a body
    // walk straight out).
    let sx = rect.x0 * s - halfWidthCells * s + 1;
    while (!isBodyClear(world, config, prop.floor, sx, startFeet)) sx++;
    const failures: string[] = [];
    for (; sx < rect.x1 * s + halfWidthCells * s; sx++) {
      expect(
        isBodyClear(world, config, prop.floor, sx, startFeet),
        `the start at sub-cell x ${sx} is inside a collider`,
      ).toBe(true);
      const rest = walkToRest({ x: sx / s, y: startFeet / s }, { x: 0, y: 1 }, prop.floor);
      if (rest.y > rect.y0 + 1e-9 || cellOf(rest.y - 1e-9) >= STAIRS_Y) {
        failures.push(`x ${sx / s}: rested at y ${rest.y}`);
      }
    }
    expect(failures).toEqual([]);
  });

  const platformAnchor = () => {
    const found = subwayAnchors().find(({ anchor }) => anchor.floor === SUBWAY_FLOOR);
    if (!found) throw new Error("no platform anchor");
    return found;
  };

  it("5d. the platform anchor's refused neighbours are each closed by a drawn prop, never an invisible blocker", () => {
    const { anchor, open } = platformAnchor();
    for (const blocked of blockedNeighborsOf(anchor, open.direction)) {
      const closers = STREET_PROPS.filter(
        (p) =>
          p.floor === SUBWAY_FLOOR &&
          coversCell(p, blocked) &&
          objectSources.get(isDefStreetProp(p) ? p.defId : streetDefId(p.id))?.collider,
      );
      expect(
        closers.length,
        `(${blocked.x}, ${blocked.y}) is closed by no placed prop with a collider`,
      ).toBeGreaterThan(0);
    }
    expect(STREET_BOUNDARY.some((r) => (r.floor ?? PLAYER_START.floor) === SUBWAY_FLOOR)).toBe(
      false,
    );
  });

  it("5e. the platform's entry cell, one past the flight along the climb, is open floor: standable and covered by no placed prop", () => {
    const { anchor, open } = platformAnchor();
    const { entry } = treadPath(stairwellRowsAt(anchor), anchor, open.direction);
    expect(isCellStandable(world, config, entry.x, entry.y, SUBWAY_FLOOR)).toBe(true);
    expect(
      STREET_PROPS.filter((p) => p.floor === SUBWAY_FLOOR && coversCell(p, entry)).map((p) => p.id),
    ).toEqual([]);
  });

  it("5f. the re-laid platform has no sealed pocket and no invisible dead cell: every standable interior cell is reachable from the landing, every other is under a drawn prop", () => {
    const interior: Cell[] = [];
    for (let y = PLATFORM_INTERIOR_Y0; y <= PLATFORM_INTERIOR_Y1; y++) {
      for (let x = PLATFORM_INTERIOR_X0; x <= PLATFORM_INTERIOR_X1; x++) interior.push({ x, y });
    }
    const standable = (c: Cell) => isCellStandable(world, config, c.x, c.y, SUBWAY_FLOOR);
    const key = (c: Cell) => `${c.x},${c.y}`;
    const reached = new Set<string>();
    const queue: Cell[] = [{ x: PLATFORM_LANDING_X, y: PLATFORM_LANDING_Y }];
    while (queue.length > 0) {
      const c = queue.pop() as Cell;
      if (reached.has(key(c)) || !interior.some((i) => key(i) === key(c)) || !standable(c))
        continue;
      reached.add(key(c));
      queue.push(
        { x: c.x + 1, y: c.y },
        { x: c.x - 1, y: c.y },
        { x: c.x, y: c.y + 1 },
        { x: c.x, y: c.y - 1 },
      );
    }
    const failures: string[] = [];
    for (const c of interior) {
      if (standable(c)) {
        if (!reached.has(key(c))) failures.push(`(${c.x}, ${c.y}) is standable but sealed off`);
      } else if (!STREET_PROPS.some((p) => p.floor === SUBWAY_FLOOR && coversCell(p, c))) {
        failures.push(`(${c.x}, ${c.y}) is not standable but no placed prop covers it`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("5g. nothing y-sorted is drawn on either stairwell's tread path or entry cell -- the player never walks through something drawn over them", () => {
    const failures: string[] = [];
    for (const { anchor, open } of subwayAnchors()) {
      const { path, entry } = treadPath(stairwellRowsAt(anchor), anchor, open.direction);
      for (const p of STREET_PROPS) {
        if (p.floor !== anchor.floor) continue;
        if (passOfLayer(layerCodeByName(p.layer)) !== "pool") continue;
        for (const c of [...path, entry]) {
          if (coversCell(p, c)) {
            failures.push(`pool-layer prop ${p.id} covers (${c.x}, ${c.y}, floor ${anchor.floor})`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("6. the subway transition pair is a real mirror: down the demo's own way (left), then the reverse input (right), lands back on the street treads -- never a detour through an unrelated direction", () => {
    const transitions = streetTransitionIndex();
    // The issue's own literal report: "descended by walking left" -- from
    // the entrance, holding ArrowLeft along the tread row.
    let down: FloorWalkResult = {
      ...initialFloorWalkState(SUBWAY_ENTRANCE_X0 + 0.5, STAIRS_Y + 0.5, PLAYER_START.floor),
      transitioned: false,
    };
    for (let i = 0; i < 200 && !down.transitioned; i++) {
      down = stepAndTransition(down, STAIRS_ENTRY_DIRECTION, 16, world, config, transitions);
    }
    expect(down.floor).toBe(SUBWAY_FLOOR);
    expect(down.cellX).toBe(PLATFORM_LANDING_X);
    expect(down.cellY).toBe(PLATFORM_LANDING_Y);

    // The reverse input (ArrowRight): straight back up.
    let up: FloorWalkResult = { ...down, transitioned: false };
    const reverseDirection = { x: -STAIRS_ENTRY_DIRECTION.x, y: -STAIRS_ENTRY_DIRECTION.y };
    for (let i = 0; i < 200 && !up.transitioned; i++) {
      up = stepAndTransition(up, reverseDirection, 16, world, config, transitions);
    }
    expect(up.floor).toBe(PLAYER_START.floor);
    expect(up.cellX).toBe(STREET_EXIT_X);
    expect(up.cellY).toBe(STREET_EXIT_Y);
  });
});

// Story 15.4 (Quentin's direction, AC4): a regression walk over the
// pavement bollard (`id: 121`) that sits west of the shopfront, off every
// scripted walk's own path -- so this walk is the first thing that ever
// collides with it. Unlike the 15.2 walks above (which compare `walk.y`
// to a rest computed in sub-cells -- body against collider, the units the
// scene's own render offset never touched), every assertion below runs
// the rest through *drawn pixels*: the same `worldPointPx` `scene.ts`'s
// `positionSprite` draws the player with, and the same `subcellRectPx`
// the FR165 overlay draws a collider with. This module never mounts
// `scene.ts` itself (`client/tests/unit/**`'s own coverage boundary), and
// both sides of every assertion below go through the same two pure
// projections, so it cannot independently prove master's cell-anchored
// placement was wrong -- that is what the two e2e cases are for
// (`debug-overlays.spec.ts`'s player-body-on-sprite check and this
// story's own AC4 case in `test-street.spec.ts`, both of which compare
// the real, mounted Pixi sprite to a collider). What this walk pins,
// against the real committed street: the resolver's own body and the
// drawn collider agree to the pixel from four different approach
// columns, so a future drift in either can never pass silently again.
describe("the bollard west of the shopfront stops the player where it is drawn (AC1, AC4)", () => {
  const config = streetMovementConfig();
  const world = streetWorldIndex();
  const floor = 0;
  const tileSizePx = committedDefs().balance.find((b) => b.key === "render.tile_size_px")?.value;
  const storeyHeightPx = committedDefs().balance.find(
    (b) => b.key === "render.storey_height_px",
  )?.value;
  if (tileSizePx === undefined || storeyHeightPx === undefined) {
    throw new Error("missing render balance keys");
  }

  const bollardProp = STREET_PROPS.find((p) => p.id === 121n);
  if (!bollardProp || isDefStreetProp(bollardProp) || !bollardProp.collider) {
    throw new Error("fixture no longer places the west-of-shopfront bollard (id 121)");
  }
  // Captured into its own, definitely-defined binding (never `bollardProp`
  // itself) so every closure below -- `walkNorth`, each `it` -- reads a
  // type TypeScript can prove non-optional, rather than re-narrowing a
  // `const` across a function boundary it cannot see into.
  const bollard = { x: bollardProp.x, y: bollardProp.y, floor: bollardProp.floor };
  // A 1x1, undecomposed `assetKey` prop: its own anchor cell *is* its
  // collider's north-west sub-cell origin, no `footprintOrigin` needed.
  const colliderX0Cells = bollard.x + BOLLARD_COLLIDER.x0 / config.subcellsPerCell;
  const colliderX1Cells = bollard.x + BOLLARD_COLLIDER.x1 / config.subcellsPerCell;
  const colliderCentreCells = (colliderX0Cells + colliderX1Cells) / 2;
  const halfWidthCells = config.bodyWidthSubcells / 2 / config.subcellsPerCell;
  const oneSubcellCells = 1 / config.subcellsPerCell;

  // Four columns, walking straight north (never moving in x) at each:
  // squarely overlapping the post's own west half, its east half, exactly
  // touching its west face (half-open: clears it), and one sub-cell
  // further east than that (now overlaps, blocked).
  const touchingClears = colliderX0Cells - halfWidthCells;
  const columns = {
    westHalf: (colliderX0Cells + colliderCentreCells) / 2,
    eastHalf: (colliderCentreCells + colliderX1Cells) / 2,
    touchingClears,
    oneSubcellBlocked: touchingClears + oneSubcellCells,
  };

  /** Starts south of the bollard's own row (clear of the world's south
   * boundary ring further south, and of the next real collider further
   * north -- probed against the real committed street) and walks north
   * (`ArrowUp`) at fixed `x` for up to `maxSteps` of `MAX_DELTA_MS` each,
   * the same release-lag-tolerant discipline the walks above use: a body
   * already at rest keeps returning the same position, so a few extra
   * steps past convergence can never move it further. */
  function walkNorth(x: number): { x: number; y: number } {
    const startY = bollard.y + 1.7;
    let pos = { x, y: startY };
    const maxSteps = 300;
    for (let i = 0; i < maxSteps; i++) {
      pos = step(pos, { x: 0, y: -1 }, MAX_DELTA_MS, world, floor, config);
    }
    return pos;
  }

  // The collider's own absolute sub-cell rect, built directly from its
  // anchor cell the way `collision-rects.ts` and the e2e case do -- never
  // by handing `worldPointPx` a cell and translating by the result. That
  // would pass a cell straight into the one function this story's own
  // doc comment says never takes one; `subcellRectPx` is the one place a
  // sub-cell coordinate (never a cell) becomes a pixel.
  const colliderSub = {
    x0: bollard.x * config.subcellsPerCell + BOLLARD_COLLIDER.x0,
    y0: bollard.y * config.subcellsPerCell + BOLLARD_COLLIDER.y0,
    x1: bollard.x * config.subcellsPerCell + BOLLARD_COLLIDER.x1,
    y1: bollard.y * config.subcellsPerCell + BOLLARD_COLLIDER.y1,
  };
  const colliderDrawn = subcellRectPx(
    colliderSub,
    floor,
    config.subcellsPerCell,
    tileSizePx,
    storeyHeightPx,
  );
  const colliderSouthFacePx = colliderDrawn.y + colliderDrawn.height;

  for (const [label, x] of Object.entries({
    westHalf: columns.westHalf,
    eastHalf: columns.eastHalf,
  }) as [string, number][]) {
    it(`stops flush against the post's drawn base, off-centre from the ${label}`, () => {
      const rest = walkNorth(x);
      const restDrawn = worldPointPx(rest.x, rest.y, floor, tileSizePx, storeyHeightPx, 1);
      // The drawn feet's bottom edge sits exactly `bodyHeightSubcells`
      // south of the post's own drawn base (`world/movement.ts`'s own
      // asymmetric north-approach extent, `onUnderpassRowY`'s established
      // idiom) -- never the offset this story fixes, which was a whole
      // extra tile.
      const bodyHeightPx = (config.bodyHeightSubcells / config.subcellsPerCell) * tileSizePx;
      expect(restDrawn.y).toBeCloseTo(colliderSouthFacePx + bodyHeightPx, 6);
      // Never a blocked span over visibly empty ground: the drawn feet's
      // own x sits inside the post's drawn base widened by half the
      // body's own width on each side.
      const bodyDrawn = subcellRectPx(
        bodyRect({ x: rest.x, y: rest.y }, config),
        floor,
        config.subcellsPerCell,
        tileSizePx,
        storeyHeightPx,
      );
      expect(bodyDrawn.x).toBeGreaterThanOrEqual(colliderDrawn.x - tileSizePx / 2);
      expect(bodyDrawn.x + bodyDrawn.width).toBeLessThanOrEqual(
        colliderDrawn.x + colliderDrawn.width + tileSizePx / 2,
      );
    });
  }

  /** Walks along the post's own mid row, `dir` = -1 (west) or +1 (east),
   * from `startX`, for up to 300 clamped steps. */
  function walkAlongRow(startX: number, dir: -1 | 1): { x: number; y: number } {
    let pos = { x: startX, y: bollard.y + 0.5 };
    for (let i = 0; i < 300; i++) {
      pos = step(pos, { x: dir, y: 0 }, MAX_DELTA_MS, world, floor, config);
    }
    return pos;
  }

  it("rests on the post's own west face, exactly, walking east into it from open pavement", () => {
    const rest = walkAlongRow(colliderX0Cells - 0.5, 1);
    expect(rest.x * config.subcellsPerCell).toBe(colliderSub.x0 - config.bodyWidthSubcells / 2);
    expect(rest.y).toBe(bollard.y + 0.5);
  });

  it("rests on the post's own east face, exactly, walking west into it from open pavement", () => {
    const rest = walkAlongRow(colliderX1Cells + 0.5, -1);
    expect(rest.x * config.subcellsPerCell).toBe(colliderSub.x1 + config.bodyWidthSubcells / 2);
    expect(rest.y).toBe(bollard.y + 0.5);
  });

  it("clears the post when the body's own east edge only just touches its west face (half-open)", () => {
    const colliderY0Cells = bollard.y + BOLLARD_COLLIDER.y0 / config.subcellsPerCell;
    const rest = walkNorth(columns.touchingClears);
    // Unblocked by this post: ends up north of its own drawn base,
    // whatever else it eventually rests against further along.
    expect(rest.y).toBeLessThan(colliderY0Cells);
  });

  it("blocks one sub-cell further east than that -- the offset this story's AC4 exists to catch", () => {
    const rest = walkNorth(columns.oneSubcellBlocked);
    const restDrawn = worldPointPx(rest.x, rest.y, floor, tileSizePx, storeyHeightPx, 1);
    const bodyHeightPx = (config.bodyHeightSubcells / config.subcellsPerCell) * tileSizePx;
    expect(restDrawn.y).toBeCloseTo(colliderSouthFacePx + bodyHeightPx, 6);
  });
});

// Story 15.3 (Quentin's finding 2, narrowed): `tools/defs-build` checks
// every `defId` row's art against its collider and footprint. This is the
// fixture-level half for the `assetKey` rows that still bypass it, held to
// a named list that can shrink and never grow.
describe("silhouette agreement: a solid or walls-layer assetKey row's own declared footprint matches its real art dimensions in tiles (FR126, Quentin's finding 2)", () => {
  const TILE_SIZE_PX = committedDefs().balance.find((b) => b.key === "render.tile_size_px")?.value;
  if (TILE_SIZE_PX === undefined) {
    throw new Error("render.tile_size_px missing from the committed defs.json");
  }

  /** Every `solid` or `walls`-layer `assetKey` row's key that still draws
   * from a raw `ModernTileset/` sheet instead of `defs/objects`. Migrating
   * one deletes it here; adding one is a build bypass this test refuses. */
  const BYPASSING_ASSET_KEYS = ["bollard", "shelf", "subwayBench", "subwayWall", "table"];

  /** The asset keys `scene.ts` draws by repeating one whole tile per cell:
   * only these may be a single tile of art under a wider or taller
   * footprint. */
  const REPEATING_TILE_KEYS = new Set(["subwayWall"]);

  function pngSizePx(href: string): { readonly width: number; readonly height: number } {
    const buf = readFileSync(fileURLToPath(href));
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  const inScope = STREET_PROPS.flatMap((prop) =>
    !isDefStreetProp(prop) && (prop.layer === "walls" || prop.solid === true) ? [prop] : [],
  );

  it("the set of solid or walls-layer assetKey rows is exactly the named list, and is not empty", () => {
    expect(inScope.length).toBeGreaterThan(0);
    expect([...new Set(inScope.map((prop) => prop.assetKey))].sort()).toEqual([
      ...BYPASSING_ASSET_KEYS,
    ]);
  });

  it("art is exactly the declared footprint in tiles (overhanging only upward on a one-row footprint), or a single tile the renderer repeats", () => {
    const failures: string[] = [];
    for (const prop of inScope) {
      const footprint = prop.footprint ?? { width: 1, height: 1 };
      const href = ASSET_URLS[prop.assetKey];
      if (!href) throw new Error(`no ASSET_URLS entry for '${prop.assetKey}'`);
      const art = pngSizePx(href);

      const repeats = REPEATING_TILE_KEYS.has(prop.assetKey);
      const widthOk =
        (repeats && art.width === TILE_SIZE_PX) || art.width === footprint.width * TILE_SIZE_PX;
      const heightOk =
        (repeats && art.height === TILE_SIZE_PX) ||
        (footprint.height === 1
          ? art.height >= TILE_SIZE_PX
          : art.height === footprint.height * TILE_SIZE_PX);
      if (!widthOk) {
        failures.push(
          `prop ${prop.id} ('${prop.assetKey}'): real art is ${art.width}px wide, not its own declared footprint width (${footprint.width} tile(s), ${footprint.width * TILE_SIZE_PX}px)${repeats ? " nor one repeating tile" : ""}`,
        );
      }
      if (!heightOk) {
        failures.push(
          `prop ${prop.id} ('${prop.assetKey}'): real art is ${art.height}px tall, not its own declared footprint height (${footprint.height} tile(s), ${footprint.height * TILE_SIZE_PX}px)${repeats ? " nor one repeating tile" : ""}`,
        );
      }
    }
    expect(failures).toEqual([]);
  });
});

// Story 2.13 (Tim's direction): the architecture made absolute, not just
// convention -- a `defId` row can never carry an `assetKey` (the type
// already forbids it; this is the runtime witness over every real
// drawable this fixture produces), and no raw `ModernTileset/` import in
// `scene.ts` may name a sheet any real `defs/objects` entry's own
// `sprite.sheet` also names -- the second half is what stops the
// shortcut growing back the moment someone reaches for `new URL(...)`
// instead of the atlas for a def that already has one.
describe("no raw-asset seam survives for a def-placed prop (story 2.13)", () => {
  function rankOf(layer: string): number {
    const table = buildLayerRankTable(LAYER_TABLE.map(({ code, rank }) => ({ code, rank })));
    const code = LAYER_TABLE.find((row) => row.name === layer)?.code;
    if (code === undefined) throw new Error(`unknown street layer ${layer}`);
    return resolveRank(table, code);
  }

  function sceneSource(): string {
    return readFileSync(
      fileURLToPath(new URL("../../../src/test-street/scene.ts", import.meta.url)),
      "utf-8",
    );
  }

  /** `ASSET_URLS`, key -> the sheet it names, repo-root-relative (the
   * shape `sprite.sheet` uses). */
  function sheetByAssetKey(): Map<string, string> {
    const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
    return new Map(
      Object.entries(ASSET_URLS).map(([key, href]) => [
        key,
        relative(repoRoot, fileURLToPath(href)).split(sep).join("/"),
      ]),
    );
  }

  it("every defId drawable this fixture produces carries no assetKey", () => {
    const drawables = buildPropDrawables({
      rankOf,
      ownership,
      windowDefIds: streetWindowDefIds(),
      objectDefs: streetObjectSources(),
    });
    const defDrawables = drawables.filter(isDefPropDrawable);
    expect(defDrawables.length).toBeGreaterThan(0);
    for (const drawable of defDrawables) {
      expect("assetKey" in drawable, `drawable ${drawable.stableId} carries both`).toBe(false);
    }
  });

  // Quentin's direction, cycle 2: the real bug this PR shipped and fixed
  // (`defCellFrameRect`'s own doc comment says the whole story) was only
  // possible because one real object -- the shop counter -- happened to
  // pack at its own page's `(0, 0)`, so a per-cell crop that silently
  // ignored the whole-sprite placement was right for it by accident. If
  // that ever stops being true for every object (the packer always
  // extrudes a border, so nothing should ever pack flush against a page's
  // own origin), a loader that made the same mistake again would once
  // again be right by accident for whichever object packs first -- this
  // closes that hole over the real, committed atlas, not a fixture.
  it("no real defs/objects entry's own atlas rect starts at its page's own origin -- every one sits behind the packer's own extrusion border", () => {
    expect(defs.objects.length).toBeGreaterThan(0);
    for (const object of defs.objects) {
      expect(
        object.atlas.x > 0 && object.atlas.y > 0,
        `object '${object.key}' packs at (${object.atlas.x}, ${object.atlas.y}) -- flush against its page's own origin, with no extrusion border to catch a per-cell crop that ignores its own placement`,
      ).toBe(true);
    }
  });

  const propAssetKeys = new Set(
    STREET_PROPS.filter(
      (prop): prop is Extract<typeof prop, { assetKey: string }> => !isDefStreetProp(prop),
    ).map((prop) => prop.assetKey),
  );

  // The only `ASSET_URLS` key this guard accepts sharing a sheet with a
  // real `defs/objects` sprite today: a ground-pass key no real
  // `StreetProp` row's own `assetKey` names, though `bridge_deck`'s def
  // names the exact file `sidewalk` paints (`Sidewalk_1_1.png`) -- the
  // ground pass still paints it outside any def's own footprint. Never
  // grows silently: a key lands here only by a human adding it, and this
  // test fails the day it stops colliding, so the list can only shrink.
  const ACCEPTED_SHEET_COLLISIONS = new Set(["sidewalk"]);

  it("no ModernTileset/ import a real StreetProp row still uses names a sheet a real defs/objects entry's own sprite already names", () => {
    const sheets = sheetByAssetKey();
    expect(sheets.size).toBeGreaterThan(0);

    const defSheets = new Set(defs.objects.map((object) => object.sprite.sheet));
    for (const [key, sheet] of sheets) {
      const collides = defSheets.has(sheet);
      if (ACCEPTED_SHEET_COLLISIONS.has(key)) {
        expect(
          collides,
          `'${key}' is on the accepted-collision allow-list but no longer collides with any real def's sprite -- remove it from ACCEPTED_SHEET_COLLISIONS`,
        ).toBe(true);
        continue;
      }
      if (!propAssetKeys.has(key)) {
        // A ground-pass-only or crop-base key with no accepted reason to
        // collide (not `sidewalk`) must still never collide.
        expect(
          collides,
          `'${key}' (not used by a real StreetProp row) newly collides with a real def's sprite '${sheet}' -- either route it through the atlas or add it to ACCEPTED_SHEET_COLLISIONS with a reason`,
        ).toBe(false);
        continue;
      }
      expect(
        collides,
        `scene.ts's '${key}' still imports '${sheet}' raw for a real StreetProp row, but a real defs/objects entry's own sprite already names it -- draw it through the atlas instead`,
      ).toBe(false);
    }
  });

  it("every ASSET_URLS key is still referenced -- by a real StreetProp row, a ground pass, or a scene.ts crop base", () => {
    // The ratchet against a dead import: a key a `defId` retarget just
    // orphaned (`window`, `trashBin`, `bridgeDeck`, `bridgeStairs`, story
    // 2.13) must actually be deleted from `ASSET_URLS`, not merely
    // unreferenced -- a stray entry still costs a boot request for
    // nothing on screen.
    const sceneSrc = sceneSource();
    const declaredKeys = [...sheetByAssetKey().keys()];
    expect(declaredKeys.length).toBeGreaterThan(0);

    const groundAssetKeys = new Set(STREET_GROUND_TILES.map((tiles) => tiles.assetKey));
    const cropBaseKeys = new Set(
      [...sceneSrc.matchAll(/textureFor\(\s*"(\w+)"/g)]
        .map((m) => m[1])
        .filter((k) => k !== undefined),
    );
    for (const key of declaredKeys) {
      const used = propAssetKeys.has(key) || groundAssetKeys.has(key) || cropBaseKeys.has(key);
      expect(used, `ASSET_URLS key '${key}' is declared but never referenced -- delete it`).toBe(
        true,
      );
    }
  });
});

// Story 15.7: the platform's stairs must read as going UP. The picture's
// one carrier of that meaning is which end of the treads is high, so this
// measures it from the decoded pixels: on the street the treads sink
// toward the anchor (down), on the platform they rise toward it (up).
// A flip/mirror/negative scale of a side-on flight reverses exactly that,
// so none may exist in the renderer or the fixture.
describe("the subway stairs read the right way (story 15.7, FR117, FR126)", () => {
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

  /** The sheet of one def row, decoded. */
  const sheetOf = (sheet: string): PNG => PNG.sync.read(readFileSync(join(repoRoot, sheet)));

  /** The art of `rows`: the bounding box of their sprites, which must be
   * cut from one sheet. */
  function decode(rows: readonly { readonly defId: number }[]): PNG {
    const sprites = rows.map((p) => objectDef(p.defId).sprite);
    const sheet = sprites[0]?.sheet;
    if (!sheet || sprites.some((s) => s.sheet !== sheet)) {
      throw new Error("the rows must be cut from one sheet");
    }
    const x0 = Math.min(...sprites.map((s) => s.x));
    const y0 = Math.min(...sprites.map((s) => s.y));
    const x1 = Math.max(...sprites.map((s) => s.x + s.w));
    const y1 = Math.max(...sprites.map((s) => s.y + s.h));
    const out = new PNG({ width: x1 - x0, height: y1 - y0 });
    PNG.bitblt(sheetOf(sheet), out, x0, y0, x1 - x0, y1 - y0, 0, 0);
    return out;
  }

  /** `png` flipped left to right, in memory. */
  function mirrorOf(png: PNG): PNG {
    const out = new PNG({ width: png.width, height: png.height });
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const from = (y * png.width + x) * 4;
        const to = (y * png.width + (png.width - 1 - x)) * 4;
        for (let c = 0; c < 4; c++) out.data[to + c] = png.data[from + c] ?? 0;
      }
    }
    return out;
  }

  /** Mean height (px from the top) of the orange/yellow tread tops over
   * the sprite's west and east thirds; smaller = higher. */
  function treadTopByThird(png: PNG): { west: number; east: number } {
    const isTread = (x: number, y: number) => {
      const i = (y * png.width + x) * 4;
      const [r = 0, g = 0, b = 0, a = 0] = [
        png.data[i],
        png.data[i + 1],
        png.data[i + 2],
        png.data[i + 3],
      ];
      return a > 200 && r > 200 && g > 90 && b < 90;
    };
    const topOf = (x: number): number | undefined => {
      for (let y = 0; y < png.height; y++) if (isTread(x, y)) return y;
      return undefined;
    };
    const mean = (x0: number, x1: number) => {
      const tops = [];
      for (let x = x0; x < x1; x++) {
        const t = topOf(x);
        if (t !== undefined) tops.push(t);
      }
      if (tops.length === 0) throw new Error("no tread pixels found in the stairs art");
      return tops.reduce((a, b) => a + b, 0) / tops.length;
    };
    const third = Math.floor(png.width / 3);
    return { west: mean(0, third), east: mean(png.width - third, png.width) };
  }

  /** The walkable flight of a stairwell group: its flat-pass rows. */
  const flightOf = (rows: readonly DefProp[]) =>
    rows.filter((p) => passOfLayer(layerCodeByName(p.layer)) === "groundObjects");

  const streetAnchor = () => {
    const found = subwayAnchors().find((a) => a.anchor.floor === PLAYER_START.floor);
    if (!found) throw new Error("no street anchor");
    return found;
  };

  const platformFlight = () => {
    const { anchor, open } = subwayAnchors().find((a) => a.anchor.floor === SUBWAY_FLOOR) ?? {};
    if (!anchor || !open) throw new Error("no platform anchor");
    return { anchor, climb: open.direction, flight: flightOf(stairwellRowsAt(anchor)) };
  };

  it("the platform's up-stairs rise toward their anchor; the street's down-stairs sink toward theirs", () => {
    // Street half: the anchor (west) end is lower on screen than the opening.
    const streetRows = stairwellRowsAt(streetAnchor().anchor);
    const streetAnchorWest = STAIRS_X < Math.min(...flightOf(streetRows).map((p) => p.x)) + 1;
    expect(streetAnchorWest).toBe(true);
    const down = treadTopByThird(decode(streetRows));
    expect(down.west).toBeGreaterThan(down.east);

    // Platform half: the flight is found by the tag rule, decoded from its
    // own sprite, and measured along the climb axis from the pairing's own
    // open direction -- the end the player climbs toward must be higher.
    const { anchor, climb, flight } = platformFlight();
    expect(flight.length).toBeGreaterThan(0);
    expect(climb.y === 0, "the side-on rise can only be read along an east-west climb").toBe(true);
    const cells = flight.flatMap(propCells);
    const aheadMost = Math.max(...cells.map((c) => c.x * climb.x));
    expect(anchor.x * climb.x, "the anchor is the climb's far end").toBe(aheadMost);
    const up = treadTopByThird(decode(flight));
    const [ahead, behind] = climb.x > 0 ? [up.east, up.west] : [up.west, up.east];
    expect(ahead).toBeLessThan(behind);

    // Positive control: the same art mirrored in memory reads as sinking
    // along the climb, so the classifier can tell the two apart.
    const mirroredUp = treadTopByThird(mirrorOf(decode(flight)));
    const [mAhead, mBehind] =
      climb.x > 0 ? [mirroredUp.east, mirroredUp.west] : [mirroredUp.west, mirroredUp.east];
    expect(mAhead).toBeGreaterThanOrEqual(mBehind);
  });

  /** The share of identical RGBA pixels between `art` and the same-size
   * window of `street` at `(ox, oy)`, `art` optionally mirrored. */
  function matchFraction(art: PNG, street: PNG, ox: number, oy: number, mirrored: boolean) {
    let same = 0;
    for (let y = 0; y < art.height; y++) {
      for (let x = 0; x < art.width; x++) {
        const ai = (y * art.width + (mirrored ? art.width - 1 - x : x)) * 4;
        const si = ((oy + y) * street.width + ox + x) * 4;
        if (
          art.data[ai] === street.data[si] &&
          art.data[ai + 1] === street.data[si + 1] &&
          art.data[ai + 2] === street.data[si + 2] &&
          art.data[ai + 3] === street.data[si + 3]
        ) {
          same++;
        }
      }
    }
    return same / (art.width * art.height);
  }

  /** The best match of `art` anywhere over `street`, both orientations. */
  function bestMatch(art: PNG, street: PNG) {
    let best = { fraction: 0, mirrored: false };
    for (let oy = 0; oy + art.height <= street.height; oy++) {
      for (let ox = 0; ox + art.width <= street.width; ox++) {
        for (const mirrored of [false, true]) {
          const fraction = matchFraction(art, street, ox, oy, mirrored);
          if (fraction > best.fraction) best = { fraction, mirrored };
        }
      }
    }
    return best;
  }

  const spriteArt = (sprite: { sheet: string; x: number; y: number; w: number; h: number }) => {
    const art = new PNG({ width: sprite.w, height: sprite.h });
    PNG.bitblt(sheetOf(sprite.sheet), art, sprite.x, sprite.y, sprite.w, sprite.h, 0, 0);
    return art;
  };

  /** At or above this share of identical pixels a sprite is the street's
   * descent art, however it is cut or flipped. */
  const RETREAT_MATCH_FRACTION = 0.75;

  it("the platform stairwell is not the street stairwell's descent art: no shared sheet, and no row matches it at 0.75 or more, unflipped or mirrored", () => {
    const streetRows = stairwellRowsAt(streetAnchor().anchor);
    const platformRows = stairwellRowsAt(platformFlight().anchor);
    expect(platformRows.length).toBeGreaterThan(0);
    const streetSheets = new Set(streetRows.map((p) => objectDef(p.defId).sprite.sheet));
    const street = decode(streetRows);
    for (const p of platformRows) {
      const { key, sprite } = objectDef(p.defId);
      expect(streetSheets.has(sprite.sheet), `${key} shares a sheet with the street`).toBe(false);
      const best = bestMatch(spriteArt(sprite), street);
      expect(
        best.fraction,
        `${key} matches the street stairwell art at ${best.fraction}${best.mirrored ? " mirrored" : ""}`,
      ).toBeLessThan(RETREAT_MATCH_FRACTION);
    }
  });

  it("the retreat matcher fires: the street's own tread sprite matches unflipped, and Stairs_Complete_4's tread row matches mirrored", () => {
    const streetRows = stairwellRowsAt(streetAnchor().anchor);
    const street = decode(streetRows);
    const treads = streetRows.find((p) => objectDef(p.defId).key === "stairwell_treads");
    if (!treads) throw new Error("the street stairwell has no treads row");
    const own = bestMatch(spriteArt(objectDef(treads.defId).sprite), street);
    expect(own.fraction).toBeGreaterThanOrEqual(RETREAT_MATCH_FRACTION);
    expect(own.mirrored).toBe(false);

    const sheet = objectDef(treads.defId).sprite.sheet.replace(
      "Stairs_Complete_2",
      "Stairs_Complete_4",
    );
    const other = bestMatch(spriteArt({ sheet, x: 0, y: 32, w: 48, h: 16 }), street);
    expect(other.fraction).toBeGreaterThanOrEqual(RETREAT_MATCH_FRACTION);
    expect(other.mirrored).toBe(true);
  });

  it("no ModernTileset sheet is drawn flipped: no negative scale or flip in the fixture or renderer", () => {
    const root = fileURLToPath(new URL("../../../src/", import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".ts")) files.push(full);
      }
    };
    walk(join(root, "test-street"));
    walk(join(root, "render"));
    const banned = [
      /scale\.(x|y)\s*\*?=\s*-/,
      /scale\.set\(\s*-/,
      /anchor\.set\(\s*-/,
      /\bflip[XY]\b/i,
    ];
    const hits: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf-8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          const code = line
            .replace(/\/\*.*?\*\//g, "")
            .replace(/\/\/.*$/, "")
            .replace(/^\s*\*.*$/, "");
          for (const re of banned) {
            if (re.test(code))
              hits.push(`${relative(root, file)}:${i + 1}: ${line.trim()} (${re})`);
          }
        });
    }
    expect(hits).toEqual([]);
  });

  it("the platform's east wall carries the green up-arrow above the up-stairs' anchor column, on the wall_decals layer", () => {
    const sign = STREET_PROPS.find((p) => !isDefStreetProp(p) && p.assetKey === "subwayArrowUp");
    expect(sign).toBeDefined();
    expect(sign?.floor).toBe(SUBWAY_FLOOR);
    expect(sign?.layer).toBe("wall_decals");
    expect(sign?.x).toBe(PLATFORM_UP_ANCHOR_X);
    expect(sign?.y).toBeLessThan(PLATFORM_UP_ANCHOR_Y);
  });
});

describe("the bollard approach route (NFR50)", () => {
  const config = streetMovementConfig();
  const sub = config.subcellsPerCell;
  const inputs = streetWalkInputs();
  const route = streetBollardRoute(inputs, config);
  const bollard = STREET_PROPS.find((p) => p.id === 121n);
  if (!bollard) throw new Error("fixture no longer places the west-of-shopfront bollard (id 121)");
  const face = {
    x0: bollard.x * sub + BOLLARD_COLLIDER.x0,
    y1: bollard.y * sub + BOLLARD_COLLIDER.y1,
    x1: bollard.x * sub + BOLLARD_COLLIDER.x1,
  };

  for (const lag of [0, 1] as const) {
    it(`rests the bollard route on the exact south, west and east faces, with release lag ${lag}`, () => {
      const out = simulateStreetWalk(route, { ...RELEASE_LAG, releaseLagSteps: lag });
      const at = (label: string) => {
        const found = out.find((c) => c.label === label);
        if (!found) throw new Error(`no checkpoint '${label}'`);
        return found.state;
      };
      expect(at("into-the-south-face").y * sub).toBe(face.y1 + config.bodyHeightSubcells);
      expect(at("into-the-west-face").x * sub).toBe(face.x0 - config.bodyWidthSubcells / 2);
      expect(at("into-the-east-face").x * sub).toBe(face.x1 + config.bodyWidthSubcells / 2);
    });

    it(`keeps the body over the post's own columns and rows before each push, with release lag ${lag}`, () => {
      const out = simulateStreetWalk(route, { ...RELEASE_LAG, releaseLagSteps: lag });
      const overlapsColumns = (x: number) =>
        x * sub + config.bodyWidthSubcells / 2 > face.x0 &&
        x * sub - config.bodyWidthSubcells / 2 < face.x1;
      const inRows = (y: number) =>
        y * sub > bollard.y * sub + BOLLARD_COLLIDER.y0 &&
        y * sub - config.bodyHeightSubcells < face.y1;
      const restBefore = (label: string) => {
        const i = out.findIndex((c) => c.label === label);
        return out[i - 1]?.state;
      };
      const south = restBefore("into-the-south-face");
      const west = restBefore("into-the-west-face");
      const east = restBefore("into-the-east-face");
      if (!south || !west || !east) throw new Error("missing checkpoint before a push");
      expect(overlapsColumns(south.x)).toBe(true);
      expect(inRows(west.y)).toBe(true);
      expect(inRows(east.y)).toBe(true);
    });
  }

  it("never starts a segment whose axis condition already holds, with a fully clamped tick of release lag", () => {
    const out = simulateStreetWalk(route, RELEASE_LAG);
    route.forEach((segment, i) => {
      const from = out[i - 1]?.state ?? PLAYER_START;
      expect(
        streetWalkUntilMet(segment.until, from.x, from.y, from.floor),
        `'${segment.label}' already holds at the previous lagged rest`,
      ).toBe(false);
    });
  });
});

describe("a stairwell is drawn whole (story 15.14, FR126)", () => {
  const sheetRect = (p: DefProp) => objectDef(p.defId).sprite;
  /** The sprite's drawn rect in world px: bottom-left on the anchor cell. */
  const drawnRect = (p: DefProp) => {
    const { w, h } = sheetRect(p);
    return { x: p.x * 16, y: (p.y + 1) * 16 - h, w, h };
  };
  const overlap = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  /** Whether two sheet rects touch along an edge with overlapping extent. */
  const abut = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ) => {
    const cols = a.x < b.x + b.w && b.x < a.x + a.w;
    const rows = a.y < b.y + b.h && b.y < a.y + a.h;
    return (
      (cols && (a.y + a.h === b.y || b.y + b.h === a.y)) ||
      (rows && (a.x + a.w === b.x || b.x + b.w === a.x))
    );
  };
  const groups = () =>
    subwayAnchors().map(({ anchor }) => ({ anchor, rows: stairwellRowsAt(anchor) }));

  it("(a) pieces cut from one sheet that touch on the sheet touch on the floor, at the offset the sheet implies", () => {
    let pairs = 0;
    for (const { rows } of groups()) {
      for (const a of rows) {
        for (const b of rows) {
          if (a === b || sheetRect(a).sheet !== sheetRect(b).sheet) continue;
          if (!abut(sheetRect(a), sheetRect(b))) continue;
          pairs++;
          const da = drawnRect(a);
          const db = drawnRect(b);
          expect(
            { dx: db.x - da.x, dy: db.y - da.y },
            `${objectDef(a.defId).key} -> ${objectDef(b.defId).key}`,
          ).toEqual({ dx: sheetRect(b).x - sheetRect(a).x, dy: sheetRect(b).y - sheetRect(a).y });
        }
      }
    }
    expect(pairs, "the street stairwell's own pieces are examined").toBeGreaterThanOrEqual(4);
  });

  it("(b) the platform stairwell's flat rows are drawn inside the platform's interior", () => {
    const { anchor } = subwayAnchors().find((a) => a.anchor.floor === SUBWAY_FLOOR) ?? {};
    if (!anchor) throw new Error("no platform anchor");
    const flat = stairwellRowsAt(anchor).filter(
      (p) => passOfLayer(layerCodeByName(p.layer)) === "groundObjects",
    );
    expect(flat.length).toBeGreaterThan(0);
    const interior = {
      x: PLATFORM_INTERIOR_X0 * 16,
      y: PLATFORM_INTERIOR_Y0 * 16,
      w: (PLATFORM_INTERIOR_X1 - PLATFORM_INTERIOR_X0 + 1) * 16,
      h: (PLATFORM_INTERIOR_Y1 - PLATFORM_INTERIOR_Y0 + 1) * 16,
    };
    for (const p of flat) {
      const r = drawnRect(p);
      const key = objectDef(p.defId).key;
      expect(r.x, `${key} west`).toBeGreaterThanOrEqual(interior.x);
      expect(r.y, `${key} north`).toBeGreaterThanOrEqual(interior.y);
      expect(r.x + r.w, `${key} east`).toBeLessThanOrEqual(interior.x + interior.w);
      expect(r.y + r.h, `${key} south`).toBeLessThanOrEqual(interior.y + interior.h);
    }
  });

  it("(c) nothing outside a stairwell's own group is drawn over its flight", () => {
    for (const { anchor, rows } of groups()) {
      const flight = rows.filter((p) => passOfLayer(layerCodeByName(p.layer)) === "groundObjects");
      expect(flight.length).toBeGreaterThan(0);
      for (const other of STREET_PROPS) {
        if (!isDefStreetProp(other) || other.floor !== anchor.floor || rows.includes(other))
          continue;
        for (const f of flight) {
          expect(
            overlap(drawnRect(other), drawnRect(f)),
            `${objectDef(other.defId).key} at (${other.x}, ${other.y}) is drawn over ${objectDef(f.defId).key}`,
          ).toBe(false);
        }
      }
    }
  });
});
