import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CAMERA_SCROLL_TOLERANCE_PX, computeCamera } from "../../../src/render/camera";
import { screenPositionPx } from "../../../src/render/screen-position";
import { CollisionGrid } from "../../../src/world/collision-grid";
import { type MovementConfig, step } from "../../../src/world/movement";

// `inv_camera_scroll_tracks_continuous_walk`: the real `step`,
// `screenPositionPx` and `computeCamera`, composed per frame with no Pixi.
// The player's screen point is constant, the world scrolls monotonically
// in the walk's direction, never strays from the continuous camera by more
// than `CAMERA_SCROLL_TOLERANCE_PX`, and (at a constant delta) consecutive
// scroll steps per axis differ by at most one screen pixel.

const TILE = 16;
const STOREY = 48;
const CONFIG: MovementConfig = {
  walkSpeedCellsPerMs: 2.2 / 1000,
  bodyWidthSubcells: 8,
  bodyHeightSubcells: 8,
  subcellsPerCell: 16,
};
const GRID = new CollisionGrid(CONFIG.subcellsPerCell, new Map());
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

function walk(
  dir: { x: number; y: number },
  startX: number,
  startY: number,
  deltas: readonly number[],
  vw: number,
  vh: number,
  zoom: number,
): Frame[] {
  const frames: Frame[] = [];
  let pos = { x: startX, y: startY };
  const record = () => {
    const a = screenPositionPx(pos.x, pos.y, 0, TILE, STOREY, zoom);
    const c = computeCamera(a.x, a.y, vw, vh, zoom);
    frames.push({
      anchorX: a.x,
      anchorY: a.y,
      offsetX: c.offsetX,
      offsetY: c.offsetY,
      idealX: vw / 2 - (pos.x + 0.5) * TILE * zoom,
      idealY: vh / 2 - (pos.y + 1) * TILE * zoom,
    });
  };
  record();
  for (const d of deltas) {
    pos = step(pos, dir, d, GRID, 0, CONFIG);
    record();
  }
  return frames;
}

const dirArb = fc.constantFrom(...DIRS);
const startArb = fc.double({ min: 1000, max: 2000, noNaN: true });
const viewportArb = fc.integer({ min: 600, max: 2560 });
const zoomArb = fc.constantFrom(2, 3, 4);
const constantDeltas = Array.from({ length: FRAMES }, () => 1000 / 60);

describe("inv_camera_scroll_tracks_continuous_walk", () => {
  it("keeps the player's screen point constant, the scroll monotone and near the continuous camera", () => {
    fc.assert(
      fc.property(
        dirArb,
        startArb,
        startArb,
        viewportArb,
        viewportArb,
        zoomArb,
        fc.oneof(
          fc.constant(constantDeltas),
          fc.array(fc.double({ min: 8, max: 34, noNaN: true }), {
            minLength: FRAMES,
            maxLength: FRAMES,
          }),
        ),
        (dir, sx, sy, vw, vh, zoom, deltas) => {
          const frames = walk(dir, sx, sy, deltas, vw, vh, zoom);
          const first = frames[0];
          if (!first) throw new Error("no frames");
          const px = first.anchorX * zoom + first.offsetX;
          const py = first.anchorY * zoom + first.offsetY;
          frames.forEach((f, i) => {
            expect(Math.abs(f.anchorX * zoom + f.offsetX - px)).toBeLessThan(EPS);
            expect(Math.abs(f.anchorY * zoom + f.offsetY - py)).toBeLessThan(EPS);
            expect(Math.abs(f.offsetX - f.idealX)).toBeLessThanOrEqual(CAMERA_SCROLL_TOLERANCE_PX);
            expect(Math.abs(f.offsetY - f.idealY)).toBeLessThanOrEqual(CAMERA_SCROLL_TOLERANCE_PX);
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
  });

  it("scrolls in steps that differ by at most one screen pixel per axis at a steady frame rate", () => {
    fc.assert(
      fc.property(
        dirArb,
        startArb,
        startArb,
        viewportArb,
        viewportArb,
        zoomArb,
        (dir, sx, sy, vw, vh, zoom) => {
          const frames = walk(dir, sx, sy, constantDeltas, vw, vh, zoom);
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

describe("screenPositionPx at a zoom", () => {
  it("lands on a whole screen pixel for any input", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.integer({ min: -3, max: 3 }),
        fc.integer({ min: 1, max: 6 }),
        (x, y, floor, zoom) => {
          const p = screenPositionPx(x, y, floor, TILE, STOREY, zoom);
          expect(Math.abs(p.x * zoom - Math.round(p.x * zoom))).toBeLessThan(EPS);
          expect(Math.abs(p.y * zoom - Math.round(p.y * zoom))).toBeLessThan(EPS);
        },
      ),
    );
  });
});
