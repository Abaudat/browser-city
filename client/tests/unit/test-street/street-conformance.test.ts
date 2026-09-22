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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildLayerRankTable, resolveRank } from "../../../src/render/layer-ranks";
import { LAYER_TABLE } from "../../../src/render/layer-table";
import { isNearSideWall } from "../../../src/render/visibility";
import { buildPropDrawables, isDefPropDrawable } from "../../../src/test-street/drawables";
import {
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
  PLATFORM_LANDING_X,
  PLATFORM_LANDING_Y,
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
  STREET_TRANSITIONS,
  SUBWAY_FLOOR,
  streetBridgeLapRoute,
  streetDefId,
  streetPlacedRows,
  streetWalkRoute,
  TRASH_BIN_DEF_ID,
  WINDOW_DEF_ID,
} from "../../../src/test-street/fixture";
import {
  type FloorWalkResult,
  initialFloorWalkState,
  stepAndTransition,
} from "../../../src/world/floor-walk";
import { footprintCells, footprintOrigin } from "../../../src/world/footprint";
import { step } from "../../../src/world/movement";
import { cellOf, NO_OWNER } from "../../../src/world/ownership";
import {
  blockedNeighborsOf,
  forwardOpenNeighbor,
  pairTransitions,
  reverseOpenNeighbor,
} from "../../../src/world/transitions";
import { checkWorldSpec } from "../../../src/world/world-spec";
import {
  committedDefs,
  isCellStandable,
  lamppostRestY,
  simulateStreetWalk,
  streetMovementConfig,
  streetObjectSources,
  streetOwnershipIndex,
  streetTransitionIndex,
  streetWalkInputs,
  streetWindowDefIds,
  streetWorldIndex,
} from "./street-world";

const defs = committedDefs();
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

  it("stops at the exact same position under the bridge whether the key is released on time or held 8 slow steps late", () => {
    // The whole point of a rest over a threshold (story 1.13, cycle 3,
    // Quentin's direction): a real collider always snaps to the same
    // face regardless of how long the walk to reach it took. Pinned at
    // unit level, to 1e-9, so a future edit that turns this checkpoint
    // back into a coordinate threshold goes red here -- on the fastest
    // job there is -- rather than only showing up as e2e baseline flake.
    const inputs = streetWalkInputs();
    const onTime = simulateStreetWalk(streetWalkRoute(inputs), { releaseLagSteps: 0 });
    const late = simulateStreetWalk(streetWalkRoute(inputs), {
      stepMs: 100,
      releaseLagSteps: 8,
    });
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

  it("survives a slow machine: every segment still completes with the key released late", () => {
    // The failure this pins: a held key is released over a round trip to
    // the page, so a walker always travels some way past its own release
    // condition, and how far is a property of the machine. A route whose
    // next segment depends on stopping *near* a threshold works on a fast
    // laptop and hangs on a slow CI runner -- which is exactly what
    // happened, on the perf job, with the route's own return leg.
    //
    // 8 steps of 100 ms (the resolver's own delta clamp, so the largest
    // step it will ever take) is ~1.8 cells of overshoot per segment --
    // roughly 800 ms of release latency at the committed walking speed,
    // which is far beyond anything a loaded CI runner has shown. Every
    // margin the route leaves is wider than that: the closest call is the
    // bridge's own landing cell, `STAIRS_X - BRIDGE_DOWN_ANCHOR_X` cells
    // from the subway stairwell's anchor.
    const lag = { stepMs: 100, releaseLagSteps: 8 };
    const inputs = streetWalkInputs();

    const out = simulateStreetWalk(streetWalkRoute(inputs), lag);
    const arrived = out[out.length - 1]?.state;
    if (!arrived) throw new Error("the walk produced no checkpoints");
    expect(arrived.floor).toBe(PLAYER_START.floor);
    // Never fell down the subway stairwell on the way.
    for (const checkpoint of out) expect(checkpoint.state.floor).not.toBe(SUBWAY_FLOOR);

    let state = arrived;
    for (let lapIndex = 0; lapIndex < 3; lapIndex++) {
      const lap = simulateStreetWalk(streetBridgeLapRoute(), {
        ...lag,
        start: state,
      });
      for (const checkpoint of lap) expect(checkpoint.state.floor).not.toBe(SUBWAY_FLOOR);
      const end = lap[lap.length - 1]?.state;
      if (!end) throw new Error("the lap produced no checkpoints");
      state = end;
    }
    // Three laps later it is still on the street, still where a lap
    // starts: the loop is stable, not slowly drifting somewhere it will
    // eventually hang.
    expect(state.floor).toBe(PLAYER_START.floor);
    expect(state.cellX).toBe(arrived.cellX);
    expect(state.cellY).toBe(arrived.cellY);
  });
});

// Story 15.2 (Quentin's direction): the class of defect a demo watch found
// -- collision geometry nothing draws, and drawn geometry nothing collides
// -- checked generically over the whole committed fixture, never by
// hand-editing the six reported coordinates. If a future edit reintroduces
// either shape, this goes red without needing to know where.
describe("collision/silhouette conformance (FR117, FR128)", () => {
  const world = streetWorldIndex();
  const sources = streetObjectSources();

  it("(a) no undrawn collider: every collider cell belongs to a real, drawn prop -- STREET_BOUNDARY contributes only the undrawn world-edge ring, nothing else", () => {
    // `STREET_BOUNDARY` is the *only* undrawn geometry this street is
    // allowed to contribute (`docs/architecture.md`'s test-street rule);
    // every one of its own rows is exempt here by construction, not by a
    // hand-picked id list -- if a future edit adds a row back for a
    // scripted walk's own convenience (exactly what this story removed),
    // it silently joins the exemption unless the *next* test below also
    // catches it lying inside the drawn ground.
    const boundaryIds = new Set(STREET_BOUNDARY.map((r) => r.id));
    const failures: string[] = [];
    const xs = [...STREET_PROPS.map((p) => p.x), ...STREET_BOUNDARY.map((r) => r.x)];
    const ys = [...STREET_PROPS.map((p) => p.y), ...STREET_BOUNDARY.map((r) => r.y)];
    const floors = new Set([
      ...STREET_PROPS.map((p) => p.floor),
      ...STREET_BOUNDARY.map((r) => r.floor ?? PLAYER_START.floor),
    ]);
    // A margin wide enough that every real collider's own footprint is
    // fully inside the scanned window, however far a prop's own anchor
    // sits from another one's -- the fixture's largest single footprint
    // (the platform's own walls) is nowhere near this wide.
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
            // Not a boundary row, so it must be a real `STREET_PROPS` row
            // -- and its own declared footprint (never its possibly-
            // smaller collider) must actually cover this cell, or
            // something drew a collider nobody's sprite reaches.
            const prop = STREET_PROPS.find((p) => p.id === entry.objectId);
            if (!prop) {
              failures.push(
                `collider at (${x}, ${y}, floor ${floor}) names no real prop or boundary id ${entry.objectId}`,
              );
              continue;
            }
            const defId = isDefStreetProp(prop) ? prop.defId : streetDefId(prop.id);
            const source = sources.get(defId);
            const footprint = source ?? { width: 1, height: 1 };
            const cells = footprintCells(prop.x, prop.y, footprint);
            const covered = cells.some((c) => c.x === x && c.y === y);
            if (!covered) {
              failures.push(
                `prop ${prop.id}'s own collider reaches (${x}, ${y}, floor ${floor}), outside its own drawn footprint`,
              );
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("the undrawn world-edge ring lies strictly outside every drawn ground-tile pass", () => {
    // A rect with its own declared partial `collider` (story 15.2, cycle
    // 2, Quentin's finding 3) is never the world-edge *ring* this check
    // means -- it is a thin, disclosed sliver on top of real, walkable
    // ground (the bridge's own south rail, id 110, is the original
    // example; the underpass approach's own id 107 is a second), the same
    // "declares its own partial shape" exemption guard (b) below already
    // gives a drawn prop with a real collider override.
    const failures: string[] = [];
    for (const rect of STREET_BOUNDARY) {
      if (rect.collider) continue;
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

  it("(b) no uncollided solid: every walls-layer drawable and every solid row rasterises a real collider somewhere in its own footprint, and blocks the whole footprint unless it declares its own partial shape", () => {
    const failures: string[] = [];
    for (const prop of STREET_PROPS) {
      if (prop.layer !== "walls" && prop.solid !== true) continue;
      const defId = isDefStreetProp(prop) ? prop.defId : streetDefId(prop.id);
      const source = sources.get(defId);
      if (!source) {
        failures.push(`prop ${prop.id}: no collider source for defId ${defId}`);
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
      // A row with no custom collider shape of its own (every asset row
      // relying on `streetColliderSources`' own default full-footprint
      // rect, and every `defId` row) blocks its whole footprint, same as
      // ever. A row that declares its own partial shape (story 15.2's own
      // "one entrance" stairwell: real drawn railings on some cells, a
      // real walkable opening on others) opts out of that -- its own
      // correctness is what "the six collision/transition regressions"
      // describe's own one-entrance geometry test checks instead, not a
      // blanket "every cell" rule that would refuse the opening by
      // construction.
      const hasCustomShape = !isDefStreetProp(prop) && prop.collider !== undefined;
      if (!hasCustomShape && collidedCells.length !== cells.length) {
        failures.push(
          `prop ${prop.id} (layer '${prop.layer}'${prop.solid ? ", solid" : ""}) draws over ${cells.length} cell(s) at floor ${prop.floor} but only ${collidedCells.length} collide, with no custom collider shape declared`,
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

  it("1. the shelf room's own north wall stops movement exactly at its own face, never before it", () => {
    const wall = STREET_PROPS.find((p) => p.id === 30n); // shop B's own north wall
    if (!wall) throw new Error("no prop with id 30 (shop B's north wall)");
    const rect = propColliderRect(wall);
    const rest = walkToRest({ x: wall.x + 0.5, y: wall.y + 4 }, { x: 0, y: -1 }, wall.floor);
    expect(rest.y).toBeCloseTo(rect.y1 + bodyHeightCells, 9);
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
    const fromSouth = walkToRest({ x: bin.x + 0.5, y: bin.y + 1 }, { x: 0, y: -1 }, bin.floor);
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
    // "A stairwell has one top and one bottom": neither anchor is a bare
    // cell in open pavement any more -- real, drawn geometry (the
    // stairwell's own railings and its own back, both real `STREET_PROPS`
    // rows) surrounds each one on every side but its own single entry.
    // This is the grid-level half finding 1 asks for, never re-deriving
    // which side is the entry side: `pairTransitions`'s own pairing
    // records it, as `d`.
    const { pairings } = pairTransitions(STREET_TRANSITIONS);
    const subway = pairings.find(
      (p) =>
        p.forward.x === STAIRS_X &&
        p.forward.y === STAIRS_Y &&
        p.forward.floor === PLAYER_START.floor,
    );
    if (!subway) throw new Error("no mirrored pairing found for the subway's own down transition");

    function assertOneEntrance(
      anchor: { readonly x: number; readonly y: number },
      floor: number,
      open: {
        readonly cell: { readonly x: number; readonly y: number };
        readonly direction: { readonly x: number; readonly y: number };
      },
    ): void {
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

      // Every other neighbour: a step from it into the anchor is refused
      // -- approached from one cell further out (a real, non-entry
      // neighbour is real drawn geometry, solid over its own whole
      // cell, so starting dead centre inside it would test the resolver's
      // own "already overlapping" edge case instead of a real approach;
      // starting one cell further out and walking the same direction a
      // real player would is what "a step from that neighbour" means).
      // The walker's cell must never become the anchor's.
      for (const blocked of blockedNeighborsOf(anchor, open.direction)) {
        const direction = { x: anchor.x - blocked.x, y: anchor.y - blocked.y };
        const approachFrom = { x: blocked.x - direction.x, y: blocked.y - direction.y };
        const result = walkToRest(
          { x: approachFrom.x + 0.5, y: approachFrom.y + 0.5 },
          direction,
          floor,
        );
        expect(
          cellOf(result.x) === anchor.x && cellOf(result.y) === anchor.y,
          `entering ${JSON.stringify(anchor)} via its own non-entry neighbour ${JSON.stringify(blocked)} was NOT refused -- ended at (${result.x}, ${result.y})`,
        ).toBe(false);
      }
    }

    assertOneEntrance(
      { x: subway.forward.x, y: subway.forward.y },
      subway.forward.floor,
      forwardOpenNeighbor(subway),
    );
    assertOneEntrance(
      { x: subway.reverse.x, y: subway.reverse.y },
      subway.reverse.floor,
      reverseOpenNeighbor(subway),
    );
  });

  it("6. the subway transition pair is a real mirror: down the demo's own way (left), then the reverse input (right), lands back beside the stairwell -- never a detour through an unrelated direction", () => {
    const transitions = streetTransitionIndex();
    // The issue's own literal report: "descended by walking left" --
    // approaching from the stairwell's own east side, holding ArrowLeft.
    let down: FloorWalkResult = {
      ...initialFloorWalkState(STAIRS_X + 2, STAIRS_Y + 0.5, PLAYER_START.floor),
      transitioned: false,
    };
    for (let i = 0; i < 200 && !down.transitioned; i++) {
      down = stepAndTransition(down, STAIRS_ENTRY_DIRECTION, 16, world, config, transitions);
    }
    expect(down.floor).toBe(SUBWAY_FLOOR);
    expect(down.cellX).toBe(PLATFORM_LANDING_X);
    expect(down.cellY).toBe(PLATFORM_LANDING_Y);

    // The reverse input (the opposite key from the one that walked down,
    // ArrowRight): no detour through an unrelated direction, straight
    // back up.
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

// Story 15.2 (Quentin's finding 2): the fixture-level half of "a drawn
// silhouette and its collider agree" for the `assetKey` rows that bypass
// `tools/defs-build` entirely -- the stairwell's own real 48x64px art
// silently overhanging a bare 1x1 footprint both ways was never checked
// anywhere, which is exactly how its own collider ended up nowhere near
// what was actually drawn. Reads the same committed `scene.ts` source
// `ASSET_URLS` table the "no raw-asset seam" describe block below already
// parses (never a hand-copied duplicate), plus the two `WALL_TILE_*_FRAME`
// rectangles `wallTile`/`wallStub` rows draw from instead of their own raw
// sheet. Promoting the stairwell (and the interior wall tile) to real
// `[[object]]` entries, so this guard becomes redundant for them, is
// Quentin's own follow-up task request (defs-build's own alpha-band
// check), out of scope here.
describe("silhouette agreement: a solid or walls-layer assetKey row's own declared footprint matches its real art dimensions in tiles (FR126, Quentin's finding 2)", () => {
  const SILHOUETTE_REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
  // `defs/balance/render.tile_size_px`'s own committed value -- read
  // directly rather than through `committedDefs()`'s balance array here,
  // since every other value this describe block needs (`ASSET_URLS`, the
  // wall frames) is likewise read straight from committed source text.
  const TILE_SIZE_PX = committedDefs().balance.find((b) => b.key === "render.tile_size_px")?.value;
  if (TILE_SIZE_PX === undefined) {
    throw new Error("render.tile_size_px missing from the committed defs.json");
  }

  function sceneSource(): string {
    return readFileSync(
      fileURLToPath(new URL("../../../src/test-street/scene.ts", import.meta.url)),
      "utf-8",
    );
  }

  function sheetByAssetKey(sceneSrc: string): Map<string, string> {
    const table = new Map<string, string>();
    for (const match of sceneSrc.matchAll(/(\w+):\s*new URL\(\s*"([^"]+)"/g)) {
      const [, key, raw] = match;
      if (!key || !raw) continue;
      table.set(key, raw.replace(/^(\.\.\/)+/, ""));
    }
    return table;
  }

  /** `WALL_TILE_H_FRAME`/`WALL_TILE_V_FRAME`'s own real pixel dimensions
   * -- the crop `wallAssetOf` actually draws for a `wallTile`/`wallStub`
   * row, never the raw multi-tile sheet behind them. */
  function wallTileFrameSizes(sceneSrc: string): Map<"H" | "V", { w: number; h: number }> {
    const frames = new Map<"H" | "V", { w: number; h: number }>();
    for (const match of sceneSrc.matchAll(
      /const WALL_TILE_(H|V)_FRAME = new Rectangle\(\s*\d+,\s*\d+,\s*(\d+),\s*(\d+)\)/g,
    )) {
      const [, axis, w, h] = match;
      if (axis !== "H" && axis !== "V") continue;
      if (!w || !h) continue;
      frames.set(axis, { w: Number(w), h: Number(h) });
    }
    return frames;
  }

  function pngSizePx(repoRootRelativePath: string): {
    readonly width: number;
    readonly height: number;
  } {
    const buf = readFileSync(`${SILHOUETTE_REPO_ROOT}${repoRootRelativePath}`);
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  it("art width equals the declared footprint width in tiles (or is a single repeating tile), and art height is at least the declared footprint height (or repeats)", () => {
    const sceneSrc = sceneSource();
    const sheets = sheetByAssetKey(sceneSrc);
    const wallFrames = wallTileFrameSizes(sceneSrc);
    expect(wallFrames.size).toBe(2); // both frames must have parsed, or this guard is silently blind
    const failures: string[] = [];

    for (const prop of STREET_PROPS) {
      // A `defId` row's own sprite/footprint agreement is `tools/defs-
      // build`'s job (FR126, checked at build time against the real
      // sheet); this guard is only for the rows that bypass it.
      if (isDefStreetProp(prop)) continue;
      if (prop.layer !== "walls" && prop.solid !== true) continue;

      const footprint = prop.footprint ?? { width: 1, height: 1 };
      let art: { readonly width: number; readonly height: number };
      if (prop.assetKey === "wallTile" || prop.assetKey === "wallStub") {
        const axis = prop.wallOrientation === "vertical" ? "V" : "H";
        const frame = wallFrames.get(axis);
        if (!frame) throw new Error(`no WALL_TILE_${axis}_FRAME parsed from scene.ts`);
        art = { width: frame.w, height: frame.h };
      } else {
        const sheet = sheets.get(prop.assetKey);
        if (!sheet) throw new Error(`no ASSET_URLS entry for '${prop.assetKey}' in scene.ts`);
        art = pngSizePx(sheet);
      }

      const widthOk = art.width === TILE_SIZE_PX || art.width === footprint.width * TILE_SIZE_PX;
      const heightOk = art.height === TILE_SIZE_PX || art.height >= footprint.height * TILE_SIZE_PX;
      if (!widthOk) {
        failures.push(
          `prop ${prop.id} ('${prop.assetKey}'): real art is ${art.width}px wide, matching neither a single repeating tile (${TILE_SIZE_PX}px) nor its own declared footprint width (${footprint.width} tile(s), ${footprint.width * TILE_SIZE_PX}px)`,
        );
      }
      if (!heightOk) {
        failures.push(
          `prop ${prop.id} ('${prop.assetKey}'): real art is ${art.height}px tall, shorter than its own declared footprint height (${footprint.height} tile(s), ${footprint.height * TILE_SIZE_PX}px) and not a single repeating tile`,
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

  /** `scene.ts`'s own `ASSET_URLS` table, key -> the sheet it names
   * (repo-root-relative, matching `sprite.sheet`'s own shape). Parsed
   * from the committed source, never hand-copied, so this stays in sync
   * with the real table by construction. */
  function sheetByAssetKey(sceneSrc: string): Map<string, string> {
    const table = new Map<string, string>();
    for (const match of sceneSrc.matchAll(/(\w+):\s*new URL\(\s*"([^"]+)"/g)) {
      const [, key, raw] = match;
      if (!key || !raw) continue;
      table.set(key, raw.replace(/^(\.\.\/)+/, ""));
    }
    return table;
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

  // Story 2.13, Tim's direction (cycle 2): the only two `ASSET_URLS` keys
  // this guard accepts sharing a sheet with a real `defs/objects` sprite
  // today -- both crop-base/ground-pass keys no real `StreetProp` row's
  // own `assetKey` ever literally names (`wallTile`, not `wallSheet`,
  // is what a wall row carries), so the old "not referenced by a real
  // row" check exempted them structurally, by construction, even though
  // `wall_segment`'s def now names the exact file `wallSheet` crops
  // (`Room_Builder_Walls_16x16.png`) and `bridge_deck`'s def now names
  // the exact file `sidewalk` paints (`Sidewalk_1_1.png`) -- both real,
  // accepted collisions (a wall pass still crops `wallSheet` for its own
  // non-`defId` cells; the ground pass still paints `sidewalk` outside
  // any def's own footprint), never a shortcut regrowing. Never grows
  // silently: a key lands here only by a human adding it, and this test
  // fails the day one of these two stops actually colliding, so the list
  // can only shrink.
  const ACCEPTED_SHEET_COLLISIONS = new Set(["wallSheet", "sidewalk"]);

  it("no ModernTileset/ import a real StreetProp row still uses names a sheet a real defs/objects entry's own sprite already names", () => {
    const sheets = sheetByAssetKey(sceneSource());
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
        // collide (not `wallSheet`/`sidewalk`) must still never collide.
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
    const declaredKeys = [...sheetByAssetKey(sceneSrc).keys()];
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
