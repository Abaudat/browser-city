import { describe, expect, it } from "vitest";
import {
  CitizenBody,
  type CitizenState,
  createCitizenFrame,
  type TransitState,
} from "../../../src/l3/citizen";
import { walkFramesPerCycle } from "../../../src/l3/config";
import { committedDefs } from "../test-street/street-world";
import { l3Config } from "./defs-config";
import { CFG, TestGrid } from "./support";

const cfg = l3Config();
const FRAMES = walkFramesPerCycle(committedDefs(), "adult");
const gait = { strideCells: cfg.strideCells, framesPerCycle: FRAMES };

const transit: TransitState = {
  kind: "transit",
  key: 1,
  leg: {
    waypoints: [
      { x: 0, y: 0, floor: 0 },
      { x: 10, y: 0, floor: 0 },
    ],
    departAt: 1000,
    arriveAt: 3000,
  },
  startFacing: "up",
  endFacing: "down",
};

function frameOf(body: CitizenBody, state: CitizenState, t: number) {
  const out = createCitizenFrame();
  body.frameAt(state, t, out);
  return { ...out };
}

describe("walkFramesPerCycle", () => {
  it("reads the walk row of the family's layout", () => {
    expect(FRAMES).toBe(6);
  });

  it("names the family when it has no walk row", () => {
    const defs = committedDefs();
    const bare = {
      ...defs,
      appearanceLayouts: defs.appearanceLayouts.map((l) => ({ ...l, rows: [] })),
    };
    expect(() => walkFramesPerCycle(bare, "adult")).toThrow(/adult/);
  });
});

describe("CitizenBody", () => {
  it("At(node): idle on the node, facing as the node says", () => {
    const body = new CitizenBody(new TestGrid(), CFG, gait, "c");
    const f = frameOf(body, { kind: "at", node: { x: 3, y: 4, floor: 0 }, facing: "left" }, 0);
    expect(f).toMatchObject({
      x: 3.5,
      y: 4.5,
      animation: "idle",
      direction: "left",
      frameIndex: 0,
    });
  });

  it("InTransit: idle facing the start before depart, the end from arrive on", () => {
    const body = new CitizenBody(new TestGrid(), CFG, gait, "c");
    expect(frameOf(body, transit, 999)).toMatchObject({
      animation: "idle",
      direction: "up",
      x: 0.5,
    });
    expect(frameOf(body, transit, 3000)).toMatchObject({
      animation: "idle",
      direction: "down",
      x: 10.5,
    });
  });

  it("walks in the walk row facing its travel, the frame following distance", () => {
    const body = new CitizenBody(new TestGrid(), CFG, gait, "c");
    const seen = new Set<number>();
    for (let t = 1001; t < 3000; t += 5) {
      const f = frameOf(body, transit, t);
      expect(f.animation).toBe("walk");
      expect(f.direction).toBe("right");
      seen.add(f.frameIndex);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("the frame is the same at the same distance whatever the pace (no sliding feet)", () => {
    const slow = { ...transit, leg: { ...transit.leg, arriveAt: 5000 } };
    const a = new CitizenBody(new TestGrid(), CFG, gait, "c");
    const b = new CitizenBody(new TestGrid(), CFG, gait, "c");
    // Half way along each leg: the same distance, whatever the time.
    expect(frameOf(a, transit, 2000).frameIndex).toBe(frameOf(b, slow, 3000).frameIndex);
  });

  it("a late joiner and a long-lived body agree on every frame", () => {
    const old = new CitizenBody(new TestGrid(), CFG, gait, "c");
    for (let t = 900; t < 3100; t += 13) {
      const joiner = new CitizenBody(new TestGrid(), CFG, gait, "c");
      expect(frameOf(joiner, transit, t)).toEqual(frameOf(old, transit, t));
    }
  });

  it("different citizens start their cycle at different frames", () => {
    const frames = new Set(
      ["a", "b", "c", "d", "e", "f"].map(
        (id) => frameOf(new CitizenBody(new TestGrid(), CFG, gait, id), transit, 1001).frameIndex,
      ),
    );
    expect(frames.size).toBeGreaterThan(1);
  });

  it("a new leg key builds a new body; the same key reuses it", () => {
    const body = new CitizenBody(new TestGrid(), CFG, gait, "c");
    frameOf(body, transit, 1500);
    frameOf(body, transit, 1600);
    expect(body.searchCount).toBe(1);
    frameOf(body, { ...transit, key: 2 }, 1600);
    expect(body.searchCount).toBe(1);
    expect(body.body).toBeDefined();
  });

  it("reports its diagnostics: fallbacks and per-segment pace", () => {
    const grid = new TestGrid();
    grid.block(10, 0);
    const body = new CitizenBody(grid, CFG, gait, "c");
    expect(body.diagnostics(1, cfg)).toBeUndefined();
    frameOf(body, transit, 1500);
    const d = body.diagnostics(1, cfg);
    expect(d?.fallbacks).toBe(1);
    // 10 cells in 2000 milliminutes of 1 ms (2 s) is over twice the walking pace.
    expect(d?.paceOutOfBand).toBe(true);
  });
});

describe("CitizenBody with flavour (story 5.2)", () => {
  const flavour = {
    bucketMilliminutes: cfg.flavourBucketMilliminutes,
    glancePercent: cfg.flavourGlancePercent,
    glanceMilliminutes: cfg.flavourGlanceMilliminutes,
    idleFrameMilliminutes: cfg.idleFrameMilliminutes,
    idleFrames: 6,
    rampCells: cfg.avoidRadiusCells,
  };
  const make = (id = "c") => new CitizenBody(new TestGrid(), CFG, gait, id, flavour);
  const stand = { kind: "at", node: { x: 3, y: 4, floor: 0 }, facing: "left" } as const;

  it("a standing citizen never leaves its node, whatever it shows", () => {
    const body = make("crowd-1");
    const facings = new Set<string>();
    const frames = new Set<number>();
    for (let t = 0; t < 200_000; t += 40) {
      const f = frameOf(body, stand, t);
      expect([f.x, f.y, f.animation]).toEqual([3.5, 4.5, "idle"]);
      facings.add(f.direction);
      frames.add(f.frameIndex);
    }
    expect(facings.size).toBeGreaterThan(1);
    expect(frames.size).toBe(6);
  });

  it("two independent bodies draw the same frame, whatever each was asked before", () => {
    const a = make("same");
    const b = make("same");
    for (const t of [5, 99_999, 40_000, 7]) frameOf(a, stand, t);
    for (let t = 0; t < 120_000; t += 777) {
      const x = frameOf(a, stand, t);
      const y = frameOf(b, stand, t);
      for (const k of Object.keys(x) as (keyof typeof x)[])
        expect(Object.is(x[k], y[k])).toBe(true);
    }
  });

  it("a walker shows the walk row and no flavour", () => {
    const body = make("w");
    for (let t = 1100; t < 2900; t += 100) {
      const f = frameOf(body, transit, t);
      expect(f.animation).toBe("walk");
      expect(f.direction).toBe("right");
      expect(f.moving).toBe(true);
    }
  });

  it("a citizen waiting to depart shows no glance that would run into its departure", () => {
    let checked = 0;
    for (let n = 0; n < 30; n++) {
      const body = make(`c${n}`);
      for (let t = 0; t < 60_000; t += 25) {
        if (frameOf(body, stand, t).direction === "left") continue;
        // Glancing at `t` while free to stay; its leg departs right after.
        const leaving: TransitState = {
          ...transit,
          key: 100 + checked,
          startFacing: "left",
          leg: { ...transit.leg, departAt: t + 1, arriveAt: t + 2001 },
        };
        const f = frameOf(make(`c${n}`), leaving, t);
        expect(f.direction).toBe("left");
        checked++;
        break;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("reports the heading and the ramp a sidestep needs, zero at both ends of the leg", () => {
    const body = make();
    const mid = frameOf(body, transit, 2000);
    expect([mid.headingX, mid.headingY, mid.moving]).toEqual([1, 0, true]);
    expect(mid.ramp).toBe(1);
    expect(frameOf(body, transit, 1000).ramp).toBe(0);
    expect(frameOf(body, transit, 3000).ramp).toBe(0);
  });
});
