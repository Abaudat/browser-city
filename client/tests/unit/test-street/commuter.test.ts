import { describe, expect, it } from "vitest";
import { Body, createBodyPose } from "../../../src/l3/body";
import { CitizenBody, createCitizenFrame } from "../../../src/l3/citizen";
import { pathConfigOf, walkFramesPerCycle } from "../../../src/l3/config";
import { COMMUTER_SPEC } from "../../../src/test-street/commuter";
import { Timetable } from "../../../src/test-street/timetable";
import { npcWalkability } from "../../../src/world/npc-walkable";
import { l3Config } from "../l3/defs-config";
import { committedDefs, streetWorldIndex } from "./street-world";

const cfg = l3Config();
const MS_PER_MILLI = cfg.realMsPerCityMinute / 1000;
const path = pathConfigOf(cfg);
const walk = npcWalkability(streetWorldIndex());
const timetable = new Timetable(COMMUTER_SPEC, cfg, walk, path);
const gait = {
  strideCells: cfg.strideCells,
  framesPerCycle: walkFramesPerCycle(committedDefs(), "adult"),
};

describe("the commuter's committed route on the real street", () => {
  const state = timetable.stateAt(0);
  const body = new Body(state.leg, walk, path);
  const out = createBodyPose();

  it("has a path everywhere: zero straight-line fallbacks", () => {
    body.poseAt(state.leg.departAt + 1, out);
    expect(body.fallbackCount).toBe(0);
  });

  it("never turns its back: the heading stays along the route, around the lamppost and after", () => {
    for (let t = state.leg.departAt + 1; t < state.leg.arriveAt; t++) {
      body.poseAt(t, out);
      expect(Math.abs(out.headingX)).toBeGreaterThanOrEqual(Math.abs(out.headingY));
    }
  });

  it("goes around the lamppost: the walked route is longer than the straight line", () => {
    const [a, b] = state.leg.waypoints;
    const straight = Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
    expect(body.totalLength).toBeGreaterThan(straight + 0.1);
    expect(body.fallbackCount).toBe(0);
  });

  it("never stands on a blocked tile", () => {
    for (let t = state.leg.departAt; t <= state.leg.arriveAt; t++) {
      body.poseAt(t, out);
      expect(walk.walkable(0, Math.floor(out.x), Math.floor(out.y))).toBe(true);
    }
  });

  it("walks every segment inside the walking band, and at one pace end to end", () => {
    expect(body.paceWithinBand(MS_PER_MILLI, cfg)).toBe(true);
    const paces = body.walkedPaces(MS_PER_MILLI);
    expect(paces).toHaveLength(1);
    expect(paces[0]).toBeCloseTo(cfg.walkCellsPerS, 1);
  });

  it("is on screen at the observed pace: displacement per frame tracks the pace", () => {
    const prev = createBodyPose();
    body.poseAt(state.leg.departAt + 1, prev);
    let worstRatio = 0;
    for (let t = state.leg.departAt + 2; t < state.leg.arriveAt; t += 2) {
      body.poseAt(t, out);
      const cellsPerS = (Math.hypot(out.x - prev.x, out.y - prev.y) / (2 * MS_PER_MILLI)) * 1000;
      worstRatio = Math.max(worstRatio, cellsPerS / cfg.walkCellsPerS);
      prev.x = out.x;
      prev.y = out.y;
    }
    expect(worstRatio).toBeLessThanOrEqual(1 + cfg.paceBandPercent / 100);
  });

  it("starts and ends at places to stand, both on walkable pavement", () => {
    for (const node of [COMMUTER_SPEC.out[0], COMMUTER_SPEC.out[COMMUTER_SPEC.out.length - 1]]) {
      expect(walk.walkable(0, node?.x ?? 0, node?.y ?? 0)).toBe(true);
    }
  });
});

describe("the timetable", () => {
  it("is a pure function of city time, periodic, out then back", () => {
    const a = timetable.stateAt(123_456);
    expect(timetable.stateAt(123_456 + timetable.periodMilli).leg.departAt - a.leg.departAt).toBe(
      timetable.periodMilli,
    );
    const back = timetable.stateAt(a.leg.departAt + timetable.halfMilli);
    expect(back.leg.waypoints).toEqual([...a.leg.waypoints].reverse());
    expect(back.key).toBe(a.key + 1);
  });

  it("returns the same state object for as long as the leg holds (no allocation per frame)", () => {
    const a = timetable.stateAt(1000);
    expect(timetable.stateAt(1001)).toBe(a);
    expect(timetable.stateAt(1000 + timetable.halfMilli)).not.toBe(a);
  });

  it("repeats within a minute of real time, so anyone opening the game sees it walk", () => {
    expect(timetable.periodMilli * MS_PER_MILLI).toBeLessThan(60_000);
  });

  it("a walker that joins mid-leg draws exactly what one that was there all along draws", () => {
    const old = new CitizenBody(walk, path, gait, "commuter");
    const a = createCitizenFrame();
    const b = createCitizenFrame();
    for (let t = 5000; t < 5000 + timetable.periodMilli; t += 37) {
      old.frameAt(timetable.stateAt(t), t, a);
      const joiner = new CitizenBody(walk, path, gait, "commuter");
      joiner.frameAt(timetable.stateAt(t), t, b);
      expect(b).toEqual(a);
    }
  });

  it("stands facing the window before departing and the lamppost on arriving", () => {
    const body = new CitizenBody(walk, path, gait, "commuter");
    const f = createCitizenFrame();
    const state = timetable.stateAt(0);
    body.frameAt(state, state.leg.departAt - 1, f);
    expect(f).toMatchObject({ animation: "idle", direction: COMMUTER_SPEC.homeFacing });
    body.frameAt(state, state.leg.departAt + 20, f);
    expect(f.animation).toBe("walk");
    body.frameAt(state, state.leg.arriveAt, f);
    expect(f).toMatchObject({ animation: "idle", direction: COMMUTER_SPEC.outFacing });
  });

  it("N frames inside one leg run one path search per segment", () => {
    const body = new CitizenBody(walk, path, gait, "commuter");
    const f = createCitizenFrame();
    const state = timetable.stateAt(0);
    for (let t = state.leg.departAt; t < state.leg.arriveAt; t += 2) body.frameAt(state, t, f);
    expect(body.searchCount).toBe(COMMUTER_SPEC.out.length - 1);
  });
});
