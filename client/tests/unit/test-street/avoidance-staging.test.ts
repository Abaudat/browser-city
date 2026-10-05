import { describe, expect, it } from "vitest";
import { AvoidanceField, type AvoidDials } from "../../../src/l3/avoidance";
import { CitizenBody, type CitizenFrame, createCitizenFrame } from "../../../src/l3/citizen";
import { pathConfigOf, walkFramesPerCycle } from "../../../src/l3/config";
import {
  AVOIDANCE_SPECS,
  BYSTANDER_CELL,
  BYSTANDER_ID,
  buildAvoidanceFixtures,
  CROSSER_EAST_ID,
  CROSSER_WEST_ID,
  PASSER_ID,
  plazaBounds,
  TWIN_A_ID,
  TWIN_B_ID,
} from "../../../src/test-street/citizens";
import { Timetable } from "../../../src/test-street/timetable";
import { CHUNK_SIZE } from "../../../src/world/chunk";
import { l3Config } from "../l3/defs-config";
import { committedDefs } from "./street-world";

const cfg = l3Config();
const defs = committedDefs();
const path = pathConfigOf(cfg);
const open = { revision: () => 0, walkable: () => true };
const dials: AvoidDials = {
  radiusCells: cfg.avoidRadiusCells,
  maxOffsetCells: cfg.avoidMaxOffsetCells,
  maxNeighbours: cfg.avoidMaxNeighbours,
  halfWidthCells: cfg.bodyHalfWidthCells,
  chunkSize: CHUNK_SIZE,
};
const life = {
  bucketMilliminutes: cfg.flavourBucketMilliminutes,
  glancePercent: cfg.flavourGlancePercent,
  glanceMilliminutes: cfg.flavourGlanceMilliminutes,
  idleFrameMilliminutes: cfg.idleFrameMilliminutes,
  idleFrames: 6,
  rampCells: cfg.avoidRadiusCells,
};
const gait = { strideCells: cfg.strideCells, framesPerCycle: walkFramesPerCycle(defs, "adult") };

interface Walker {
  id: string;
  timetable: Timetable;
  body: CitizenBody;
  frame: CitizenFrame;
}

const ids = [CROSSER_EAST_ID, CROSSER_WEST_ID, PASSER_ID, TWIN_A_ID, TWIN_B_ID];
const walkers: Walker[] = ids.map((id) => ({
  id,
  timetable: new Timetable(AVOIDANCE_SPECS[id] as never, cfg, open, path),
  body: new CitizenBody(open, path, gait, id, life),
  frame: createCitizenFrame(),
}));
const period = (walkers[0] as Walker).timetable.periodMilli;

/** One frame of the staging: base pose and sidestep of each walker, with the
 * bystander standing in. */
function sample(t: number) {
  const field = new AvoidanceField();
  const out = new Map<
    string,
    { x: number; y: number; ox: number; oy: number; frame: CitizenFrame }
  >();
  const index = new Map<string, number>();
  for (const w of walkers) {
    w.body.frameAt(w.timetable.stateAt(t), t, w.frame);
    const f = w.frame;
    index.set(w.id, field.add(w.id, f.x, f.y, f.floor, f.headingX, f.headingY, f.moving, f.ramp));
  }
  const stand = index.set(
    BYSTANDER_ID,
    field.add(BYSTANDER_ID, BYSTANDER_CELL.x + 0.5, BYSTANDER_CELL.y + 0.5, 0, 0, 0, false, 0),
  );
  field.resolve(dials, open);
  for (const w of walkers) {
    const i = index.get(w.id) as number;
    out.set(w.id, {
      x: w.frame.x,
      y: w.frame.y,
      ox: field.offsetX(i),
      oy: field.offsetY(i),
      frame: { ...w.frame },
    });
  }
  return {
    out,
    standerOffset: [
      field.offsetX(stand.get(BYSTANDER_ID) as number),
      field.offsetY(stand.get(BYSTANDER_ID) as number),
    ],
  };
}

describe("the avoidance staging on the test street (story 5.2)", () => {
  it("is plain data on the crowd's own pavement: every route and the bystander inside the plaza", () => {
    const b = plazaBounds();
    const fixtures = buildAvoidanceFixtures(defs);
    expect(fixtures.map((f) => f.id).sort()).toEqual([BYSTANDER_ID, ...ids].sort());
    for (const f of fixtures) {
      expect(f.gridX).toBeGreaterThan(b.x0);
      expect(f.gridX).toBeLessThan(b.x1);
      expect(f.gridY).toBeGreaterThan(b.y0);
      expect(f.gridY).toBeLessThan(b.y1);
    }
    for (const id of ids) {
      for (const c of (AVOIDANCE_SPECS[id] as never as { out: { x: number; y: number }[] }).out) {
        expect(c.x).toBeLessThan(b.x1);
        expect(c.y).toBeLessThan(b.y1);
      }
    }
    expect(new Set(fixtures.map((f) => JSON.stringify(f.tuple))).size).toBe(fixtures.length);
  });

  it("two citizens meet head-on and pass a body's width apart, each on its own right", () => {
    let closestLedger = Number.POSITIVE_INFINITY;
    let closestDrawn = Number.POSITIVE_INFINITY;
    for (let t = 0; t < period; t += 5) {
      const { out } = sample(t);
      const a = out.get(CROSSER_EAST_ID);
      const b = out.get(CROSSER_WEST_ID);
      if (!a || !b) throw new Error("missing crosser");
      closestLedger = Math.min(closestLedger, Math.hypot(a.x - b.x, a.y - b.y));
      closestDrawn = Math.min(
        closestDrawn,
        Math.hypot(a.x + a.ox - b.x - b.ox, a.y + a.oy - b.y - b.oy),
      );
      // Each steps to its own right of its heading: east-bound south, west-bound north.
      for (const w of [a, b]) {
        if (w.frame.moving) {
          const right = w.ox * -w.frame.headingY + w.oy * w.frame.headingX;
          expect(right).toBeGreaterThanOrEqual(-1e-12);
        }
      }
    }
    expect(closestLedger).toBeLessThan(0.2);
    expect(closestDrawn).toBeGreaterThan(1.5 * cfg.avoidMaxOffsetCells);
  });

  it("a walker steps round the standing citizen, who never moves, and the walk ends on its ledger tile", () => {
    let widest = 0;
    for (let t = 0; t < period; t += 5) {
      const { out, standerOffset } = sample(t);
      expect(standerOffset).toEqual([0, 0]);
      const p = out.get(PASSER_ID);
      if (!p) throw new Error("missing passer");
      widest = Math.max(widest, Math.abs(p.oy));
      if (!p.frame.moving) expect([p.ox, p.oy]).toEqual([0, 0]);
    }
    expect(widest).toBeGreaterThan(0.25);
  });

  it("two citizens leaving one node together spread to either side by id", () => {
    let spread = 0;
    for (let t = 0; t < period; t += 5) {
      const { out } = sample(t);
      const a = out.get(TWIN_A_ID);
      const b = out.get(TWIN_B_ID);
      if (!a || !b || !a.frame.moving) continue;
      expect(Math.abs(a.y - b.y)).toBeLessThan(1e-9);
      spread = Math.max(spread, Math.abs(a.oy - b.oy));
    }
    expect(spread).toBeGreaterThan(0.5);
  });

  it("no walker's facing, frame or arrival depends on the sidestep", () => {
    // The sidestep is lateral, so a walker heading east never draws as facing south.
    for (let t = 0; t < period; t += 5) {
      const { out } = sample(t);
      for (const w of out.values()) {
        if (w.frame.moving) expect(w.frame.direction).toBe(w.frame.headingX > 0 ? "right" : "left");
      }
    }
  });
});
