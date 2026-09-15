// `test-street/scene.ts`'s own pure helpers, tested directly rather than only
// through the slower e2e suite (Artie's cycle-2 direction: a unit case
// for a 1x1 near-side wall is what would have caught shop B's front wall
// dropping to the flush side-wall tile).
import { describe, expect, it } from "vitest";
import { highlightOverlayAlpha, wallAssetOf } from "../../../src/test-street/scene";

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

describe("highlightOverlayAlpha", () => {
  // Story 1.11 (Quentin/Tim's direction): the options menu's Display
  // slider is a real consumer of this, not a persisted-only dial --
  // these are the numbers `mountStreetScene`'s own overlay-building
  // closes over through `highlightOverlayAlpha`.
  it("at strength 100 (the pre-dial default), matches the bare HIGHLIGHT_ALPHA*sourceAlpha this replaced", () => {
    expect(highlightOverlayAlpha(100, 1)).toBeCloseTo(0.18, 10);
    expect(highlightOverlayAlpha(100, 0.5)).toBeCloseTo(0.09, 10);
  });

  it("scales linearly with strength", () => {
    expect(highlightOverlayAlpha(50, 1)).toBeCloseTo(0.09, 10);
    expect(highlightOverlayAlpha(20, 1)).toBeCloseTo(0.036, 10);
  });

  it("strength 0 means no highlight at all", () => {
    expect(highlightOverlayAlpha(0, 1)).toBe(0);
  });
});
