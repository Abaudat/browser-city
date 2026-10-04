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

type Codec = {
  quantise: typeof quantise;
  dequantise: typeof dequantise;
  units: number;
};
const real: Codec = { quantise, dequantise, units: UNITS };

function assertRoundTrips(codec: Codec): void {
  fc.assert(
    fc.property(coord, coord, fc.integer({ min: -1, max: 7 }), (x, y, floor) => {
      const q = codec.quantise(x, y, floor, codec.units);
      const back = codec.dequantise(q, codec.units);
      expect(Math.abs(back.x - x)).toBeLessThanOrEqual(1 / codec.units);
      expect(Math.abs(back.y - y)).toBeLessThanOrEqual(1 / codec.units);
      expect(q.fracX).toBeGreaterThanOrEqual(0);
      expect(q.fracX).toBeLessThan(codec.units);
      expect(q.fracY).toBeLessThan(codec.units);
      expect(back.floor).toBe(floor);
      // Idempotent.
      expect(codec.quantise(back.x, back.y, back.floor, codec.units)).toEqual(q);
      // The cell and chunk of the quantised value are those of the float.
      expect(q.x).toBe(cellOf(x));
      expect(q.y).toBe(cellOf(y));
      expect(chunkKey(cellOf(back.x), cellOf(back.y), floor)).toBe(
        chunkKey(cellOf(x), cellOf(y), floor),
      );
    }),
    { numRuns: 500 },
  );
}

/** Walkers among colliders: every rest position the real `step` ends at, put
 * through the codec, must still overlap no collider. Returns how many steps
 * actually met a collider, so the caller can prove the run touched one. */
function assertRestNeverPenetrates(codec: Codec): number {
  const sub = CONFIG.subcellsPerCell;
  const rect = fc
    .record({
      x0: fc.integer({ min: -30, max: 30 }),
      y0: fc.integer({ min: -30, max: 30 }),
      w: fc.integer({ min: 1, max: 30 }),
      h: fc.integer({ min: 1, max: 30 }),
    })
    .map(({ x0, y0, w, h }) => ({ x0, y0, x1: x0 + w, y1: y0 + h }));
  const overlaps = (
    a: { x0: number; y0: number; x1: number; y1: number },
    b: { x0: number; y0: number; x1: number; y1: number },
  ) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  let contacts = 0;

  fc.assert(
    fc.property(
      fc.array(rect, { minLength: 1, maxLength: 6 }),
      fc.record({
        x: fc.integer({ min: -60, max: 60 }).map((v) => v / sub),
        y: fc.integer({ min: -60, max: 60 }).map((v) => v / sub),
      }),
      fc.array(
        fc.record({
          dx: fc.integer({ min: -2, max: 2 }),
          dy: fc.integer({ min: -2, max: 2 }),
          ms: fc.integer({ min: 1, max: 100 }),
        }),
        { minLength: 1, maxLength: 60 },
      ),
      (colliders, start, inputs) => {
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
        let pos: Vec2 = start;
        // A start inside a collider is no resting place `step` produced.
        fc.pre(!colliders.some((c) => overlaps(bodyRect(pos, CONFIG), c)));
        for (const { dx, dy, ms } of inputs) {
          const next = step(pos, { x: dx, y: dy }, ms, grid, 0, CONFIG);
          const wanted = CONFIG.walkSpeedCellsPerMs * Math.min(ms, 100);
          if (
            (dx !== 0 || dy !== 0) &&
            Math.hypot(next.x - pos.x, next.y - pos.y) < wanted - 1e-9
          ) {
            contacts++;
          }
          pos = next;
          const rest = codec.dequantise(codec.quantise(pos.x, pos.y, 0, codec.units), codec.units);
          expect(colliders.some((c) => overlaps(bodyRect(rest, CONFIG), c))).toBe(false);
        }
      },
    ),
    { numRuns: 300 },
  );
  return contacts;
}

describe("position quantisation", () => {
  it("inv_position_quantisation_round_trips", () => {
    assertRoundTrips(real);
  });

  it("a truncating codec fails inv_position_quantisation_round_trips (negative control)", () => {
    const truncating: Codec = {
      units: UNITS,
      dequantise,
      quantise: (x, y, floor, units) => ({
        x: Math.trunc(x),
        y: Math.trunc(y),
        floor,
        fracX: Math.round((x - Math.trunc(x)) * units) % units,
        fracY: Math.round((y - Math.trunc(y)) * units) % units,
      }),
    };
    expect(() => assertRoundTrips(truncating)).toThrow();
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
    expect(assertRestNeverPenetrates(real)).toBeGreaterThan(0);
  });

  it("a quantum that is not a multiple of the collider sub-cell fails inv_quantised_rest_never_penetrates (negative control)", () => {
    expect(UNITS % CONFIG.subcellsPerCell).toBe(0);
    expect(() => assertRestNeverPenetrates({ quantise, dequantise, units: 1000 })).toThrow();
  });
});
