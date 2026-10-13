// Streamed rows to drawables (story 3.16): decomposed footprints, one stub
// per wall cell, a band per doorway, and a wall's owner and facing read from
// the live ownership index -- so building areas arriving after the walls they
// own (streaming order is not guaranteed) still decide the facing.

import { describe, expect, it } from "vitest";
import { buildLayerRankTable, resolveRank } from "../../../src/render/layer-ranks";
import { LAYER_TABLE, layerCodeByName } from "../../../src/render/layer-table";
import {
  BAND_ID_OFFSET,
  buildPropDrawables,
  isDefPropDrawable,
  type PlacedRowView,
  REMOTE_STABLE_ID_BASE,
  STUB_ID_OFFSET,
} from "../../../src/render/prop-drawables";
import { computeVisibility } from "../../../src/render/visibility";
import { NO_OWNER, OwnershipIndex } from "../../../src/world/ownership";

const WALLS = layerCodeByName("walls");
const FURNITURE = layerCodeByName("furniture");
const rank = buildLayerRankTable(LAYER_TABLE.map(({ code, rank: r }) => ({ code, rank: r })));

const WALL = 6;
const DOOR = 25;
const WINDOW = 5;
const COUNTER = 3;
const STUB_DEF = 6;

const objectDefs = new Map([
  [WALL, { width: 1, height: 1 }],
  [DOOR, { width: 1, height: 1, spriteHeightPx: 32 }],
  [WINDOW, { width: 1, height: 1 }],
  [COUNTER, { width: 2, height: 1 }],
]);

function options(ownership: OwnershipIndex) {
  return {
    rankOf: (code: number) => resolveRank(rank, code),
    ownership,
    windowDefIds: new Set([WINDOW]),
    thresholdDefIds: new Set([DOOR]),
    wallStubDefId: STUB_DEF,
    objectDefs,
  };
}

const row = (id: number, defId: number, x: number, y: number, layer: number): PlacedRowView => ({
  objectId: BigInt(id),
  defId,
  x,
  y,
  floor: 0,
  layer,
});

describe("buildPropDrawables", () => {
  it("decomposes a multi-cell def into one drawable per cell, sharing its object id", () => {
    const rows = [row(1, COUNTER, 4, 4, FURNITURE)];
    const out = buildPropDrawables(rows, options(new OwnershipIndex()));
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.stableId)).toEqual([1n, 1n]);
    expect(out.map((d) => (isDefPropDrawable(d) ? d.sourceCol : -1)).sort()).toEqual([0, 1]);
  });

  it("gives every wall cell a stub, a doorway a band, and neither to furniture", () => {
    const rows = [
      row(10, WALL, 2, 2, WALLS),
      row(11, DOOR, 3, 2, WALLS),
      row(12, COUNTER, 5, 5, FURNITURE),
    ];
    const out = buildPropDrawables(rows, options(new OwnershipIndex()));
    const ids = out.map((d) => d.stableId);
    expect(ids).toContain(10n + STUB_ID_OFFSET);
    expect(ids).toContain(11n + BAND_ID_OFFSET);
    expect(ids).not.toContain(11n + STUB_ID_OFFSET);
    expect(ids).not.toContain(12n + STUB_ID_OFFSET);
    const band = out.find((d) => d.stableId === 11n + BAND_ID_OFFSET);
    expect(band && isDefPropDrawable(band) ? band.liftSourcePx : 0).toBe(32);
    // Companion ids stay below the remote players' range.
    expect(Math.max(...ids.map((i) => Number(i)))).toBeLessThan(Number(REMOTE_STABLE_ID_BASE));
  });

  it("reads a wall's owner and facing from ownership that arrives after the wall", () => {
    const ownership = new OwnershipIndex();
    const [wall, stub] = buildPropDrawables([row(1, WALL, 3, 5, WALLS)], options(ownership));
    // No building area yet: the wall belongs to nobody.
    expect(wall?.ownerBuildingId).toBe(NO_OWNER);
    ownership.insertBuilding(1n, { ownerId: 9n, floor: 0, rect: { x0: 0, y0: 0, x1: 8, y1: 6 } });
    // (3, 5) is in the building, (3, 6) below it is not: a front wall.
    expect(wall?.ownerBuildingId).toBe(9n);
    expect(wall?.isNearSide).toBe(true);
    expect(stub?.isStub).toBe(true);
    expect(stub?.isNearSide).toBe(true);
    // Viewer inside: the wall retracts, its stub takes over.
    const viewer = { floor: 0, buildingId: 9n };
    expect(computeVisibility(viewer, wall as NonNullable<typeof wall>)).toBe("hidden");
    expect(computeVisibility(viewer, stub as NonNullable<typeof stub>)).toBe("normal");
    // Viewer outside: the wall is drawn, the stub is not.
    const outside = { floor: 0, buildingId: NO_OWNER };
    expect(computeVisibility(outside, wall as NonNullable<typeof wall>)).toBe("normal");
    expect(computeVisibility(outside, stub as NonNullable<typeof stub>)).toBe("hidden");
  });

  it("never marks a side wall near-side, whatever the chunk seam does to its neighbours", () => {
    const ownership = new OwnershipIndex();
    const [wall] = buildPropDrawables([row(1, WALL, 0, 3, WALLS)], options(ownership));
    ownership.insertBuilding(1n, { ownerId: 9n, floor: 0, rect: { x0: 0, y0: 0, x1: 8, y1: 6 } });
    // (0, 4) below is the same building's wall: not the front.
    expect(wall?.isNearSide).toBe(false);
    // The neighbour's area arrives later still, and changes nothing.
    ownership.insertBuilding(2n, { ownerId: 4n, floor: 0, rect: { x0: 8, y0: 0, x1: 12, y1: 6 } });
    expect(wall?.isNearSide).toBe(false);
  });

  it("throws, naming the def, for a row whose def is unknown", () => {
    expect(() =>
      buildPropDrawables([row(1, 9999, 0, 0, FURNITURE)], options(new OwnershipIndex())),
    ).toThrow(/9999/);
  });
});
