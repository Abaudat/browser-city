import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Body, createBodyPose, type Leg, legInstants } from "../../../src/l3/body";
import { sizeProbe } from "../setup/size-probe";
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

/** Milliminutes that walk `cells` at the canonical pace. */
function canonicalDuration(cells: number): number {
  return Math.max(1, Math.round(((cells / cfg.walkCellsPerS) * 1000) / MS_PER_MILLIMINUTE));
}

/** A leg over `route` sized for the path actually walked on `grid`. */
function pacedLeg(route: readonly [number, number][], grid: TestGrid, departAt = 0): Leg {
  const probe = new Body(leg(route, 0, 1), grid, CFG);
  return leg(route, departAt, departAt + canonicalDuration(probe.totalLength));
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

describe("legInstants on diagonals", () => {
  it("shares the duration by straight-line distance, not Manhattan", () => {
    const l = leg(
      [
        [0, 0],
        [10, 0],
        [20, 10],
      ],
      0,
      1000,
    );
    const [, mid] = legInstants(l);
    // 10 and sqrt(200): 10 / (10 + 14.142...) of the duration.
    expect(mid).toBe(Math.floor((1000 * 10) / (10 + Math.sqrt(200))));
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

  it("walks at constant speed, spread over the whole segment", () => {
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

  it("a time that is not a number is the origin, standing", () => {
    const body = new Body(straight, new TestGrid(), CFG);
    for (const t of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(poseOf(body, t)).toMatchObject({ x: 0.5, y: 0.5, moving: false, distance: 0 });
    }
  });

  it("carries speed through a corner and turns the heading once", () => {
    const l = leg(
      [
        [0, 0],
        [4, 0],
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

  it("sidesteps without turning its back: the heading stays along the route", () => {
    const grid = new TestGrid();
    grid.block(5, 0);
    const body = new Body(straight, grid, CFG);
    for (let t = 1001; t < straight.arriveAt; t += 3) {
      expect(poseOf(body, t).headingX).toBeGreaterThan(0.9);
    }
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

  it("refuses a leg with no waypoint", () => {
    expect(
      () => new Body({ waypoints: [], departAt: 0, arriveAt: 1 }, new TestGrid(), CFG),
    ).toThrow(/waypoint/);
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

  it("a far-apart pair of waypoints is walked straight, never thrown on", () => {
    const body = new Body(
      leg(
        [
          [0, 0],
          [2_000_000, 0],
        ],
        0,
        100,
      ),
      new TestGrid(),
      CFG,
    );
    expect(poseOf(body, 50)).toMatchObject({ moving: true });
    expect(body.fallbackCount).toBe(1);
  });
});

describe("walked pace", () => {
  it("a leg at canonical pace is in band; a hurried or crawling one is not", () => {
    const grid = new TestGrid();
    const ok = pacedLeg(
      [
        [0, 0],
        [10, 0],
      ],
      grid,
    );
    expect(new Body(ok, grid, CFG).paceWithinBand(MS_PER_MILLIMINUTE, cfg)).toBe(true);
    const fast = { ...ok, arriveAt: Math.floor(ok.arriveAt / 2) };
    const slow = { ...ok, arriveAt: ok.arriveAt * 2 };
    expect(new Body(fast, grid, CFG).paceWithinBand(MS_PER_MILLIMINUTE, cfg)).toBe(false);
    expect(new Body(slow, grid, CFG).paceWithinBand(MS_PER_MILLIMINUTE, cfg)).toBe(false);
  });

  it("is judged on the path walked, not the Manhattan length: a detour that sprints fails", () => {
    const grid = new TestGrid();
    for (let y = -3; y <= 3; y++) grid.block(5, y);
    // Long way round, but the leg is timed for a straight ten cells.
    const l = leg(
      [
        [0, 0],
        [10, 0],
      ],
      0,
      canonicalDuration(10),
    );
    const body = new Body(l, grid, CFG);
    expect(body.walkedPaces(MS_PER_MILLIMINUTE)[0]).toBeGreaterThan(cfg.walkCellsPerS * 1.15);
    expect(body.paceWithinBand(MS_PER_MILLIMINUTE, cfg)).toBe(false);
  });

  it("an instantaneous leg is infinitely fast and a standing one has no pace", () => {
    const grid = new TestGrid();
    const instant = new Body(
      leg(
        [
          [0, 0],
          [3, 0],
        ],
        5,
        5,
      ),
      grid,
      CFG,
    );
    expect(instant.walkedPaces(MS_PER_MILLIMINUTE)).toEqual([Number.POSITIVE_INFINITY]);
    expect(instant.paceWithinBand(MS_PER_MILLIMINUTE, cfg)).toBe(false);
    const still = new Body(leg([[1, 1]], 0, 5), grid, CFG);
    expect(still.walkedPaces(MS_PER_MILLIMINUTE)).toEqual([0]);
    expect(still.paceWithinBand(MS_PER_MILLIMINUTE, cfg)).toBe(true);
  });
});

const cell = fc.tuple(fc.integer({ min: 0, max: 14 }), fc.integer({ min: 0, max: 14 }));
const routeArb = fc.array(cell, { minLength: 2, maxLength: 6 });

function dedupe(route: readonly [number, number][]): [number, number][] {
  return route.filter(
    (c, i) => i === 0 || c[0] !== route[i - 1]?.[0] || c[1] !== route[i - 1]?.[1],
  );
}

describe("properties", () => {
  it("inv_npc_arrives_exactly_on_time", () => {
    const routes = sizeProbe({ min: 2, max: 6, ceiling: 4 });
    const midLeg = sizeProbe({ min: 0, max: 120 });
    const frames = sizeProbe({ min: 1, max: 120 });
    fc.assert(
      fc.property(
        routes.over(routeArb, (r) => dedupe(r).length),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 200, max: 3000 }),
        frames.over(
          fc.array(fc.constantFrom(16, 100, 400), { minLength: 1, maxLength: 120 }),
          (d) => d.length,
        ),
        (raw, depart, duration, deltas) => {
          const route = dedupe(raw);
          fc.pre(route.length >= 2);
          const arrive = depart + duration;
          const body = new Body(leg(route, depart, arrive), new TestGrid(), CFG);
          const pose = createBodyPose();
          let t = depart - 100;
          let mid = 0;
          const check = (now: number): void => {
            body.poseAt(now, pose);
            if (now < depart) expect(pose.distance).toBe(0);
            if (now >= arrive) expect(pose.distance).toBe(body.totalLength);
            if (now < arrive - cfg.earlyArrivalBoundMilliminutes) {
              expect(pose.distance).toBeLessThan(body.totalLength);
            }
            if (now >= depart && now < arrive) mid++;
          };
          for (const d of deltas) {
            t += d / MS_PER_MILLIMINUTE;
            check(Math.floor(t));
          }
          for (const edge of [depart - 1, depart, arrive - 1, arrive, arrive + 1]) check(edge);
          midLeg.record(mid);
          const last = route[route.length - 1] ?? [0, 0];
          expect([pose.x, pose.y]).toEqual([last[0] + 0.5, last[1] + 0.5]);
        },
      ),
    );
    routes.expectReached(5);
    frames.expectReached(100);
    midLeg.expectReached(20);
  });

  it("inv_l3_pace_is_even_on_open_ground", () => {
    const routes = sizeProbe({ min: 2, max: 6, ceiling: 4 });
    fc.assert(
      fc.property(
        routes.over(routeArb, (r) => dedupe(r).length),
        (raw) => {
          const route = dedupe(raw);
          fc.pre(route.length >= 2);
          const grid = new TestGrid();
          const l = pacedLeg(route, grid);
          const paces = new Body(l, grid, CFG).walkedPaces(MS_PER_MILLIMINUTE);
          // Whole milliminutes are the only slack: a segment's interval is rounded.
          const mean = paces.reduce((s, x) => s + x, 0) / paces.length;
          for (const pace of paces) expect(Math.abs(pace - mean) / mean).toBeLessThan(0.01);
          expect(new Body(l, grid, CFG).paceWithinBand(MS_PER_MILLIMINUTE, cfg)).toBe(true);
        },
      ),
    );
    routes.expectReached(5);
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
      | { k: "despawn" };
    const cmd: fc.Arbitrary<Cmd> = fc.oneof(
      {
        weight: 4,
        arbitrary: fc.integer({ min: 1, max: 300 }).map((dt): Cmd => ({ k: "advance", dt })),
      },
      { weight: 3, arbitrary: cell.map(([x, y]): Cmd => ({ k: "insert", x, y })) },
      { weight: 2, arbitrary: cell.map(([x, y]): Cmd => ({ k: "delete", x, y })) },
      { weight: 1, arbitrary: fc.constant<Cmd>({ k: "despawn" }) },
    );
    const commands = sizeProbe({ min: 1, max: 60 });
    const asserted = sizeProbe({ min: 0, max: 60 });
    const ends = new Set(["0,0", "14,0", "14,14"]);
    fc.assert(
      fc.property(
        commands.over(fc.array(cmd, { minLength: 1, maxLength: 60 }), (c) => c.length),
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
          let checks = 0;
          const out = createBodyPose();
          for (const c of cmds) {
            if (c.k === "insert" && !ends.has(`${c.x},${c.y}`)) grid.block(c.x, c.y);
            if (c.k === "delete") grid.unblock(c.x, c.y);
            if (c.k === "despawn") body = undefined;
            if (c.k === "advance") {
              t += c.dt;
              // A viewer arrives: whatever was despawned is built afresh.
              body ??= new Body(l, grid, CFG);
            }
            if (!body) continue;
            body.poseAt(t, out);
            // A leg with no path is walked straight (counted); the property is
            // about legs that have one.
            if (body.fallbackCount > 0) continue;
            checks++;
            expect(grid.walkable(0, Math.floor(out.x), Math.floor(out.y))).toBe(true);
          }
          asserted.record(checks);
        },
      ),
    );
    commands.expectReached(50);
    asserted.expectReached(30);
  });

  it("inv_npc_motion_is_continuous", () => {
    const obstacles = sizeProbe({ min: 0, max: 20 });
    const frames = sizeProbe({ min: 1, max: 80 });
    const lowPace = cfg.walkCellsPerS * (1 - cfg.paceBandPercent / 100);
    const highPace = cfg.walkCellsPerS * (1 + cfg.paceBandPercent / 100);
    fc.assert(
      fc.property(
        cell,
        cell,
        obstacles.over(fc.array(cell, { maxLength: 20 }), (o) => o.length),
        frames.over(
          fc.array(fc.integer({ min: 4, max: 60 }), { minLength: 1, maxLength: 80 }),
          (f) => f.length,
        ),
        (from, to, blocked, frameMs) => {
          fc.pre(from[0] !== to[0] || from[1] !== to[1]);
          const grid = new TestGrid();
          for (const [x, y] of blocked) {
            if ((x === from[0] && y === from[1]) || (x === to[0] && y === to[1])) continue;
            grid.block(x, y);
          }
          const l = pacedLeg([from, to], grid);
          const body = new Body(l, grid, CFG);
          const out = createBodyPose();
          body.poseAt(0, out);
          // A leg with no path is walked straight, through whatever is there.
          fc.pre(body.fallbackCount === 0);
          expect(body.paceWithinBand(MS_PER_MILLIMINUTE, cfg)).toBe(true);
          const durationMs = (l.arriveAt - l.departAt) * MS_PER_MILLIMINUTE;
          const speedCellsPerMs = body.totalLength / durationMs;
          const prev = createBodyPose();
          let realMs = 0;
          let stationaryMs = 0;
          let worstOverSpeed = Number.NEGATIVE_INFINITY;
          let worstBackstep = 0;
          let worstStationaryMs = 0;
          let slowest = Number.POSITIVE_INFINITY;
          let fastest = 0;
          body.poseAt(0, prev);
          let i = 0;
          while (realMs < 60_000) {
            const dt = frameMs[i++ % frameMs.length] ?? 16;
            realMs += dt;
            body.poseAt(realMs / MS_PER_MILLIMINUTE, out);
            const moved = Math.hypot(out.x - prev.x, out.y - prev.y);
            worstOverSpeed = Math.max(worstOverSpeed, moved - (speedCellsPerMs * dt * 1.05 + 1e-9));
            worstBackstep = Math.max(worstBackstep, prev.distance - out.distance);
            const walking = realMs < durationMs;
            stationaryMs = walking && moved === 0 ? stationaryMs + dt : 0;
            worstStationaryMs = Math.max(worstStationaryMs, stationaryMs);
            if (walking) {
              // Observed pace, from the distance walked: inside the band both ways.
              const pace = ((out.distance - prev.distance) / dt) * 1000;
              slowest = Math.min(slowest, pace);
              fastest = Math.max(fastest, pace);
            }
            prev.x = out.x;
            prev.y = out.y;
            prev.distance = out.distance;
          }
          expect(worstOverSpeed).toBeLessThanOrEqual(0);
          expect(worstBackstep).toBe(0);
          expect(worstStationaryMs).toBeLessThanOrEqual(cfg.stallBoundMs);
          if (fastest > 0) {
            expect(slowest).toBeGreaterThanOrEqual(lowPace * 0.99);
            expect(fastest).toBeLessThanOrEqual(highPace * 1.01);
          }
        },
      ),
    );
    obstacles.expectReached(15);
    frames.expectReached(60);
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
