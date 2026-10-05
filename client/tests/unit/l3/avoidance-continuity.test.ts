import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AvoidanceField, type AvoidDials } from "../../../src/l3/avoidance";
import { CitizenBody, type CitizenFrame, createCitizenFrame } from "../../../src/l3/citizen";
import { l3Config, lifeDials } from "./defs-config";
import { CFG, TestGrid } from "./support";

const cfg = l3Config();
const dials: AvoidDials = {
  radiusCells: cfg.avoidRadiusCells,
  clearanceCells: cfg.avoidClearanceCells,
  tieBandCells: cfg.avoidTieBandCells,
  maxNeighbours: cfg.avoidMaxNeighbours,
  halfWidthCells: cfg.bodyHalfWidthCells,
  chunkSize: 16,
};
const gait = { strideCells: cfg.strideCells, framesPerCycle: 6 };
const all = () => true;

/** The most a sidestep may move per cell of ground the bodies cover between
 * two frames, from the dials alone. Each of these moves it by its steepest
 * slope: the distance weight and the corner ramp (a smoothstep, 3/2 at its
 * steepest, times the clearance), the wall slope, and a crossing pair's fade
 * through "which side" (a half clearance wide, two bodies moving, shared
 * clearance). Five times: both bodies move, the slopes add up, and the steepest cases (a crossing pair near its fade) sit above the typical ones. */
const CROSSING_FADE = 0.5;
const LIPSCHITZ =
  5 *
  ((1.5 * dials.clearanceCells) / dials.radiusCells +
    (1.5 * dials.clearanceCells) / cfg.avoidRampCells +
    1 / 3 +
    2 / CROSSING_FADE);
const STEP = 6;
const RUNS = 25;
const HORIZON = 4500;

const cell = fc.tuple(fc.nat(11), fc.nat(11));
const leg = fc.record({
  route: fc.array(cell, { minLength: 2, maxLength: 3 }),
  start: fc.nat(1500),
  length: fc.integer({ min: 700, max: 2600 }),
});

describe("avoidance is continuous in time (FR64)", () => {
  it("inv_l3_avoidance_is_continuous", () => {
    let sidesteps = 0;
    let biggest = 0;
    fc.assert(
      fc.property(
        fc.array(cell, { maxLength: 25 }),
        fc.array(leg, { minLength: 1, maxLength: 3 }),
        fc.array(cell, { maxLength: 3 }),
        (walls, legs, standingRaw) => {
          // Two citizens on one cell is an L2 defect, not a case to draw.
          const onRoutes = new Set(legs.flatMap((l) => l.route.map(([x, y]) => `${x},${y}`)));
          const standing = standingRaw.filter(([x, y]) => !onRoutes.has(`${x},${y}`));
          const grid = new TestGrid();
          for (const [x, y] of walls) grid.block(x, y);
          for (const l of legs) for (const [x, y] of l.route) grid.unblock(x, y);
          for (const [x, y] of standing) grid.unblock(x, y);
          const bodies = legs.map((l, i) => ({
            id: `walker-${i}`,
            body: new CitizenBody(grid, CFG, gait, `walker-${i}`, lifeDials()),
            state: {
              kind: "transit" as const,
              key: 1,
              leg: {
                waypoints: l.route.map(([x, y]) => ({ x, y, floor: 0 })),
                departAt: l.start,
                arriveAt: l.start + l.length,
              },
              startFacing: "down" as const,
              endFacing: "down" as const,
            },
            frame: createCitizenFrame(),
          }));
          const stands = standing.map(([x, y], i) => ({
            id: `stander-${i}`,
            body: new CitizenBody(grid, CFG, gait, `stander-${i}`, lifeDials()),
            state: { kind: "at" as const, node: { x, y, floor: 0 }, facing: "down" as const },
            frame: createCitizenFrame(),
          }));
          const members = [...bodies, ...stands];
          const field = new AvoidanceField();
          let before: { ox: number[]; oy: number[]; px: number[]; py: number[] } | undefined;
          for (let t = 0; t <= HORIZON; t += STEP) {
            field.reset();
            for (const m of members) {
              m.body.frameAt(m.state, t, m.frame);
              const f: CitizenFrame = m.frame;
              field.add(m.id, f.x, f.y, f.floor, f.headingX, f.headingY, f.moving, f.ramp);
            }
            field.resolve(dials, grid, all);
            const now = {
              ox: members.map((_, i) => field.offsetX(i)),
              oy: members.map((_, i) => field.offsetY(i)),
              px: members.map((m) => m.frame.x),
              py: members.map((m) => m.frame.y),
            };
            if (before) {
              let moved = 0;
              for (let i = 0; i < members.length; i++) {
                moved += Math.hypot(
                  (now.px[i] as number) - (before.px[i] as number),
                  (now.py[i] as number) - (before.py[i] as number),
                );
              }
              for (let i = 0; i < members.length; i++) {
                const jump = Math.hypot(
                  (now.ox[i] as number) - (before.ox[i] as number),
                  (now.oy[i] as number) - (before.oy[i] as number),
                );
                expect(jump).toBeLessThanOrEqual(LIPSCHITZ * moved + 1e-9);
                if (moved > 0) biggest = Math.max(biggest, jump / moved);
                if (jump > 0 || now.ox[i] !== 0 || now.oy[i] !== 0) sidesteps++;
              }
            }
            before = now;
          }
        },
      ),
      { numRuns: RUNS },
    );
    // Not vacuous: sidesteps happened, and steeply enough to matter.
    expect(sidesteps).toBeGreaterThan(200);
  });

  it("a waypoint the path runs straight through is not a corner: the same sidestep with or without it", () => {
    const run = (waypoints: number[]) => {
      const grid = new TestGrid();
      const east = new CitizenBody(grid, CFG, gait, "east", lifeDials());
      const west = new CitizenBody(grid, CFG, gait, "west", lifeDials());
      const legE = {
        kind: "transit" as const,
        key: 1,
        leg: {
          waypoints: waypoints.map((x) => ({ x, y: 6, floor: 0 })),
          departAt: 0,
          arriveAt: 2000,
        },
        startFacing: "right" as const,
        endFacing: "right" as const,
      };
      const legW = {
        ...legE,
        leg: {
          waypoints: [...waypoints].reverse().map((x) => ({ x, y: 6, floor: 0 })),
          departAt: 0,
          arriveAt: 2000,
        },
      };
      const fe = createCitizenFrame();
      const fw = createCitizenFrame();
      const field = new AvoidanceField();
      const offsets: number[] = [];
      for (let t = 0; t <= 2000; t += 20) {
        field.reset();
        east.frameAt(legE, t, fe);
        west.frameAt(legW, t, fw);
        field.add("east", fe.x, fe.y, 0, fe.headingX, fe.headingY, fe.moving, fe.ramp, fe.speed);
        field.add("west", fw.x, fw.y, 0, fw.headingX, fw.headingY, fw.moving, fw.ramp, fw.speed);
        field.resolve(dials, grid, all);
        offsets.push(field.offsetY(0));
      }
      return offsets;
    };
    const plain = run([0, 12]);
    // Straight-through waypoints, every few cells and every cell.
    for (const through of [
      [0, 4, 8, 12],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    ]) {
      const inserted = run(through);
      expect(Math.max(...plain.map((o, i) => Math.abs(o - (inserted[i] as number))))).toBeLessThan(
        0.05,
      );
    }
    expect(Math.max(...plain.map(Math.abs))).toBeGreaterThan(0.4);
  });
});
