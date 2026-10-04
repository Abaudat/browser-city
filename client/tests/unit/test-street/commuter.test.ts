import { describe, expect, it } from "vitest";
import { Body, createBodyPose, paceWithinBand } from "../../../src/l3/body";
import { COMMUTER_SPEC } from "../../../src/test-street/commuter";
import {
  buildTimetable,
  createWalkerFrame,
  legAt,
  TimetableWalker,
} from "../../../src/test-street/timetable";
import { npcWalkability } from "../../../src/world/npc-walkable";
import { l3Config } from "../l3/defs-config";
import { streetWorldIndex } from "./street-world";

const cfg = l3Config();
const MS_PER_MILLI = cfg.realMsPerCityMinute / 1000;
const path = { marginCells: cfg.marginCells, nodeBudget: cfg.nodeBudget };
const walk = npcWalkability(streetWorldIndex());
const timetable = buildTimetable(COMMUTER_SPEC, cfg);

describe("the commuter's committed route on the real street", () => {
  const leg = legAt(timetable, 0).leg;
  const body = new Body(leg, walk, path);
  const out = createBodyPose();

  it("has a path everywhere: zero straight-line fallbacks", () => {
    body.poseAt(leg.departAt + 1, out);
    expect(body.fallbackCount).toBe(0);
  });

  it("goes around a solid prop and turns at least twice", () => {
    let manhattan = 0;
    for (let i = 1; i < leg.waypoints.length; i++) {
      const a = leg.waypoints[i - 1];
      const b = leg.waypoints[i];
      manhattan += Math.abs((a?.x ?? 0) - (b?.x ?? 0)) + Math.abs((a?.y ?? 0) - (b?.y ?? 0));
    }
    expect(body.totalLength).toBe(manhattan + COMMUTER_SPEC.detourCells);
    expect(COMMUTER_SPEC.detourCells).toBeGreaterThan(0);
    let turns = 0;
    let last = "";
    for (let t = leg.departAt + 1; t < leg.arriveAt; t++) {
      body.poseAt(t, out);
      const h = `${out.headingX},${out.headingY}`;
      if (last && h !== last) turns++;
      last = h;
    }
    expect(turns).toBeGreaterThanOrEqual(2);
  });

  it("never stands on a blocked tile", () => {
    for (let t = leg.departAt; t <= leg.arriveAt; t++) {
      body.poseAt(t, out);
      expect(walk.walkable(0, Math.floor(out.x), Math.floor(out.y))).toBe(true);
    }
  });

  it("is issued at a pace inside the walking band", () => {
    expect(paceWithinBand(leg, MS_PER_MILLI, cfg)).toBe(true);
  });

  it("starts and ends at standing places on the pavement", () => {
    const start = COMMUTER_SPEC.out[0];
    expect(walk.walkable(0, start?.x ?? 0, start?.y ?? 0)).toBe(true);
    const end = COMMUTER_SPEC.out[COMMUTER_SPEC.out.length - 1];
    expect(walk.walkable(0, end?.x ?? 0, end?.y ?? 0)).toBe(true);
  });
});

describe("the timetable", () => {
  it("is a pure function of city time, periodic, out then back", () => {
    const a = legAt(timetable, 123_456);
    expect(legAt(timetable, 123_456)).toEqual(a);
    const later = legAt(timetable, 123_456 + timetable.periodMilli);
    expect(later.leg.departAt - a.leg.departAt).toBe(timetable.periodMilli);
    const back = legAt(timetable, a.leg.departAt + timetable.halfMilli);
    expect(back.leg.waypoints).toEqual([...a.leg.waypoints].reverse());
    expect(back.key).toBe(a.key + 1);
  });

  it("stands between legs and keeps walking a minute on end", () => {
    // Whatever the moment, within a minute of real time the commuter walks.
    const minuteMilli = 60_000 / MS_PER_MILLI;
    expect(timetable.periodMilli).toBeLessThan(minuteMilli);
  });

  it("two walkers built apart agree on every frame (same place on two clients)", () => {
    const a = new TimetableWalker(timetable, walk, path, cfg, "commuter");
    const b = new TimetableWalker(timetable, walk, path, cfg, "commuter");
    const fa = createWalkerFrame();
    const fb = createWalkerFrame();
    for (let t = 5000; t < 5000 + timetable.periodMilli; t += 37) {
      a.frameAt(t, fa);
      // `b` first meets the world mid-period.
      b.frameAt(t, fb);
      expect(fb).toEqual(fa);
    }
  });

  it("walks in the walk row while moving and the idle row while standing, feet by distance", () => {
    const w = new TimetableWalker(timetable, walk, path, cfg, "commuter");
    const f = createWalkerFrame();
    const leg = legAt(timetable, 0).leg;
    w.frameAt(leg.departAt - 1, f);
    expect(f.animation).toBe("idle");
    expect(f.direction).toBe(COMMUTER_SPEC.homeFacing);
    w.frameAt(leg.departAt + 20, f);
    expect(f.animation).toBe("walk");
    w.frameAt(leg.arriveAt, f);
    expect(f.animation).toBe("idle");
    expect(f.direction).toBe(COMMUTER_SPEC.outFacing);
  });

  it("walk frame follows the distance walked: the same distance, the same frame", () => {
    const w = new TimetableWalker(timetable, walk, path, cfg, "commuter");
    const f = createWalkerFrame();
    const leg = legAt(timetable, 0).leg;
    const seen = new Set<number>();
    for (let t = leg.departAt + 1; t < leg.arriveAt; t += 3) {
      w.frameAt(t, f);
      seen.add(f.frameIndex);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("N frames inside one leg run one path search", () => {
    const w = new TimetableWalker(timetable, walk, path, cfg, "commuter");
    const f = createWalkerFrame();
    const leg = legAt(timetable, 0).leg;
    for (let t = leg.departAt; t < leg.arriveAt; t += 2) w.frameAt(t, f);
    expect(w.searchCount).toBe(COMMUTER_SPEC.out.length - 1);
  });
});
