import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sizeProbe } from "./size-probe";

describe("sizeProbe (NFR51)", () => {
  const stated = { min: 0, max: 40 };

  it("is green when the largest recorded size is at the floor", () => {
    const p = sizeProbe(stated);
    for (const n of [3, 25, 11]) p.record(n);
    expect(() => p.expectReached(25)).not.toThrow();
  });

  it("is red when the largest recorded size is below the floor", () => {
    const p = sizeProbe(stated);
    for (const n of [3, 24, 11]) p.record(n);
    expect(() => p.expectReached(25)).toThrow(/largest of 3 cases/);
  });

  it("is red when nothing was recorded", () => {
    expect(() => sizeProbe(stated).expectReached(25)).toThrow();
  });

  it("rejects a floor at or below the default ceiling, 2 * min + 10", () => {
    const p = sizeProbe(stated);
    p.record(40);
    expect(() => p.expectReached(10)).toThrow(/default ceiling/);
    expect(() => p.expectReached(11)).not.toThrow();
    const q = sizeProbe({ min: 2, max: 40 });
    q.record(40);
    expect(() => q.expectReached(14)).toThrow(/default ceiling/);
    expect(() => q.expectReached(15)).not.toThrow();
  });

  it("rejects a floor above the stated maximum", () => {
    const p = sizeProbe(stated);
    p.record(40);
    expect(() => p.expectReached(41)).toThrow(/stated maximum/);
  });

  it("takes an explicit ceiling for a dimension whose default was measured", () => {
    const p = sizeProbe({ min: 0, max: 5, ceiling: 2 });
    p.record(5);
    expect(() => p.expectReached(3)).not.toThrow();
    expect(() => p.expectReached(2)).toThrow(/default ceiling/);
  });

  // minLength 11 and maxLength 40 keep max(seen) and max(seen) + 1 inside (ceiling 10, stated 41].
  it("over records every value its arbitrary generates", () => {
    const p = sizeProbe({ min: 11, max: 41, ceiling: 10 });
    const seen: number[] = [];
    fc.assert(
      fc.property(
        p.over(fc.array(fc.integer(), { minLength: 11, maxLength: 40 }), (a) => a.length),
        (a) => {
          seen.push(a.length);
        },
      ),
      { numRuns: 30 },
    );
    expect(seen.length).toBe(30);
    expect(() => p.expectReached(Math.max(...seen))).not.toThrow();
    expect(() => p.expectReached(Math.max(...seen) + 1)).toThrow(`largest of ${seen.length} cases`);
  });
});
