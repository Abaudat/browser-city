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
import { describe, expect, it } from "vitest";
import { isNearSideWall } from "../../../src/render/visibility";
import {
  BRIDGE_DECK_DEF_ID,
  BRIDGE_DECK_WIDTH,
  BRIDGE_DECK_Y,
  BRIDGE_FLOOR,
  BRIDGE_X0,
  BRIDGE_X1,
  furnitureBehindWindows,
  LAMPPOST_CELL,
  LAMPPOST_DEF_ID,
  PLAYER_START,
  STREET_BOUNDARY,
  STREET_BUILDING_AREAS,
  STREET_PROPS,
  STREET_ROOM_AREAS,
  STREET_TRANSITIONS,
  SUBWAY_FLOOR,
  streetBridgeLapRoute,
  streetPlacedRows,
  streetWalkRoute,
  WINDOW_DEF_ID,
} from "../../../src/test-street/fixture";
import { NO_OWNER } from "../../../src/world/ownership";
import { checkWorldSpec } from "../../../src/world/world-spec";
import {
  committedDefs,
  isCellStandable,
  lamppostRestY,
  simulateStreetWalk,
  streetMovementConfig,
  streetOwnershipIndex,
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
      expect(isCellStandable(world, config, x, BRIDGE_DECK_Y, PLAYER_START.floor)).toBe(true);
    }
    const deck = objectDef(BRIDGE_DECK_DEF_ID);
    expect(deck.width).toBe(BRIDGE_DECK_WIDTH);
    expect(deck.collider).toBeUndefined();
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
    const windows = STREET_PROPS.filter((prop) => prop.defId === WINDOW_DEF_ID);
    expect(windows.length).toBeGreaterThan(0);
    expect(objectDef(WINDOW_DEF_ID).window).toBe(true);
  });

  it("has furniture directly behind a window, so the window has something to be seen through", () => {
    // The real "behind a window" set (same floor, north of the window's
    // own row, x-overlapping its footprint) -- not merely "any furniture
    // somewhere on the floor", which would pass even if no window sat in
    // front of any of it.
    expect(furnitureBehindWindows().length).toBeGreaterThan(0);
  });

  it("has a prop wider than one cell", () => {
    const multiCell = STREET_PROPS.filter(
      (prop) => (prop.footprint?.width ?? 1) > 1 || (prop.footprint?.height ?? 1) > 1,
    );
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
    expect(STREET_PROPS.some((prop) => prop.defId === LAMPPOST_DEF_ID)).toBe(true);
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
  const checkpoints = simulateStreetWalk(streetWalkRoute({ lamppostRestY: lamppostRestY() }));
  const at = (label: string) => {
    const found = checkpoints.find((checkpoint) => checkpoint.label === label);
    if (!found) throw new Error(`no checkpoint '${label}' in the simulated walk`);
    return found.state;
  };

  it("completes every segment against the real collision grid", () => {
    expect(checkpoints.map((checkpoint) => checkpoint.label)).toEqual(
      streetWalkRoute({ lamppostRestY: lamppostRestY() }).map((segment) => segment.label),
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

  it("crosses the whole bridge span underneath it, on the street's own floor", () => {
    const under = at("under-the-bridge");
    expect(under.floor).toBe(PLAYER_START.floor);
    expect(under.cellY).toBe(BRIDGE_DECK_Y);
    expect(under.x).toBeGreaterThan(BRIDGE_X1);
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
    const inputs = { lamppostRestY: lamppostRestY() };

    const out = simulateStreetWalk(streetWalkRoute(inputs), lag);
    const arrived = out[out.length - 1]?.state;
    if (!arrived) throw new Error("the walk produced no checkpoints");
    expect(arrived.floor).toBe(PLAYER_START.floor);
    // Never fell down the subway stairwell on the way.
    for (const checkpoint of out) expect(checkpoint.state.floor).not.toBe(SUBWAY_FLOOR);

    let state = arrived;
    for (let lapIndex = 0; lapIndex < 3; lapIndex++) {
      const lap = simulateStreetWalk(streetBridgeLapRoute(), { ...lag, start: state });
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
