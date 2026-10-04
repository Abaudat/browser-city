import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  Body,
  createBodyPose,
  type Leg,
  legInstants,
  legPaceCellsPerS,
  paceWithinBand,
} from "../../../src/l3/body";
import { l3Config } from "./defs-config";
import { CFG, TestGrid } from "./support";

const cfg = l3Config();
const MS_PER_MILLIMINUTE = cfg.realMsPerCityMinute / 1000;

function leg(
  waypoints: readonly [number, number][],
  departAt: number,
  arriveAt: number,
  floor = 0,
): Leg {
  return { waypoints: waypoints.map(([x, y]) => ({ x, y, floor })), departAt, arriveAt };
}

/** A duration (milliminutes) that walks `cells` at the canonical pace. */
function canonicalDuration(cells: number): number {
  const msPerCell = 1000 / cfg.walkCellsPerS;
  return Math.max(1, Math.round((cells * msPerCell) / MS_PER_MILLIMINUTE));
}

function poseOf(body: Body, t: number) {
  const out = createBodyPose();
  body.poseAt(t, out);
  return { ...out };
}

describe("legInstants", () => {
  it("splits the leg by cumulative Manhattan length, floor division, ends exact", () => {
    const l = leg(
      [
        [0, 0],
        [3, 0],
        [3, 4],
      ],
      100,
      207,
    );
    expect(legInstants(l)).toEqual([100, 100 + Math.floor((107 * 3) / 7), 207]);
  });
});

describe("Body pose", () => {
  const straight = leg(
    [
      [0, 0],
      [10, 0],
    ],
    1000,
    1000 + canonicalDuration(10),
  );

  it("stands at the origin before depart and the destination from arrive on", () => {
    const body = new Body(straight, new TestGrid(), CFG);
    const before = poseOf(body, 999);
    expect([before.x, before.y, before.moving]).toEqual([0.5, 0.5, false]);
    const at = poseOf(body, straight.arriveAt);
    expect([at.x, at.y, at.moving]).toEqual([10.5, 0.5, false]);
    expect(poseOf(body, straight.arriveAt + 5_000_000).x).toBe(10.5);
  });

  it("walks at constant speed, spread over the whole leg", () => {
    const body = new Body(straight, new TestGrid(), CFG);
    const mid = poseOf(body, 1000 + (straight.arriveAt - 1000) / 2);
    expect(mid.x).toBeCloseTo(5.5, 9);
    expect(mid.moving).toBe(true);
    expect(mid.headingX).toBe(1);
  });

  it("is mid-walk for a body created mid-leg, exactly where a long-lived one is", () => {
    const grid = new TestGrid();
    const old = new Body(straight, grid, CFG);
    for (let t = 1000; t < 1500; t += 7) poseOf(old, t);
    const fresh = new Body(straight, grid, CFG);
    expect(poseOf(fresh, 1500)).toEqual(poseOf(old, 1500));
  });

  it("depart == arrive: origin before, destination at and after", () => {
    const body = new Body(
      leg(
        [
          [0, 0],
          [3, 0],
        ],
        50,
        50,
      ),
      new TestGrid(),
      CFG,
    );
    expect(poseOf(body, 49).x).toBe(0.5);
    expect(poseOf(body, 50).x).toBe(3.5);
  });

  it("arrive < depart never throws and never walks backwards", () => {
    const body = new Body(
      leg(
        [
          [0, 0],
          [3, 0],
        ],
        50,
        40,
      ),
      new TestGrid(),
      CFG,
    );
    expect(poseOf(body, 45).x).toBe(0.5);
    expect(poseOf(body, 50).x).toBe(3.5);
  });

  it("carries speed through a corner and turns the heading once", () => {
    const l = leg(
      [
        [0, 0],
        [4, 3],
      ],
      0,
      700,
    );
    const body = new Body(l, new TestGrid(), CFG);
    const headings = new Set<string>();
    let last = "";
    let changes = 0;
    for (let t = 1; t < 700; t++) {
      const p = poseOf(body, t);
      const h = `${p.headingX},${p.headingY}`;
      headings.add(h);
      if (h !== last) changes++;
      last = h;
    }
    expect(headings.size).toBe(2);
    expect(changes).toBe(2);
  });

  it("paths around a static obstacle", () => {
    const grid = new TestGrid();
    grid.block(5, 0);
    const body = new Body(straight, grid, CFG);
    for (let t = 1000; t <= straight.arriveAt; t += 3) {
      const p = poseOf(body, t);
      expect(grid.walkable(0, Math.floor(p.x), Math.floor(p.y))).toBe(true);
    }
    expect(body.fallbackCount).toBe(0);
  });

  it("an unreachable goal is walked straight and still arrives on time", () => {
    const grid = new TestGrid();
    grid.block(10, 0);
    const body = new Body(straight, grid, CFG);
    poseOf(body, 1100);
    expect(body.fallbackCount).toBe(1);
    expect(poseOf(body, straight.arriveAt).x).toBe(10.5);
  });

  it("runs one path search for any number of frames inside a segment", () => {
    const body = new Body(straight, new TestGrid(), CFG);
    for (let t = 1000; t < 1300; t++) poseOf(body, t);
    expect(body.searchCount).toBe(1);
  });

  it("recomputes the whole leg when the grid revision moves", () => {
    const grid = new TestGrid();
    const body = new Body(straight, grid, CFG);
    poseOf(body, 1100);
    grid.block(5, 0);
    poseOf(body, 1101);
    expect(body.searchCount).toBe(2);
  });

  it("refuses a leg that changes floor, by name", () => {
    expect(
      () =>
        new Body(
          {
            waypoints: [
              { x: 0, y: 0, floor: 0 },
              { x: 1, y: 0, floor: 1 },
            ],
            departAt: 0,
            arriveAt: 10,
          },
          new TestGrid(),
          CFG,
        ),
    ).toThrow(/floor/);
  });

  it("a one-waypoint route stands still", () => {
    const body = new Body(leg([[2, 2]], 0, 10), new TestGrid(), CFG);
    expect(poseOf(body, 5)).toMatchObject({ x: 2.5, y: 2.5, moving: false });
  });

  it("distance is the cumulative walked arc length", () => {
    const body = new Body(straight, new TestGrid(), CFG);
    expect(poseOf(body, straight.arriveAt).distance).toBe(10);
    expect(poseOf(body, 999).distance).toBe(0);
  });
});

describe("pace", () => {
  it("a leg at canonical pace is in band; a hurried or crawling one is not", () => {
    const ok = leg(
      [
        [0, 0],
        [10, 0],
      ],
      0,
      canonicalDuration(10),
    );
    expect(legPaceCellsPerS(ok, MS_PER_MILLIMINUTE) / cfg.walkCellsPerS).toBeCloseTo(1, 1);
    expect(paceWithinBand(ok, MS_PER_MILLIMINUTE, cfg)).toBe(true);
    const fast = { ...ok, arriveAt: Math.floor(ok.arriveAt / 2) };
    const slow = { ...ok, arriveAt: ok.arriveAt * 2 };
    expect(paceWithinBand(fast, MS_PER_MILLIMINUTE, cfg)).toBe(false);
    expect(paceWithinBand(slow, MS_PER_MILLIMINUTE, cfg)).toBe(false);
  });
});

const cell = fc.tuple(fc.integer({ min: 0, max: 14 }), fc.integer({ min: 0, max: 14 }));
const routeArb = fc.array(cell, { minLength: 2, maxLength: 4 });

function dedupe(route: readonly [number, number][]): [number, number][] {
  return route.filter(
    (c, i) => i === 0 || c[0] !== route[i - 1]?.[0] || c[1] !== route[i - 1]?.[1],
  );
}

function manhattan(route: readonly [number, number][]): number {
  let n = 0;
  for (let i = 1; i < route.length; i++) {
    n += Math.abs((route[i]?.[0] ?? 0) - (route[i - 1]?.[0] ?? 0));
    n += Math.abs((route[i]?.[1] ?? 0) - (route[i - 1]?.[1] ?? 0));
  }
  return n;
}

describe("properties", () => {
  it("inv_npc_arrives_exactly_on_time", () => {
    fc.assert(
      fc.property(
        routeArb,
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 5, max: 20_000 }),
        fc.array(fc.constantFrom(16, 100, 5 * 60 * 1000), { minLength: 1, maxLength: 30 }),
        (raw, depart, duration, deltas) => {
          const route = dedupe(raw);
          fc.pre(route.length >= 2);
          const l = leg(route, depart, depart + duration);
          const body = new Body(l, new TestGrid(), CFG);
          let t = depart - 200;
          const pose = createBodyPose();
          for (const d of deltas) {
            t += d / 16;
            const now = Math.floor(t);
            body.poseAt(now, pose);
            if (now < depart) expect(pose.distance).toBe(0);
            if (now >= depart + duration) expect(pose.distance).toBe(body.totalLength);
            if (now < depart + duration - cfg.earlyArrivalBoundMilliminutes) {
              expect(pose.distance).toBeLessThan(body.totalLength);
            }
          }
          body.poseAt(depart + duration, pose);
          const last = route[route.length - 1] ?? [0, 0];
          expect([pose.x, pose.y]).toEqual([last[0] + 0.5, last[1] + 0.5]);
        },
      ),
    );
  });

  it("inv_npc_pose_is_frame_rate_independent", () => {
    fc.assert(
      fc.property(
        routeArb,
        fc.array(fc.integer({ min: 1, max: 400 }), { minLength: 1, maxLength: 40 }),
        fc.array(fc.integer({ min: 1, max: 400 }), { minLength: 1, maxLength: 40 }),
        (raw, a, b) => {
          const route = dedupe(raw);
          fc.pre(route.length >= 2);
          const l = leg(route, 0, 3000);
          const span = Math.min(
            a.reduce((s, x) => s + x, 0),
            b.reduce((s, x) => s + x, 0),
          );
          const run = (deltas: number[]) => {
            const body = new Body(l, new TestGrid(), CFG);
            const out = createBodyPose();
            let t = 0;
            for (const d of deltas) {
              if (t + d > span) break;
              t += d;
              body.poseAt(t, out);
            }
            body.poseAt(span, out);
            return { ...out };
          };
          expect(run(a)).toEqual(run(b));
        },
      ),
    );
  });

  it("inv_npc_never_enters_a_blocked_tile", () => {
    type Cmd =
      | { k: "advance"; dt: number }
      | { k: "insert"; x: number; y: number }
      | { k: "delete"; x: number; y: number }
      | { k: "despawn" }
      | { k: "respawn" };
    const cmd: fc.Arbitrary<Cmd> = fc.oneof(
      fc.integer({ min: 1, max: 300 }).map((dt): Cmd => ({ k: "advance", dt })),
      cell.map(([x, y]): Cmd => ({ k: "insert", x, y })),
      cell.map(([x, y]): Cmd => ({ k: "delete", x, y })),
      fc.constant<Cmd>({ k: "despawn" }),
      fc.constant<Cmd>({ k: "respawn" }),
    );
    const ends = new Set(["0,0", "14,0", "14,14"]);
    fc.assert(
      fc.property(
        fc.array(cmd, { minLength: 1, maxLength: 60 }),
        fc.array(cell, { maxLength: 20 }),
        (cmds, initial) => {
          const grid = new TestGrid();
          for (const [x, y] of initial) if (!ends.has(`${x},${y}`)) grid.block(x, y);
          const l = leg(
            [
              [0, 0],
              [14, 0],
              [14, 14],
            ],
            0,
            4000,
          );
          let body: Body | undefined = new Body(l, grid, CFG);
          let t = 0;
          const out = createBodyPose();
          for (const c of cmds) {
            if (c.k === "insert" && !ends.has(`${c.x},${c.y}`)) grid.block(c.x, c.y);
            if (c.k === "delete") grid.unblock(c.x, c.y);
            if (c.k === "despawn") body = undefined;
            if (c.k === "respawn" && !body) body = new Body(l, grid, CFG);
            if (c.k === "advance") t += c.dt;
            if (!body) continue;
            body.poseAt(t, out);
            // A leg with no path is walked straight (counted); the property is
            // about legs that have one.
            if (body.fallbackCount > 0) continue;
            expect(grid.walkable(0, Math.floor(out.x), Math.floor(out.y))).toBe(true);
          }
        },
      ),
    );
  });

  it("inv_npc_motion_is_continuous", () => {
    fc.assert(
      fc.property(
        routeArb,
        fc.array(fc.integer({ min: 8, max: 60 }), { minLength: 1, maxLength: 80 }),
        (raw, frameMs) => {
          const route = dedupe(raw);
          fc.pre(route.length >= 2);
          const cells = manhattan(route);
          const duration = canonicalDuration(cells);
          const l = leg(route, 0, duration);
          const body = new Body(l, new TestGrid(), CFG);
          expect(paceWithinBand(l, MS_PER_MILLIMINUTE, cfg)).toBe(true);
          const speedCellsPerMs = body.totalLength / (duration * MS_PER_MILLIMINUTE);
          const out = createBodyPose();
          const prev = createBodyPose();
          let realMs = 0;
          let stationaryMs = 0;
          // Worst values are tracked per frame and asserted once: a 60 s walk is
          // thousands of frames and `expect` per frame costs seconds.
          let worstOverSpeed = Number.NEGATIVE_INFINITY;
          let worstBackstep = 0;
          let worstStationaryMs = 0;
          body.poseAt(0, prev);
          let i = 0;
          while (realMs < 60_000) {
            const dt = frameMs[i++ % frameMs.length] ?? 16;
            realMs += dt;
            body.poseAt(realMs / MS_PER_MILLIMINUTE, out);
            const moved = Math.hypot(out.x - prev.x, out.y - prev.y);
            worstOverSpeed = Math.max(worstOverSpeed, moved - (speedCellsPerMs * dt * 1.05 + 1e-9));
            worstBackstep = Math.max(worstBackstep, prev.distance - out.distance);
            const walking = realMs < duration * MS_PER_MILLIMINUTE;
            stationaryMs = walking && moved === 0 ? stationaryMs + dt : 0;
            worstStationaryMs = Math.max(worstStationaryMs, stationaryMs);
            prev.x = out.x;
            prev.y = out.y;
            prev.distance = out.distance;
          }
          expect(worstOverSpeed).toBeLessThanOrEqual(0);
          expect(worstBackstep).toBe(0);
          expect(worstStationaryMs).toBeLessThanOrEqual(cfg.stallBoundMs);
        },
      ),
    );
  });

  it("inv_l3_despawn_snaps_to_ledger", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 5000 }), { minLength: 1, maxLength: 40 }),
        fc.integer({ min: 0, max: 5000 }),
        fc.array(cell, { maxLength: 12 }),
        (times, respawnAt, blocked) => {
          const grid = new TestGrid();
          for (const [x, y] of blocked) {
            if ((x === 0 && y === 0) || (x === 12 && y === 9)) continue;
            grid.block(x, y);
          }
          const l = leg(
            [
              [0, 0],
              [12, 0],
              [12, 9],
            ],
            100,
            4000,
          );
          const used = new Body(l, grid, CFG);
          for (const t of times) used.poseAt(t, createBodyPose());
          // Despawn drops `used`; the respawned body is built from the ledger
          // record alone and must agree with a fresh one, and with `used`.
          const respawned = new Body(l, grid, CFG);
          const fresh = new Body(l, grid, CFG);
          expect(poseOf(respawned, respawnAt)).toEqual(poseOf(fresh, respawnAt));
          expect(poseOf(respawned, respawnAt)).toEqual(poseOf(used, respawnAt));
        },
      ),
    );
  });
});
