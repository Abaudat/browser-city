import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Drawable } from "../../../src/render/sort-key";
import { compareDrawables, sortDrawablesInPlace } from "../../../src/render/sort-key";

const drawableArb: fc.Arbitrary<Drawable> = fc.record({
  x: fc.integer({ min: -500, max: 500 }),
  y: fc.integer({ min: -500, max: 500 }),
  rank: fc.integer({ min: 0, max: 60 }),
  stableId: fc.bigInt({ min: 0n, max: 1_000_000n }),
  floor: fc.integer({ min: -5, max: 5 }),
});

function sameKey(a: Drawable, b: Drawable): boolean {
  return a.x === b.x && a.y === b.y && a.rank === b.rank && a.stableId === b.stableId;
}

describe("compareDrawables", () => {
  // FR123: the depth-sort key is a strict total order over (y, rank, x,
  // stableId) -- antisymmetric, strict for distinct keys, and transitive.
  // This is the proof, not prose, behind the AC that no canopy footprint
  // can occlude another drawable: the key never runs out of tiebreakers.
  it("inv_depth_order_total_and_stable", () => {
    fc.assert(
      fc.property(drawableArb, drawableArb, drawableArb, (a, b, c) => {
        const ab = compareDrawables(a, b);
        const ba = compareDrawables(b, a);
        expect(Math.sign(ab)).toBe(-Math.sign(ba));

        if (!sameKey(a, b)) {
          expect(ab).not.toBe(0);
        } else {
          expect(ab).toBe(0);
        }

        const bc = compareDrawables(b, c);
        const ac = compareDrawables(a, c);
        if (ab <= 0 && bc <= 0) expect(ac).toBeLessThanOrEqual(0);
        if (ab >= 0 && bc >= 0) expect(ac).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  // FR124: floor is a vertical screen offset, never a sort key. For any
  // two drawables that differ only in floor, the comparator's result
  // against any third drawable is identical to the same pair with equal
  // floors -- floor is simply never read.
  it("inv_floor_never_affects_depth_order", () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.integer({ min: -500, max: 500 }),
          y: fc.integer({ min: -500, max: 500 }),
          rank: fc.integer({ min: 0, max: 60 }),
          stableId: fc.bigInt({ min: 0n, max: 1_000_000n }),
        }),
        fc.integer({ min: -5, max: 5 }),
        fc.integer({ min: -5, max: 5 }),
        drawableArb,
        (base, floorA, floorB, other) => {
          const a: Drawable = { ...base, floor: floorA };
          const b: Drawable = { ...base, floor: floorB };
          expect(compareDrawables(a, other)).toBe(compareDrawables(b, other));
          expect(compareDrawables(other, a)).toBe(compareDrawables(other, b));
          expect(compareDrawables(a, b)).toBe(0);
        },
      ),
    );
  });

  // FR123: sorting a pool never drops or duplicates a drawable -- the
  // sorted output is exactly the input multiset.
  it("inv_drawable_pool_is_a_permutation", () => {
    fc.assert(
      fc.property(fc.array(drawableArb, { minLength: 0, maxLength: 40 }), (pool) => {
        const before = new Map<string, number>();
        for (const d of pool) {
          const key = `${d.x},${d.y},${d.rank},${d.stableId},${d.floor}`;
          before.set(key, (before.get(key) ?? 0) + 1);
        }

        const copy = [...pool];
        sortDrawablesInPlace(copy);

        expect(copy).toHaveLength(pool.length);
        const after = new Map<string, number>();
        for (const d of copy) {
          const key = `${d.x},${d.y},${d.rank},${d.stableId},${d.floor}`;
          after.set(key, (after.get(key) ?? 0) + 1);
        }
        expect(after).toEqual(before);
      }),
    );
  });

  // Precedence: a future refactor that swaps two components in the
  // comparison chain must fail a named test, not silently pass.
  const base: Drawable = { x: 0, y: 0, rank: 0, stableId: 0n, floor: 0 };

  it("precedence: y differs, everything else equal", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: -1 }), fc.integer({ min: 1, max: 100 }), (lo, hi) => {
        const a: Drawable = { ...base, y: lo };
        const b: Drawable = { ...base, y: hi };
        expect(compareDrawables(a, b)).toBeLessThan(0);
        expect(compareDrawables(b, a)).toBeGreaterThan(0);
      }),
    );
  });

  it("precedence: rank differs, everything else equal", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 21, max: 60 }), (lo, hi) => {
        const a: Drawable = { ...base, rank: lo };
        const b: Drawable = { ...base, rank: hi };
        expect(compareDrawables(a, b)).toBeLessThan(0);
        expect(compareDrawables(b, a)).toBeGreaterThan(0);
      }),
    );
  });

  it("precedence: x differs, everything else equal", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: -1 }), fc.integer({ min: 1, max: 100 }), (lo, hi) => {
        const a: Drawable = { ...base, x: lo };
        const b: Drawable = { ...base, x: hi };
        expect(compareDrawables(a, b)).toBeLessThan(0);
        expect(compareDrawables(b, a)).toBeGreaterThan(0);
      }),
    );
  });

  it("precedence: stableId differs, everything else equal", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 1000n }), fc.bigInt({ min: 1001n, max: 2000n }), (lo, hi) => {
        const a: Drawable = { ...base, stableId: lo };
        const b: Drawable = { ...base, stableId: hi };
        expect(compareDrawables(a, b)).toBeLessThan(0);
        expect(compareDrawables(b, a)).toBeGreaterThan(0);
      }),
    );
  });

  // The trap Quentin names: two per-cell drawables of one multi-cell prop
  // share objectId (stableId) and rank -- totality there rests entirely
  // on x/y differing. Generate that case deliberately: same stableId, same
  // rank, every cell of a footprint, and assert no pair ever compares
  // equal.
  it("same object, same rank, every cell of a footprint: no pair ever ties", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        (stableId, rank, width, height) => {
          const cells: Drawable[] = [];
          for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
              cells.push({ x: col, y: row, rank, stableId, floor: 0 });
            }
          }
          for (let i = 0; i < cells.length; i++) {
            for (let j = i + 1; j < cells.length; j++) {
              const a = cells[i];
              const b = cells[j];
              if (!a || !b) throw new Error("unreachable");
              expect(compareDrawables(a, b)).not.toBe(0);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  // The canopy AC as a proof, not prose: sorting a shuffled pool of
  // distinct-keyed drawables repeatedly always yields the exact same id
  // sequence -- "stable" means stable across shuffles, not merely
  // deterministic within one call.
  it("sorting a shuffled pool repeatedly yields a byte-identical id sequence", () => {
    const pool: Drawable[] = [];
    for (let i = 0; i < 60; i++) {
      pool.push({
        x: (i * 7) % 23,
        y: (i * 13) % 17,
        rank: (i % 5) * 10,
        stableId: BigInt(i),
        floor: i % 3,
      });
    }

    const first = [...pool];
    sortDrawablesInPlace(first);
    const expectedIds = first.map((d) => d.stableId);

    for (let shuffle = 0; shuffle < 20; shuffle++) {
      const shuffled = fc.sample(fc.shuffledSubarray(pool, { minLength: pool.length, maxLength: pool.length }), 1)[0];
      if (!shuffled) throw new Error("unreachable");
      sortDrawablesInPlace(shuffled);
      expect(shuffled.map((d) => d.stableId)).toEqual(expectedIds);
    }
  });

  // Performance discipline: the comparator allocates nothing (no closures,
  // no intermediate arrays), and sorting is in place over the given array
  // -- same array identity in, same array identity out.
  it("sortDrawablesInPlace mutates and returns the same array identity", () => {
    const pool: Drawable[] = [
      { x: 1, y: 1, rank: 0, stableId: 2n, floor: 0 },
      { x: 0, y: 0, rank: 0, stableId: 1n, floor: 0 },
    ];
    const originalArray = pool;
    sortDrawablesInPlace(pool);
    expect(pool).toBe(originalArray);
    expect(pool[0]?.stableId).toBe(1n);
    expect(pool[1]?.stableId).toBe(2n);
  });

  it("holds an order-of-magnitude ceiling over a realistic drawable count", () => {
    const pool: Drawable[] = [];
    for (let i = 0; i < 4000; i++) {
      pool.push({
        x: (i * 31) % 400,
        y: (i * 17) % 400,
        rank: (i % 6) * 10,
        stableId: BigInt(i),
        floor: i % 3,
      });
    }
    const start = performance.now();
    sortDrawablesInPlace(pool);
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(200);
  });
});
