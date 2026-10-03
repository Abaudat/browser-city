import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CAMERA_SCROLL_TOLERANCE_PX, computeCamera, ZOOM } from "../../../src/render/camera";
import { worldPointPx } from "../../../src/render/screen-position";
import { CollisionGrid } from "../../../src/world/collision-grid";
import { type MovementConfig, step } from "../../../src/world/movement";
import { committedDefs, streetMovementConfig } from "../test-street/street-world";

// `inv_camera_scroll_tracks_continuous_walk`: the real `step`,
// `worldPointPx` and `computeCamera`, composed per frame with no Pixi.
// The player's screen point is constant, the world scrolls monotonically
// in the walk's direction, never strays from the continuous camera by more
// than `CAMERA_SCROLL_TOLERANCE_PX`, and (at a constant delta) consecutive
// scroll steps per axis differ by at most one screen pixel. Every property
// holds at any constant velocity, so the walk speed is drawn across its
// balance key's own range rather than pinned to today's value.

const DEFS = committedDefs();
const BASE_CONFIG = streetMovementConfig();
function balance(key: string): { value: number; min: number; max: number } {
  const entry = DEFS.balance.find((b) => b.key === key);
  if (!entry) throw new Error(`no balance entry '${key}'`);
  return entry;
}
const SPEED = balance("movement.walk_speed_millicells_per_s");
const TILE = balance("render.tile_size_px").value;
const STOREY = balance("render.storey_height_px").value;
const GRID = new CollisionGrid(BASE_CONFIG.subcellsPerCell, new Map());
const DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
] as const;
const EPS = 1e-6;
const FRAMES = 300;

interface Frame {
  readonly anchorX: number;
  readonly anchorY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly idealX: number;
  readonly idealY: number;
}

interface Setup {
  readonly config: MovementConfig;
  readonly tile: number;
  readonly zoom: number;
}

function walk(
  setup: Setup,
  dir: { x: number; y: number },
  startX: number,
  startY: number,
  deltas: readonly number[],
  vw: number,
  vh: number,
): Frame[] {
  const { config, tile, zoom } = setup;
  const frames: Frame[] = [];
  let pos = { x: startX, y: startY };
  const record = () => {
    // The player's own continuous feet position, through the plain
    // `worldPointPx` projection with no anchor term of its own (story
    // 15.4) -- the exact call `scene.ts`'s `applyCamera` makes.
    const a = worldPointPx(pos.x, pos.y, 0, tile, STOREY, zoom, 0);
    const c = computeCamera(a.x, a.y, vw, vh, zoom);
    frames.push({
      anchorX: a.x,
      anchorY: a.y,
      offsetX: c.offsetX,
      offsetY: c.offsetY,
      idealX: vw / 2 - pos.x * tile * zoom,
      idealY: vh / 2 - pos.y * tile * zoom,
    });
  };
  record();
  for (const d of deltas) {
    pos = step(pos, dir, d, GRID, 0, config);
    record();
  }
  return frames;
}

const dirArb = fc.constantFrom(...DIRS);
const startArb = fc.double({ min: 1000, max: 2000, noNaN: true });
const viewportArb = fc.integer({ min: 600, max: 2560 });
const setupArb: fc.Arbitrary<Setup> = fc.record({
  config: fc
    .integer({ min: SPEED.min, max: SPEED.max })
    .map((m) => ({ ...BASE_CONFIG, walkSpeedCellsPerMs: m / 1000 / 1000 })),
  tile: fc.constantFrom(TILE, 8, 16, 32),
  // The live zoom, plus other integer zooms.
  zoom: fc.constantFrom(ZOOM, 1, 2, 4),
});
const constantDeltasArb = fc
  .double({ min: 8, max: 34, noNaN: true })
  .map((d) => Array.from({ length: FRAMES }, () => d));

// Two 200-case properties with thousands of expects each: about 1s on a
// laptop, but a coverage-instrumented CI runner has taken over 5s, vitest's
// default. The case count is the test's budget, so the timeout gives way.
const PROPERTY_TIMEOUT_MS = 60_000;

describe("camera scroll during a continuous walk", { timeout: PROPERTY_TIMEOUT_MS }, () => {
  it("inv_camera_scroll_tracks_continuous_walk", () => {
    // The player's screen point is constant, the scroll monotone and near
    // the continuous camera, under any frame-delta sequence.
    fc.assert(
      fc.property(
        setupArb,
        dirArb,
        startArb,
        startArb,
        viewportArb,
        viewportArb,
        fc.oneof(
          constantDeltasArb,
          fc.array(fc.double({ min: 8, max: 34, noNaN: true }), {
            minLength: FRAMES,
            maxLength: FRAMES,
          }),
        ),
        (setup, dir, sx, sy, vw, vh, deltas) => {
          const { zoom } = setup;
          const frames = walk(setup, dir, sx, sy, deltas, vw, vh);
          const first = frames[0];
          if (!first) throw new Error("no frames");
          const px = first.anchorX * zoom + first.offsetX;
          const py = first.anchorY * zoom + first.offsetY;
          frames.forEach((f, i) => {
            expect(Math.abs(f.anchorX * zoom + f.offsetX - px)).toBeLessThan(EPS);
            expect(Math.abs(f.anchorY * zoom + f.offsetY - py)).toBeLessThan(EPS);
            expect(Math.abs(f.offsetX - f.idealX)).toBeLessThanOrEqual(
              CAMERA_SCROLL_TOLERANCE_PX + EPS,
            );
            expect(Math.abs(f.offsetY - f.idealY)).toBeLessThanOrEqual(
              CAMERA_SCROLL_TOLERANCE_PX + EPS,
            );
            const prev = frames[i - 1];
            if (!prev) return;
            // The camera moves against the walk: offset falls as the player goes +.
            expect((f.offsetX - prev.offsetX) * dir.x).toBeLessThanOrEqual(0);
            expect((f.offsetY - prev.offsetY) * dir.y).toBeLessThanOrEqual(0);
            if (dir.x === 0) expect(f.offsetX).toBe(prev.offsetX);
            if (dir.y === 0) expect(f.offsetY).toBe(prev.offsetY);
          });
        },
      ),
      { numRuns: 200 },
    );

    // At a steady frame rate, consecutive scroll steps per axis differ by
    // at most one screen pixel.
    fc.assert(
      fc.property(
        setupArb,
        dirArb,
        startArb,
        startArb,
        viewportArb,
        viewportArb,
        constantDeltasArb,
        (setup, dir, sx, sy, vw, vh, deltas) => {
          const frames = walk(setup, dir, sx, sy, deltas, vw, vh);
          for (const axis of ["offsetX", "offsetY"] as const) {
            const steps = frames.slice(1).map((f, i) => {
              const prev = frames[i];
              return Math.abs(f[axis] - (prev ? prev[axis] : 0));
            });
            expect(Math.max(...steps) - Math.min(...steps)).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("worldPointPx at a zoom", () => {
  it("lands on a whole screen pixel for any input", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.integer({ min: -3, max: 3 }),
        fc.oneof(fc.constant(ZOOM), fc.integer({ min: 1, max: 6 })),
        (x, y, floor, zoom) => {
          const p = worldPointPx(x, y, floor, TILE, STOREY, zoom, 0);
          expect(Math.abs(p.x * zoom - Math.round(p.x * zoom))).toBeLessThan(EPS);
          expect(Math.abs(p.y * zoom - Math.round(p.y * zoom))).toBeLessThan(EPS);
        },
      ),
    );
  });
});
