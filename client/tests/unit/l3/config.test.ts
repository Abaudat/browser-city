import { describe, expect, it } from "vitest";
import { loadL3Config } from "../../../src/l3/config";
import { committedDefs } from "../test-street/street-world";

describe("loadL3Config", () => {
  it("reads every dial from the committed defs", () => {
    const cfg = loadL3Config(committedDefs());
    expect(cfg.walkCellsPerS).toBeCloseTo(2.2, 9);
    expect(cfg.strideCells).toBeCloseTo(1.3, 9);
    expect(cfg.paceBandPercent).toBeGreaterThan(0);
  });

  it("names the missing key", () => {
    const defs = committedDefs();
    const without = { ...defs, balance: defs.balance.filter((b) => b.key !== "l3.stall_bound_ms") };
    expect(() => loadL3Config(without)).toThrow(/l3\.stall_bound_ms/);
  });
});
