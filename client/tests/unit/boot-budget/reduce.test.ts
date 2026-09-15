// Story 1.14 (NFR1): fixed-input tests for the pure reducer
// docs/spikes/1.14-boot-budget.md's tables are generated from -- Quentin's
// direction, the same bar sched_timing_report's Rust unit tests set.
import { describe, expect, it } from "vitest";
import {
  decodeRevisitOpened,
  median,
  percentile,
  percentileOfSorted,
  summarize,
  summarizeTerms,
  verdictMet,
} from "../../e2e/boot-budget/reduce.mjs";

describe("percentileOfSorted / percentile", () => {
  // True nearest-rank: rank = ceil(p/100 * n), 1-based. Cycle 1's formula
  // (floor(p/100 * n)) read one rank too high throughout -- p50 of 1..10
  // was 6, not the correct 5 (Quentin's cycle-1 finding).
  it("is true nearest-rank: rank = ceil(p/100 * n), 1-based", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileOfSorted(sorted, 50)).toBe(5); // ceil(5)=5 -> index 4
    expect(percentileOfSorted(sorted, 90)).toBe(9); // ceil(9)=9 -> index 8
    expect(percentileOfSorted(sorted, 0)).toBe(1); // ceil(0)=0 -> clamped to index 0
  });

  it("at n=20, p95 is the 19th-smallest value, never the max (cycle 1's bug)", () => {
    const sorted = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
    expect(percentileOfSorted(sorted, 95)).toBe(19); // ceil(19)=19 -> index 18
    expect(percentileOfSorted(sorted, 95)).not.toBe(20);
  });

  it("sorts unsorted input rather than assuming it", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
  });

  it("returns NaN for an empty array rather than throwing", () => {
    expect(percentileOfSorted([], 50)).toBeNaN();
  });
});

describe("median", () => {
  it("is percentile 50", () => {
    expect(median([10, 20, 30, 40])).toBe(percentile([10, 20, 30, 40], 50));
  });
});

describe("summarize", () => {
  it("reports n, median, p75, p95 and max -- never the mean", () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
    const result = summarize(values);
    expect(result.n).toBe(20);
    expect(result.median).toBe(percentile(values, 50));
    expect(result.p75).toBe(percentile(values, 75));
    expect(result.p95).toBe(percentile(values, 95));
    expect(result.max).toBe(20);
  });

  it("handles an empty array without throwing", () => {
    const result = summarize([]);
    expect(result.n).toBe(0);
    expect(result.max).toBeNaN();
  });
});

describe("summarizeTerms", () => {
  const samples = [
    { totalMs: 900, terms: { bundle: 200, defs: 40, handshake: 100 } },
    { totalMs: 1000, terms: { bundle: 250, defs: 50, handshake: 150 } },
    { totalMs: 1100, terms: { bundle: 300, defs: 60, handshake: 200 } },
  ];

  it("summarizes every named term independently", () => {
    const result = summarizeTerms(samples);
    expect(result.n).toBe(3);
    expect(result.terms.bundle.median).toBe(250);
    expect(result.terms.defs.median).toBe(50);
    expect(result.terms.handshake.median).toBe(150);
  });

  it("summarizes the end-to-end total", () => {
    const result = summarizeTerms(samples);
    expect(result.total.median).toBe(1000);
  });

  it("computes the unattributed remainder explicitly, never hiding it", () => {
    const result = summarizeTerms(samples);
    // sample 2: 1000 - (250 + 50 + 150) = 550
    expect(result.remainder.median).toBe(550);
  });

  it("allows a negative remainder when terms overlap in real execution, rather than clamping it", () => {
    const overlapping = [{ totalMs: 100, terms: { a: 80, b: 80 } }];
    const result = summarizeTerms(overlapping);
    expect(result.remainder.median).toBe(-60);
  });

  // Cycle 3 (both leads' direction): atlasFetch nests inside atlasDecoded
  // (both cover the same image fetches), so summing every term double-
  // subtracted the atlas window and made the remainder meaningless
  // (-1.7s to -4.0s in the committed report). An explicit disjoint-term
  // list fixes this without dropping the nested term from the table.
  it("never double-subtracts a nested sub-figure when an explicit disjoint list is given", () => {
    const nested = [
      {
        totalMs: 500,
        terms: { bundle: 100, atlasFetch: 300, atlasDecoded: 320, toControllable: 80 },
      },
    ];
    // Naive (no disjoint list): 500 - (100+300+320+80) = -300, wrong --
    // atlasFetch is counted a second time inside atlasDecoded.
    expect(summarizeTerms(nested).remainder.median).toBe(-300);
    // Disjoint list leaves atlasFetch out: 500 - (100+320+80) = 0, correct.
    const result = summarizeTerms(nested, ["bundle", "atlasDecoded", "toControllable"]);
    expect(result.remainder.median).toBe(0);
    // The excluded term is still summarized and present in the table.
    expect(result.terms.atlasFetch.median).toBe(300);
  });

  it("still reports every term's own summary regardless of the disjoint list", () => {
    const result = summarizeTerms(samples, ["bundle"]);
    expect(result.terms.defs.median).toBe(50);
    expect(result.terms.handshake.median).toBe(150);
    // remainder now only subtracts bundle: 1000 - 250 = 750
    expect(result.remainder.median).toBe(750);
  });
});

describe("verdictMet", () => {
  it("is met when p75 is at or under the budget", () => {
    const summary = { total: { p75: 950 } };
    expect(verdictMet(summary, 1000)).toBe(true);
    expect(verdictMet({ total: { p75: 1000 } }, 1000)).toBe(true);
  });

  it("is missed when p75 exceeds the budget", () => {
    expect(verdictMet({ total: { p75: 1001 } }, 1000)).toBe(false);
  });
});

describe("decodeRevisitOpened", () => {
  it("opens D4's chunking migration when p95 exceeds the trigger", () => {
    expect(decodeRevisitOpened(151, 150)).toBe(true);
  });

  it("stays closed at or under the trigger", () => {
    expect(decodeRevisitOpened(150, 150)).toBe(false);
    expect(decodeRevisitOpened(100, 150)).toBe(false);
  });
});
