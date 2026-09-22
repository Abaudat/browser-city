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
  PLAYER_START,
  STREET_BOUNDARY,
  STREET_BUILDING_AREAS,
  STREET_GROUND_TILES,
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
  streetObjectSources,
  streetOwnershipIndex,
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
