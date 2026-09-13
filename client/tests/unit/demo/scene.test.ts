// `demo/scene.ts`'s own pure helpers, tested directly rather than only
// through the slower e2e suite (Artie's cycle-2 direction: a unit case
// for a 1x1 near-side wall is what would have caught shop B's front wall
// dropping to the flush side-wall tile).
import { describe, expect, it } from "vitest";
import { wallAssetOf } from "../../../src/demo/scene";

describe("wallAssetOf", () => {
  it("picks the tall swatch for a horizontal (front/back) wall, regardless of how narrow this particular cut is", () => {
    // The exact regression this test exists for (Artie's cycle-2
    // finding): a one-cell-wide front-wall pier is indistinguishable from
    // a one-cell side wall by footprint alone (both are 1x1 after
    // decomposition) -- `wallOrientation` is what disambiguates them.
    expect(wallAssetOf("wallTile", "horizontal")).toBe("wallTileH");
  });

  it("picks the flush swatch for a vertical (side/party) wall", () => {
    expect(wallAssetOf("wallTile", "vertical")).toBe("wallTileV");
  });

  it("a wall-stub companion always uses the flush swatch, regardless of its own parent's orientation", () => {
    expect(wallAssetOf("wallStub", "horizontal")).toBe("wallTileV");
    expect(wallAssetOf("wallStub", "vertical")).toBe("wallTileV");
  });

  it("any other asset key passes through unchanged, regardless of orientation", () => {
    expect(wallAssetOf("subwayWall", "horizontal")).toBe("subwayWall");
    expect(wallAssetOf("subwayWall", "vertical")).toBe("subwayWall");
    expect(wallAssetOf("window", "horizontal")).toBe("window");
  });
});
