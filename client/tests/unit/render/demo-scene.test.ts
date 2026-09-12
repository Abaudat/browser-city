import { describe, expect, it } from "vitest";
import { PLAYER_START } from "../../../src/render/demo-fixture";
import { buildPlayerDrawable, buildPropDrawables } from "../../../src/render/demo-scene-drawables";
import { buildLayerRankTable, resolveRank } from "../../../src/render/layer-ranks";
import { compareDrawables, sortDrawablesInPlace } from "../../../src/render/sort-key";
import { DEMO_SCENE_GOLDEN_ORDER } from "./demo-scene-golden";

// Mirrors `server/sim/tests/goldens/codes_v1.golden`'s `layer` rows --
// fixture data for this test only (`layer-ranks.test.ts` pins the lookup
// logic itself; this file is about the demo scene's own ordering).
const LAYER_ROWS = [
  { code: 2, rank: 10 }, // furniture
  { code: 3, rank: 20 }, // objects
  { code: 4, rank: 30 }, // walls
  { code: 5, rank: 40 }, // wall_decals
  { code: 6, rank: 50 }, // characters
];
const LAYER_CODE_BY_NAME: Record<string, number> = {
  furniture: 2,
  objects: 3,
  walls: 4,
  wall_decals: 5,
  characters: 6,
};

function rankOf(layer: keyof typeof LAYER_CODE_BY_NAME): number {
  const table = buildLayerRankTable(LAYER_ROWS);
  const code = LAYER_CODE_BY_NAME[layer];
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

  it("worked example: the player stands between the counter's near and far ends", () => {
    // FR125's AC, made explicit rather than left to the snapshot above:
    // the counter runs toward the camera (width=1, height=3) beside the
    // player's start position. The far cell (smaller y) sorts behind the
    // player; the near cell (larger y) sorts in front -- the one thing a
    // footprint running parallel to the camera could never demonstrate.
    const props = buildPropDrawables((layer) => rankOf(layer));
    const player = buildPlayerDrawable(rankOf("characters"), PLAYER_START.x, PLAYER_START.y);

    const counterCells = props.filter((p) => p.stableId === 4n);
    expect(counterCells).toHaveLength(3);
    const farCell = counterCells.find((c) => c.sourceRow === 0);
    const middleCell = counterCells.find((c) => c.sourceRow === 1);
    const nearCell = counterCells.find((c) => c.sourceRow === 2);
    if (!farCell || !middleCell || !nearCell) throw new Error("unreachable");

    // far end: behind the player (drawn first)
    expect(compareDrawables(farCell, player)).toBeLessThan(0);
    // same row as the player: furniture's rank is below characters', so
    // it draws behind regardless of x
    expect(compareDrawables(middleCell, player)).toBeLessThan(0);
    // near end: in front of the player (drawn after)
    expect(compareDrawables(nearCell, player)).toBeGreaterThan(0);
  });

  it("a table and the glass on it share an anchor; the rank tiebreak keeps the glass on top", () => {
    const props = buildPropDrawables((layer) => rankOf(layer));
    const table = props.find((p) => p.stableId === 5n);
    const glass = props.find((p) => p.stableId === 6n);
    if (!table || !glass) throw new Error("unreachable");
    expect(table.x).toBe(glass.x);
    expect(table.y).toBe(glass.y);
    expect(compareDrawables(table, glass)).toBeLessThan(0);
  });

  it("FR124: the upper-storey wall shares (x, y, rank) with the ground-floor wall, and only the stableId tiebreak (never floor) orders them", () => {
    const props = buildPropDrawables((layer) => rankOf(layer));
    const groundWallCell = props.find((p) => p.stableId === 1n && p.sourceCol === 0);
    const upperWallCell = props.find((p) => p.stableId === 8n && p.sourceCol === 0);
    if (!groundWallCell || !upperWallCell) throw new Error("unreachable");
    expect(groundWallCell.x).toBe(upperWallCell.x);
    expect(groundWallCell.y).toBe(upperWallCell.y);
    expect(groundWallCell.rank).toBe(upperWallCell.rank);
    expect(groundWallCell.floor).not.toBe(upperWallCell.floor);

    // The comparison result is driven entirely by stableId (1n < 8n) --
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
