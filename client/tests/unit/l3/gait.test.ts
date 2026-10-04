import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FacingHold, facingOfHeading, phaseOffsetFor, walkFrame } from "../../../src/l3/gait";
import { l3Config } from "./defs-config";

const cfg = l3Config();
const STRIDE = cfg.strideCells;

describe("walkFrame", () => {
  it("advances with distance walked, not with time", () => {
    expect(walkFrame(0, STRIDE, 0, 6)).toBe(0);
    expect(walkFrame(STRIDE / 6, STRIDE, 0, 6)).toBe(1);
    expect(walkFrame(STRIDE, STRIDE, 0, 6)).toBe(0);
    expect(walkFrame(STRIDE * 2.5, STRIDE, 0, 6)).toBe(3);
  });

  it("a stable per-citizen offset shifts the cycle", () => {
    expect(walkFrame(0, STRIDE, 0.5, 6)).toBe(3);
  });

  it("inv_gait_phase_follows_distance_only", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 500, noNaN: true }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        (d, off) => {
          const f = walkFrame(d, STRIDE, off, 6);
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThan(6);
          // A whole number of strides further on is the same frame.
          expect(walkFrame(d + STRIDE * 3, STRIDE, off, 6)).toBe(f);
        },
      ),
    );
  });
});

describe("phaseOffsetFor", () => {
  it("is a stable value in [0, 1) per id, different ids differ", () => {
    expect(phaseOffsetFor("a")).toBe(phaseOffsetFor("a"));
    expect(phaseOffsetFor("a")).not.toBe(phaseOffsetFor("b"));
    for (const id of ["a", "walker", "commuter", ""]) {
      const p = phaseOffsetFor(id);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
  });
});

describe("facingOfHeading", () => {
  it("follows the dominant axis", () => {
    expect(facingOfHeading(1, 0.2, "down")).toBe("right");
    expect(facingOfHeading(-1, 0, "down")).toBe("left");
    expect(facingOfHeading(0, -1, "down")).toBe("up");
    expect(facingOfHeading(0.1, 1, "left")).toBe("down");
  });

  it("keeps the current facing on a perfect diagonal and when still", () => {
    expect(facingOfHeading(1, 1, "up")).toBe("up");
    expect(facingOfHeading(0, 0, "left")).toBe("left");
  });
});

describe("FacingHold", () => {
  it("holds a facing for the hold time before it may change", () => {
    const hold = new FacingHold(cfg.facingHoldMs, "down");
    expect(hold.update("right", 1000)).toBe("right");
    expect(hold.update("up", 1000 + cfg.facingHoldMs - 1)).toBe("right");
    expect(hold.update("up", 1000 + cfg.facingHoldMs)).toBe("up");
  });

  it("the first change is immediate", () => {
    const hold = new FacingHold(cfg.facingHoldMs, "down");
    expect(hold.update("left", 0)).toBe("left");
  });
});
