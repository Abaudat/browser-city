// Story 5.4 (NFR11): the rush-hour load and, over many frames of it, the
// deterministic work counters that fail in seconds on any client PR -- long
// before the wall-clock gate in `l3-budget.spec.ts` (e2e-perf) does. Avoidance
// pair work is bounded by the neighbour cap, wall scans by the sidestepping
// bodies, path searches by segments x grid revisions, buffers stop growing.
import { describe, expect, it } from "vitest";
import {
  buildRushCrowd,
  RUSH_CROWD_SIZE,
  RUSH_MIN_WALKING_SHARE,
  RUSH_RADIUS_CELLS,
  rushCrowdFor,
} from "../../../src/debug/rush-crowd";
import { type AvoidDials, scanSpan } from "../../../src/l3/avoidance";
import { CitizenBody } from "../../../src/l3/citizen";
import { pathConfigOf, walkFramesPerCycle } from "../../../src/l3/config";
import { Timetable } from "../../../src/l3/interim-timetable";
import {
  type LifeMember,
  lifeDialsFor,
  StreetLife,
  standState,
} from "../../../src/render/street-life";
import { bodyZoneOf, zoneHoldsChunk } from "../../../src/world/body-zone";
import { CHUNK_SIZE } from "../../../src/world/chunk";
import { l3Config } from "../l3/defs-config";
import { committedDefs } from "../support/committed-defs";

/** An open field around the start: the crowd is laid over whatever the
 * world says is standable, so a field is the plainest world there is. */
const START = { x: 100, y: 100 };
const FIELD = {
  x0: START.x - 6 * RUSH_RADIUS_CELLS,
  x1: START.x + 6 * RUSH_RADIUS_CELLS,
  y0: START.y - 3 * RUSH_RADIUS_CELLS,
  y1: START.y + 3 * RUSH_RADIUS_CELLS,
};
const standable = (x: number, y: number) =>
  x >= FIELD.x0 && x < FIELD.x1 && y >= FIELD.y0 && y < FIELD.y1;
const base = {
  revision: () => 0,
  walkable: (_floor: number, x: number, y: number) => standable(x, y),
};

const cfg = l3Config();
const defs = committedDefs();
const path = pathConfigOf(cfg);
const gait = { strideCells: cfg.strideCells, framesPerCycle: walkFramesPerCycle(defs, "adult") };
const life = lifeDialsFor(defs, cfg, "adult");
const crowd = buildRushCrowd(defs, { standable, start: START });

/** A walkability whose revision a test can move, standing in for the
 * collision grid changing under the crowd. */
function revisable() {
  let revision = 0;
  const wrapped = {
    revision: () => revision,
    walkable: base.walkable,
  };
  return { walk: wrapped, bump: () => void revision++ };
}

function street(walk: ReturnType<typeof revisable>["walk"], keep?: (id: string) => boolean) {
  const s = new StreetLife(cfg, walk);
  const bodies = new Map<string, CitizenBody>();
  for (const f of crowd.fixtures) {
    if (keep && !keep(f.id)) continue;
    const spec = crowd.specs[f.id];
    const make = () => ({
      timetable: spec ? new Timetable(spec, cfg, walk, path) : undefined,
      body: new CitizenBody(walk, path, gait, f.id, life),
    });
    const built = make();
    const member = s.add({
      id: f.id,
      ...built,
      stand: spec
        ? undefined
        : standState({ x: Math.floor(f.gridX), y: Math.floor(f.gridY) }, 0, f.facing as never),
      standAt: spec ? undefined : { x: f.gridX, y: f.gridY },
      look: f.id,
      remake: make,
    });
    bodies.set(f.id, member.body);
  }
  return { s, bodies };
}

const dials: AvoidDials = {
  radiusCells: cfg.avoidRadiusCells,
  clearanceCells: cfg.avoidClearanceCells,
  tieBandCells: cfg.avoidTieBandCells,
  maxNeighbours: cfg.avoidMaxNeighbours,
  halfWidthCells: cfg.bodyHalfWidthCells,
  chunkSize: CHUNK_SIZE,
};
const msPerMilli = cfg.realMsPerCityMinute / 1000;
const FRAME_MILLI = 16.7 / msPerMilli;

describe("the rush-hour crowd (NFR11 workload)", () => {
  it("holds RUSH_CROWD_SIZE distinct citizens, deterministically", () => {
    expect(crowd.fixtures).toHaveLength(RUSH_CROWD_SIZE);
    expect(new Set(crowd.fixtures.map((f) => f.id)).size).toBe(RUSH_CROWD_SIZE);
    expect(buildRushCrowd(defs, { standable, start: START })).toEqual(crowd);
    expect(RUSH_CROWD_SIZE).toBeGreaterThanOrEqual(200);
  });

  it("is rush hour: most walk, some stand, a pile converges", () => {
    const walkers = Object.keys(crowd.specs).length;
    expect(walkers).toBe(crowd.walkerCount);
    expect(walkers / RUSH_CROWD_SIZE).toBeGreaterThanOrEqual(RUSH_MIN_WALKING_SHARE);
    expect(crowd.fixtures.length - walkers).toBeGreaterThan(0);
    const pile = Object.entries(crowd.specs).filter(([id]) => id.startsWith("rush-pile"));
    expect(pile.length).toBeGreaterThan(0);
    expect(new Set(pile.map(([, s]) => `${s.out[1].x},${s.out[1].y}`)).size).toBe(1);
  });

  it("stays on standable cells within the crowd's radius of the start", () => {
    const cells = [
      ...Object.values(crowd.specs).flatMap((s) => s.out),
      ...crowd.fixtures.map((f) => ({ x: Math.floor(f.gridX), y: Math.floor(f.gridY), floor: 0 })),
    ];
    for (const c of cells) {
      expect(Math.abs(c.x - START.x)).toBeLessThanOrEqual(6 * RUSH_RADIUS_CELLS);
      expect(Math.abs(c.y - START.y)).toBeLessThanOrEqual(RUSH_RADIUS_CELLS);
      expect(standable(c.x, c.y)).toBe(true);
    }
  });
});

describe("L3 work counters over a sustained rush hour", () => {
  const FRAMES = 600;
  /** 600 frames of 200 bodies is seconds of node time. */
  const T = 60_000;

  it(
    "bounds avoidance pair work by the neighbour cap, never by bodies squared",
    () => {
      const { walk } = revisable();
      const { s } = street(walk);
      let worstPairs = 0;
      let capped = 0;
      for (let k = 0; k < FRAMES; k++) {
        s.solve(5_000 + k * FRAME_MILLI);
        worstPairs = Math.max(worstPairs, s.field.pairChecks);
        capped = Math.max(capped, s.field.capHits);
      }
      const n = RUSH_CROWD_SIZE;
      // Each body looks at the 3x3 cells round it only: far below n^2 / 2.
      expect(worstPairs).toBeLessThan((n * n) / 4);
      // The pile reaches the cap: the m^2 case is really exercised.
      expect(capped).toBeGreaterThan(0);
    },
    T,
  );

  it(
    "scans walls once per sidestepping body, not once per question",
    () => {
      const { walk } = revisable();
      const { s } = street(walk);
      let worstCalls = 0;
      const side = 2 * scanSpan(dials) + 1;
      for (let k = 0; k < FRAMES; k++) {
        s.solve(5_000 + k * FRAME_MILLI);
        worstCalls = Math.max(worstCalls, s.field.walkableCalls);
      }
      expect(worstCalls).toBeLessThanOrEqual(RUSH_CROWD_SIZE * side * side);
    },
    T,
  );

  it(
    "searches once per segment per grid revision, never per frame",
    () => {
      const rev = revisable();
      const { s, bodies } = street(rev.walk);
      const t0 = 5_000;
      const mostSearches = (): number =>
        Math.max(...[...bodies.values()].map((b) => b.searchCount));
      for (let k = 0; k < 120; k++) s.solve(t0 + k * FRAME_MILLI);
      // Every leg here is a single segment: at most one search each so far.
      expect(mostSearches()).toBeLessThanOrEqual(1);
      rev.bump();
      for (let k = 120; k < 240; k++) s.solve(t0 + k * FRAME_MILLI);
      expect(mostSearches()).toBeLessThanOrEqual(2);
      // The same instant, the same revision: nothing re-searches.
      s.solve(t0 + 240 * FRAME_MILLI);
      const before = [...bodies.values()].reduce((sum, b) => sum + b.searchCount, 0);
      s.solve(t0 + 240 * FRAME_MILLI);
      const after = [...bodies.values()].reduce((sum, b) => sum + b.searchCount, 0);
      expect(after).toBe(before);
    },
    T,
  );

  it(
    "never grows its buffers after warm-up",
    () => {
      const { walk } = revisable();
      const { s } = street(walk);
      for (let k = 0; k < 60; k++) s.solve(5_000 + k * FRAME_MILLI);
      const capacity = s.field.capacity;
      const members: readonly LifeMember[] = s.members;
      expect(members).toHaveLength(RUSH_CROWD_SIZE);
      for (let k = 60; k < FRAMES; k++) s.solve(5_000 + k * FRAME_MILLI);
      expect(s.field.capacity).toBe(capacity);
      expect(s.field.size).toBe(RUSH_CROWD_SIZE);
    },
    T,
  );
});

describe("avoidance scoping at density (bubble independence)", () => {
  const rect = (x0: number, x1: number) => ({
    x0: START.x + x0,
    y0: START.y - 20,
    x1: START.x + x1,
    y1: START.y + 20,
  });

  it("a chunk is held only wholly inside the spawn rect less the inset, in the band", () => {
    const zone = bodyZoneOf({ x0: 0, y0: 0, x1: 0, y1: 0 }, 0, 0, 10);
    // spawn is -10..10 on both axes.
    expect(zoneHoldsChunk(zone, 0, 0, 0, 4)).toBe(true);
    expect(zoneHoldsChunk(zone, 0, 1, 0, 4)).toBe(true);
    expect(zoneHoldsChunk(zone, 0, 2, 0, 4)).toBe(false);
    expect(zoneHoldsChunk(zone, 0, 1, 0, 4, 3)).toBe(false);
    expect(zoneHoldsChunk(zone, -1, 0, 0, 4)).toBe(false);
  });

  it(
    "two bubbles agree on every body both resolve with a held neighbourhood",
    () => {
      const left = bodyZoneOf(rect(-30, 24), 0, 0, 0);
      const right = bodyZoneOf(rect(-14, 40), 0, 0, 0);
      const { walk } = revisable();
      let compared = 0;
      let sidestepping = 0;
      for (let k = 0; k < 24; k++) {
        const t = 5_000 + k * 400;
        const ref = street(walk);
        ref.s.solve(t);
        const at = new Map(ref.s.members.map((m) => [m.id, m.frame.x]));
        // Each client holds only the citizens inside its own spawn rect.
        const holds = (zone: typeof left) => (id: string) => {
          const x = at.get(id) as number;
          return x >= zone.spawn.x0 && x <= zone.spawn.x1;
        };
        const a = street(walk, holds(left));
        const b = street(walk, holds(right));
        a.s.solve(t, left);
        b.s.solve(t, right);
        const inB = new Map(b.s.members.map((m) => [m.id, m]));
        for (const m of a.s.members) {
          const n = inB.get(m.id);
          if (!n || !a.s.field.agreed(m.index) || !b.s.field.agreed(n.index)) continue;
          compared++;
          if (a.s.offsetX(m) !== 0 || a.s.offsetY(m) !== 0) sidestepping++;
          expect(a.s.offsetX(m)).toBe(b.s.offsetX(n));
          expect(a.s.offsetY(m)).toBe(b.s.offsetY(n));
        }
      }
      expect(compared).toBeGreaterThan(100);
      expect(sidestepping).toBeGreaterThan(0);
    },
    T_LONG,
  );
});

const T_LONG = 60_000;

describe("laying the crowd over a world", () => {
  it("is empty where nothing is standable, and builds through the page's hook", () => {
    const none = buildRushCrowd(defs, { standable: () => false, start: START });
    expect(none).toEqual({ fixtures: [], specs: {}, walkerCount: 0 });
    const built = rushCrowdFor(defs)({ standable, start: START });
    expect(built.fixtures).toHaveLength(RUSH_CROWD_SIZE);
  });

  it("still lays a crowd where only a thin lane is standable", () => {
    const lane = (x: number, y: number) => y === START.y && Math.abs(x - START.x) < 20;
    const built = buildRushCrowd(defs, { standable: lane, start: START });
    expect(built.fixtures).toHaveLength(RUSH_CROWD_SIZE);
    for (const f of built.fixtures)
      expect(lane(Math.floor(f.gridX), Math.floor(f.gridY))).toBe(true);
  });
});
