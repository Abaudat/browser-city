import { describe, expect, it } from "vitest";
import {
  buildPlayerDrawable,
  buildPropDrawables,
  updatePlayerDrawable,
} from "../../../src/demo/drawables";
import { PLAYER_BOUNDS, PLAYER_START, SIDEWALK_TILES } from "../../../src/demo/fixture";
import { buildLayerRankTable, resolveRank } from "../../../src/render/layer-ranks";
import { LAYER_TABLE } from "../../../src/render/layer-table";
import { screenPositionPx } from "../../../src/render/screen-position";
import { compareDrawables, sortDrawablesInPlace } from "../../../src/render/sort-key";
import { toSortUnits } from "../../../src/render/sort-units";
import { DEMO_SCENE_GOLDEN_ORDER, DEMO_SCENE_GOLDEN_ORDER_AFTER_WALKING_SOUTH } from "./golden";

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
  if (code === undefined) throw new Error(`unknown demo layer ${layer}`);
  return resolveRank(table, code);
}

describe("the story 1.6 demo scene's committed ordering", () => {
  it("sorts the whole fixture (props + player) to a fixed, committed id sequence", () => {
    const props = buildPropDrawables((layer) => rankOf(layer));
    const player = buildPlayerDrawable(rankOf("characters"), PLAYER_START.x, PLAYER_START.y);
    const pool = [...props, player];
    sortDrawablesInPlace(pool);

    // Shared verbatim with `render-order.spec.ts` -- the comparator (run
    // here, directly, in node) and the real Pixi adapter (run there,
    // through a mounted display list) can never silently disagree about
    // what this scene renders.
    expect(pool.map((d) => d.stableId.toString())).toEqual(DEMO_SCENE_GOLDEN_ORDER);
  });

  it("sorts the fixture with the player walked south to the clamped bound to the second committed id sequence", () => {
    // Quentin's direction: the unit test owns this ordering fact too --
    // `render-order.spec.ts` only has to prove the real adapter reaches
    // it after a real move, never derive or own it by itself. Built
    // straight from the comparator, the same way the at-rest golden
    // above is, so a wrong golden here fails with a diff in the fastest
    // job instead of a ten-second timeout in the slowest one.
    const props = buildPropDrawables((layer) => rankOf(layer));
    const player = buildPlayerDrawable(rankOf("characters"), PLAYER_START.x, PLAYER_BOUNDS.y1);
    const pool = [...props, player];
    sortDrawablesInPlace(pool);

    expect(pool.map((d) => d.stableId.toString())).toEqual(
      DEMO_SCENE_GOLDEN_ORDER_AFTER_WALKING_SOUTH,
    );
  });

  it("worked example: the player stands between the west wall's near and far cells", () => {
    // FR125's AC, made explicit rather than left to the snapshot above:
    // the west wall runs toward the camera (width 1, height 4) beside
    // the player's start position. Cells nearer the north wall (smaller
    // y) sort behind the player; cells nearer the door (larger y) sort
    // in front -- the one thing a footprint running parallel to the
    // camera could never demonstrate.
    const props = buildPropDrawables((layer) => rankOf(layer));
    const player = buildPlayerDrawable(rankOf("characters"), PLAYER_START.x, PLAYER_START.y);

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
    const props = buildPropDrawables((layer) => rankOf(layer));
    const table = props.find((p) => p.stableId === 9n);
    const glass = props.find((p) => p.stableId === 10n);
    if (!table || !glass) throw new Error("unreachable");
    expect(table.x).toBe(glass.x);
    expect(table.y).toBe(glass.y);
    expect(compareDrawables(table, glass)).toBeLessThan(0);
  });

  it("FR124: the upper-storey wall shares (x, y, rank) with the ground-floor wall, and only the stableId tiebreak (never floor) orders them", () => {
    const props = buildPropDrawables((layer) => rankOf(layer));
    const groundWallCell = props.find((p) => p.stableId === 1n && p.sourceCol === 0);
    const upperWallCell = props.find((p) => p.stableId === 12n && p.sourceCol === 0);
    if (!groundWallCell || !upperWallCell) throw new Error("unreachable");
    expect(groundWallCell.x).toBe(upperWallCell.x);
    expect(groundWallCell.y).toBe(upperWallCell.y);
    expect(groundWallCell.rank).toBe(upperWallCell.rank);
    expect(groundWallCell.floor).not.toBe(upperWallCell.floor);

    // The comparison result is driven entirely by stableId (1n < 12n) --
    // swapping which one carries which floor changes nothing about the
    // result, which is exactly `inv_floor_never_affects_depth_order`
    // applied to this scene's own data.
    const swapped = { ...groundWallCell, floor: upperWallCell.floor };
    const swappedOther = { ...upperWallCell, floor: groundWallCell.floor };
    expect(compareDrawables(groundWallCell, upperWallCell)).toBe(
      compareDrawables(swapped, swappedOther),
    );
  });
});

describe("PLAYER_BOUNDS stays within the world the scene actually draws (Quentin's cycle-4 direction)", () => {
  // The scene's mount-time canvas-bounds guard (`assertSpritesWithinCanvas`)
  // only ever runs once, against the player's *starting* position -- it
  // can never catch a clamp that only overruns the drawn world once the
  // player has actually walked there. This pins the relation directly
  // against the pure `screenPositionPx` the scene itself uses, so a
  // future edit to either the bounds or the fixture's ground extent fails
  // here, cheaply, instead of drawing the player off the pavement.
  it("keeps every corner of PLAYER_BOUNDS drawn no lower than the pavement's own last row", () => {
    // `SIDEWALK_TILES.y1` is exclusive -- the last drawn pavement row's
    // own bottom edge, in world pixels, is exactly `y1 * tileSizePx`.
    const groundBottomPx = SIDEWALK_TILES.y1 * TILE_SIZE_PX;
    const corners = [
      { x: PLAYER_BOUNDS.x0, y: PLAYER_BOUNDS.y0 },
      { x: PLAYER_BOUNDS.x0, y: PLAYER_BOUNDS.y1 },
      { x: PLAYER_BOUNDS.x1, y: PLAYER_BOUNDS.y0 },
      { x: PLAYER_BOUNDS.x1, y: PLAYER_BOUNDS.y1 },
    ] as const;

    for (const corner of corners) {
      const pos = screenPositionPx(
        corner.x,
        corner.y,
        PLAYER_START.floor,
        TILE_SIZE_PX,
        STOREY_HEIGHT_PX,
      );
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeLessThanOrEqual(groundBottomPx);
      expect(pos.x).toBeGreaterThanOrEqual(SIDEWALK_TILES.x0 * TILE_SIZE_PX);
      expect(pos.x).toBeLessThanOrEqual(SIDEWALK_TILES.x1 * TILE_SIZE_PX);
    }
  });
});

describe("updatePlayerDrawable", () => {
  it("mutates the same object in place rather than allocating a new one", () => {
    const player = buildPlayerDrawable(rankOf("characters"), PLAYER_START.x, PLAYER_START.y);
    const sameObject = player;

    updatePlayerDrawable(player, PLAYER_START.x + 1, PLAYER_START.y + 1);

    expect(player).toBe(sameObject);
    expect(player.x).toBe(toSortUnits(PLAYER_START.x + 1));
    expect(player.y).toBe(toSortUnits(PLAYER_START.y + 1));
    // Everything else about the player stays fixed.
    expect(player.rank).toBe(rankOf("characters"));
    expect(player.stableId).toBe(1000n);
    expect(player.floor).toBe(PLAYER_START.floor);
  });
});
