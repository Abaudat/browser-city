import { describe, expect, it } from "vitest";
import type { Defs } from "../../../src/defs/types";
import { loadMovementConfig } from "../../../src/world/movement-config";

function defsWith(balance: readonly { key: string; value: number }[]): Defs {
  return {
    defsVersion: "test",
    colliderSubcellsPerCell: 16,
    interactAtMaxReachCells: 2,
    maxFootprintCells: 8,
    maxShelfLifeMinutes: 525_600,
    atlasMaxPagesPerGroup: 2,
    characterCompositePages: 2,
    atlasPages: [],
    objects: [],
    items: [],
    recipes: [],
    professions: [],
    chains: [],
    balance: balance.map((b) => ({ ...b, min: 0, max: 1_000_000 })),
    bodies: [],
    eyes: [],
    hairstyles: [],
    outfits: [],
    accessories: [],
    appearanceLayouts: [],
    uniforms: [],
    tags: [],
  };
}

describe("loadMovementConfig", () => {
  it("derives cells-per-ms from millicells-per-second, and copies the body/subcell keys through", () => {
    const defs = defsWith([
      { key: "movement.walk_speed_millicells_per_s", value: 2200 },
      { key: "movement.player_body_width_subcells", value: 8 },
      { key: "movement.player_body_height_subcells", value: 4 },
    ]);
    const config = loadMovementConfig(defs);
    expect(config.walkSpeedCellsPerMs).toBeCloseTo(0.0022, 12);
    expect(config.bodyWidthSubcells).toBe(8);
    expect(config.bodyHeightSubcells).toBe(4);
    expect(config.subcellsPerCell).toBe(16);
  });

  it("throws naming the missing key when a required balance entry is absent", () => {
    const defs = defsWith([]);
    expect(() => loadMovementConfig(defs)).toThrow(/movement.walk_speed_millicells_per_s/);
  });
});
