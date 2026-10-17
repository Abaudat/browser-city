// Story 3.16 AC1: the traverse takes roughly 233 real seconds on foot at the
// settled walking speed. The arithmetic: `generation.site_extent_cells`
// (512) cells at `movement.walk_speed_millicells_per_s` (2.2 cells/s) is
// 232.7 s edge to edge; edge to core is half. Nothing here restates 233: it
// is derived from the two balance keys.
//
// Three facts are held over the committed district's streamed rows, through
// the real collision grid and the real `world/movement.ts` step, on a
// simulated clock (no real time):
//   - a path exists across the whole site on foot;
//   - it is no more than DETOUR_BOUND times the straight crossing (the
//     street network does not force a winding walk that silently turns 233 s
//     into 400);
//   - walked step by step it takes that length divided by the speed, and the
//     walker is never stuck (no frame with a key held makes zero progress).

import { describe, expect, it } from "vitest";
import { bodyCell, MAX_DELTA_MS, step, type Vec2 } from "../../../src/world/movement";
import { isBodyClear } from "../../../src/world/standable";
import { committedMovementConfig } from "../support/committed-defs";
import { districtWorld } from "../support/district-fixture";

/** The longest a crossing may be, against the straight line across: the
 * street grid's own detour bound (`docs/generation.md`, detour excess) and
 * the GDD's commute arithmetic (one walk across the city is the commute
 * ladder's reference) both cap it. */
const DETOUR_BOUND = 1.25;

const { district, world } = districtWorld();
const config = committedMovementConfig();
const sub = config.subcellsPerCell;
const W = district.site.x1 - district.site.x0;
const H = district.site.y1 - district.site.y0;

/** Whether a body fits centred in cell `(x, y)` of floor 0. */
function fits(x: number, y: number): boolean {
  if (
    x < district.site.x0 ||
    y < district.site.y0 ||
    x >= district.site.x1 ||
    y >= district.site.y1
  ) {
    return false;
  }
  return isBodyClear(world, config, 0, Math.round((x + 0.5) * sub), Math.round((y + 0.5) * sub));
}

/** Shortest 4-connected path of fitting cells from any of `from` to any cell
 * satisfying `done`. */
function shortestPath(
  from: readonly { x: number; y: number }[],
  done: (x: number, y: number) => boolean,
): { x: number; y: number }[] {
  const prev = new Int32Array(W * H).fill(-2);
  const at = (x: number, y: number) => (y - district.site.y0) * W + (x - district.site.x0);
  const queue: number[] = [];
  for (const c of from) {
    if (!fits(c.x, c.y)) continue;
    prev[at(c.x, c.y)] = -1;
    queue.push(c.x, c.y);
  }
  for (let head = 0; head < queue.length; head += 2) {
    const x = queue[head] as number;
    const y = queue[head + 1] as number;
    if (done(x, y)) {
      const path: { x: number; y: number }[] = [];
      let i = at(x, y);
      while (i >= 0) {
        path.push({ x: (i % W) + district.site.x0, y: Math.floor(i / W) + district.site.y0 });
        i = prev[i] as number;
      }
      return path.reverse();
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!fits(nx, ny) || (prev[at(nx, ny)] as number) !== -2) continue;
      prev[at(nx, ny)] = at(x, y);
      queue.push(nx, ny);
    }
  }
  throw new Error("no path on foot");
}

/** Walks `path` from its first cell's centre with the real step, at a fixed
 * frame time, and returns the simulated milliseconds, the frames that made
 * no progress while moving, and the final position. */
function walk(path: readonly { x: number; y: number }[], frameMs: number) {
  let pos: Vec2 = { x: (path[0] as { x: number }).x + 0.5, y: (path[0] as { y: number }).y + 0.5 };
  let ms = 0;
  let stuck = 0;
  for (let i = 1; i < path.length; i++) {
    const target = { x: (path[i] as { x: number }).x + 0.5, y: (path[i] as { y: number }).y + 0.5 };
    let guard = 0;
    while (Math.hypot(target.x - pos.x, target.y - pos.y) > 1e-6) {
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const before = pos;
      pos = step(pos, { x: dx, y: dy }, frameMs, world, 0, config, 1);
      // A frame that would overshoot lands on the target: part of a frame.
      const moved = Math.hypot(pos.x - before.x, pos.y - before.y);
      if (moved === 0) {
        stuck++;
        throw new Error(
          `stuck at (${before.x}, ${before.y}) heading for (${target.x}, ${target.y})`,
        );
      }
      const need = Math.hypot(dx, dy);
      if (moved >= need - 1e-9) {
        ms += need / (config.walkSpeedCellsPerMs * 1);
        pos = target;
        break;
      }
      ms += frameMs;
      if (guard++ > 10_000) throw new Error("a cell took more than 10000 frames");
    }
  }
  return { ms, stuck, pos };
}

describe("walking the district edge to edge (AC1)", () => {
  const speedCellsPerS = config.walkSpeedCellsPerMs * 1000;
  const straightCells = W;
  const straightSeconds = straightCells / speedCellsPerS;

  const west = Array.from({ length: 41 }, (_, i) => ({
    x: district.site.x0 + 2,
    y: district.site.y0 + H / 2 - 20 + i,
  }));
  const path = shortestPath(west, (x) => x >= district.site.x1 - 3);
  const length = path.length - 1;

  it("has a path on foot from the west edge to the east edge, through the real grid", () => {
    expect(path.length).toBeGreaterThan(2);
    expect(path[0]?.x).toBe(district.site.x0 + 2);
    expect(path.at(-1)?.x).toBeGreaterThanOrEqual(district.site.x1 - 3);
    console.log(
      `district traverse: straight ${straightCells} cells = ${straightSeconds.toFixed(1)} s; ` +
        `walked ${length} cells = ${(length / speedCellsPerS).toFixed(1)} s ` +
        `(x${(length / (straightCells - 5)).toFixed(3)} the straight line)`,
    );
  });

  it("is no more than the detour bound longer than the straight crossing", () => {
    expect(length).toBeGreaterThanOrEqual(straightCells - 5);
    expect(length).toBeLessThanOrEqual(DETOUR_BOUND * straightCells);
  });

  it("takes its length over the walking speed, walked frame by frame, never stuck", () => {
    const frame = MAX_DELTA_MS;
    const { ms, stuck, pos } = walk(path, frame);
    expect(stuck).toBe(0);
    const seconds = ms / 1000;
    const expected = length / speedCellsPerS;
    // Within one clamp step per cell turned: every frame moves exactly
    // `speed * frame` except the one that lands on a waypoint.
    expect(Math.abs(seconds - expected) / expected).toBeLessThan(0.02);
    expect(seconds).toBeGreaterThanOrEqual(straightSeconds * 0.98);
    expect(bodyCell(pos).x).toBeGreaterThanOrEqual(district.site.x1 - 3);
  });

  it("derives the figure from the speed and the site extent, not a literal", () => {
    expect(straightSeconds).toBeCloseTo(W / (config.walkSpeedCellsPerMs * 1000), 6);
    // "Roughly 233 s": the AC's own figure, within a second of 512 / 2.2.
    expect(Math.abs(straightSeconds - 232.7)).toBeLessThan(1);
  });
});
