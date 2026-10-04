import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  advanceGait,
  facingOfHeading,
  type GaitState,
  phaseOffsetFor,
  walkFrame,
} from "../../../src/l3/gait";
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
    expect(facingOfHeading(1, 0.2)).toBe("right");
    expect(facingOfHeading(-1, 0)).toBe("left");
    expect(facingOfHeading(0, -1)).toBe("up");
    expect(facingOfHeading(0.1, 1)).toBe("down");
  });

  it("is horizontal on a perfect diagonal: a pure function, no state to disagree on", () => {
    expect(facingOfHeading(1, 1)).toBe("right");
    expect(facingOfHeading(-1, 1)).toBe("left");
    expect(facingOfHeading(-1, -1)).toBe("left");
  });

  it("inv_facing_is_a_function_of_the_heading", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        (x, y) => {
          expect(facingOfHeading(x, y)).toBe(facingOfHeading(x, y));
          const f = facingOfHeading(x, y);
          if (Math.abs(x) > Math.abs(y)) expect(["left", "right"]).toContain(f);
          if (Math.abs(y) > Math.abs(x)) expect(["up", "down"]).toContain(f);
        },
      ),
    );
  });
});

describe("advanceGait", () => {
  it("reads facing from motion, holds it at rest and restarts the distance", () => {
    const s: GaitState = { facing: "down", walked: 0 };
    expect(advanceGait(s, 1, 0.2)).toBe(true);
    expect(s).toEqual({ facing: "right", walked: Math.hypot(1, 0.2) });
    expect(advanceGait(s, -1, 0.2)).toBe(true);
    expect(s.facing).toBe("left");
    expect(advanceGait(s, 0.1, -1)).toBe(true);
    expect(s.facing).toBe("up");
    expect(advanceGait(s, 0, 0)).toBe(false);
    expect(s).toEqual({ facing: "up", walked: 0 });
  });

  it("the frame follows the distance walked: the same distance, the same frame", () => {
    const a: GaitState = { facing: "down", walked: 0 };
    const b: GaitState = { facing: "down", walked: 0 };
    for (let i = 0; i < 10; i++) advanceGait(a, 0.1, 0);
    advanceGait(b, 1, 0);
    expect(walkFrame(a.walked, STRIDE, 0.3, 6)).toBe(walkFrame(b.walked, STRIDE, 0.3, 6));
  });
});
