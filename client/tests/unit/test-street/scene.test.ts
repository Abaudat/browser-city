// `test-street/scene.ts`'s own pure helpers, tested directly rather than only
// through the slower e2e suite (Artie's cycle-2 direction: a unit case
// for a 1x1 near-side wall is what would have caught shop B's front wall
// dropping to the flush side-wall tile).
import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { computeCamera } from "../../../src/render/camera";
import { applyCameraToWorld, wallAssetOf } from "../../../src/test-street/scene";

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

// `highlightOverlayAlpha`'s own tests moved to
// `tests/unit/render/highlight.test.ts` (story 1.15): the affordance mark
// is a permanent `render/` module now, not `test-street/scene.ts`'s own
// throwaway function.

// The camera/viewport story (Quentin's direction): the ticker's own
// per-frame call, tested against a real Pixi `Container` -- no canvas or
// GPU needed (the same confirmed-safe idiom `render/pixi-order.test.ts`
// uses). Its signature is the structural proof that it can never resize
// the renderer or read the world's own bounds: it is never given either.
describe("applyCameraToWorld", () => {
  it("writes the world container's own position from computeCamera, and nothing else", () => {
    const world = new Container();
    world.scale.set(3);

    const camera = applyCameraToWorld(world, 100, 50, 800, 600, 3);

    expect(camera).toEqual(computeCamera(100, 50, 800, 600, 3));
    expect(world.position.x).toBe(camera.offsetX);
    expect(world.position.y).toBe(camera.offsetY);
  });

  it("never touches the container's own scale, however many times it is called", () => {
    const world = new Container();
    world.scale.set(3);

    applyCameraToWorld(world, 10, 10, 800, 600, 3);
    applyCameraToWorld(world, 500, -200, 1920, 1080, 3);
    applyCameraToWorld(world, -50, 900, 2560, 1440, 3);

    expect(world.scale.x).toBe(3);
    expect(world.scale.y).toBe(3);
  });

  it("moves the world container to keep a moving player's own position centred", () => {
    const world = new Container();
    world.scale.set(1);

    applyCameraToWorld(world, 0, 0, 800, 600, 1);
    const first = { x: world.position.x, y: world.position.y };

    applyCameraToWorld(world, 100, 0, 800, 600, 1);
    const second = { x: world.position.x, y: world.position.y };

    // The player moved 100px east in world space; the camera must have
    // pulled the world container 100px further west to keep it centred.
    expect(second.x).toBe(first.x - 100);
    expect(second.y).toBe(first.y);
  });
});
