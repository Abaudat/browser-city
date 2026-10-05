import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Runs under the global configuration exactly as the setup file left it (it
// must not reconfigure): a stated max is the size explored (NFR51).
const RUNS = 100;

function largest<T>(arb: fc.Arbitrary<T>, measure: (v: T) => number): number {
  let max = 0;
  fc.assert(
    fc.property(arb, (v) => {
      max = Math.max(max, measure(v));
    }),
    { numRuns: RUNS },
  );
  return max;
}

describe("a stated maximum is the size a property explores (NFR51)", () => {
  // Measured over 2000 seeds the largest of 100 runs is never below 250 for
  // either arbitrary; 200 is missed by a fresh seed with negligible probability.
  it("fc.array with maxLength 400 reaches past 200", () => {
    expect(largest(fc.array(fc.integer(), { maxLength: 400 }), (a) => a.length)).toBeGreaterThan(
      200,
    );
  });
  it("fc.string with maxLength 400 reaches past 200", () => {
    expect(largest(fc.string({ maxLength: 400 }), (s) => s.length)).toBeGreaterThan(200);
  });
  it("fc.uniqueArray with maxLength 400 reaches past 200", () => {
    expect(
      largest(fc.uniqueArray(fc.integer(), { maxLength: 400 }), (a) => a.length),
    ).toBeGreaterThan(200);
  });
  it("fc.dictionary with maxKeys 400 reaches past 200 keys", () => {
    expect(
      largest(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.integer(), { maxKeys: 400 }),
        (d) => Object.keys(d).length,
      ),
    ).toBeGreaterThan(200);
  });
  it("an arbitrary with no stated maximum stays at the cheap default", () => {
    expect(largest(fc.array(fc.integer()), (a) => a.length)).toBeLessThanOrEqual(10);
  });
});
