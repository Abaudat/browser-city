// Story 4.4 (FR138): a position travels as integers -- the cell plus the
// fraction of the cell in 1/`positionUnitsPerCell`. The unit is read from
// the committed defs, never restated.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseDefs } from "../../../src/defs/parse";
import { chunkKey } from "../../../src/world/chunk";
import { CollisionGrid } from "../../../src/world/collision-grid";
import type { Vec2 } from "../../../src/world/movement";
import { bodyRect, step } from "../../../src/world/movement";
import { loadMovementConfig } from "../../../src/world/movement-config";
import { dequantise, quantise } from "../../../src/world/position-codec";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const defs = parseDefs(
  JSON.parse(readFileSync(`${REPO_ROOT}client/public/defs/defs.json`, "utf-8")),
);
const UNITS = defs.positionUnitsPerCell;
const QUANTUM = 1 / UNITS;
const CONFIG = loadMovementConfig(defs);

const coord = fc.oneof(
  fc.double({ min: -5000, max: 5000, noNaN: true }),
  // Exact cell boundaries and values a hair either side of them.
  fc.integer({ min: -200, max: 200 }),
  fc
    .tuple(fc.integer({ min: -200, max: 200 }), fc.constantFrom(-1e-9, 1e-9, -QUANTUM / 4))
    .map(([c, d]) => c + d),
);

const cellOf = (v: number) => Math.floor(v) + 0;

describe("position quantisation", () => {
  it("inv_position_quantisation_round_trips", () => {
    fc.assert(
      fc.property(coord, coord, fc.integer({ min: -1, max: 7 }), (x, y, floor) => {
        const q = quantise(x, y, floor, UNITS);
        const back = dequantise(q, UNITS);
        expect(Math.abs(back.x - x)).toBeLessThanOrEqual(QUANTUM);
        expect(Math.abs(back.y - y)).toBeLessThanOrEqual(QUANTUM);
        expect(q.fracX).toBeGreaterThanOrEqual(0);
        expect(q.fracX).toBeLessThan(UNITS);
        expect(q.fracY).toBeLessThan(UNITS);
        expect(back.floor).toBe(floor);
        // Idempotent.
        expect(quantise(back.x, back.y, back.floor, UNITS)).toEqual(q);
        // The cell and chunk of the quantised value are those of the float.
        expect(q.x).toBe(cellOf(x));
        expect(q.y).toBe(cellOf(y));
        expect(chunkKey(cellOf(back.x), cellOf(back.y), floor)).toBe(
          chunkKey(cellOf(x), cellOf(y), floor),
        );
      }),
      { numRuns: 500 },
    );
  });

  it("is within half a quantum except in the last half-quantum of a cell", () => {
    fc.assert(
      fc.property(coord, (x) => {
        const q = quantise(x, 0, 0, UNITS);
        const err = Math.abs(dequantise(q, UNITS).x - x);
        const inLastHalf = x - Math.floor(x) > 1 - QUANTUM / 2;
        if (!inLastHalf) expect(err).toBeLessThanOrEqual(QUANTUM / 2 + 1e-12);
      }),
    );
  });

  it("represents every collider face exactly", () => {
    for (let sub = -64; sub <= 64; sub++) {
      const v = sub / CONFIG.subcellsPerCell;
      expect(dequantise(quantise(v, v, 0, UNITS), UNITS)).toEqual({ x: v, y: v, floor: 0 });
    }
  });

  it("inv_quantised_rest_never_penetrates", () => {
    const sub = CONFIG.subcellsPerCell;
    const rect = fc
      .record({
        x0: fc.integer({ min: -60, max: 60 }),
        y0: fc.integer({ min: -60, max: 60 }),
        w: fc.integer({ min: 1, max: 30 }),
        h: fc.integer({ min: 1, max: 30 }),
      })
      .map(({ x0, y0, w, h }) => ({ x0, y0, x1: x0 + w, y1: y0 + h }));
    const overlaps = (
      a: { x0: number; y0: number; x1: number; y1: number },
      b: { x0: number; y0: number; x1: number; y1: number },
    ) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

    fc.assert(
      fc.property(
        fc.array(rect, { minLength: 1, maxLength: 6 }),
        fc.array(
          fc.record({
            dx: fc.integer({ min: -2, max: 2 }),
            dy: fc.integer({ min: -2, max: 2 }),
            ms: fc.integer({ min: 1, max: 100 }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        (colliders, inputs) => {
          const defsMap = new Map(
            colliders.map((c, i) => [i, { width: 100000, height: 1, collider: c }] as const),
          );
          const grid = new CollisionGrid(sub, defsMap);
          for (let i = 0; i < colliders.length; i++) {
            grid.insert({
              objectId: BigInt(i + 1),
              defId: i,
              x: 0,
              y: 0,
              floor: 0,
              layer: 0,
              orientation: 0,
              chunkKey: 0n,
            });
          }
          let pos: Vec2 = { x: 100, y: 100 };
          for (const { dx, dy, ms } of inputs) {
            pos = step(pos, { x: dx, y: dy }, ms, grid, 0, CONFIG);
            const q = quantise(pos.x, pos.y, 0, UNITS);
            const rest = dequantise(q, UNITS);
            const body = bodyRect(rest, CONFIG);
            const wasInside = colliders.some((c) => overlaps(bodyRect(pos, CONFIG), c));
            if (!wasInside) {
              expect(colliders.some((c) => overlaps(body, c))).toBe(false);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("a position-wise truncating codec would fail the cell property (negative control)", () => {
    const truncating = (v: number) => Math.trunc(v);
    expect(truncating(-0.5)).not.toBe(cellOf(-0.5));
  });
});
