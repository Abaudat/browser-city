// A property records the effective size of each case -- what the system under
// test consumed, after any map/filter/dedupe -- and asserts the largest one
// seen reached a stated floor (NFR51). With BC_SIZE_REPORT set to a file path
// each probe also appends `test<TAB>max<TAB>median<TAB>cases` to it.
// A floor is about 75-80% of the smallest max seen over 40 distinct seeds at
// the property's own numRuns, so a fresh seed (explore.yml) is far from it.
import { appendFileSync } from "node:fs";
import type fc from "fast-check";
import { expect } from "vitest";

export interface SizeProbe {
  record(size: number): void;
  /** `arb`, recording `size(value)` of every value it generates. */
  over<T>(arb: fc.Arbitrary<T>, size: (value: T) => number): fc.Arbitrary<T>;
  /** Assert the largest recorded size is at least `floor`. */
  expectReached(floor: number): void;
}

export function sizeProbe(): SizeProbe {
  const sizes: number[] = [];
  const record = (size: number): void => {
    sizes.push(size);
  };
  return {
    record,
    over: (arb, size) =>
      arb.map((value) => {
        record(size(value));
        return value;
      }),
    expectReached: (floor) => {
      const sorted = [...sizes].sort((a, b) => a - b);
      const max = sorted[sorted.length - 1] ?? 0;
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      const report = process.env.BC_SIZE_REPORT;
      if (report) {
        const name = expect.getState().currentTestName ?? "?";
        appendFileSync(report, `${name}\t${max}\t${median}\t${sizes.length}\n`);
      }
      expect(max, `largest of ${sizes.length} cases, median ${median}`).toBeGreaterThanOrEqual(
        floor,
      );
    },
  };
}
