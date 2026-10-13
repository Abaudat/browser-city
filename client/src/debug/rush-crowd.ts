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
import { CROWD_FLOOR, type CitizenFixture, type CrowdSource } from "../render/citizens-layer";

/** NFR11's agent count: "~200 agents in a busy bubble". The L3 budget gate
 * (`l3-budget.spec.ts`) asserts this many bodies are live while it measures;
 * lowering it is never a fix for a red gate (D-L3). */
export const RUSH_CROWD_SIZE = 200;

/** The share of the crowd that walks (the rest stand, some gesturing): the
 * gate asserts at least this many bodies are walking or sidestepping. */
export const RUSH_MIN_WALKING_SHARE = 0.6;

/** How far from the start, in cells, the crowd is laid: inside the body zone
 * of a player on a 1080p screen. */
export const RUSH_RADIUS_CELLS = 18;

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

/**
 * The crowd for a world: `standable` is the world's own answer for a cell,
 * `start` where the player is. Every body starts (and every leg ends) on a
 * standable cell within [`RUSH_RADIUS_CELLS`] of the start.
 */
export function buildRushCrowd(
  defs: Defs,
  world: { standable(x: number, y: number): boolean; start: Cell },
  count = RUSH_CROWD_SIZE,
): RushCrowd {
  const pool: Cell[] = [];
  const r = RUSH_RADIUS_CELLS;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r * 2; dx <= r * 2; dx++) {
      const c = { x: world.start.x + dx, y: world.start.y + dy };
      if (world.standable(c.x, c.y)) pool.push(c);
    }
  }
  if (pool.length === 0) return { fixtures: [], specs: {}, walkerCount: 0 };
  const pick = (n: number, salt: number): Cell =>
    pool[hash32(n * 2654435761 + salt) % pool.length] as Cell;
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

  function add(i: number, kind: string, at: Cell, facing: Facing, spec?: TimetableSpec): void {
    const id = `rush-${kind}-${i}`;
    fixtures.push({
      id,
      // Forty looks, shared: the appearance cache is bounded, and rendering
      // is not what this load measures.
      tuple: tupleFor(defs, "adult", i % 40),
      gridX: at.x + 0.5,
      gridY: at.y + 0.5,
      facing,
    });
    if (spec) specs[id] = spec;
  }

  let n = 0;
  for (let k = 0; k < count - standers - pile; k++, n++) {
    const from = pick(n, 0x11);
    const to = near(from, n, 0x12, 4 + (n % 9));
    const facing = facings[hash32(n) % 4] as Facing;
    add(n, k % 3 === 0 ? "column" : "lane", from, facing, leg(from, to, 100 + (n % 400), facing));
  }
  for (let k = 0; k < pile; k++, n++) {
    const from = near(pilePoint, n, 0x31, 6);
    add(n, "pile", from, "right", leg(from, pilePoint, 100 + (n % 200), "right"));
  }
  for (let k = 0; k < standers; k++, n++) {
    add(n, "stand", pick(n, 0x51), facings[hash32(n) % 4] as Facing);
  }
  return { fixtures, specs, walkerCount: count - standers };
}

/** What `main.ts` hands the scene as its `crowd` option. */
export function rushCrowdFor(defs: Defs) {
  return (world: { standable(x: number, y: number): boolean; start: Cell }) =>
    buildRushCrowd(defs, world);
}
