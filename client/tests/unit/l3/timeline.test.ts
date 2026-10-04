import { describe, expect, it } from "vitest";
import { milliminutesFor, periodOf } from "../../../src/l3/timeline";

describe("timeline", () => {
  it("milliminutesFor rounds to whole milliminutes and never returns zero", () => {
    expect(milliminutesFor(5000, 2.5)).toBe(2000);
    expect(milliminutesFor(0.1, 2.5)).toBe(1);
    expect(milliminutesFor(3, 2.5)).toBe(1);
    expect(milliminutesFor(4, 2.5)).toBe(2);
  });

  it("periodOf floors, including before the epoch", () => {
    expect(periodOf(0, 100)).toBe(0);
    expect(periodOf(99.9, 100)).toBe(0);
    expect(periodOf(100, 100)).toBe(1);
    expect(periodOf(-1, 100)).toBe(-1);
  });
});
