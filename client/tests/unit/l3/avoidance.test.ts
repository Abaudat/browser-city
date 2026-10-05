import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AvoidanceField,
  type AvoidDials,
  type HeldPredicate,
  rampOf,
  scanSpan,
} from "../../../src/l3/avoidance";
import { l3Config } from "./defs-config";
import { TestGrid } from "./support";

const cfg = l3Config();
const CHUNK = 8;
const dials: AvoidDials = {
  radiusCells: cfg.avoidRadiusCells,
  clearanceCells: cfg.avoidClearanceCells,
  tieBandCells: cfg.avoidTieBandCells,
  maxNeighbours: cfg.avoidMaxNeighbours,
  halfWidthCells: cfg.bodyHalfWidthCells,
  chunkSize: CHUNK,
};
const open = new TestGrid();
const ALL_HELD: HeldPredicate = () => true;

interface B {
  id: string;
  x: number;
  y: number;
  hx: number;
  hy: number;
  moving: boolean;
  ramp: number;
  speed: number;
}

/** Cells per milliminute at walking pace. */
const WALK = 0.0055;

const HEADINGS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const body = (world: number): fc.Arbitrary<Omit<B, "id">> =>
  fc
    .record({
      x: fc.double({ min: 0, max: world, noNaN: true }),
      y: fc.double({ min: 0, max: world, noNaN: true }),
      h: fc.constantFrom(...HEADINGS),
      moving: fc.boolean(),
      ramp: fc.constantFrom(1, 1, 0.5, 0),
      speed: fc.constantFrom(WALK, WALK, 0.5 * WALK, 0),
    })
    .map(({ h, ...rest }) => ({ ...rest, hx: h[0], hy: h[1] }));

function withIds(raw: Omit<B, "id">[]): B[] {
  return raw.map((b, i) => ({ ...b, id: `citizen-${i}` }));
}

function run(
  bodies: readonly B[],
  isHeld: HeldPredicate = ALL_HELD,
  grid = open,
  field = new AvoidanceField(),
  d: AvoidDials = dials,
) {
  field.reset();
  const index = new Map<string, number>();
  for (const b of bodies) {
    index.set(b.id, field.add(b.id, b.x, b.y, 0, b.hx, b.hy, b.moving, b.ramp, b.speed, b.x, b.y));
  }
  field.resolve(d, grid, isHeld);
  const out = new Map<string, [number, number]>();
  for (const [id, i] of index) out.set(id, [field.offsetX(i), field.offsetY(i)]);
  return { field, out };
}

const chunkOf = (v: number) => Math.floor(v / CHUNK);
const walker = (id: string, x: number, y: number, hx: number, hy: number, ramp = 1): B => ({
  id,
  x,
  y,
  hx,
  hy,
  moving: true,
  ramp,
  speed: WALK,
});
const stander = (id: string, x: number, y: number): B => ({
  id,
  x,
  y,
  hx: 0,
  hy: 0,
  moving: false,
  ramp: 0,
  speed: 0,
});

const C = dials.clearanceCells;

describe("local avoidance (FR64)", () => {
  it("inv_l3_avoidance_is_bubble_independent", () => {
    fc.assert(
      fc.property(
        fc.array(body(40), { minLength: 1, maxLength: 40 }),
        fc.array(fc.nat(3), { minLength: 4, maxLength: 4 }),
        fc.array(fc.nat(3), { minLength: 4, maxLength: 4 }),
        fc.array(fc.nat(1000), { minLength: 40, maxLength: 40 }),
        (raw, ea, eb, keys) => {
          const bodies = withIds(raw);
          // Region: chunk (2, 2). Each client's bubble is that chunk plus its
          // one-chunk halo, grown by its own arbitrary extra.
          const bubble =
            (e: number[]): HeldPredicate =>
            (_f, cx, cy) =>
              cx >= 1 - (e[0] as number) &&
              cx <= 3 + (e[1] as number) &&
              cy >= 1 - (e[2] as number) &&
              cy <= 3 + (e[3] as number);
          const view = (e: number[], order: number[]) => {
            const held = bubble(e);
            const known = bodies
              .map((b, i) => ({ b, k: order[i] as number }))
              .filter(({ b }) => held(0, chunkOf(b.x), chunkOf(b.y)))
              .sort((p, q) => p.k - q.k)
              .map(({ b }) => b);
            return run(known, held).out;
          };
          const a = view(ea, keys);
          const b = view(eb, [...keys].reverse());
          for (const body of bodies) {
            if (chunkOf(body.x) !== 2 || chunkOf(body.y) !== 2) continue;
            const [ax, ay] = a.get(body.id) as [number, number];
            const [bx, by] = b.get(body.id) as [number, number];
            expect(Object.is(ax, bx)).toBe(true);
            expect(Object.is(ay, by)).toBe(true);
          }
        },
      ),
    );
  });

  it("a body whose chunk is not held whole is drawn at its ledger pose", () => {
    const pair = [walker("a", 4.5, 4.5, 1, 0), walker("b", 5.5, 4.5, -1, 0)];
    expect(run(pair).out.get("a")).not.toEqual([0, 0]);
    const partial = run(pair, (_f, cx, cy) => !(cx === 1 && cy === 0)).out;
    expect(partial.get("a")).toEqual([0, 0]);
    expect(partial.get("b")).toEqual([0, 0]);
  });

  it("a radius over a chunk is refused, since the halo would not hold every neighbour", () => {
    const field = new AvoidanceField();
    field.add("a", 1, 1, 0, 1, 0, true, 1, WALK, 1, 1);
    expect(() => field.resolve({ ...dials, radiusCells: CHUNK + 1 }, open, ALL_HELD)).toThrow(
      /chunk/,
    );
  });

  it("inv_l3_avoidance_is_history_free", () => {
    // A dense frame: bodies within a cell of each other, enough to cut the cap.
    const dense = fc.array(body(1.5), { minLength: dials.maxNeighbours + 4, maxLength: 40 });
    fc.assert(
      fc.property(
        fc.array(body(24), { minLength: 1, maxLength: 20 }),
        fc.array(fc.array(body(24), { minLength: 1, maxLength: 40 }), {
          minLength: 1,
          maxLength: 6,
        }),
        dense,
        (raw, others, crowd) => {
          const bodies = withIds(raw);
          const cold = run(bodies).out;
          // Every earlier frame at least as large as this one, a dense one last
          // before it: whatever the buffers hold from them must not show.
          const warm = new AvoidanceField();
          for (const world of others) run(withIds(world), ALL_HELD, open, warm);
          run(withIds(crowd), ALL_HELD, open, warm);
          const again = run(bodies, ALL_HELD, open, warm).out;
          for (const [id, off] of cold) {
            const w = again.get(id) as [number, number];
            expect(Object.is(w[0], off[0]) && Object.is(w[1], off[1])).toBe(true);
          }
        },
      ),
      // Sizes stay at the largest the property states; the runs are cut to fit
      // NFR49 (each run resolves up to 7 worlds of up to 40 bodies).
      { numRuns: 15 },
    );
  });

  it("is bounded by the clearance and never moves a standing body", () => {
    fc.assert(
      fc.property(fc.array(body(12), { minLength: 1, maxLength: 30 }), (raw) => {
        const bodies = withIds(raw);
        const { out } = run(bodies);
        for (const b of bodies) {
          const [ox, oy] = out.get(b.id) as [number, number];
          expect(Number.isFinite(ox) && Number.isFinite(oy)).toBe(true);
          expect(Math.sqrt(ox * ox + oy * oy)).toBeLessThanOrEqual(C + 1e-12);
          if (!b.moving || b.ramp === 0) expect([ox, oy]).toEqual([0, 0]);
        }
      }),
    );
  });

  it("the ramp is zero at a corner or an end and eases in over its distance", () => {
    expect(rampOf(0, 3)).toBe(0);
    expect(rampOf(3, 3)).toBe(1);
    expect(rampOf(30, 3)).toBe(1);
    let previous = 0;
    for (let d = 0; d <= 3; d += 0.05) {
      const r = rampOf(d, 3);
      expect(r).toBeGreaterThanOrEqual(previous);
      previous = r;
    }
  });

  it("a head-on pair on any parallel lines never closes below the ledger gap and opens to the clearance", () => {
    const gaps = [
      0, 0.02, 0.04, 0.06, 0.08, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.2, 2, 3.5, -0.02, -0.04, -0.06,
      -0.08, -0.15, -0.3, -0.45, -0.6, -0.75, -0.9, -1.2, -3.5,
    ];
    for (const g of gaps) {
      let closestLedger = Number.POSITIVE_INFINITY;
      let closestDrawn = Number.POSITIVE_INFINITY;
      for (let step = 0; step <= 400; step++) {
        const a = walker("a", 2 + step * 0.04, 10.5, 1, 0);
        // `g` to the right of `a` is south of it.
        const b = walker("b", 18 - step * 0.04, 10.5 + g, -1, 0);
        const { out } = run([a, b]);
        const [ax, ay] = out.get("a") as [number, number];
        const [bx, by] = out.get("b") as [number, number];
        closestLedger = Math.min(closestLedger, Math.hypot(a.x - b.x, a.y - b.y));
        closestDrawn = Math.min(closestDrawn, Math.hypot(a.x + ax - b.x - bx, a.y + ay - b.y - by));
      }
      if (Math.abs(g) >= C) {
        // Already clear: nobody swerves.
        expect(closestDrawn).toBeCloseTo(closestLedger, 9);
      } else {
        expect(closestDrawn).toBeGreaterThanOrEqual(closestLedger - 1e-9);
        expect(closestDrawn).toBeGreaterThanOrEqual(0.8 * C);
      }
    }
  });

  it("a walker passes a standing citizen at any lateral gap without closing below the ledger gap", () => {
    const gaps = [
      0, 0.02, 0.06, 0.08, 0.2, 0.4, 0.6, 0.9, 1.0, 1.5, -0.02, -0.06, -0.08, -0.2, -0.4, -0.6,
      -0.9, -1.0,
    ];
    for (const g of gaps) {
      let closestLedger = Number.POSITIVE_INFINITY;
      let closestDrawn = Number.POSITIVE_INFINITY;
      for (let step = 0; step <= 250; step++) {
        const w = walker("w", 4 + step * 0.04, 10.5, 1, 0);
        const s = stander("s", 9, 10.5 + g);
        const { out } = run([w, s]);
        const [ox, oy] = out.get("w") as [number, number];
        expect(out.get("s")).toEqual([0, 0]);
        closestLedger = Math.min(closestLedger, Math.hypot(w.x - s.x, w.y - s.y));
        closestDrawn = Math.min(closestDrawn, Math.hypot(w.x + ox - s.x, w.y + oy - s.y));
      }
      if (Math.abs(g) >= C) expect(closestDrawn).toBeCloseTo(closestLedger, 9);
      else {
        expect(closestDrawn).toBeGreaterThanOrEqual(closestLedger - 1e-9);
        expect(closestDrawn).toBeGreaterThanOrEqual(0.9 * C);
      }
    }
  });

  it("the path bends no more than about one in three while passing", () => {
    let worst = 0;
    let previous = 0;
    for (let step = 0; step <= 1000; step++) {
      const w = walker("w", 4 + step * 0.01, 10.5, 1, 0);
      const { out } = run([w, stander("s", 9, 10.5)]);
      const oy = (out.get("w") as [number, number])[1];
      if (step > 0) worst = Math.max(worst, Math.abs(oy - previous) / 0.01);
      previous = oy;
    }
    expect(worst).toBeLessThanOrEqual(0.4);
  });

  it("two paths that cross keep their sides through the pass, whoever arrives first, and never jump", () => {
    for (const late of [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3]) {
      let previous: [number, number, number, number] | undefined;
      let worst = 0;
      let closest = Number.POSITIVE_INFINITY;
      let sign: number | undefined;
      for (let step = 0; step <= 450; step++) {
        // A walks east along y = 10.5 and reaches x = 10.5 at step 212; B walks
        // north along x = 10.5 and reaches y = 10.5 `late` cells after it.
        const a = walker("a", 2 + step * 0.04, 10.5, 1, 0);
        const b = walker("b", 10.5, 10.5 + (212 - step) * 0.04 + late, 0, -1);
        const { out } = run([a, b]);
        const [ax, ay] = out.get("a") as [number, number];
        const [bx, by] = out.get("b") as [number, number];
        if (previous) {
          const jump = Math.max(
            Math.hypot(ax - previous[0], ay - previous[1]),
            Math.hypot(bx - previous[2], by - previous[3]),
          );
          worst = Math.max(worst, jump / 0.08);
        }
        previous = [ax, ay, bx, by];
        closest = Math.min(closest, Math.hypot(a.x + ax - b.x - bx, a.y + ay - b.y - by));
        // A's side of the pass, while it is clear of the ends: one side only.
        if (Math.abs(ay) > 0.2) {
          const now = Math.sign(ay);
          if (sign !== undefined) expect(now).toBe(sign);
          sign = now;
        }
      }
      // No snap: a slope of the order of the one-in-three the rule claims.
      expect(worst).toBeLessThanOrEqual(2 / 0.5 + 2);
      // And they do not walk through each other.
      expect(closest).toBeGreaterThan(0.4);
    }
  });

  it("crossing paths at any angle and any lag never draw closer than the ledger, and keep their gaps", () => {
    let worstPerpendicular = Number.POSITIVE_INFINITY;
    let worstConverging = Number.POSITIVE_INFINITY;
    for (const degrees of [45, 90, 135]) {
      const turn = (degrees * Math.PI) / 180;
      // B's heading is A's (east) turned by `degrees`, clockwise on screen.
      const bx = Math.cos(turn);
      const by = Math.sin(turn);
      for (let lag = -1.5; lag <= 1.5001; lag += 0.25) {
        let closestLedger = Number.POSITIVE_INFINITY;
        let closestDrawn = Number.POSITIVE_INFINITY;
        for (let step = 0; step <= 400; step++) {
          // Both reach (10.5, 10.5) at step 200, B `lag` cells later along its way.
          const a = walker("a", 2.5 + step * 0.04, 10.5, 1, 0);
          const back = (200 - step) * 0.04 + lag;
          const b = walker("b", 10.5 - bx * -back, 10.5 - by * -back, bx, by);
          const { out } = run([a, b]);
          const [ax, ay] = out.get("a") as [number, number];
          const [qx, qy] = out.get("b") as [number, number];
          closestLedger = Math.min(closestLedger, Math.hypot(a.x - b.x, a.y - b.y));
          closestDrawn = Math.min(
            closestDrawn,
            Math.hypot(a.x + ax - b.x - qx, a.y + ay - b.y - qy),
          );
        }
        // The sweep samples the ledger gap every 0.04 cell.
        expect(closestDrawn).toBeGreaterThanOrEqual(closestLedger - 0.04);
        if (degrees === 90) worstPerpendicular = Math.min(worstPerpendicular, closestDrawn);
        if (degrees === 135 && Math.abs(lag) < 0.01) {
          worstConverging = Math.min(worstConverging, closestDrawn);
        }
      }
    }
    expect(worstPerpendicular).toBeGreaterThanOrEqual(0.4);
    expect(worstConverging).toBeGreaterThanOrEqual(0.3);
  });

  it("a walker passing a standing citizen goes to the side with room, and holds it", () => {
    const stand = stander("s", 9.5, 10.5);
    // Another standing citizen a cell to its right, level with the first.
    const beside = stander("t", 9.5, 11.5);
    const sides = new Set<number>();
    for (let step = 0; step <= 600; step++) {
      const w = walker("w", 5 + step * 0.01, 10.5, 1, 0);
      const { out } = run([w, stand, beside]);
      const oy = (out.get("w") as [number, number])[1];
      if (Math.abs(oy) > 0.1) sides.add(Math.sign(oy));
      // Never into the one it has to go round, nor the one beside it.
      expect(Math.hypot(w.x + 0 - beside.x, w.y + oy - beside.y)).toBeGreaterThan(0.45);
    }
    // North (negative y) is the open side; it never swapped to the south.
    expect([...sides]).toEqual([-1]);
    // With nobody beside, it keeps right, as the convention says.
    const only = new Set<number>();
    for (let step = 0; step <= 600; step++) {
      const { out } = run([walker("w", 5 + step * 0.01, 10.5, 1, 0), stand]);
      const oy = (out.get("w") as [number, number])[1];
      if (Math.abs(oy) > 0.1) only.add(Math.sign(oy));
    }
    expect([...only]).toEqual([1]);
  });

  it("a wide clearance still tapers continuously beside a wall (the window follows the dials)", () => {
    const wide = { ...dials, clearanceCells: 2 };
    const grid = new TestGrid();
    for (let x = 10; x < 40; x++) grid.block(x, 11);
    let previous = Number.NaN;
    let worst = 0;
    for (let step = 0; step <= 1600; step++) {
      const w = walker("w", 2 + step * 0.01, 10.5, 1, 0);
      const { out } = run(
        [w, stander("s", 22.5, 10.5)],
        ALL_HELD,
        grid,
        new AvoidanceField(),
        wide,
      );
      const oy = (out.get("w") as [number, number])[1];
      if (!Number.isNaN(previous)) worst = Math.max(worst, Math.abs(oy - previous) / 0.01);
      previous = oy;
    }
    expect(worst).toBeLessThanOrEqual(0.5);
  });

  it("two walkers on one heading and one line spread by id order", () => {
    const { out } = run([walker("b", 6.5, 6.5, 1, 0), walker("a", 6, 6.5, 1, 0)]);
    expect((out.get("a") as [number, number])[1]).toBeGreaterThan(0);
    expect((out.get("b") as [number, number])[1]).toBeLessThan(0);
  });

  it("inv_l3_avoidance_never_enters_a_blocked_tile", () => {
    fc.assert(
      fc.property(
        fc.array(body(10), { minLength: 2, maxLength: 20 }),
        fc.array(fc.tuple(fc.nat(9), fc.nat(9)), { maxLength: 30 }),
        (raw, walls) => {
          const grid = new TestGrid();
          for (const [x, y] of walls) grid.block(x, y);
          const bodies = withIds(raw).filter((b) =>
            grid.walkable(0, Math.floor(b.x), Math.floor(b.y)),
          );
          const { out } = run(bodies, ALL_HELD, grid);
          for (const b of bodies) {
            const [ox, oy] = out.get(b.id) as [number, number];
            expect(grid.walkable(0, Math.floor(b.x + ox), Math.floor(b.y + oy))).toBe(true);
            // Nor does its leading edge: the body is half a cell wide.
            // Touching a wall face is allowed; inside it is not.
            const edge = (v: number) =>
              (v === 0 ? 0 : v < 0 ? -1 : 1) * (dials.halfWidthCells - 1e-9);
            expect(
              grid.walkable(0, Math.floor(b.x + ox + edge(ox)), Math.floor(b.y + oy + edge(oy))),
            ).toBe(true);
          }
        },
      ),
    );
  });

  it("the room beside a wall tapers continuously along the walk", () => {
    const grid = new TestGrid();
    // A wall along the row south of the walker's, from x = 10 on.
    for (let x = 10; x < 30; x++) grid.block(x, 11);
    let previous = Number.NaN;
    let worstStep = 0;
    let beside = 0;
    for (let step = 0; step <= 1200; step++) {
      const w = walker("w", 4 + step * 0.01, 10.5, 1, 0);
      // A standing citizen on the line makes it step right, towards the wall.
      const { out } = run([w, stander("s", 14.5, 10.5)], ALL_HELD, grid);
      const oy = (out.get("w") as [number, number])[1];
      if (!Number.isNaN(previous)) worstStep = Math.max(worstStep, Math.abs(oy - previous) / 0.01);
      previous = oy;
      if (w.x > 11 && w.x < 13) beside = Math.max(beside, oy);
    }
    // At most one in three along the walk, so a pop of a third of the offset
    // in one frame cannot happen.
    expect(worstStep).toBeLessThanOrEqual(0.5);
    // Beside the wall the room is what its face leaves, never into it.
    expect(beside + dials.halfWidthCells).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it("a pair meeting in a one-wide corridor degrades gracefully", () => {
    const corridor = new TestGrid();
    for (let x = 0; x < 30; x++) {
      corridor.block(x, 9);
      corridor.block(x, 11);
    }
    for (let step = 0; step <= 100; step++) {
      const a = walker("a", 10 + step * 0.1, 10.5, 1, 0);
      const b = walker("b", 20 - step * 0.1, 10.5, -1, 0);
      const { out } = run([a, b], ALL_HELD, corridor);
      for (const id of ["a", "b"]) {
        const [ox, oy] = out.get(id) as [number, number];
        expect(Number.isFinite(ox) && Number.isFinite(oy)).toBe(true);
        expect(ox).toBeCloseTo(0, 12);
        expect(Math.abs(oy) + dials.halfWidthCells).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
  });

  it("keeps the nearest neighbours when more are in range, whatever the order", () => {
    const sub = { ...dials, maxNeighbours: 3 };
    const w = walker("w", 10, 10, 1, 0);
    const crowd = Array.from({ length: 12 }, (_, i) =>
      stander(`s${String(i).padStart(2, "0")}`, 10.3 + i * 0.25, 10.4 + (i % 3) * 0.1),
    );
    const all = run([w, ...crowd], ALL_HELD, open, new AvoidanceField(), sub);
    expect(all.field.capHits).toBe(1);
    const nearest = [...crowd]
      .sort((p, q) => Math.hypot(p.x - 10, p.y - 10) - Math.hypot(q.x - 10, q.y - 10))
      .slice(0, 3);
    const only = run([w, ...nearest], ALL_HELD, open, new AvoidanceField(), sub);
    expect(all.out.get("w")).toEqual(only.out.get("w"));
    const shuffled = run([...crowd].reverse().concat(w), ALL_HELD, open, new AvoidanceField(), sub);
    expect(shuffled.out.get("w")).toEqual(all.out.get("w"));
  });

  it("costs work in the neighbours, never the square of the bodies, on any layout", () => {
    const spacing = dials.radiusCells * 1.01;
    const layout = fc.constantFrom("column", "row", "diagonal", "scatter");
    fc.assert(
      fc.property(layout, fc.integer({ min: 20, max: 200 }), fc.integer(), (kind, n, seed) => {
        const bodies: B[] = [];
        const side = Math.ceil(Math.sqrt(n));
        for (let i = 0; i < n; i++) {
          let x = 0;
          let y = 0;
          if (kind === "column") y = i * spacing;
          else if (kind === "row") x = i * spacing;
          else if (kind === "diagonal") {
            x = i * spacing;
            y = i * spacing;
          } else {
            // A lattice of one body per cell of the sparsest spacing, in a
            // seed-shuffled order of cells.
            const cell = (i * 7919 + (seed >>> 0)) % (side * side);
            x = (cell % side) * spacing;
            y = Math.floor(cell / side) * spacing;
          }
          bodies.push(walker(`b${i}`, x, y, 1, 0));
        }
        const { field, out } = run(bodies, ALL_HELD, open, new AvoidanceField(), {
          ...dials,
          chunkSize: 1 << 20,
        });
        expect(field.pairChecks).toBeLessThanOrEqual(8 * n);
        // Nobody is within the radius of anybody: nobody moves.
        for (const o of out.values()) expect(o).toEqual([0, 0]);
      }),
      { numRuns: 20 },
    );
  });

  it("a pile on one spot costs its own square at most, beside sparse walkers who cost a few each", () => {
    const pile = Array.from({ length: 60 }, (_, i) => walker(`p${i}`, 5 + i * 0.001, 5, 1, 0));
    const sparse = Array.from({ length: 100 }, (_, i) =>
      walker(`s${i}`, 100 + i * dials.radiusCells * 1.01, 100, 1, 0),
    );
    const { field } = run([...pile, ...sparse], ALL_HELD, open, new AvoidanceField(), {
      ...dials,
      chunkSize: 1 << 20,
    });
    expect(field.pairChecks).toBeLessThanOrEqual(60 * 59 + 8 * sparse.length);
    expect(field.capHits).toBeGreaterThan(0);
  });

  it("scans the walls once per sidestepping body, not once per question", () => {
    let calls = 0;
    const counting = {
      revision: () => 0,
      walkable: () => {
        calls++;
        return true;
      },
    };
    // A crowd of standers round one walker: many abeam questions, one scan.
    const crowd = [walker("w", 10, 10.5, 1, 0)];
    for (let k = 0; k < 12; k++) crowd.push(stander(`s${k}`, 11 + k * 0.2, 10.5 + (k % 3) * 0.1));
    const { field } = run(crowd, ALL_HELD, counting as never);
    const side = 2 * scanSpan(dials) + 1;
    expect(field.walkableCalls).toBe(calls);
    expect(field.walkableCalls).toBeLessThanOrEqual(side * side);
    expect(field.walkableCalls).toBeGreaterThan(0);
    // Two walkers: one scan each, no more.
    calls = 0;
    const { field: two } = run(
      [...crowd, walker("v", 20, 20.5, 1, 0), stander("t", 21, 20.5)],
      ALL_HELD,
      counting as never,
    );
    expect(two.walkableCalls).toBeLessThanOrEqual(2 * side * side);
  });

  it("never grows its buffers once it has room", () => {
    const field = new AvoidanceField();
    const bodies = withIds(
      Array.from({ length: 50 }, (_, i) => ({
        x: i * 0.3,
        y: 3,
        hx: 1,
        hy: 0,
        moving: true,
        ramp: 1,
        speed: WALK,
      })),
    );
    run(bodies, ALL_HELD, open, field);
    const capacity = field.capacity;
    for (let k = 0; k < 20; k++) run(bodies, ALL_HELD, open, field);
    expect(field.capacity).toBe(capacity);
  });
});
