import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sortAcrossFloors } from "../../../src/render/floor-stacks";
import { buildLayerRankTable, resolveRank } from "../../../src/render/layer-ranks";
import {
  FIRST_POOL_RANK,
  LAYER_TABLE,
  layerCodeByName,
  passOfLayer,
} from "../../../src/render/layer-table";
import { compareDrawables } from "../../../src/render/sort-key";
import { SORT_SUBDIVISIONS, toSortUnits } from "../../../src/render/sort-units";
import { computeVisibility, type VisibilityViewer } from "../../../src/render/visibility";
import { CROWD_FLOOR } from "../../../src/test-street/citizens";
import {
  buildPlayerDrawable,
  buildPropDrawables,
  updatePlayerDrawable,
} from "../../../src/test-street/drawables";
import {
  BRIDGE_DECK_Y,
  BRIDGE_X1,
  INTERIOR_FLOOR_TILES,
  INTERIOR_FLOOR_TILES_B,
  isDefStreetProp,
  LAMPPOST_CELL,
  PLATFORM_LANDING_X,
  PLATFORM_LANDING_Y,
  PLATFORM_STAIRWELL_ROWS,
  PLAYER_START,
  SIDEWALK_TILES,
  STAIRS_ENTRY_DIRECTION,
  STAIRWELL_BOTTOM_RAILING_DEF_ID,
  STAIRWELL_TOP_RAILING_DEF_ID,
  STAIRWELL_X0,
  STREET_FLOOR,
  STREET_PROPS,
  SUBWAY_FLOOR,
  streetDefId,
  streetNearRailingPressRoute,
  wallRunCellId,
} from "../../../src/test-street/fixture";
import type { Vec2 } from "../../../src/world/movement";
import { step } from "../../../src/world/movement";
import { cellOf, NO_OWNER } from "../../../src/world/ownership";
import {
  STREET_GOLDEN_ORDER,
  STREET_GOLDEN_ORDER_AFTER_WALKING_SOUTH,
  STREET_VISIBILITY_AT_LAMPPOST_OUTSIDE,
  STREET_VISIBILITY_AT_REST_IN_SHOP_A,
  STREET_VISIBILITY_ON_SUBWAY_LANDING,
} from "./golden";
import {
  lamppostRestY,
  nearRailingRestY,
  shopfrontExitRestY,
  simulateStreetWalk,
  stairwellRowsAt,
  streetMovementConfig,
  streetObjectSources,
  streetOwnershipIndex,
  streetWalkInputs,
  streetWindowDefIds,
  streetWorldIndex,
  subwayAnchors,
  topRailingFoot,
  treadPath,
} from "./street-world";

// Mirrors `render.tile_size_px` / `render.storey_height_px`
// (`defs/defs.json`) -- the scene itself always reads these from the
// balance keys (`main.ts`), never a literal; this test pins the same
// values so the relation below stays a pure arithmetic fact, with no
// need to mount Pixi to check it.
const TILE_SIZE_PX = 16;

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
    objectDefs: streetObjectSources(),
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
    const pool = sortAcrossFloors([...props, player], (d) => d).filter(
      (d) => d.rank >= FIRST_POOL_RANK,
    );

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
    // Story 2.13: `LAMPPOST_CELL.x`, not `PLAYER_START.x` -- the lamppost
    // no longer shares the door's own column (`LAMPPOST_CELL`'s own doc
    // comment says why).
    const player = buildPlayerDrawable(
      rankOf("characters"),
      LAMPPOST_CELL.x + 0.5,
      lamppostRestY(),
      PLAYER_START.floor,
    );
    const pool = sortAcrossFloors([...props, player], (d) => d).filter(
      (d) => d.rank >= FIRST_POOL_RANK,
    );

    expect(pool.map((d) => d.stableId.toString())).toEqual(STREET_GOLDEN_ORDER_AFTER_WALKING_SOUTH);
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

    const westWallIds = new Set([0, 1, 2, 3].map((index) => wallRunCellId(4n, index)));
    const westWallCells = props
      .filter((p) => westWallIds.has(p.stableId))
      .sort((a, b) => a.y - b.y);
    expect(westWallCells).toHaveLength(4);
    const farCell = westWallCells[0];
    const nearCell = westWallCells[westWallCells.length - 1];
    if (!farCell || !nearCell) throw new Error("unreachable");

    expect(compareDrawables(farCell, player)).toBeLessThan(0); // far end: behind the player
    expect(compareDrawables(nearCell, player)).toBeGreaterThan(0); // near end: in front of the player
  });

  // Stories 15.3 / 15.13 (FR123): the street stairwell is objects so
  // the player walks between the railings -- behind the near (bottom) one,
  // in front of the far (top) one -- wherever the body can rest on the
  // treads. The sweep covers every position the real resolver allows on the
  // entry cell and the tread path, at sub-cell step. (The platform's flight
  // is one flat row with a railing beside it: story 15.11, below.)
  describe("street stairwell sort oracle", () => {
    const floor = STREET_FLOOR;
    const pooled = buildStreetProps().filter(
      (d) =>
        "defId" in d &&
        d.floor === floor &&
        (d.defId === STAIRWELL_TOP_RAILING_DEF_ID || d.defId === STAIRWELL_BOTTOM_RAILING_DEF_ID),
    );

    /** The oracle, as a function of the feet position: every stairwell pool row whose ground row
     * is south of the feet sorts after the player, every one north before. */
    function expectStairwellSortAt(x: number, y: number) {
      const player = buildPlayerDrawable(rankOf("characters"), x, y, floor);
      for (const row of pooled) {
        const where = `player (${x}, ${y}) vs def ${"defId" in row ? row.defId : "?"} row ${row.y / SORT_SUBDIVISIONS}`;
        if (row.y / SORT_SUBDIVISIONS > y) {
          expect(compareDrawables(row, player), where).toBeGreaterThan(0);
        } else {
          expect(compareDrawables(row, player), where).toBeLessThan(0);
        }
      }
    }

    it("floor 0: the player sorts correctly against both railings at every sub-cell step over the entry cell and tread path", () => {
      const anchor = subwayAnchors().find((a) => a.anchor.floor === floor)?.anchor;
      if (!anchor) throw new Error("no street anchor");
      const path = treadPath(stairwellRowsAt(anchor), anchor, STAIRS_ENTRY_DIRECTION);
      const cells = [path.entry, ...path.path];
      expect(cells.length).toBeGreaterThanOrEqual(3);
      const pool = pooled;
      expect(
        pool.filter((d) => "defId" in d && d.defId === STAIRWELL_TOP_RAILING_DEF_ID),
      ).toHaveLength(3);
      expect(
        pool.filter((d) => "defId" in d && d.defId === STAIRWELL_BOTTOM_RAILING_DEF_ID),
      ).toHaveLength(3);
      const SUB = 16;
      for (const cell of cells) {
        for (let i = 0; i < SUB; i++) {
          for (let j = 0; j < SUB; j++) expectStairwellSortAt(cell.x + i / SUB, cell.y + j / SUB);
        }
      }
    });

    it("both resting postures of the press route (collider rest south, upper rail north) sort correctly, and are where the helpers say", () => {
      const inputs = streetWalkInputs();
      const out = simulateStreetWalk(streetNearRailingPressRoute(inputs));
      const south = out.find((c) => c.label === "press-south")?.state;
      const north = out.find((c) => c.label === "press-north")?.state;
      if (!south || !north) throw new Error("no rest checkpoint");
      expect(south.y).toBeCloseTo(nearRailingRestY(), 9);
      expect(north.y).toBeCloseTo(inputs.subwayTreadRowY, 9);
      for (const rest of [south, north]) {
        expect(rest.floor).toBe(floor);
        expectStairwellSortAt(rest.x, rest.y);
      }
    });

    it("negative control: a player south of the stairwell draws over the bottom railing, and one north of it under the top railing", () => {
      expect(pooled.length).toBe(6);
      const bottom = pooled.filter(
        (d) => "defId" in d && d.defId === STAIRWELL_BOTTOM_RAILING_DEF_ID,
      );
      const top = pooled.filter((d) => "defId" in d && d.defId === STAIRWELL_TOP_RAILING_DEF_ID);
      const south = buildPlayerDrawable(
        rankOf("characters"),
        (bottom[0]?.x ?? Number.NaN) / SORT_SUBDIVISIONS,
        (bottom[0]?.y ?? Number.NaN) / SORT_SUBDIVISIONS + 1.5,
        floor,
      );
      const north = buildPlayerDrawable(
        rankOf("characters"),
        (top[0]?.x ?? Number.NaN) / SORT_SUBDIVISIONS,
        (top[0]?.y ?? Number.NaN) / SORT_SUBDIVISIONS - 0.5,
        floor,
      );
      for (const rail of bottom) expect(compareDrawables(rail, south)).toBeLessThan(0);
      for (const rail of top) expect(compareDrawables(rail, north)).toBeGreaterThan(0);
    });

    it("north of the top railing the player is behind it, at every sub-cell step from the finial row to the foot's rest, on each column (story 15.12)", () => {
      const sub = streetMovementConfig().subcellsPerCell;
      const foot = topRailingFoot();
      const rest = foot.rect.y0;
      let steps = 0;
      for (let dx = 0; dx < foot.width; dx++) {
        for (let feetY = foot.prop.y - 1 + 1 / sub; feetY <= rest + 1e-9; feetY += 1 / sub) {
          expectStairwellSortAt(foot.prop.x + dx + 0.5, feetY);
          steps++;
        }
      }
      expect(steps).toBeGreaterThan(0);
    });
  });

  it("a table and the glass on it share an anchor; the rank tiebreak keeps the glass on top", () => {
    const props = buildStreetProps();
    const glass = props.find((p) => p.stableId === 10n);
    if (!glass) throw new Error("unreachable");
    // The table is decomposed per cell; the glass shares its south-west one.
    const table = props.find((p) => p.stableId === 9n && p.x === glass.x && p.y === glass.y);
    if (!table) throw new Error("no table cell at the glass's own anchor");
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
    const flatFloors = new Set<number>();
    for (const drawable of [...props, player]) {
      if (drawable.rank < FIRST_POOL_RANK) {
        flatFloors.add(drawable.floor);
        continue;
      }
      result[drawable.stableId.toString()] = computeVisibility(viewer, drawable);
    }
    const group = (floor: number, layer: string) =>
      computeVisibility(viewer, {
        floor,
        layerCode: layerCodeByName(layer),
        ownerBuildingId: NO_OWNER,
        isWindow: false,
        isNearSide: false,
        isStub: false,
      });
    for (const groundFloor of GROUND_FLOORS) {
      result[`ground:${groundFloor}`] = group(groundFloor, "ground");
      // Story 15.8: mirrors `regen-golden.ts`'s own `ground_decals:<floor>`
      // key -- the ground-decals pass is culled the same way the ground
      // pass is.
      result[`ground_decals:${groundFloor}`] = group(groundFloor, "ground");
    }
    for (const floor of flatFloors) {
      result[`ground_objects:${floor}`] = group(floor, "ground_objects");
    }
    // Story 15.8: the crowd's own flat, floor-0 visibility member --
    // mirrors `regen-golden.ts`'s own `visibilityAt`, so the golden this
    // asserts against and the golden actually committed are derived from
    // exactly the same facts.
    result[`crowd:${CROWD_FLOOR}`] = group(CROWD_FLOOR, "characters");
    return result;
  }

  it("at rest in shop A", () => {
    expect(visibilityAt(PLAYER_START.x, PLAYER_START.y, PLAYER_START.floor)).toEqual(
      STREET_VISIBILITY_AT_REST_IN_SHOP_A,
    );
  });

  it("at the lamppost rest point outside", () => {
    // Story 2.13: `LAMPPOST_CELL.x`, not `PLAYER_START.x` -- see
    // `LAMPPOST_CELL`'s own doc comment for why they no longer share a
    // column.
    expect(visibilityAt(LAMPPOST_CELL.x + 0.5, lamppostRestY(), PLAYER_START.floor)).toEqual(
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
  // The camera now follows the player everywhere the fixture's own
  // colliders let it walk (the camera/viewport story), so there is no
  // mount-time canvas-bounds guard here any more to catch a stray walk --
  // nothing clamps the player either (story 1.8 deleted `PLAYER_BOUNDS`),
  // so the only thing keeping the avatar on the pavement is the fixture's
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
    // ground. A raw world-space corner is compared against the ground
    // rects in the same plain `tile * tileSizePx` pixel space they were
    // built in above -- never through `cellBottomCentre`, which adds a
    // bottom-centre *sprite anchor* offset (`+0.5` tile in x, `+1` tile
    // in y) that has nothing to do with where a collision corner actually
    // sits. That mismatch went unnoticed while every walk this property
    // covered stayed comfortably inside the ground rects' own interior;
    // it surfaces the moment a corner is checked within about a tile of
    // a rect's real edge (found while extending this property to the
    // bridge's own east end, story 1.13 cycle 2), which is exactly where
    // a boundary hole would otherwise go undetected.
    return bodyCorners(pos).every((corner) => {
      const screenX = corner.x * TILE_SIZE_PX;
      const screenY = corner.y * TILE_SIZE_PX;
      return groundScreenRects.some(
        (rect) =>
          screenX >= rect.left &&
          screenX <= rect.right &&
          screenY >= rect.top &&
          screenY <= rect.bottom,
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

  it("walking straight south rests against the real trash bin directly south of the door (story 2.13; story 15.2, cycle 2, Quentin's finding 3)", () => {
    // The lamppost no longer shares the door's own column (`LAMPPOST_
    // CELL`'s own doc comment says why), so a straight south walk out of
    // the door now rests against the real trash bin's own base collider
    // instead (FR148, story 1.9; `shopfrontExitRestY`'s own doc comment
    // in `street-world.ts` says why this replaces the old, undrawn
    // `SHOPFRONT_EXIT_REST_COLLIDER`, Quentin's finding 3) -- the scripted
    // walk's own "east-to-the-lamppost" segment is what actually reaches
    // the lamppost, from here (`street-conformance.test.ts`).
    let pos: Vec2 = { x: PLAYER_START.x, y: PLAYER_START.y };
    for (let i = 0; i < 400; i++) {
      pos = step(pos, { x: 0, y: 1 }, 16, grid, PLAYER_START.floor, config);
      expect(isOnDrawnGround(pos), `left the drawn world at (${pos.x}, ${pos.y})`).toBe(true);
    }
    expect(pos.y).toBeCloseTo(shopfrontExitRestY(), 9);
  });

  // Story 15.12: the top railing collides at its foot, so a body can stand
  // wholly inside the open strip of its row. That strip must not lead out of
  // the world past the well's west end, nor down into the treads.
  it("a body inside the top railing's open strip cannot slide out west past the well, nor down into the treads, for any input sequence", () => {
    const foot = topRailingFoot();
    const half = config.bodyWidthSubcells / 2 / config.subcellsPerCell;
    const overWell = (pos: Vec2) => pos.x + half > foot.rect.x0 && pos.x - half < foot.rect.x1;
    const outsideTheWorld = (pos: Vec2) =>
      pos.x - half < STAIRWELL_X0 - 1e-9 && pos.y > foot.prop.y;
    const start = (x: number): Vec2 => ({ x, y: foot.rect.y0 });
    /** Runs the inputs from the strip. The invariant: a body over the well
     * at-or-north of the foot face that is still over the well after a step
     * is stopped by the foot. A body that has left the well (a diagonal step
     * clears its last column in the X pass, then the Y pass carries it south
     * down the entrance column) is no longer the foot's business, and may
     * come back west onto the treads through the opening. */
    const run = (
      from: Vec2,
      inputs: readonly { dx: number; dy: number; deltaMs: number }[],
    ): void => {
      let pos = from;
      for (const { dx, dy, deltaMs } of inputs) {
        const before = pos;
        pos = step(pos, { x: dx, y: dy }, deltaMs, grid, PLAYER_START.floor, config);
        expect(outsideTheWorld(pos), `slid out of the world at (${pos.x}, ${pos.y})`).toBe(false);
        if (overWell(before) && before.y <= foot.rect.y0 + 1e-9 && overWell(pos)) {
          expect(
            pos.y,
            `stepped through the foot at (${before.x}, ${before.y})`,
          ).toBeLessThanOrEqual(foot.rect.y0 + 1e-9);
        }
      }
    };
    const repeat = (dx: number, dy: number, n: number) =>
      Array.from({ length: n }, () => ({ dx, dy, deltaMs: 100 }));
    for (const direction of [-1, 1]) {
      run(start(foot.rect.x0 + 1.5), repeat(direction, 0, 400));
    }
    // East out of the strip, south down the entrance column, west through
    // the opening onto the treads: legitimate, and the invariant tolerates it.
    const around = [...repeat(1, 0, 20), ...repeat(0, 1, 8), ...repeat(-1, 0, 12)];
    run(start(foot.rect.x0 + half), around);
    // A diagonal off the strip's east end, in one step.
    run(start(foot.rect.x0 + half), repeat(1, 1, 40));
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
        fc.integer({ min: 0, max: 8 }),
        (inputs, offset) =>
          run(start(foot.rect.x0 + half + offset / config.subcellsPerCell), inputs),
      ),
      { numRuns: 60 },
    );
  });

  // Story 1.13, cycle 2 (Quentin's direction): the bridge's own east end
  // specifically, not only the general walk from the shop -- a hole in
  // the boundary ring there must fail here, at unit speed, rather than
  // only ever showing up as a wrong-looking screenshot.
  it("stays on the pavement for any input sequence starting under the bridge's own east end", () => {
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
          let pos: Vec2 = { x: BRIDGE_X1 + 0.5, y: BRIDGE_DECK_Y + 0.5 };
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

  it("walking straight east from under the bridge stops at the world's own edge, still on the pavement", () => {
    let pos: Vec2 = { x: BRIDGE_X1 + 0.5, y: BRIDGE_DECK_Y + 0.5 };
    for (let i = 0; i < 400; i++) {
      pos = step(pos, { x: 1, y: 0 }, 16, grid, PLAYER_START.floor, config);
    }
    expect(isOnDrawnGround(pos)).toBe(true);
    // Actually stopped (the boundary collider caught it), not merely
    // exhausted the loop mid-stride.
    const further = step(pos, { x: 1, y: 0 }, 16, grid, PLAYER_START.floor, config);
    expect(further.x).toBeCloseTo(pos.x, 9);
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

describe("story 15.5: flat objects stay under the player, upright props keep y-sorting", () => {
  const isFlat = (d: { rank: number }) => d.rank < FIRST_POOL_RANK;
  const flatProps = () => buildStreetProps().filter(isFlat);

  /** Where `player` is drawn in the full drawn order, or -1. */
  function indexIn(order: readonly { stableId: bigint }[], stableId: bigint): number {
    return order.findIndex((d) => d.stableId === stableId);
  }

  it("the fixture has flat props at all (the sweep below is not vacuous)", () => {
    expect(flatProps().length).toBeGreaterThan(0);
  });

  it("every flat prop is drawn before the player at every sub-cell step over the 3x3 cells around it", () => {
    const props = buildStreetProps();
    for (const flat of flatProps()) {
      const cx = flat.x / SORT_SUBDIVISIONS;
      const cy = flat.y / SORT_SUBDIVISIONS;
      for (let ux = (cx - 1) * SORT_SUBDIVISIONS; ux <= (cx + 2) * SORT_SUBDIVISIONS; ux++) {
        for (let uy = (cy - 1) * SORT_SUBDIVISIONS; uy <= (cy + 2) * SORT_SUBDIVISIONS; uy++) {
          const player = buildPlayerDrawable(
            rankOf("characters"),
            ux / SORT_SUBDIVISIONS,
            uy / SORT_SUBDIVISIONS,
            flat.floor,
          );
          const order = sortAcrossFloors([...props, player], (d) => d);
          expect(indexIn(order, flat.stableId)).toBeLessThan(indexIn(order, player.stableId));
        }
      }
    }
  });

  it("a flat prop is drawn before a player one tile north of it, in drawn order", () => {
    const props = buildStreetProps();
    for (const flat of flatProps()) {
      const cx = flat.x / SORT_SUBDIVISIONS;
      const cy = flat.y / SORT_SUBDIVISIONS;
      for (const [dx, dy] of [
        [0, 0],
        [0, -1],
        [0, 1],
        [1, 0],
        [-1, 0],
      ] as const) {
        const player = buildPlayerDrawable(
          rankOf("characters"),
          cx + 0.5 + dx,
          cy + 0.5 + dy,
          flat.floor,
        );
        const order = sortAcrossFloors([...props, player], (d) => d);
        expect(indexIn(order, flat.stableId)).toBeLessThan(indexIn(order, player.stableId));
      }
    }
  });

  it("the bin, lamppost and bollards still draw in front of a player north of them and behind one south of them", () => {
    const props = buildStreetProps();
    for (const id of [15n, 14n, 118n, 121n, 122n]) {
      const upright = props.filter((p) => p.stableId === id);
      expect(upright.length).toBeGreaterThan(0);
      const cx = upright[0].x / SORT_SUBDIVISIONS;
      const cy = upright[0].y / SORT_SUBDIVISIONS;
      const north = buildPlayerDrawable(rankOf("characters"), cx + 0.5, cy - 1, upright[0].floor);
      const south = buildPlayerDrawable(rankOf("characters"), cx + 0.5, cy + 1, upright[0].floor);
      const northOrder = sortAcrossFloors([...props, north], (d) => d);
      const southOrder = sortAcrossFloors([...props, south], (d) => d);
      expect(indexIn(northOrder, north.stableId)).toBeLessThan(indexIn(northOrder, id));
      expect(indexIn(southOrder, south.stableId)).toBeGreaterThan(indexIn(southOrder, id));
    }
  });

  // Story 15.11 (AC1 sort): the platform flight is walked on, so a player on
  // the entry cell or any tread is drawn over the flight, over everything
  // north of that row and under every collider row south of it.
  it("the platform flight is in the flat sweep's population, and the player sorts correctly at every sub-cell step over its entry cell and tread path", () => {
    const sources = streetObjectSources();
    const flightRows = PLATFORM_STAIRWELL_ROWS.filter(
      (p) => isDefStreetProp(p) && passOfLayer(layerCodeByName(p.layer)) === "groundObjects",
    );
    expect(flightRows.length).toBeGreaterThan(0);
    const flatIds = new Set(flatProps().map((d) => d.stableId));
    for (const row of flightRows) expect(flatIds.has(row.id)).toBe(true);

    // The tread path and the entry cell, from the pairing (one definition,
    // shared with the conformance tests).
    const platform = subwayAnchors().find(({ anchor }) => anchor.floor === SUBWAY_FLOOR);
    if (!platform) throw new Error("no platform anchor");
    const stairPath = treadPath(
      stairwellRowsAt(platform.anchor),
      platform.anchor,
      platform.open.direction,
    );
    const cells = [stairPath.entry, ...stairPath.path];
    expect(cells.length).toBeGreaterThanOrEqual(3); // entry, landing, anchor

    const props = buildStreetProps();
    const colliderRowIds = (north: boolean, row: number) =>
      new Set(
        STREET_PROPS.filter((p) => {
          if (p.floor !== SUBWAY_FLOOR) return false;
          const defId = isDefStreetProp(p) ? p.defId : streetDefId(p.id);
          if (!sources.get(defId)?.collider) return false;
          if (passOfLayer(layerCodeByName(p.layer)) !== "pool") return false;
          // One-row props only: a tall run's cells straddle the path row.
          const rows = isDefStreetProp(p)
            ? sources.get(p.defId)?.height
            : (p.footprint?.height ?? 1);
          if (rows !== 1) return false;
          return north ? p.y < row : p.y > row;
        }).map((p) => p.id),
      );
    const flightIds = new Set(flightRows.map((r) => r.id));
    const SUB = 16;
    for (const cell of cells) {
      const northIds = colliderRowIds(true, cell.y);
      const southIds = colliderRowIds(false, cell.y);
      // Every y-sorted row of the platform stairwell (the railing) is
      // compared with the player, never silently dropped from the sets.
      for (const row of PLATFORM_STAIRWELL_ROWS) {
        if (passOfLayer(layerCodeByName(row.layer)) !== "pool") continue;
        expect(
          northIds.has(row.id) || southIds.has(row.id),
          `row ${row.id} is in neither the north nor the south collider set at (${cell.x}, ${cell.y})`,
        ).toBe(true);
      }
      for (let i = 0; i < SUB; i++) {
        for (let j = 0; j < SUB; j++) {
          const player = buildPlayerDrawable(
            rankOf("characters"),
            cell.x + i / SUB,
            cell.y + j / SUB,
            SUBWAY_FLOOR,
          );
          const order = sortAcrossFloors([...props, player], (d) => d);
          const at = indexIn(order, player.stableId);
          for (const [index, d] of order.entries()) {
            if (d.floor !== SUBWAY_FLOOR) continue;
            const where = `player at (${cell.x + i / SUB}, ${cell.y + j / SUB})`;
            if (flightIds.has(d.stableId) || northIds.has(d.stableId)) {
              expect(index, `${where}: ${d.stableId} must be drawn before`).toBeLessThan(at);
            } else if (southIds.has(d.stableId)) {
              expect(index, `${where}: ${d.stableId} must be drawn after`).toBeGreaterThan(at);
            }
          }
        }
      }
    }
  });

  it("the manhole covers and the doormat are on the flat ground-objects pass; the stairs and bin are not", () => {
    const props = buildStreetProps();
    for (const id of [116n, 117n, 119n, 120n]) {
      expect(props.find((p) => p.stableId === id)?.layerCode).toBe(
        layerCodeByName("ground_objects"),
      );
    }
    for (const id of [80n, 15n]) {
      const p = props.find((q) => q.stableId === id);
      expect(p && passOfLayer(p.layerCode)).toBe("pool");
    }
  });
});
