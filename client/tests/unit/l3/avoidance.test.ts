import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AvoidanceField, type AvoidDials, endpointRamp } from "../../../src/l3/avoidance";
import { l3Config } from "./defs-config";
import { TestGrid } from "./support";

const cfg = l3Config();
const CHUNK = 8;
const dials: AvoidDials = {
  radiusCells: cfg.avoidRadiusCells,
  maxOffsetCells: cfg.avoidMaxOffsetCells,
  maxNeighbours: cfg.avoidMaxNeighbours,
  halfWidthCells: cfg.bodyHalfWidthCells,
  chunkSize: CHUNK,
};
const open = new TestGrid();

interface B {
  id: string;
  x: number;
  y: number;
  hx: number;
  hy: number;
  moving: boolean;
  ramp: number;
}

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
    })
    .map(({ h, ...rest }) => ({ ...rest, hx: h[0], hy: h[1] }));

function withIds(raw: Omit<B, "id">[]): B[] {
  return raw.map((b, i) => ({ ...b, id: `citizen-${i}` }));
}

function run(
  bodies: readonly B[],
  isHeld?: (floor: number, cx: number, cy: number) => boolean,
  grid = open,
  field = new AvoidanceField(),
) {
  field.reset();
  const index = new Map<string, number>();
  for (const b of bodies) {
    index.set(b.id, field.add(b.id, b.x, b.y, 0, b.hx, b.hy, b.moving, b.ramp));
  }
  field.resolve(dials, grid, isHeld);
  const out = new Map<string, [number, number]>();
  for (const [id, i] of index) out.set(id, [field.offsetX(i), field.offsetY(i)]);
  return { field, out };
}

const chunkOf = (v: number) => Math.floor(v / CHUNK);

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
          const bubble = (e: number[]) => (_f: number, cx: number, cy: number) =>
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
    const pair: B[] = [
      { id: "a", x: 4.5, y: 4.5, hx: 1, hy: 0, moving: true, ramp: 1 },
      { id: "b", x: 5.5, y: 4.5, hx: -1, hy: 0, moving: true, ramp: 1 },
    ];
    expect(run(pair).out.get("a")).not.toEqual([0, 0]);
    const partial = run(pair, (_f, cx, cy) => !(cx === 1 && cy === 0)).out;
    expect(partial.get("a")).toEqual([0, 0]);
    expect(partial.get("b")).toEqual([0, 0]);
  });

  it("inv_l3_avoidance_is_history_free", () => {
    fc.assert(
      fc.property(
        fc.array(body(24), { minLength: 1, maxLength: 20 }),
        fc.array(fc.array(body(24), { maxLength: 20 }), { minLength: 3, maxLength: 6 }),
        (raw, others) => {
          const bodies = withIds(raw);
          const cold = run(bodies).out;
          const warm = new AvoidanceField();
          for (let k = 0; k < 100; k++)
            run(withIds(others[k % others.length] ?? []), undefined, open, warm);
          const again = run(bodies, undefined, open, warm).out;
          for (const [id, off] of cold) {
            const w = again.get(id) as [number, number];
            expect(Object.is(w[0], off[0]) && Object.is(w[1], off[1])).toBe(true);
          }
        },
      ),
    );
  });

  it("is bounded and never moves a standing body", () => {
    fc.assert(
      fc.property(fc.array(body(12), { minLength: 1, maxLength: 30 }), (raw) => {
        const bodies = withIds(raw);
        const { out } = run(bodies);
        for (const b of bodies) {
          const [ox, oy] = out.get(b.id) as [number, number];
          expect(Number.isFinite(ox) && Number.isFinite(oy)).toBe(true);
          expect(Math.sqrt(ox * ox + oy * oy)).toBeLessThanOrEqual(dials.maxOffsetCells + 1e-12);
          if (!b.moving || b.ramp === 0) expect([ox, oy]).toEqual([0, 0]);
        }
      }),
    );
  });

  it("the sidestep is zero at either end of a leg", () => {
    expect(endpointRamp(0, 20, 1.5)).toBe(0);
    expect(endpointRamp(20, 20, 1.5)).toBe(0);
    expect(endpointRamp(10, 20, 1.5)).toBe(1);
    let previous = 0;
    for (let d = 0; d <= 1.5; d += 0.05) {
      const r = endpointRamp(d, 20, 1.5);
      expect(r).toBeGreaterThanOrEqual(previous);
      previous = r;
    }
  });

  it("a head-on crossing passes on the right and keeps a body width apart", () => {
    const speed = 0.01;
    let closest = Number.POSITIVE_INFINITY;
    let previous: [number, number, number, number] | undefined;
    let largestStep = 0;
    for (let step = 0; step <= 2000; step++) {
      const a: B = { id: "a", x: 2 + step * speed, y: 10.5, hx: 1, hy: 0, moving: true, ramp: 1 };
      const b: B = { id: "b", x: 22 - step * speed, y: 10.5, hx: -1, hy: 0, moving: true, ramp: 1 };
      const { out } = run([a, b]);
      const [ax, ay] = out.get("a") as [number, number];
      const [bx, by] = out.get("b") as [number, number];
      const dx = a.x + ax - (b.x + bx);
      const dy = a.y + ay - (b.y + by);
      closest = Math.min(closest, Math.sqrt(dx * dx + dy * dy));
      expect(ax).toBeCloseTo(0, 12);
      expect(bx).toBeCloseTo(0, 12);
      // East-bound steps south, west-bound steps north: each to its own right.
      expect(ay).toBeGreaterThanOrEqual(0);
      expect(by).toBeLessThanOrEqual(0);
      if (previous) {
        largestStep = Math.max(largestStep, Math.abs(ay - previous[1]), Math.abs(by - previous[3]));
      }
      previous = [ax, ay, bx, by];
    }
    expect(closest).toBeGreaterThanOrEqual(1.7 * dials.maxOffsetCells);
    // 1 cm of travel never moves the sidestep by more than a sliver.
    expect(largestStep).toBeLessThan(0.02);
  });

  it("a walker steps round a standing citizen, who is never displaced", () => {
    let walkerMoved = false;
    for (let step = 0; step <= 400; step++) {
      const walker: B = {
        id: "w",
        x: 5 + step * 0.01,
        y: 6.5,
        hx: 1,
        hy: 0,
        moving: true,
        ramp: 1,
      };
      const stander: B = { id: "s", x: 7, y: 6.5, hx: 0, hy: 0, moving: false, ramp: 1 };
      const { out } = run([walker, stander]);
      expect(out.get("s")).toEqual([0, 0]);
      if (Math.abs((out.get("w") as [number, number])[1]) > 0.1) walkerMoved = true;
    }
    expect(walkerMoved).toBe(true);
  });

  it("two walkers on one heading and one line spread by id order", () => {
    const a: B = { id: "a", x: 6, y: 6.5, hx: 1, hy: 0, moving: true, ramp: 1 };
    const b: B = { id: "b", x: 6.5, y: 6.5, hx: 1, hy: 0, moving: true, ramp: 1 };
    const { out } = run([b, a]);
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
          const { out } = run(bodies, undefined, grid);
          for (const b of bodies) {
            const [ox, oy] = out.get(b.id) as [number, number];
            expect(grid.walkable(0, Math.floor(b.x + ox), Math.floor(b.y + oy))).toBe(true);
            // Nor does its leading edge: the body is half a cell wide.
            const edge = (v: number) => (v === 0 ? 0 : v < 0 ? -1 : 1) * dials.halfWidthCells;
            expect(
              grid.walkable(0, Math.floor(b.x + ox + edge(ox)), Math.floor(b.y + oy + edge(oy))),
            ).toBe(true);
          }
        },
      ),
    );
  });

  it("a pair meeting in a one-wide corridor degrades gracefully", () => {
    const corridor = new TestGrid();
    for (let x = 0; x < 30; x++) {
      corridor.block(x, 9);
      corridor.block(x, 11);
    }
    for (let step = 0; step <= 100; step++) {
      const a: B = { id: "a", x: 10 + step * 0.1, y: 10.5, hx: 1, hy: 0, moving: true, ramp: 1 };
      const b: B = { id: "b", x: 20 - step * 0.1, y: 10.5, hx: -1, hy: 0, moving: true, ramp: 1 };
      const { out } = run([a, b], undefined, corridor);
      for (const id of ["a", "b"]) {
        const [ox, oy] = out.get(id) as [number, number];
        expect(Number.isFinite(ox) && Number.isFinite(oy)).toBe(true);
        expect(ox).toBeCloseTo(0, 12);
        expect(Math.abs(oy) + dials.halfWidthCells).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it("costs work in the neighbours and counts what it cuts", () => {
    // Far apart: a linear number of pair checks.
    const spread: B[] = [];
    for (let i = 0; i < 100; i++) {
      spread.push({ id: `s${i}`, x: i * 3, y: 5, hx: 1, hy: 0, moving: true, ramp: 1 });
    }
    expect(run(spread).field.pairChecks).toBeLessThanOrEqual(2 * spread.length);
    // Piled on one spot: each body looks at no more than the cap.
    const pile: B[] = [];
    for (let i = 0; i < 60; i++) {
      pile.push({ id: `p${i}`, x: 5 + i * 0.001, y: 5, hx: 1, hy: 0, moving: true, ramp: 1 });
    }
    const { field } = run(pile);
    expect(field.pairChecks).toBeLessThanOrEqual(pile.length * (dials.maxNeighbours + 2));
    expect(field.capHits).toBeGreaterThan(0);
  });

  it("allocates nothing per frame once it has room", () => {
    const field = new AvoidanceField();
    const bodies = withIds(
      Array.from({ length: 50 }, (_, i) => ({
        x: i * 0.3,
        y: 3,
        hx: 1,
        hy: 0,
        moving: true,
        ramp: 1,
      })),
    );
    run(bodies, undefined, open, field);
    const capacity = field.capacity;
    for (let k = 0; k < 20; k++) run(bodies, undefined, open, field);
    expect(field.capacity).toBe(capacity);
  });
});
