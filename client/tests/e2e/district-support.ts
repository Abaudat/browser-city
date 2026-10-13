// What an e2e spec needs to walk the generated city and ask it questions,
// from the committed district dump (`fixtures/district-pinned.v1.json`) --
// the very rows the module inserts, so a spec never carries a coordinate of
// its own. A spec says "the arrival dwelling", "the first shop", "a cell on
// the street" and gets a cell; routes are found over the real collision
// grid and walked with real key presses through `walk-support.ts` (the one
// walk helper), never a teleport.

import type { Page } from "@playwright/test";
import { bodyCell } from "../../src/world/movement";
import { isBodyClear } from "../../src/world/standable";
import { committedMovementConfig } from "../unit/support/committed-defs";
import { districtWorld } from "../unit/support/district-fixture";
import { walkRealSegment } from "./walk-support";
import type { WalkKey, WalkSegment } from "./walk-types";

const { district, world, ownership } = districtWorld();
const config = committedMovementConfig();
const sub = config.subcellsPerCell;

export { district, ownership };

export interface Cell {
  readonly x: number;
  readonly y: number;
}

/** Whether a body fits centred in cell `(x, y)` of floor 0. */
export function fits(x: number, y: number): boolean {
  if (x < district.site.x0 || y < district.site.y0) return false;
  if (x >= district.site.x1 || y >= district.site.y1) return false;
  return isBodyClear(world, config, 0, Math.round((x + 0.5) * sub), Math.round((y + 0.5) * sub));
}

/** The building a cell is inside, or none. */
export function buildingOf(cell: Cell): bigint {
  return ownership.ownershipAt(cell.x, cell.y, 0).buildingId;
}

/** The cell the player arrives in (the server's `my_start` for a character
 * with no stored position). */
export function arrivalCell(): Cell {
  return district.arrival;
}

/** The nearest cell to `from` (Chebyshev rings) where a body fits and whose
 * building is `inside` (`true`: some building, `false`: none), reached by the
 * scan order only -- not a path. */
export function nearestCell(from: Cell, inside: boolean, within = 40): Cell {
  for (let r = 0; r <= within; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const c = { x: from.x + dx, y: from.y + dy };
        if (!fits(c.x, c.y)) continue;
        if ((buildingOf(c) !== 0n) === inside) return c;
      }
    }
  }
  throw new Error(
    `no ${inside ? "indoor" : "outdoor"} cell within ${within} of ${from.x},${from.y}`,
  );
}

const DIRS: readonly { key: WalkKey; dx: number; dy: number }[] = [
  { key: "ArrowRight", dx: 1, dy: 0 },
  { key: "ArrowLeft", dx: -1, dy: 0 },
  { key: "ArrowDown", dx: 0, dy: 1 },
  { key: "ArrowUp", dx: 0, dy: -1 },
];

/** A cheap-to-walk route of cells from `from` to `to`: shortest over fitting
 * cells with a penalty per turn (each turn is a place for the walk's own
 * release lag to bite) and per cell that hugs a collider. */
export function routeBetween(from: Cell, to: Cell): Cell[] {
  const pad = 70;
  const x0 = Math.min(from.x, to.x) - pad;
  const y0 = Math.min(from.y, to.y) - pad;
  const w = Math.abs(from.x - to.x) + 2 * pad + 1;
  const h = Math.abs(from.y - to.y) + 2 * pad + 1;
  const idx = (x: number, y: number, d: number) => ((y - y0) * w + (x - x0)) * 4 + d;
  const cost = new Float64Array(w * h * 4).fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(w * h * 4).fill(-1);
  const hug = (x: number, y: number) => (DIRS.some((d) => !fits(x + d.dx, y + d.dy)) ? 1.5 : 0);
  // A small binary heap over (cost, state).
  const heap: [number, number][] = [];
  const push = (c: number, s: number) => {
    heap.push([c, s]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((heap[p] as [number, number])[0] <= (heap[i] as [number, number])[0]) break;
      [heap[p], heap[i]] = [heap[i] as [number, number], heap[p] as [number, number]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0] as [number, number];
    const last = heap.pop() as [number, number];
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && (heap[l] as [number, number])[0] < (heap[m] as [number, number])[0])
          m = l;
        if (r < heap.length && (heap[r] as [number, number])[0] < (heap[m] as [number, number])[0])
          m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i] as [number, number], heap[m] as [number, number]];
        i = m;
      }
    }
    return top;
  };
  for (let d = 0; d < 4; d++) {
    cost[idx(from.x, from.y, d)] = 0;
    push(0, idx(from.x, from.y, d));
  }
  while (heap.length > 0) {
    const [c, s] = pop();
    if (c > (cost[s] as number)) continue;
    const d = s % 4;
    const cellIndex = (s - d) / 4;
    const x = (cellIndex % w) + x0;
    const y = Math.floor(cellIndex / w) + y0;
    if (x === to.x && y === to.y) {
      const out: Cell[] = [];
      let at = s;
      while (at >= 0) {
        const ad = at % 4;
        const ci = (at - ad) / 4;
        out.push({ x: (ci % w) + x0, y: Math.floor(ci / w) + y0 });
        at = prev[at] as number;
      }
      out.reverse();
      return out.filter(
        (cell, i) => i === 0 || cell.x !== out[i - 1]?.x || cell.y !== out[i - 1]?.y,
      );
    }
    for (let nd = 0; nd < 4; nd++) {
      const dir = DIRS[nd] as (typeof DIRS)[number];
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < x0 || ny < y0 || nx >= x0 + w || ny >= y0 + h || !fits(nx, ny)) continue;
      const turn = c > 0 && nd !== d ? 4 : 0;
      const next = c + 1 + turn + hug(nx, ny);
      const ns = idx(nx, ny, nd);
      if (next < (cost[ns] as number)) {
        cost[ns] = next;
        prev[ns] = s;
        push(next, ns);
      }
    }
  }
  throw new Error(`no route from ${from.x},${from.y} to ${to.x},${to.y}`);
}

/** A route as held-key segments: one per straight run, released once the
 * body's centre has reached the run's last cell centre. */
export function segmentsOf(route: readonly Cell[], label = "route"): WalkSegment[] {
  const out: WalkSegment[] = [];
  let i = 0;
  while (i < route.length - 1) {
    const a = route[i] as Cell;
    const b = route[i + 1] as Cell;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let j = i + 1;
    while (j + 1 < route.length) {
      const n = route[j + 1] as Cell;
      const c = route[j] as Cell;
      if (n.x - c.x !== dx || n.y - c.y !== dy) break;
      j++;
    }
    const end = route[j] as Cell;
    const dir = DIRS.find((d) => d.dx === dx && d.dy === dy) as (typeof DIRS)[number];
    const until =
      dx > 0
        ? ({ kind: "x-at-least", value: end.x + 0.5 } as const)
        : dx < 0
          ? ({ kind: "x-at-most", value: end.x + 0.5 } as const)
          : dy > 0
            ? ({ kind: "y-at-least", value: end.y + 0.5 } as const)
            : ({ kind: "y-at-most", value: end.y + 0.5 } as const);
    out.push({ label: `${label}-${out.length}-to-${end.x},${end.y}`, key: dir.key, until });
    i = j;
  }
  return out;
}

/** Walks the player (wherever it stands now) to `to`, with real key presses,
 * along the cheapest route over the real grid. */
export async function walkTo(page: Page, to: Cell): Promise<void> {
  const here = await page.evaluate(() => window.__bc?.playerPosition);
  if (!here) throw new Error("no player position");
  const from = bodyCell(here);
  const route = routeBetween(from, to);
  for (const segment of segmentsOf(route)) await walkRealSegment(page, segment, 40_000);
}

/** Waits until the scene holds a position and has drawn something. */
export async function awaitScene(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__bc?.playerPosition !== undefined, undefined, {
    timeout: 30_000,
  });
  await page.waitForFunction(() => (window.__bc?.world?.().drawnChunks ?? 0) > 0, undefined, {
    timeout: 30_000,
  });
}

/** The straight outdoor run of at least `minLen` cells (east-west, every
 * cell fitting a body and in no building) nearest `from`. */
export function straightStreet(from: Cell, minLen: number): { start: Cell; end: Cell } {
  let best: { start: Cell; end: Cell; d: number } | undefined;
  for (let y = from.y - 40; y <= from.y + 40; y++) {
    let runStart: number | undefined;
    for (let x = from.x - 80; x <= from.x + 80 + 1; x++) {
      const open = x <= from.x + 80 && fits(x, y) && buildingOf({ x, y }) === 0n;
      if (open && runStart === undefined) runStart = x;
      if (!open && runStart !== undefined) {
        if (x - runStart >= minLen) {
          const d = Math.abs(y - from.y) + Math.abs(runStart - from.x);
          if (!best || d < best.d) {
            best = { start: { x: runStart, y }, end: { x: x - 1, y }, d };
          }
        }
        runStart = undefined;
      }
    }
  }
  if (!best) throw new Error(`no straight street of ${minLen} cells near ${from.x},${from.y}`);
  return { start: best.start, end: best.end };
}
