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

  it("reads the avoidance and flavour dials as named values", () => {
    const cfg = loadL3Config(committedDefs());
    expect(cfg.avoidRadiusCells).toBeCloseTo(1.5, 9);
    expect(cfg.avoidMaxOffsetCells).toBeCloseTo(0.45, 9);
    expect(cfg.avoidMaxOffsetCells).toBeLessThan(0.5);
    expect(cfg.avoidMaxNeighbours).toBeGreaterThan(0);
    expect(cfg.flavourBucketMilliminutes).toBeGreaterThan(cfg.flavourGlanceMilliminutes);
    expect(cfg.flavourGlancePercent).toBeLessThan(50);
    expect(cfg.idleFrameMilliminutes).toBeGreaterThan(0);
  });

  it("names every missing story 5.2 key", () => {
    const defs = committedDefs();
    for (const key of [
      "l3.avoid_radius_millicells",
      "l3.avoid_max_offset_millicells",
      "l3.avoid_max_neighbours",
      "l3.flavour_bucket_milliminutes",
      "l3.flavour_glance_percent",
      "l3.flavour_glance_milliminutes",
      "l3.idle_frame_milliminutes",
    ]) {
      const without = { ...defs, balance: defs.balance.filter((b) => b.key !== key) };
      expect(() => loadL3Config(without)).toThrow(key);
    }
  });

  it("names the missing key", () => {
    const defs = committedDefs();
    const without = { ...defs, balance: defs.balance.filter((b) => b.key !== "l3.stall_bound_ms") };
    expect(() => loadL3Config(without)).toThrow(/l3\.stall_bound_ms/);
  });
});
