import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildPlayerDrawable,
  buildPropDrawables,
  updatePlayerDrawable,
} from "../../../src/test-street/drawables";
import {
  INTERIOR_FLOOR_TILES,
  INTERIOR_FLOOR_TILES_B,
  PLATFORM_LANDING_X,
  PLATFORM_LANDING_Y,
  PLAYER_START,
  SIDEWALK_TILES,
  SUBWAY_FLOOR,
} from "../../../src/test-street/fixture";
import { sortAcrossFloors } from "../../../src/render/floor-stacks";
import { buildLayerRankTable, resolveRank } from "../../../src/render/layer-ranks";
import { LAYER_TABLE, layerCodeByName } from "../../../src/render/layer-table";
import { screenPositionPx } from "../../../src/render/screen-position";
import { compareDrawables } from "../../../src/render/sort-key";
import { toSortUnits } from "../../../src/render/sort-units";
import { computeVisibility, type VisibilityViewer } from "../../../src/render/visibility";
import type { Vec2 } from "../../../src/world/movement";
import { step } from "../../../src/world/movement";
import { cellOf, NO_OWNER } from "../../../src/world/ownership";
import {
  streetMovementConfig,
  streetOwnershipIndex,
  streetWindowDefIds,
  streetWorldIndex,
  lamppostRestY,
} from "./street-world";
import {
  STREET_GOLDEN_ORDER,
  STREET_GOLDEN_ORDER_AFTER_WALKING_SOUTH,
  STREET_VISIBILITY_AT_LAMPPOST_OUTSIDE,
  STREET_VISIBILITY_AT_REST_IN_SHOP_A,
  STREET_VISIBILITY_ON_SUBWAY_LANDING,
} from "./golden";

// Mirrors `render.tile_size_px` / `render.storey_height_px`
// (`defs/defs.json`) -- the scene itself always reads these from the
// balance keys (`main.ts`), never a literal; this test pins the same
// values so the relation below stays a pure arithmetic fact, with no
// need to mount Pixi to check it.
const TILE_SIZE_PX = 16;
const STOREY_HEIGHT_PX = 48;

const CODE_BY_NAME: Record<string, number> = Object.fromEntries(
  LAYER_TABLE.map((row) => [row.name, row.code]),
);

function rankOf(layer: string): number {
  const table = buildLayerRankTable(LAYER_TABLE.map(({ code, rank }) => ({ code, rank })));
  const code = CODE_BY_NAME[layer];
  if (code === undefined) throw new Error(`unknown street layer ${layer}`);
  return resolveRank(table, code);
}

/** Every test below builds the same real props -- the street's own
 * ownership index and window def ids, exactly the way `scene.ts` does. */
function buildStreetProps() {
  return buildPropDrawables({
    rankOf,
    ownership: streetOwnershipIndex(),
    windowDefIds: streetWindowDefIds(),
  });
}

describe("the story 1.6 street scene's committed ordering", () => {
  it("sorts the whole fixture (props + player) to a fixed, committed id sequence", () => {
    const props = buildStreetProps();
    const player = buildPlayerDrawable(
      rankOf("characters"),
      PLAYER_START.x,
      PLAYER_START.y,
      PLAYER_START.floor,
    );
    const pool = sortAcrossFloors([...props, player], (d) => d);

    // Shared verbatim with `render-order.spec.ts` -- the comparator (run
    // here, directly, in node) and the real Pixi adapter (run there,
    // through a mounted display list) can never silently disagree about
    // what this scene renders.
    expect(pool.map((d) => d.stableId.toString())).toEqual(STREET_GOLDEN_ORDER);
  });

  it("sorts the fixture with the player walked south to rest against the story 1.8 obstacle to the second committed id sequence", () => {
    // Quentin's direction: the unit test owns this ordering fact too --
    // `render-order.spec.ts` only has to prove the real adapter reaches
    // it after a real move, never derive or own it by itself. Built
    // straight from the comparator, the same way the at-rest golden
    // above is, so a wrong golden here fails with a diff in the fastest
    // job instead of a ten-second timeout in the slowest one.
    const props = buildStreetProps();
    const player = buildPlayerDrawable(
      rankOf("characters"),
      PLAYER_START.x,
      lamppostRestY(),
      PLAYER_START.floor,
    );
    const pool = sortAcrossFloors([...props, player], (d) => d);

    expect(pool.map((d) => d.stableId.toString())).toEqual(
      STREET_GOLDEN_ORDER_AFTER_WALKING_SOUTH,
    );
  });

  it("worked example: the player stands between the west wall's near and far cells", () => {
    // FR125's AC, made explicit rather than left to the snapshot above:
    // the west wall runs toward the camera (width 1, height 4) beside
    // the player's start position. Cells nearer the north wall (smaller
    // y) sort behind the player; cells nearer the door (larger y) sort
    // in front -- the one thing a footprint running parallel to the
    // camera could never demonstrate.
    const props = buildStreetProps();
    const player = buildPlayerDrawable(
      rankOf("characters"),
      PLAYER_START.x,
      PLAYER_START.y,
      PLAYER_START.floor,
    );

    const westWallCells = props
      .filter((p) => p.stableId === 4n)
      .sort((a, b) => a.sourceRow - b.sourceRow);
    expect(westWallCells).toHaveLength(4);
    const farCell = westWallCells[0];
    const nearCell = westWallCells[westWallCells.length - 1];
    if (!farCell || !nearCell) throw new Error("unreachable");

    expect(compareDrawables(farCell, player)).toBeLessThan(0); // far end: behind the player
    expect(compareDrawables(nearCell, player)).toBeGreaterThan(0); // near end: in front of the player
  });

  it("a table and the glass on it share an anchor; the rank tiebreak keeps the glass on top", () => {
    const props = buildStreetProps();
    const table = props.find((p) => p.stableId === 9n);
    const glass = props.find((p) => p.stableId === 10n);
    if (!table || !glass) throw new Error("unreachable");
    expect(table.x).toBe(glass.x);
    expect(table.y).toBe(glass.y);
    expect(compareDrawables(table, glass)).toBeLessThan(0);
  });

  it("FR124: two drawables sharing (x, y, rank) but not floor are still ordered, by stableId alone, never floor", () => {
    // This fixture carries no real upper storey (removed, story 1.7 cycle
    // 2 -- `isStoreyAboveCulled` is proven directly, against synthetic
    // drawables, in `visibility.test.ts`), so this worked example builds
    // its own second drawable rather than reaching for one: a real ground
    // wall cell, and a copy of it on a different floor with a different
    // stableId -- the exact shape a real upper storey's own wall would
    // have shared with the one below it.
    const props = buildStreetProps();
    const groundWallCell = props.find((p) => p.stableId === 1n && p.sourceCol === 0);
    if (!groundWallCell) throw new Error("unreachable");
    const upperWallCell = { ...groundWallCell, stableId: 99_999n, floor: 1 };

    expect(groundWallCell.x).toBe(upperWallCell.x);
    expect(groundWallCell.y).toBe(upperWallCell.y);
    expect(groundWallCell.rank).toBe(upperWallCell.rank);
    expect(groundWallCell.floor).not.toBe(upperWallCell.floor);

    // The comparison result is driven entirely by stableId -- swapping
    // which one carries which floor changes nothing about the result,
    // which is exactly `inv_floor_never_affects_depth_order` applied to
    // this scene's own data.
    const swapped = { ...groundWallCell, floor: upperWallCell.floor };
    const swappedOther = { ...upperWallCell, floor: groundWallCell.floor };
    expect(compareDrawables(groundWallCell, upperWallCell)).toBe(
      compareDrawables(swapped, swappedOther),
    );
  });
});

describe("the street scene's committed visibility (story 1.7 cycle 2, Quentin's direction)", () => {
  // The unit counterpart to `../e2e/enclosure.spec.ts`: derives the same
  // three goldens straight from `buildPropDrawables` + `computeVisibility`
  // over the real street ownership index, resolving the viewer's own
  // `(floor, buildingId)` from a cell exactly the way `scene.ts` does
  // (`ownershipAt` on `cellOf(x)`/`cellOf(y)`) -- never a slow e2e round
  // trip as the only thing proving what a given position should show.
  // The two floors this street's ground-tile passes ever occupy (`fixture.ts`'s
  // `STREET_FLOOR`/`SUBWAY_FLOOR`) -- a ground group is never a window,
  // never near-side and never owned by a building (`NO_OWNER`), so floor
  // culling is the only rule that can ever apply to it, exactly mirroring
  // `scene.ts`'s own synthetic ground drawable.
  const GROUND_FLOORS = [0, -1] as const;

  function visibilityAt(x: number, y: number, floor: number): Record<string, string> {
    const ownership = streetOwnershipIndex();
    const props = buildStreetProps();
    const player = buildPlayerDrawable(rankOf("characters"), x, y, floor);
    const viewer: VisibilityViewer = {
      floor,
      buildingId: ownership.ownershipAt(cellOf(x), cellOf(y), floor).buildingId,
    };
    const result: Record<string, string> = {};
    for (const drawable of [...props, player]) {
      result[drawable.stableId.toString()] = computeVisibility(viewer, drawable);
    }
    for (const groundFloor of GROUND_FLOORS) {
      result[`ground:${groundFloor}`] = computeVisibility(viewer, {
        floor: groundFloor,
        layerCode: layerCodeByName("objects"),
        ownerBuildingId: NO_OWNER,
        isWindow: false,
        isNearSide: false,
        isStub: false,
      });
    }
    return result;
  }

  it("at rest in shop A", () => {
    expect(visibilityAt(PLAYER_START.x, PLAYER_START.y, PLAYER_START.floor)).toEqual(
      STREET_VISIBILITY_AT_REST_IN_SHOP_A,
    );
  });

  it("at the lamppost rest point outside", () => {
    expect(visibilityAt(PLAYER_START.x, lamppostRestY(), PLAYER_START.floor)).toEqual(
      STREET_VISIBILITY_AT_LAMPPOST_OUTSIDE,
    );
  });

  it("on the subway landing", () => {
    expect(visibilityAt(PLATFORM_LANDING_X + 0.5, PLATFORM_LANDING_Y + 0.5, SUBWAY_FLOOR)).toEqual(
      STREET_VISIBILITY_ON_SUBWAY_LANDING,
    );
  });
});

describe("the player can never walk off the drawn world", () => {
  // The scene's mount-time canvas-bounds guard (`assertSpritesWithinCanvas`)
  // only ever runs once, against the player's *starting* position -- it
  // can never catch a walk that leaves the drawn ground later. Nothing
  // clamps the player any more (story 1.8 deleted `PLAYER_BOUNDS`), so
  // the only thing keeping the avatar on the pavement is the fixture's
  // own boundary colliders; this walks the real resolver against the real
  // grid to prove that ring is actually closed, rather than trusting the
  // rect list by eye.
  const grid = streetWorldIndex();
  const config = streetMovementConfig();

  /** The drawn ground: interior floor and pavement, in screen pixels.
   * `x1`/`y1` are exclusive tile indices, so the drawn extent's own far
   * edge is at `x1 * tileSizePx`. */
  const groundScreenRects = [INTERIOR_FLOOR_TILES, INTERIOR_FLOOR_TILES_B, SIDEWALK_TILES].map(
    (tiles) => ({
      left: tiles.x0 * TILE_SIZE_PX,
      right: tiles.x1 * TILE_SIZE_PX,
      top: tiles.y0 * TILE_SIZE_PX,
      bottom: tiles.y1 * TILE_SIZE_PX,
    }),
  );

  /** The four corners of the player's collision body, in world cells. */
  function bodyCorners(pos: Vec2): readonly Vec2[] {
    const halfWidth = config.bodyWidthSubcells / 2 / config.subcellsPerCell;
    const height = config.bodyHeightSubcells / config.subcellsPerCell;
    return [
      { x: pos.x - halfWidth, y: pos.y - height },
      { x: pos.x + halfWidth, y: pos.y - height },
      { x: pos.x - halfWidth, y: pos.y },
      { x: pos.x + halfWidth, y: pos.y },
    ];
  }

  function isOnDrawnGround(pos: Vec2): boolean {
    // The union of the two ground rects has no hole, so a body entirely
    // inside it is exactly a body whose every corner is inside one of
    // them -- corner checking cannot pass a body that has left the
    // ground.
    return bodyCorners(pos).every((corner) => {
      const screen = screenPositionPx(
        corner.x,
        corner.y,
        PLAYER_START.floor,
        TILE_SIZE_PX,
        STOREY_HEIGHT_PX,
      );
      return groundScreenRects.some(
        (rect) =>
          screen.x >= rect.left &&
          screen.x <= rect.right &&
          screen.y >= rect.top &&
          screen.y <= rect.bottom,
      );
    });
  }

  it("stays on the interior floor or the pavement for any input sequence, every step", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            dx: fc.integer({ min: -1, max: 1 }),
            dy: fc.integer({ min: -1, max: 1 }),
            deltaMs: fc.integer({ min: 1, max: 5_000 }),
          }),
          { minLength: 1, maxLength: 400 },
        ),
        (inputs) => {
          let pos: Vec2 = { x: PLAYER_START.x, y: PLAYER_START.y };
          expect(isOnDrawnGround(pos)).toBe(true);
          for (const { dx, dy, deltaMs } of inputs) {
            pos = step(pos, { x: dx, y: dy }, deltaMs, grid, PLAYER_START.floor, config);
            expect(isOnDrawnGround(pos), `left the drawn world at (${pos.x}, ${pos.y})`).toBe(true);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("walking straight south rests against the lamppost, still on the last pavement row", () => {
    let pos: Vec2 = { x: PLAYER_START.x, y: PLAYER_START.y };
    for (let i = 0; i < 400; i++) {
      pos = step(pos, { x: 0, y: 1 }, 16, grid, PLAYER_START.floor, config);
    }
    expect(pos.y).toBeCloseTo(lamppostRestY(), 9);
    expect(isOnDrawnGround(pos)).toBe(true);
  });
});

describe("updatePlayerDrawable", () => {
  it("mutates the same object in place rather than allocating a new one", () => {
    const player = buildPlayerDrawable(
      rankOf("characters"),
      PLAYER_START.x,
      PLAYER_START.y,
      PLAYER_START.floor,
    );
    const sameObject = player;

    updatePlayerDrawable(player, PLAYER_START.x + 1, PLAYER_START.y + 1, PLAYER_START.floor);

    expect(player).toBe(sameObject);
    expect(player.x).toBe(toSortUnits(PLAYER_START.x + 1));
    expect(player.y).toBe(toSortUnits(PLAYER_START.y + 1));
    // Everything else about the player stays fixed.
    expect(player.rank).toBe(rankOf("characters"));
    expect(player.stableId).toBe(1000n);
    expect(player.floor).toBe(PLAYER_START.floor);
  });

  it("also updates the player's own floor on a floor transition -- FR122: a stale floor would read the player itself as floor-culled the instant it lands", () => {
    const player = buildPlayerDrawable(
      rankOf("characters"),
      PLAYER_START.x,
      PLAYER_START.y,
      PLAYER_START.floor,
    );

    updatePlayerDrawable(player, PLAYER_START.x, PLAYER_START.y, -1);

    expect(player.floor).toBe(-1);
  });
});
