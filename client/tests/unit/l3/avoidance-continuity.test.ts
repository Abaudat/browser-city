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
 * two frames. Passing on one line or to one side changes it by about a third
 * per cell. The steepest part is the blend between "on one line" (the right
 * hand rule) and "to one side" (step away), where two paths that cross change
 * sides: the clearance over the tie band, twice (both bodies move). */
const LIPSCHITZ = (2 * dials.clearanceCells) / dials.tieBandCells + 4;
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
        (walls, legs, standing) => {
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
});
