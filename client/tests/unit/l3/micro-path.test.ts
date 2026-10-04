import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { findMicroPath } from "../../../src/l3/micro-path";
import { sizeProbe } from "../setup/size-probe";

function open(): (x: number, y: number) => boolean {
  return () => true;
}

function wallAt(cells: readonly [number, number][]): (x: number, y: number) => boolean {
  const set = new Set(cells.map(([x, y]) => `${x},${y}`));
  return (x, y) => !set.has(`${x},${y}`);
}

describe("findMicroPath", () => {
  it("is the Manhattan length on open ground, tile by tile", () => {
    const r = findMicroPath(open(), { x: 0, y: 0 }, { x: 4, y: 3 }, 4, 4096, 65536);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cells.length / 2 - 1).toBe(7);
  });

  it("detours around a wall", () => {
    const walk = wallAt([
      [2, -1],
      [2, 0],
      [2, 1],
    ]);
    const r = findMicroPath(walk, { x: 0, y: 0 }, { x: 4, y: 0 }, 4, 4096, 65536);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (let i = 0; i < r.cells.length; i += 2) {
      expect(walk(r.cells[i] ?? 0, r.cells[i + 1] ?? 0)).toBe(true);
    }
    expect(r.cells.length / 2 - 1).toBeGreaterThan(4);
  });

  it("start == goal is a one-cell path", () => {
    const r = findMicroPath(open(), { x: 3, y: 3 }, { x: 3, y: 3 }, 4, 4096, 65536);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(Array.from(r.cells)).toEqual([3, 3]);
  });

  it("a blocked goal and an unreachable goal are typed failures", () => {
    expect(
      findMicroPath(wallAt([[1, 0]]), { x: 0, y: 0 }, { x: 1, y: 0 }, 4, 4096, 65536),
    ).toMatchObject({
      ok: false,
      reason: "blocked_goal",
    });
    const ring = wallAt([
      [4, 3],
      [4, 5],
      [3, 4],
      [5, 4],
    ]);
    expect(findMicroPath(ring, { x: 0, y: 0 }, { x: 4, y: 4 }, 6, 4096, 65536)).toMatchObject({
      ok: false,
      reason: "unreachable",
    });
  });

  it("a blocked start may be left", () => {
    const r = findMicroPath(wallAt([[0, 0]]), { x: 0, y: 0 }, { x: 2, y: 0 }, 4, 4096, 65536);
    expect(r.ok).toBe(true);
  });

  it("gives up with a typed failure when the node budget is spent", () => {
    const r = findMicroPath(open(), { x: 0, y: 0 }, { x: 30, y: 30 }, 4, 64, 65536);
    expect(r).toMatchObject({ ok: false, reason: "budget" });
  });

  it("inv_micro_path_is_total_and_deterministic", () => {
    const probe = sizeProbe({ min: 0, max: 40 });
    fc.assert(
      fc.property(
        probe.over(
          fc.array(fc.tuple(fc.integer({ min: -8, max: 8 }), fc.integer({ min: -8, max: 8 })), {
            maxLength: 40,
          }),
          (cells) => cells.length,
        ),
        fc.tuple(fc.integer({ min: -8, max: 8 }), fc.integer({ min: -8, max: 8 })),
        fc.tuple(fc.integer({ min: -8, max: 8 }), fc.integer({ min: -8, max: 8 })),
        fc.integer({ min: 1, max: 8 }),
        (blocked, [sx, sy], [gx, gy], margin) => {
          const walk = wallAt(blocked);
          const a = findMicroPath(walk, { x: sx, y: sy }, { x: gx, y: gy }, margin, 4096, 65536);
          const b = findMicroPath(walk, { x: sx, y: sy }, { x: gx, y: gy }, margin, 4096, 65536);
          expect(a).toEqual(b);
          const w = Math.abs(gx - sx) + 1 + 2 * margin;
          const h = Math.abs(gy - sy) + 1 + 2 * margin;
          expect(a.expansions).toBeLessThanOrEqual(w * h);
          if (a.ok) {
            expect(a.cells[0]).toBe(sx);
            expect(a.cells[1]).toBe(sy);
            expect(a.cells[a.cells.length - 2]).toBe(gx);
            expect(a.cells[a.cells.length - 1]).toBe(gy);
            for (let i = 2; i < a.cells.length; i += 2) {
              const step =
                Math.abs((a.cells[i] ?? 0) - (a.cells[i - 2] ?? 0)) +
                Math.abs((a.cells[i + 1] ?? 0) - (a.cells[i - 1] ?? 0));
              expect(step).toBe(1);
              expect(walk(a.cells[i] ?? 0, a.cells[i + 1] ?? 0)).toBe(true);
            }
          }
        },
      ),
    );
    probe.expectReached(30);
  });
});

describe("findMicroPath: the taut route", () => {
  it("is a straight line on open ground, however the tiles stair-step", () => {
    const r = findMicroPath(open(), { x: 0, y: 0 }, { x: 8, y: 3 }, 4, 4096, 65536);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Array.from(r.route)).toEqual([0.5, 0.5, 8.5, 3.5]);
  });

  it("sidesteps an obstacle as a drift: no right angle, back on the line soon after", () => {
    const walk = wallAt([[8, 8]]);
    const r = findMicroPath(walk, { x: 3, y: 8 }, { x: 14, y: 8 }, 6, 4096, 65536);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const route = Array.from(r.route);
    // Every edge leans: none is a pure vertical step of a sidestep.
    for (let i = 2; i < route.length; i += 2) {
      const dx = (route[i] ?? 0) - (route[i - 2] ?? 0);
      const dy = (route[i + 1] ?? 0) - (route[i - 1] ?? 0);
      if (dy !== 0) expect(Math.abs(dx)).toBeGreaterThanOrEqual(2 * Math.abs(dy));
    }
    // Back on its own row within two cells of passing the obstacle.
    const after = route.findIndex((v, i) => i % 2 === 0 && v >= 10.5);
    expect(route[after + 1]).toBe(8.5);
  });

  it("keeps clear of a blocked tile by more than the tile edge", () => {
    const walk = wallAt([[8, 8]]);
    const r = findMicroPath(walk, { x: 3, y: 8 }, { x: 14, y: 8 }, 6, 4096, 65536);
    if (!r.ok) throw new Error("no path");
    for (let i = 2; i < r.route.length; i += 2) {
      const ax = r.route[i - 2] as number;
      const ay = r.route[i - 1] as number;
      const bx = r.route[i] as number;
      const by = r.route[i + 1] as number;
      for (let f = 0; f <= 1; f += 0.01) {
        const x = ax + (bx - ax) * f;
        const y = ay + (by - ay) * f;
        expect(walk(Math.floor(x), Math.floor(y))).toBe(true);
      }
    }
  });
});

describe("findMicroPath: totality at any distance", () => {
  it("refuses a search box over the cell cap before allocating anything", () => {
    const r = findMicroPath(open(), { x: 0, y: 0 }, { x: 1_000_000, y: 1_000_000 }, 6, 4096, 65536);
    expect(r).toMatchObject({ ok: false, reason: "budget", expansions: 0 });
  });

  it("inv_micro_path_is_total_and_deterministic across the whole i32 range", () => {
    const probe = sizeProbe({ min: 0, max: 30 });
    const coord = fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 });
    const near = fc.integer({ min: -6, max: 6 });
    fc.assert(
      fc.property(
        probe.over(fc.array(fc.tuple(near, near), { maxLength: 30 }), (cells) => cells.length),
        coord,
        coord,
        near,
        near,
        fc.integer({ min: 64, max: 4096 }),
        (blocked, sx, sy, dx, dy, budget) => {
          const walk = wallAt(blocked.map(([x, y]) => [x + sx, y + sy] as [number, number]));
          const to = { x: sx + dx, y: sy + dy };
          const a = findMicroPath(walk, { x: sx, y: sy }, to, 6, budget, 65536);
          const b = findMicroPath(walk, { x: sx, y: sy }, to, 6, budget, 65536);
          expect(a).toEqual(b);
          // Far apart: refused, never thrown, never allocated.
          const far = findMicroPath(
            walk,
            { x: sx, y: sy },
            { x: sx ^ 0x40000000, y: sy },
            6,
            budget,
            65536,
          );
          expect(far.ok).toBe(false);
        },
      ),
    );
    probe.expectReached(20);
  });

  it("a small budget makes the budget failure occur", () => {
    const r = findMicroPath(open(), { x: 0, y: 0 }, { x: 40, y: 40 }, 6, 64, 65536);
    expect(r).toMatchObject({ ok: false, reason: "budget" });
  });
});
