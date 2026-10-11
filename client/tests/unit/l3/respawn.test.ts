import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CitizenBody, createCitizenFrame, type TransitState } from "../../../src/l3/citizen";
import { walkFramesPerCycle } from "../../../src/l3/config";
import { committedDefs } from "../test-street/street-world";
import { l3Config, lifeDials } from "./defs-config";
import { CFG, TestGrid } from "./support";

const cfg = l3Config();
const gait = {
  strideCells: cfg.strideCells,
  framesPerCycle: walkFramesPerCycle(committedDefs(), "adult"),
};

const state = (len: number, departAt: number, arriveAt: number): TransitState => ({
  kind: "transit",
  key: 7,
  leg: {
    waypoints: [
      { x: 0, y: 0, floor: 0 },
      { x: len, y: 0, floor: 0 },
      { x: len, y: len, floor: 0 },
    ],
    departAt,
    arriveAt,
  },
  startFacing: "up",
  endFacing: "down",
});

const make = (id: string) => new CitizenBody(new TestGrid(), CFG, gait, id, lifeDials());
const sample = (b: CitizenBody, s: TransitState, t: number) => {
  const f = createCitizenFrame();
  b.frameAt(s, t, f);
  return f;
};

describe("inv_respawned_body_matches_continuous_body", () => {
  it("a body discarded at t1 and rebuilt at t2 draws exactly what one that lived on draws", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.integer({ min: 4, max: 30 }),
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        (id, len, t0, d1, d2) => {
          const s = state(len, 0, 20000);
          const t1 = t0 + d1;
          const t2 = t1 + d2;
          const continuous = make(id);
          sample(continuous, s, t0);
          sample(continuous, s, t1);
          const a = sample(continuous, s, t2);
          // Despawned at t1: nothing of it survives.
          const respawned = make(id);
          const b = sample(respawned, s, t2);
          for (const k of [
            "x",
            "y",
            "floor",
            "animation",
            "direction",
            "frameIndex",
            "flavour",
            "headingX",
            "headingY",
          ] as const) {
            expect(Object.is(a[k], b[k]), `${k}: ${String(a[k])} vs ${String(b[k])}`).toBe(true);
          }
        },
      ),
    );
  });
});
