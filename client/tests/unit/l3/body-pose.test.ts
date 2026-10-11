import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type BodyDials,
  type BodyFrame,
  createBodyMotion,
  poseBody,
} from "../../../src/l3/body-pose";
import { type Facing, facingOfHeading, phaseOffsetFor, walkFrame } from "../../../src/l3/gait";
import { l3Config } from "./defs-config";

const cfg = l3Config();
const DIALS: BodyDials = {
  strideCells: cfg.strideCells,
  walkFrames: 6,
  idleFrames: 6,
  idleFrameMilliminutes: cfg.idleFrameMilliminutes,
};
const frame = (): BodyFrame => ({ animation: "idle", direction: "down", frameIndex: 0 });
const ID = "character-7";

describe("poseBody", () => {
  it("faces each of the four directions of a move", () => {
    const cases: [number, number, Facing][] = [
      [0.1, 0, "right"],
      [-0.1, 0, "left"],
      [0, 0.1, "down"],
      [0, -0.1, "up"],
    ];
    for (const [dx, dy, want] of cases) {
      const m = createBodyMotion();
      const out = frame();
      poseBody(ID, m, dx, dy, 0, DIALS, out);
      expect(out.animation).toBe("walk");
      expect(out.direction).toBe(want);
    }
  });

  it("inv_facing_is_a_function_of_the_heading", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        (dx, dy) => {
          fc.pre(dx !== 0 || dy !== 0);
          const out = frame();
          poseBody(ID, createBodyMotion(), dx, dy, 0, DIALS, out);
          expect(out.direction).toBe(facingOfHeading(dx, dy));
        },
      ),
    );
  });

  it("a diagonal tie faces horizontally", () => {
    const out = frame();
    poseBody(ID, createBodyMotion(), 0.1, 0.1, 0, DIALS, out);
    expect(out.direction).toBe("right");
  });

  it("the walk frame follows distance walked, never time", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.001, max: 0.3, noNaN: true }), { minLength: 1, maxLength: 40 }),
        fc.integer({ min: 0, max: 1e9 }),
        (steps, t) => {
          const a = createBodyMotion();
          const b = createBodyMotion();
          const oa = frame();
          const ob = frame();
          let walked = 0;
          for (const s of steps) {
            poseBody(ID, a, s, 0, 0, DIALS, oa);
            poseBody(ID, b, s, 0, t, DIALS, ob);
            walked += s;
          }
          expect(oa.frameIndex).toBe(ob.frameIndex);
          expect(oa.frameIndex).toBe(
            walkFrame(walked, DIALS.strideCells, phaseOffsetFor(ID), DIALS.walkFrames),
          );
        },
      ),
    );
  });

  it("at rest it returns to the idle row and keeps the last facing", () => {
    const m = createBodyMotion();
    const out = frame();
    poseBody(ID, m, -0.1, 0, 0, DIALS, out);
    expect(out.direction).toBe("left");
    poseBody(ID, m, 0, 0, 0, DIALS, out);
    expect(out.animation).toBe("idle");
    expect(out.direction).toBe("left");
  });

  it("a frame with no displacement (a wall) is idle, never a walk on the spot", () => {
    const m = createBodyMotion();
    const out = frame();
    poseBody(ID, m, 0.1, 0, 0, DIALS, out);
    poseBody(ID, m, 0, 0, 0, DIALS, out);
    expect(out.animation).toBe("idle");
    expect(out.direction).toBe("right");
  });

  it("idle plays on city time with an id-seeded phase", () => {
    const m = createBodyMotion();
    const a = frame();
    const b = frame();
    poseBody(ID, m, 0, 0, 0, DIALS, a);
    poseBody(ID, m, 0, 0, DIALS.idleFrameMilliminutes, DIALS, b);
    expect((a.frameIndex + 1) % DIALS.idleFrames).toBe(b.frameIndex);
  });

  it("is the same function for a local and a remote driver", () => {
    const moves: [number, number][] = [
      [0.1, 0],
      [0.1, 0.05],
      [0, 0],
      [0, -0.2],
      [-0.1, 0],
      [0, 0],
    ];
    const local = createBodyMotion();
    const remote = createBodyMotion();
    const lo = frame();
    const ro = frame();
    for (const [dx, dy] of moves) {
      poseBody(ID, local, dx, dy, 100, DIALS, lo);
      poseBody(ID, remote, dx, dy, 100, DIALS, ro);
      expect(lo).toEqual(ro);
    }
  });
});
