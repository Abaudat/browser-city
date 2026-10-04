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
  it("is the Manhattan length on open ground, with one turn for an L", () => {
    const r = findMicroPath(open(), { x: 0, y: 0 }, { x: 4, y: 3 }, 4, 4096);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cells.length / 2 - 1).toBe(7);
    let turns = 0;
    for (let i = 4; i < r.cells.length; i += 2) {
      const d1x = (r.cells[i - 2] ?? 0) - (r.cells[i - 4] ?? 0);
      const d2x = (r.cells[i] ?? 0) - (r.cells[i - 2] ?? 0);
      if (d1x !== d2x) turns++;
    }
    expect(turns).toBe(1);
  });

  it("detours around a wall", () => {
    const walk = wallAt([
      [2, -1],
      [2, 0],
      [2, 1],
    ]);
    const r = findMicroPath(walk, { x: 0, y: 0 }, { x: 4, y: 0 }, 4, 4096);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (let i = 0; i < r.cells.length; i += 2) {
      expect(walk(r.cells[i] ?? 0, r.cells[i + 1] ?? 0)).toBe(true);
    }
    expect(r.cells.length / 2 - 1).toBeGreaterThan(4);
  });

  it("start == goal is a one-cell path", () => {
    const r = findMicroPath(open(), { x: 3, y: 3 }, { x: 3, y: 3 }, 4, 4096);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(Array.from(r.cells)).toEqual([3, 3]);
  });

  it("a blocked goal and an unreachable goal are typed failures", () => {
    expect(findMicroPath(wallAt([[1, 0]]), { x: 0, y: 0 }, { x: 1, y: 0 }, 4, 4096)).toMatchObject({
      ok: false,
      reason: "blocked_goal",
    });
    const ring = wallAt([
      [4, 3],
      [4, 5],
      [3, 4],
      [5, 4],
    ]);
    expect(findMicroPath(ring, { x: 0, y: 0 }, { x: 4, y: 4 }, 6, 4096)).toMatchObject({
      ok: false,
      reason: "unreachable",
    });
  });

  it("a blocked start may be left", () => {
    const r = findMicroPath(wallAt([[0, 0]]), { x: 0, y: 0 }, { x: 2, y: 0 }, 4, 4096);
    expect(r.ok).toBe(true);
  });

  it("gives up with a typed failure when the node budget is spent", () => {
    const r = findMicroPath(open(), { x: 0, y: 0 }, { x: 30, y: 30 }, 4, 64);
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
          const a = findMicroPath(walk, { x: sx, y: sy }, { x: gx, y: gy }, margin, 4096);
          const b = findMicroPath(walk, { x: sx, y: sy }, { x: gx, y: gy }, margin, 4096);
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
