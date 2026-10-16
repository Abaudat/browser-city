// Story 5.4 (NFR11): the rush-hour load the L3 frame budget is measured
// under -- a seeded, pure builder of `RUSH_CROWD_SIZE` citizens in the shape
// L3 consumes (a fixture and a two-node timetable each), so story 5.5 swaps
// the source and the load survives. Zero PixiJS. DEV only: `?rushCrowd=1`
// adds it to the street through `main.ts`'s DEV branch; no production path
// reaches it.
//
// Story 3.16: the crowd is anchored on the generated district. It is laid
// over the standable cells around the player's start, whatever they are:
// the world tells which cells a body may stand on, the crowd never assumes.
//
// It is hostile on purpose: most citizens walk, legs are short (so micro-path
// searches keep happening), lanes run both ways on shared rows (head-on
// passes), columns cross them, a pile converges on one cell (the m^2 case
// avoidance's neighbour cap exists for) and some stand on walked lines.

import type { Defs } from "../defs/types";
import type { Facing } from "../l3/gait";
import type { TimetableSpec } from "../l3/interim-timetable";
import { tupleFor } from "../render/appearance/player-look";
import { type CitizenFixture, CROWD_FLOOR, type CrowdSource } from "../render/citizens-layer";

/** NFR11's agent count: "~200 agents in a busy bubble". The L3 budget gate
 * (`l3-budget.spec.ts`) asserts this many bodies are live while it measures;
 * lowering it is never a fix for a red gate (D-L3). */
export const RUSH_CROWD_SIZE = 200;

/** The share of the crowd that walks (the rest stand, some gesturing): the
 * gate asserts at least this many bodies are walking or sidestepping. */
export const RUSH_MIN_WALKING_SHARE = 0.6;

/** How many distinct looks the crowd shares among its citizens. */
export const RUSH_LOOKS = 40;

/** How far from the start, in cells, the crowd is laid: inside the body zone
 * of a player on a 1080p screen (the zone reaches 20 cells either side and
 * 11 above and below), clear of its edge where a body's neighbourhood
 * stops being held. */
export const RUSH_RADIUS_CELLS = 5;
/** The crowd's east-west reach, in cells either side of the start. */
export const RUSH_REACH_X_CELLS = 6 * RUSH_RADIUS_CELLS;

export interface RushCrowd extends CrowdSource {
  /** Citizens that walk (have a timetable). */
  readonly walkerCount: number;
}

function hash32(seed: number): number {
  let z = (seed + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}

interface Cell {
  readonly x: number;
  readonly y: number;
}

/** `pct` percent of `count`, whole bodies (not a position). */
function percentOf(count: number, pct: number): number {
  const scaled = count * pct;
  return (scaled - (scaled % 100)) / 100;
}

function leg(a: Cell, b: Cell, dwellMs: number, facing: Facing): TimetableSpec {
  return {
    out: [
      { x: a.x, y: a.y, floor: CROWD_FLOOR },
      { x: b.x, y: b.y, floor: CROWD_FLOOR },
    ],
    dwellMs,
    homeFacing: facing,
    outFacing: facing,
  };
}

/** Whether a walk over standable cells (four neighbours) joins `a` to `b`
 * inside the box of the two plus `margin` cells. */
function walkableWithin(
  world: { standable(x: number, y: number): boolean },
  a: Cell,
  b: Cell,
  margin: number,
): boolean {
  if (a.x === b.x && a.y === b.y) return true;
  const x0 = Math.min(a.x, b.x) - margin;
  const x1 = Math.max(a.x, b.x) + margin;
  const y0 = Math.min(a.y, b.y) - margin;
  const y1 = Math.max(a.y, b.y) + margin;
  const width = x1 - x0 + 1;
  const seen = new Set<number>([(a.y - y0) * width + (a.x - x0)]);
  const queue: Cell[] = [a];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head] as Cell;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const x = c.x + dx;
      const y = c.y + dy;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const k = (y - y0) * width + (x - x0);
      if (seen.has(k) || !world.standable(x, y)) continue;
      if (x === b.x && y === b.y) return true;
      seen.add(k);
      queue.push({ x, y });
    }
  }
  return false;
}

/** The standable cells of the crowd's window reachable on foot (four
 * neighbours) from the cell nearest the start, in row-major order. */
function connectedStandable(world: {
  standable(x: number, y: number): boolean;
  start: Cell;
}): Cell[] {
  const r = RUSH_RADIUS_CELLS;
  const x0 = world.start.x - RUSH_REACH_X_CELLS;
  const x1 = world.start.x + RUSH_REACH_X_CELLS;
  const y0 = world.start.y - r;
  const y1 = world.start.y + r;
  const key = (x: number, y: number): number => (y - y0) * (x1 - x0 + 1) + (x - x0);
  const inside = (x: number, y: number): boolean => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  // The seed: the standable cell nearest the start (the start itself, in a
  // world that has the player standing).
  let seed: Cell | undefined;
  let best = Number.POSITIVE_INFINITY;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!world.standable(x, y)) continue;
      const d = Math.abs(x - world.start.x) + Math.abs(y - world.start.y);
      if (d < best) {
        best = d;
        seed = { x, y };
      }
    }
  }
  if (!seed) return [];
  const seen = new Set<number>([key(seed.x, seed.y)]);
  const queue: Cell[] = [seed];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head] as Cell;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (!inside(nx, ny) || seen.has(key(nx, ny)) || !world.standable(nx, ny)) continue;
      seen.add(key(nx, ny));
      queue.push({ x: nx, y: ny });
    }
  }
  return queue.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * The crowd for a world: `standable` is the world's own answer for a cell,
 * `start` where the player is. Every body starts (and every leg ends) on a
 * standable cell within [`RUSH_RADIUS_CELLS`] of the start.
 */
export function buildRushCrowd(
  defs: Defs,
  world: { standable(x: number, y: number): boolean; start: Cell },
  count = RUSH_CROWD_SIZE,
  looks = RUSH_LOOKS,
): RushCrowd {
  // The cells a leg may run between: the standable cells of the window that
  // can be walked to from the start's own, so no leg crosses a wall.
  const pool: Cell[] = connectedStandable(world);
  if (pool.length === 0) return { fixtures: [], specs: {}, walkerCount: 0 };
  const pick = (n: number, salt: number): Cell =>
    pool[hash32(n * 2654435761 + salt) % pool.length] as Cell;
  // Starts are distinct cells (a shuffled walk through the pool): two bodies
  // on one cell would tie on every distance, and ties are not the load.
  const shuffled = pool
    .map((c, i) => ({ c, k: hash32(i * 2654435761 + 0x9e37) }))
    .sort((a, b) => a.k - b.k || a.c.x - b.c.x || a.c.y - b.c.y)
    .map((e) => e.c);
  const startOf = (n: number): Cell => shuffled[n % shuffled.length] as Cell;
  const near = (from: Cell, n: number, salt: number, maxCells: number): Cell => {
    // The first of a few draws within `maxCells` of `from`; the draw itself
    // when none is.
    for (let k = 0; k < 8; k++) {
      const c = pick(n, salt + k * 17);
      if (Math.abs(c.x - from.x) + Math.abs(c.y - from.y) <= maxCells) return c;
    }
    return pick(n, salt);
  };

  const fixtures: CitizenFixture[] = [];
  const specs: Record<string, TimetableSpec> = {};
  const standers = percentOf(count, 20);
  const pile = percentOf(count, 10);
  const pilePoint = pick(0, 0x77);
  const facings: readonly Facing[] = ["down", "up", "left", "right"];
  // A leg is only laid between cells joined by a walk inside the path box
  // the micro path searches (the legs' own bounding box plus its margin):
  // anything else would be walked as a straight line through a wall.
  const margin = defs.balance.find((b) => b.key === "l3.path_box_margin_cells")?.value ?? 0;
  const pathable = (a: Cell, b: Cell): boolean => walkableWithin(world, a, b, margin);
  /** `to` if a walk joins it to `from`, else the first of a few other
   * draws that does, else `from`'s own cell (a body that stays). */
  const joined = (from: Cell, to: Cell, n: number, salt: number): Cell => {
    if (pathable(from, to)) return to;
    for (let k = 1; k <= 8; k++) {
      const c = pick(n, salt + k * 31);
      if (Math.abs(c.x - from.x) + Math.abs(c.y - from.y) <= 12 && pathable(from, c)) return c;
    }
    return from;
  };

  function add(i: number, kind: string, at: Cell, facing: Facing, spec?: TimetableSpec): void {
    const id = `rush-${kind}-${i}`;
    fixtures.push({
      id,
      // A few dozen looks, shared: the appearance cache is bounded, and
      // rendering is not what this load measures.
      tuple: tupleFor(defs, "adult", i % looks),
      gridX: at.x + 0.5,
      gridY: at.y + 0.5,
      facing,
    });
    if (spec) specs[id] = spec;
  }

  let n = 0;
  for (let k = 0; k < count - standers - pile; k++, n++) {
    const from = startOf(n);
    const to = joined(from, near(from, n, 0x12, 4 + (n % 9)), n, 0x12);
    const facing = facings[hash32(n) % 4] as Facing;
    add(n, k % 3 === 0 ? "column" : "lane", from, facing, leg(from, to, 100 + (n % 400), facing));
  }
  for (let k = 0; k < pile; k++, n++) {
    const from = near(pilePoint, n, 0x31, 6);
    const to = joined(from, pilePoint, n, 0x31);
    add(n, "pile", from, "right", leg(from, to, 100 + (n % 200), "right"));
  }
  for (let k = 0; k < standers; k++, n++) {
    add(n, "stand", startOf(n), facings[hash32(n) % 4] as Facing);
  }
  return { fixtures, specs, walkerCount: count - standers };
}

/** What `main.ts` hands the scene as its `crowd` option. */
export function rushCrowdFor(defs: Defs, looks = RUSH_LOOKS) {
  return (world: { standable(x: number, y: number): boolean; start: Cell }) =>
    buildRushCrowd(defs, world, RUSH_CROWD_SIZE, looks);
}
