import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Body, createBodyPose } from "../../../src/l3/body";
import type { TransitState } from "../../../src/l3/citizen";
import { type LedgerPoint, ledgerPositionAt } from "../../../src/l3/ledger-position";
import { CFG, TestGrid } from "./support";

const mk = (pts: [number, number][], departAt: number, arriveAt: number): TransitState => ({
  kind: "transit",
  key: 1,
  leg: { waypoints: pts.map(([x, y]) => ({ x, y, floor: 0 })), departAt, arriveAt },
  startFacing: "down",
  endFacing: "down",
});
const at = (
  s: TransitState | { kind: "at"; node: { x: number; y: number; floor: number }; facing: "down" },
  t: number,
): LedgerPoint => {
  const out = { x: 0, y: 0, floor: 0 };
  ledgerPositionAt(s, t, out);
  return out;
};

describe("ledgerPositionAt", () => {
  it("an At state is its node's centre", () => {
    expect(at({ kind: "at", node: { x: 3, y: 4, floor: 2 }, facing: "down" }, 0)).toEqual({
      x: 3.5,
      y: 4.5,
      floor: 2,
    });
  });

  it("holds the first waypoint before departing and the last after arriving", () => {
    const s = mk(
      [
        [0, 0],
        [10, 0],
      ],
      100,
      200,
    );
    expect(at(s, 0).x).toBe(0.5);
    expect(at(s, 1000).x).toBe(10.5);
  });

  it("on open ground it is exactly where the body's own pose is", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 30 })), {
          minLength: 2,
          maxLength: 5,
        }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (pts, u) => {
          fc.pre(pts.some((p, i) => i > 0 && (p[0] !== pts[0]?.[0] || p[1] !== pts[0]?.[1])));
          const s = mk(pts, 0, 10000);
          const t = Math.floor(u * 10000);
          const body = new Body(s.leg, new TestGrid(), CFG);
          const pose = createBodyPose();
          body.poseAt(t, pose);
          const p = at(s, t);
          // The body may cut a corner round a tile; never by a cell.
          expect(Math.hypot(p.x - pose.x, p.y - pose.y)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});
