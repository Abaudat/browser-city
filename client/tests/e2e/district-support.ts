// What an e2e spec needs to walk the generated city and ask it questions,
// from the committed district dump (`fixtures/district-pinned.v1.json`) --
// the very rows the module inserts, so a spec never carries a coordinate of
// its own. A spec says "the arrival dwelling", "the first shop", "a cell on
// the street" and gets a cell; routes are found over the real collision
// grid and walked with real key presses through `walk-support.ts` (the one
// walk helper), never a teleport.

import type { Page } from "@playwright/test";
import { footprintOrigin } from "../../src/world/footprint";
import { bodyCell } from "../../src/world/movement";
import { isBodyClear } from "../../src/world/standable";
import { committedDefs, committedMovementConfig } from "../unit/support/committed-defs";
import { districtWorld } from "../unit/support/district-fixture";
import { segmentsOf, walkRealAxes, walkRealCellsDir, walkRealSegment } from "./walk-support";
import type { WalkKey } from "./walk-types";

const { district, world, ownership } = districtWorld();
const config = committedMovementConfig();
const sub = config.subcellsPerCell;

export { district, ownership };

export interface Cell {
  readonly x: number;
  readonly y: number;
}

/** Cells the page itself placed a prop on (a local prop the dump does not
 * hold): routes treat them as walls. */
let localBlocked: readonly Cell[] = [];
export function blockLocalCells(cells: readonly Cell[]): void {
  localBlocked = cells;
  edgeMemo.clear();
}

/** Whether a body fits centred in cell `(x, y)` of floor 0. */
export function fits(x: number, y: number): boolean {
  if (localBlocked.some((c) => c.x === x && c.y === y)) return false;
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
export function nearestCell(
  from: Cell,
  inside: boolean,
  within = 40,
  avoid: readonly Cell[] = [],
): Cell {
  for (let r = 0; r <= within; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const c = { x: from.x + dx, y: from.y + dy };
        if (!fits(c.x, c.y)) continue;
        if (avoid.some((a) => Math.abs(a.x - c.x) <= 1 && Math.abs(a.y - c.y) <= 1)) continue;
        if ((buildingOf(c) !== 0n) === inside) return c;
      }
    }
  }
  throw new Error(
    `no ${inside ? "indoor" : "outdoor"} cell within ${within} of ${from.x},${from.y}`,
  );
}

/** Whether a body centred in `a` can walk straight to the centre of the
 * adjacent cell `b`: clear at every sub-cell position of the move, never only
 * at the two ends (a thin collider can sit between them). */
const edgeMemo = new Map<number, boolean>();
export function canStep(a: Cell, b: Cell): boolean {
  const key = ((a.x * 4096 + a.y) * 4096 + b.x) * 4096 + b.y;
  const known = edgeMemo.get(key);
  if (known !== undefined) return known;
  let ok = fits(a.x, a.y) && fits(b.x, b.y);
  for (let i = 1; ok && i < sub; i++) {
    const cx = Math.round((a.x + 0.5) * sub + (b.x - a.x) * i);
    const feet = Math.round((a.y + 0.5) * sub + (b.y - a.y) * i);
    ok = isBodyClear(world, config, 0, cx, feet);
  }
  edgeMemo.set(key, ok);
  return ok;
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
  const pad = 40;
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
      if (nx < x0 || ny < y0 || nx >= x0 + w || ny >= y0 + h) continue;
      if (!canStep({ x, y }, { x: nx, y: ny })) continue;
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

/** Walks the player (wherever it stands now) to `to`, with real key presses,
 * along the cheapest route over the real grid. */
export async function walkTo(page: Page, to: Cell): Promise<void> {
  const here = await page.evaluate(() => window.__bc?.playerPosition);
  if (!here) throw new Error("no player position");
  const from = bodyCell(here);
  const route = routeBetween(from, to);
  for (const segment of segmentsOf(route)) {
    try {
      await walkRealSegment(page, segment, 40_000);
    } catch (error) {
      const at = await page.evaluate(() => window.__bc?.playerPosition);
      throw new Error(
        `walk from ${from.x},${from.y} to ${to.x},${to.y} failed at ${JSON.stringify(at)}: ${String(error)}`,
      );
    }
  }
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

/** An interactable object of the district and where a body stands to reach
 * it: the nearest to `from` among the defs that declare `interact_at`. */
export interface Interactable {
  readonly objectId: bigint;
  readonly defId: number;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  /** A cell a body fits in whose centre lies inside the object's reach
   * rect, nearest the object. */
  readonly reachCell: Cell;
  /** A cell on the near side of the reach rect from which the object is out
   * of reach (a few cells away, fitting). */
  readonly outOfReachCell: Cell;
}

export function nearestInteractable(from: Cell, defIds?: readonly number[]): Interactable {
  const defs = committedDefs();
  const reachOf = new Map(
    defs.objects
      .filter((o) => o.interactAt)
      .map((o) => [o.id, o.interactAt as NonNullable<typeof o.interactAt>]),
  );
  let best: { o: (typeof district.objects)[number]; d: number } | undefined;
  for (const o of district.objects) {
    if (!reachOf.has(o.defId) || (defIds && !defIds.includes(o.defId))) continue;
    const d = Math.abs(o.x - from.x) + Math.abs(o.y - from.y);
    if (!best || d < best.d) best = { o, d };
  }
  if (!best) throw new Error("the district holds no interactable object");
  const { o } = best;
  const { reachCell, rect } = reachCellOf(o.defId, o.x, o.y);
  const r = rect;
  // Out of reach: a fitting cell a few cells from the reach cell whose own
  // centre is outside the rect.
  let outOfReachCell: Cell | undefined;
  for (let r2 = 2; r2 <= 6 && !outOfReachCell; r2++) {
    for (let dy = -r2; dy <= r2 && !outOfReachCell; dy++) {
      for (let dx = -r2; dx <= r2; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r2) continue;
        const c = { x: reachCell.x + dx, y: reachCell.y + dy };
        const cx = c.x + 0.5;
        const cy = c.y + 0.5;
        const inside = cx >= r.x0 && cx < r.x1 && cy >= r.y0 && cy < r.y1;
        if (!inside && fits(c.x, c.y)) {
          outOfReachCell = c;
          break;
        }
      }
    }
  }
  if (!outOfReachCell) throw new Error(`no out-of-reach cell near object ${o.objectId}`);
  return {
    objectId: o.objectId,
    defId: o.defId,
    x: o.x,
    y: o.y,
    floor: o.floor,
    reachCell,
    outOfReachCell,
  };
}

/** The nearest cell beside `from` (never `from` itself) a body fits in,
 * indoors or out: where to stand beside something placed on `from`. */
export function nearestFitting(from: Cell): Cell {
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const c = { x: from.x + dx, y: from.y + dy };
        if (fits(c.x, c.y)) return c;
      }
    }
  }
  throw new Error(`no fitting cell near ${from.x},${from.y}`);
}

/** Where a body stands to reach the object of def `defId` anchored at
 * `(x, y)`: the fitting cell nearest it whose centre lies inside the def's
 * `interact_at` rect, and that rect in world cells. */
export function reachCellOf(
  defId: number,
  x: number,
  y: number,
): { reachCell: Cell; rect: { x0: number; y0: number; x1: number; y1: number } } {
  const defs = committedDefs();
  const def = defs.objects.find((o) => o.id === defId);
  const reach = def?.interactAt;
  if (!def || !reach) throw new Error(`def ${defId} declares no interact_at`);
  const origin = footprintOrigin(x, y, { width: def.width, height: def.height });
  const r = {
    x0: origin.x + reach.x0 / sub,
    y0: origin.y + reach.y0 / sub,
    x1: origin.x + reach.x1 / sub,
    y1: origin.y + reach.y1 / sub,
  };
  let reachCell: Cell | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let cy = Math.floor(r.y0) - 1; cy <= Math.ceil(r.y1) + 1; cy++) {
    for (let cx = Math.floor(r.x0) - 1; cx <= Math.ceil(r.x1) + 1; cx++) {
      const mx = cx + 0.5;
      const my = cy + 0.5;
      if (mx < r.x0 || mx >= r.x1 || my < r.y0 || my >= r.y1) continue;
      if (!fits(cx, cy)) continue;
      // Never the object's own footprint: that is where it stands.
      if (
        cx >= origin.x &&
        cx < origin.x + def.width &&
        cy >= origin.y &&
        cy < origin.y + def.height
      ) {
        continue;
      }
      const d = Math.abs(cx - x) + Math.abs(cy - y);
      if (d < bestDist) {
        bestDist = d;
        reachCell = { x: cx, y: cy };
      }
    }
  }
  if (!reachCell) throw new Error(`no cell reaches def ${defId} at ${x},${y}`);
  return { reachCell, rect: r };
}

/** A sub-cell position a body can rest at inside the reach rect of the
 * object of def `defId` anchored at `(x, y)`: clear of colliders, and as far
 * inside the rect as the geometry allows (so a release lag cannot walk it
 * out again). */
export function reachPositionOf(
  defId: number,
  x: number,
  y: number,
): { x: number; y: number; cell: Cell } {
  const def = committedDefs().objects.find((o) => o.id === defId);
  const reach = def?.interactAt;
  if (!def || !reach) throw new Error(`def ${defId} declares no interact_at`);
  const origin = footprintOrigin(x, y, { width: def.width, height: def.height });
  const r = {
    x0: origin.x + reach.x0 / sub,
    y0: origin.y + reach.y0 / sub,
    x1: origin.x + reach.x1 / sub,
    y1: origin.y + reach.y1 / sub,
  };
  let best: { x: number; y: number; margin: number } | undefined;
  for (let feet = Math.ceil(r.y0 * sub); feet < r.y1 * sub; feet++) {
    for (let cx = Math.ceil(r.x0 * sub); cx < r.x1 * sub; cx++) {
      if (!isBodyClear(world, config, 0, cx, feet)) continue;
      // The object itself may be a local prop the dump does not hold: its own
      // collider blocks the body the same way.
      if (def.collider) {
        const hw = config.bodyWidthSubcells / 2;
        const bx0 = cx - hw;
        const bx1 = cx + hw;
        const by0 = feet - config.bodyHeightSubcells;
        const by1 = feet;
        const ox = origin.x * sub;
        const oy = origin.y * sub;
        const c = def.collider;
        if (bx0 < ox + c.x1 && bx1 > ox + c.x0 && by0 < oy + c.y1 && by1 > oy + c.y0) continue;
      }
      const px = cx / sub;
      const py = feet / sub;
      const margin = Math.min(px - r.x0, r.x1 - px, py - r.y0, r.y1 - py);
      if (!best || margin > best.margin) best = { x: px, y: py, margin };
    }
  }
  if (!best) throw new Error(`no position reaches def ${defId} at ${x},${y}`);
  // The cell to approach from: a fitting cell beside the position whose own
  // centre the object's collider does not touch.
  const blocked = (c: Cell): boolean => {
    if (!def.collider) return false;
    const hw = config.bodyWidthSubcells / 2;
    const cx = (c.x + 0.5) * sub;
    const feet = (c.y + 0.5) * sub;
    const k = def.collider;
    const ox = origin.x * sub;
    const oy = origin.y * sub;
    return (
      cx - hw < ox + k.x1 &&
      cx + hw > ox + k.x0 &&
      feet - config.bodyHeightSubcells < oy + k.y1 &&
      feet > oy + k.y0
    );
  };
  const home = { x: Math.floor(best.x), y: Math.ceil(best.y) - 1 };
  let approach: Cell | undefined;
  let approachDist = Number.POSITIVE_INFINITY;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const c = { x: home.x + dx, y: home.y + dy };
      if (!fits(c.x, c.y) || blocked(c)) continue;
      const d = Math.hypot(c.x + 0.5 - best.x, c.y + 0.5 - best.y);
      if (d < approachDist) {
        approachDist = d;
        approach = c;
      }
    }
  }
  if (!approach) throw new Error(`no approach to def ${defId} at ${x},${y}`);
  return { x: best.x, y: best.y, cell: approach };
}

/** Walks to a cell, then along each axis to the exact position. */
export async function walkToPosition(
  page: Page,
  to: { x: number; y: number; cell: Cell },
): Promise<void> {
  await walkTo(page, to.cell);
  await walkRealAxes(page, to);
}

/** Walks `cells` from where the player stands, in whichever of the four
 * directions has the room for it (east first): what a spec that only needs
 * the player to move does, whatever building it happens to stand in. */
export async function walkFreeCells(page: Page, label: string, cells: number): Promise<void> {
  const here = await page.evaluate(() => window.__bc?.playerPosition);
  if (!here) throw new Error("no player position");
  const from = bodyCell(here);
  const options: { key: WalkKey; dx: number; dy: number }[] = [
    { key: "ArrowRight", dx: 1, dy: 0 },
    { key: "ArrowLeft", dx: -1, dy: 0 },
    { key: "ArrowDown", dx: 0, dy: 1 },
    { key: "ArrowUp", dx: 0, dy: -1 },
  ];
  const room = Math.ceil(cells) + 1;
  for (const o of options) {
    let ok = true;
    for (let i = 1; i <= room && ok; i++) {
      ok = canStep(
        { x: from.x + o.dx * (i - 1), y: from.y + o.dy * (i - 1) },
        { x: from.x + o.dx * i, y: from.y + o.dy * i },
      );
    }
    if (ok) {
      await walkRealCellsDir(page, label, cells, o.key);
      return;
    }
  }
  throw new Error(`no direction with ${cells} free cells from ${from.x},${from.y}`);
}

/** The nearest cell to `from` with a clear `side` x `side` block of fitting
 * cells to its south-east: where a body can walk a small square. */
export function openSquareNear(from: Cell, side: number): Cell {
  for (let r = 0; r <= 60; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const c = { x: from.x + dx, y: from.y + dy };
        let ok = true;
        for (let y = c.y; ok && y < c.y + side; y++) {
          for (let x = c.x; ok && x < c.x + side; x++) ok = fits(x, y);
        }
        if (ok) return c;
      }
    }
  }
  throw new Error(`no open ${side}x${side} block near ${from.x},${from.y}`);
}
