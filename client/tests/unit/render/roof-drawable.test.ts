// Story 3.16: a building's roof is a pool drawable that hides what stands
// inside it from the street and is itself hidden from inside, by the one
// retraction rule -- no second visibility mechanism.

import { describe, expect, it } from "vitest";
import { buildLayerRankTable, resolveRank } from "../../../src/render/layer-ranks";
import { LAYER_TABLE, layerCodeByName } from "../../../src/render/layer-table";
import {
  buildCharacterDrawable,
  buildRoofDrawable,
  ROOF_ID_OFFSET,
  roofBottoms,
} from "../../../src/render/prop-drawables";
import { compareDrawables } from "../../../src/render/sort-key";
import { toSortUnits } from "../../../src/render/sort-units";
import { computeVisibility } from "../../../src/render/visibility";
import { NO_OWNER } from "../../../src/world/ownership";

const ranks = buildLayerRankTable(LAYER_TABLE.map(({ code, rank }) => ({ code, rank })));
const WALLS_RANK = resolveRank(ranks, layerCodeByName("walls"));
const BUILDING = 77n;
// The roof over a 6x4 interior net at (10, 20); the wall ring is one cell.
const roof = buildRoofDrawable(
  {
    areaId: 5n,
    buildingId: BUILDING,
    defId: 78,
    x0: 10,
    y0: 20,
    x1: 16,
    y1: 24,
    floor: 0,
  },
  WALLS_RANK,
);

describe("buildRoofDrawable", () => {
  it("is a near-side wall of its own building, so only the viewer inside it retracts it", () => {
    expect(roof.ownerBuildingId).toBe(BUILDING);
    expect(computeVisibility({ floor: 0, buildingId: NO_OWNER }, roof)).toBe("normal");
    expect(computeVisibility({ floor: 0, buildingId: 12n }, roof)).toBe("normal");
    expect(computeVisibility({ floor: 0, buildingId: BUILDING }, roof)).toBe("hidden");
  });

  it("has an id that can never collide with a placed object or a companion", () => {
    expect(roof.stableId).toBe(5n + ROOF_ID_OFFSET);
  });

  it("sorts over a body resting against the front wall's inner face", () => {
    // The wall's collider face is the roof's own bottom edge (y = 24).
    const body = buildCharacterDrawable(
      resolveRank(ranks, layerCodeByName("characters")),
      12,
      24,
      0,
    );
    expect(compareDrawables(body, roof)).toBeLessThan(0);
  });

  it("sorts behind the front wall's own face", () => {
    // The front wall row is cell y = 24: its drawable foot is y = 25.
    const wallFoot = {
      x: toSortUnits(12.5),
      y: toSortUnits(25),
      rank: WALLS_RANK,
      stableId: 1n,
      floor: 0,
    };
    expect(compareDrawables(roof, wallFoot)).toBeLessThan(0);
  });

  it("sorts after furniture standing on the last floor row", () => {
    const furnitureRank = resolveRank(ranks, layerCodeByName("furniture"));
    // A fixture in cell row y = 23 has its foot at y = 24.
    const fixture = {
      x: toSortUnits(12.5),
      y: toSortUnits(24),
      rank: furnitureRank,
      stableId: 9n,
      floor: 0,
    };
    expect(compareDrawables(fixture, roof)).toBeLessThan(0);
  });

  it("sorts a north-rim strip at the net's south edge, over a fixture overhanging the rim", () => {
    // The rim strip west of a north door: row y = 19, net bottom y = 24.
    const strip = buildRoofDrawable(
      {
        areaId: 6n,
        buildingId: BUILDING,
        defId: 78,
        x0: 10,
        y0: 19,
        x1: 12,
        y1: 20,
        floor: 0,
      },
      WALLS_RANK,
      24,
    );
    expect(strip.y).toBe(roof.y);
    const furnitureRank = resolveRank(ranks, layerCodeByName("furniture"));
    // A two-cell lamp on the first floor row (y = 20) overhangs the rim.
    const lamp = {
      x: toSortUnits(10.5),
      y: toSortUnits(21),
      rank: furnitureRank,
      stableId: 9n,
      floor: 0,
    };
    expect(compareDrawables(lamp, strip)).toBeLessThan(0);
  });
});

describe("roofBottoms", () => {
  it("is the largest bottom edge among one building's roof rects", () => {
    const rows = [
      {
        areaId: 1n,
        buildingId: 1n,
        defId: 78,
        x0: 0,
        y0: 1,
        x1: 4,
        y1: 6,
        floor: 0,
      },
      {
        areaId: 2n,
        buildingId: 1n,
        defId: 78,
        x0: 0,
        y0: 0,
        x1: 1,
        y1: 1,
        floor: 0,
      },
      {
        areaId: 3n,
        buildingId: 2n,
        defId: 78,
        x0: 9,
        y0: 0,
        x1: 12,
        y1: 3,
        floor: 0,
      },
    ];
    const bottoms = roofBottoms(rows);
    expect(bottoms.get(1n)).toBe(6);
    expect(bottoms.get(2n)).toBe(3);
  });
});
