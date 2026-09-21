import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Camera,
  clientFromWorldPx,
  computeCamera,
  worldPxFromClient,
} from "../../../src/render/camera";

// NFR48's own supported-viewport range (`docs/requirements.md`): 800x600
// to 2560x1440, either orientation -- the same range
// `camera-viewport.spec.ts`'s own size matrix is drawn from.
const viewportDimension = () => fc.integer({ min: 600, max: 2560 });
const zoomArb = () => fc.double({ min: 0.25, max: 8, noNaN: true });
// A world-pixel coordinate wide enough to cover a large generated world,
// well beyond any real `render.tile_size_px` * cell-count product this
// game will ever place a player at.
const worldPxArb = () =>
  fc.double({ min: Math.fround(-1_000_000), max: Math.fround(1_000_000), noNaN: true });

describe("computeCamera", () => {
  it("centres a player at the coordinate origin in a simple, even viewport", () => {
    const camera = computeCamera(0, 0, 800, 600, 1);
    expect(camera).toEqual({ zoom: 1, offsetX: 400, offsetY: 300 });
  });

  it("scales the player's own position by zoom before centring it", () => {
    const camera = computeCamera(10, 10, 800, 600, 3);
    expect(camera).toEqual({ zoom: 3, offsetX: 400 - 30, offsetY: 300 - 30 });
  });

  it("snaps the offset to a whole pixel, never a fractional one", () => {
    const camera = computeCamera(0.4, 0.6, 801, 601, 1);
    expect(Number.isInteger(camera.offsetX)).toBe(true);
    expect(Number.isInteger(camera.offsetY)).toBe(true);
  });

  // Story NFR48: no easing, no lag, no world-edge clamp -- the camera is a
  // pure function of its own three inputs alone, so it must be identical
  // across two calls with identical arguments, never carrying state from
  // a previous call.
  it("is a pure function: identical inputs always give an identical camera", () => {
    fc.assert(
      fc.property(
        worldPxArb(),
        worldPxArb(),
        viewportDimension(),
        viewportDimension(),
        zoomArb(),
        (px, py, vw, vh, zoom) => {
          expect(computeCamera(px, py, vw, vh, zoom)).toEqual(computeCamera(px, py, vw, vh, zoom));
        },
      ),
    );
  });

  // The camera/viewport story's central claim (AC2): for any player
  // position, any viewport size in the supported range and any zoom, the
  // player's own screen anchor projects to the viewport's centre, within
  // half a pixel -- `Math.round`'s own worst case, and the tightest bound
  // that still holds for every input. Cycle 2 (Quentin's direction): a 1px
  // bound was loose enough to let a `floor`/`ceil` swap or a half-pixel
  // bias through undetected; 0.5 (plus a float epsilon for the arithmetic
  // itself, never for the rounding) is the real guarantee `computeCamera`
  // makes. The e2e follow spec keeps its own, looser 1px budget -- real
  // compositor/measurement noise on top of this exact guarantee.
  it("inv_camera_centres_player", () => {
    fc.assert(
      fc.property(
        worldPxArb(),
        worldPxArb(),
        viewportDimension(),
        viewportDimension(),
        zoomArb(),
        (playerScreenX, playerScreenY, viewportWidth, viewportHeight, zoom) => {
          const camera = computeCamera(
            playerScreenX,
            playerScreenY,
            viewportWidth,
            viewportHeight,
            zoom,
          );
          const projected = clientFromWorldPx(playerScreenX, playerScreenY, camera);
          const epsilon = 1e-9;
          expect(Math.abs(projected.x - viewportWidth / 2)).toBeLessThanOrEqual(0.5 + epsilon);
          expect(Math.abs(projected.y - viewportHeight / 2)).toBeLessThanOrEqual(0.5 + epsilon);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("clientFromWorldPx / worldPxFromClient", () => {
  it("are exact inverses at zoom 1 with no offset", () => {
    const camera: Camera = { zoom: 1, offsetX: 0, offsetY: 0 };
    expect(clientFromWorldPx(5, 7, camera)).toEqual({ x: 5, y: 7 });
    expect(worldPxFromClient(5, 7, camera)).toEqual({ x: 5, y: 7 });
  });

  it("applies zoom before the offset in one direction, and undoes the offset before zoom in the other", () => {
    const camera: Camera = { zoom: 2, offsetX: 10, offsetY: -4 };
    expect(clientFromWorldPx(3, 3, camera)).toEqual({ x: 16, y: 2 });
    expect(worldPxFromClient(16, 2, camera)).toEqual({ x: 3, y: 3 });
  });

  // Picking depends on this: a scene whose camera moves every frame must
  // still resolve a click back to the exact world point the player saw
  // under the pointer, through whichever camera transform was live in
  // that same frame -- never a transform captured earlier and now stale.
  it("inv_camera_transform_round_trips", () => {
    fc.assert(
      fc.property(
        // Every camera under test is one `computeCamera` itself could
        // produce -- a whole-pixel offset, any zoom in the supported
        // range -- so this exercises exactly the transforms the live
        // scene ever hands a picker, never an arbitrary fractional one
        // `computeCamera` would never emit.
        worldPxArb(),
        worldPxArb(),
        viewportDimension(),
        viewportDimension(),
        zoomArb(),
        worldPxArb(),
        worldPxArb(),
        (playerScreenX, playerScreenY, viewportWidth, viewportHeight, zoom, probeX, probeY) => {
          const camera = computeCamera(
            playerScreenX,
            playerScreenY,
            viewportWidth,
            viewportHeight,
            zoom,
          );

          // world -> client -> world -- an exact algebraic inverse (no
          // rounding in either direction), well inside the 1px budget.
          const client = clientFromWorldPx(probeX, probeY, camera);
          const backToWorld = worldPxFromClient(client.x, client.y, camera);
          expect(Math.abs(backToWorld.x - probeX)).toBeLessThanOrEqual(1e-6);
          expect(Math.abs(backToWorld.y - probeY)).toBeLessThanOrEqual(1e-6);

          // client -> world -> client
          const world = worldPxFromClient(probeX, probeY, camera);
          const backToClient = clientFromWorldPx(world.x, world.y, camera);
          expect(Math.abs(backToClient.x - probeX)).toBeLessThanOrEqual(1e-6);
          expect(Math.abs(backToClient.y - probeY)).toBeLessThanOrEqual(1e-6);
        },
      ),
      { numRuns: 500 },
    );
  });
});
