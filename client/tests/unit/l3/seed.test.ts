import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { phaseOffsetFor } from "../../../src/l3/gait";
import { SALTS, seedOf, unitOf } from "../../../src/l3/seed";

const id = fc.string({ maxLength: 24 });
const salt = fc.integer({ min: -1_000_000, max: 1_000_000_000 });

describe("seedOf / unitOf (NFR26, FR65)", () => {
  it("inv_l3_seed_is_deterministic", () => {
    fc.assert(
      fc.property(id, fc.array(salt, { maxLength: 4 }), (s, salts) => {
        expect(seedOf(s, ...salts)).toBe(seedOf(s, ...salts));
        expect(unitOf(s, ...salts)).toBe(unitOf(s, ...salts));
      }),
    );
  });

  it("a freshly imported module instance gives the same draw", async () => {
    vi.resetModules();
    const fresh = await import("../../../src/l3/seed");
    fc.assert(
      fc.property(id, salt, (s, n) => {
        expect(fresh.seedOf(s, n)).toBe(seedOf(s, n));
      }),
    );
  });

  it("is a u32, and unitOf is in [0, 1)", () => {
    fc.assert(
      fc.property(id, salt, (s, n) => {
        const v = seedOf(s, n);
        expect(Number.isInteger(v) && v >= 0 && v <= 0xffffffff).toBe(true);
        const u = unitOf(s, n);
        expect(u >= 0 && u < 1).toBe(true);
      }),
    );
  });

  it("is sensitive to one differing character and to adjacent buckets", () => {
    let sameId = 0;
    let sameBucket = 0;
    const runs = 400;
    for (let i = 0; i < runs; i++) {
      if (seedOf(`citizen-${i}`, SALTS.flavour, 7) === seedOf(`citizen-${i + 1}`, SALTS.flavour, 7))
        sameId++;
      if (seedOf("c", SALTS.flavour, i) === seedOf("c", SALTS.flavour, i + 1)) sameBucket++;
    }
    expect(sameId).toBeLessThanOrEqual(1);
    expect(sameBucket).toBeLessThanOrEqual(1);
  });

  it("distinct salts give distinct streams", () => {
    const salts = Object.values(SALTS);
    expect(new Set(salts).size).toBe(salts.length);
    let equal = 0;
    for (let i = 0; i < 200; i++) {
      if (seedOf(`c${i}`, SALTS.flavour, 1) === seedOf(`c${i}`, SALTS.glanceFacing, 1)) equal++;
    }
    expect(equal).toBeLessThanOrEqual(1);
  });

  it("the gait phase is the unsalted draw, unchanged from story 5.1", () => {
    expect(phaseOffsetFor("walker")).toBe(unitOf("walker"));
    // FNV-1a + avalanche of "walker", pinned so no gait phase on screen moves.
    expect(seedOf("walker")).toBe(145252826);
  });
});
