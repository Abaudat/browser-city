// Story 5.4 (NFR11): the rush-hour load the L3 frame budget is measured
// under -- a seeded, pure builder of `RUSH_CROWD_SIZE` citizens in the shape
// L3 consumes (a fixture and a two-node timetable each), so story 5.5 swaps
// the source and the load survives. Zero PixiJS. Dev-only: `?rushCrowd=1`
// adds it to the street; nothing in a production path reaches it.
//
// It is hostile on purpose: most citizens walk, legs are short (so micro-path
// searches keep happening), lanes run both ways on shared rows (head-on
// passes), columns cross them, a pile converges on one cell (the m^2 case
// avoidance's neighbour cap exists for) and some stand on walked lines.

import type { Defs } from "../defs/types";
import type { Facing } from "../l3/gait";
import { type CitizenFixture, CROWD_FLOOR, isStagingKerb, tupleFor } from "./citizens";
import type { TimetableSpec } from "./timetable";

/** NFR11's agent count: "~200 agents in a busy bubble". The L3 budget gate
 * (`l3-budget.spec.ts`) asserts this many bodies are live while it measures;
 * lowering it is never a fix for a red gate (D-L3). */
export const RUSH_CROWD_SIZE = 200;

/** The share of the crowd that walks (the rest stand, some gesturing): the
 * gate asserts at least this many bodies are walking or sidestepping. */
export const RUSH_MIN_WALKING_SHARE = 0.6;

/** The crowd's own pavement, in cells. Inside the body zone of a player
 * standing at `PLAYER_START` on a 1080p screen, and clear of every collider
 * (`rush-crowd.test.ts` holds both). */
export const RUSH_X0 = -12;
export const RUSH_X1 = 28;
export const RUSH_Y0 = 13;
export const RUSH_Y1 = 22;

/** Where the pile converges. */
export const RUSH_PILE_CELL = { x: 10, y: 18 } as const;

export interface RushCrowd {
  readonly fixtures: readonly CitizenFixture[];
  readonly specs: Readonly<Record<string, TimetableSpec>>;
  /** Citizens that walk (have a timetable). */
  readonly walkerCount: number;
}

function hash32(seed: number): number {
  let z = (seed + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}

/** An integer in `[lo, hi]` for `(index, salt)`. */
function between(index: number, salt: number, lo: number, hi: number): number {
  return lo + (hash32(index * 2654435761 + salt) % (hi - lo + 1));
}

/** The kerb row beyond the avoidance staging is not walkable (`isStagingKerb`):
 * a cell on it is moved one row up onto the pavement. */
function onPavement(c: { x: number; y: number }): { x: number; y: number } {
  return isStagingKerb(c.x, c.y) ? { x: c.x, y: c.y - 1 } : c;
}

function leg(
  a: { x: number; y: number },
  b: { x: number; y: number },
  dwellMs: number,
  facing: Facing,
): TimetableSpec {
  const from = onPavement(a);
  const to = onPavement(b);
  return {
    out: [
      { x: from.x, y: from.y, floor: CROWD_FLOOR },
      { x: to.x, y: to.y, floor: CROWD_FLOOR },
    ],
    dwellMs,
    homeFacing: facing,
    outFacing: facing,
  };
}

export function buildRushCrowd(defs: Defs, count = RUSH_CROWD_SIZE): RushCrowd {
  const fixtures: CitizenFixture[] = [];
  const specs: Record<string, TimetableSpec> = {};
  const standers = Math.round(count * 0.2);
  const pile = Math.round(count * 0.1);
  const diagonal = Math.round(count * 0.1);
  const columns = Math.round(count * 0.25);
  const lanes = count - standers - pile - diagonal - columns;
  const rows = RUSH_Y1 - RUSH_Y0 + 1;

  function add(
    i: number,
    kind: string,
    at: { x: number; y: number },
    facing: Facing,
    spec?: TimetableSpec,
  ): void {
    const id = `rush-${kind}-${i}`;
    at = onPavement(at);
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
  for (let k = 0; k < lanes; k++, n++) {
    // Rows are shared by both directions: head-on passes.
    const row = RUSH_Y0 + (k % rows);
    const east = Math.floor(k / rows) % 2 === 0;
    const len = between(n, 0x11, 6, 14);
    const x0 = between(n, 0x12, RUSH_X0, RUSH_X1 - len);
    const from = { x: east ? x0 : x0 + len, y: row };
    const to = { x: east ? x0 + len : x0, y: row };
    add(
      n,
      "lane",
      from,
      east ? "right" : "left",
      leg(from, to, between(n, 0x13, 100, 500), east ? "right" : "left"),
    );
  }
  for (let k = 0; k < columns; k++, n++) {
    const len = between(n, 0x21, 4, RUSH_Y1 - RUSH_Y0);
    const y0 = between(n, 0x22, RUSH_Y0, RUSH_Y1 - len);
    const x = between(n, 0x23, RUSH_X0, RUSH_X1);
    const down = k % 2 === 0;
    const from = { x, y: down ? y0 : y0 + len };
    const to = { x, y: down ? y0 + len : y0 };
    add(
      n,
      "column",
      from,
      down ? "down" : "up",
      leg(from, to, between(n, 0x24, 100, 500), down ? "down" : "up"),
    );
  }
  for (let k = 0; k < pile; k++, n++) {
    // A ring of starts around the pile cell, every walker heading for it.
    const ring = [
      { x: -3, y: 0 },
      { x: 3, y: 0 },
      { x: 0, y: -3 },
      { x: 0, y: 3 },
      { x: -2, y: -2 },
      { x: 2, y: 2 },
      { x: -2, y: 2 },
      { x: 2, y: -2 },
    ];
    const o = ring[k % ring.length] as { x: number; y: number };
    const from = { x: RUSH_PILE_CELL.x + o.x, y: RUSH_PILE_CELL.y + o.y };
    add(n, "pile", from, "right", leg(from, RUSH_PILE_CELL, between(n, 0x31, 100, 300), "right"));
  }
  for (let k = 0; k < diagonal; k++, n++) {
    const x0 = between(n, 0x41, RUSH_X0, RUSH_X1 - 8);
    const y0 = between(n, 0x42, RUSH_Y0, RUSH_Y1 - 4);
    const flip = k % 2 === 0;
    const from = { x: flip ? x0 : x0 + 6, y: y0 };
    const to = { x: flip ? x0 + 6 : x0, y: y0 + 4 };
    add(n, "diag", from, "right", leg(from, to, between(n, 0x43, 100, 500), "right"));
  }
  const facings: readonly Facing[] = ["down", "up", "left", "right"];
  for (let k = 0; k < standers; k++, n++) {
    // On walked rows, so walkers pass them.
    const at = {
      x: between(n, 0x51, RUSH_X0, RUSH_X1),
      y: between(n, 0x52, RUSH_Y0, RUSH_Y1),
    };
    add(n, "stand", at, facings[hash32(n) % 4] as Facing);
  }
  return { fixtures, specs, walkerCount: count - standers };
}
