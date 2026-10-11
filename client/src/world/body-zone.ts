// The body zone (FR58): which citizens have a body, as a pure function of the
// camera's viewport rect and each citizen's ledger position at the frame's
// city time -- no Pixi, no clock, no table read. A body is spawned inside the
// spawn rect (viewport + `REGION_BODY_MARGIN_CELLS`) and kept until it is
// outside the despawn rect (+ `BODY_DESPAWN_HYSTERESIS_CELLS`). Spatial only:
// no timer, no frame-count grace.

import {
  type Band,
  BODY_DESPAWN_HYSTERESIS_CELLS,
  bandOf,
  REGION_BODY_MARGIN_CELLS,
} from "./region";

/** The longest frame delta the scene feeds anything (ms). */
export const BODY_MAX_FRAME_DELTA_MS = 100;

/** What the appearance cache is budgeted to hand back ready frames in (ms).
 * Arithmetic only: `body-zone.test.ts` holds the margin to cover it. */
export const BODY_ACQUIRE_BUDGET_MS = 1000;

/** A rect in cells, edges inclusive. */
export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface BodyZone {
  /** Both rects are in floor-0 cells: a point on floor `f` is judged at
   * `y - f * storeyCells`, where it is drawn. */
  readonly spawn: Rect;
  readonly despawn: Rect;
  /** Cells one storey lifts a drawn point. */
  readonly storeyCells: number;
  /** Only citizens in the player's co-visible band have a body. */
  readonly band: Band;
}

/** A citizen's ledger position. Mutable so a caller can reuse one buffer. */
export interface BodyCandidate {
  id: string;
  x: number;
  y: number;
  floor: number;
}

export interface BodyPlan {
  /** Ids that need a body now. */
  readonly spawn: string[];
  /** Held ids that keep theirs. */
  readonly keep: string[];
  /** Held ids to discard. */
  readonly despawn: string[];
}

export function createBodyPlan(): BodyPlan {
  return { spawn: [], keep: [], despawn: [] };
}

function grow(r: Rect, by: number): Rect {
  return { x0: r.x0 - by, y0: r.y0 - by, x1: r.x1 + by, y1: r.y1 + by };
}

export function bodyZoneOf(
  viewport: Rect,
  storeyCells = 0,
  band: Band = 0,
  marginCells = REGION_BODY_MARGIN_CELLS,
): BodyZone {
  const spawn = grow(viewport, marginCells);
  return { spawn, despawn: grow(spawn, BODY_DESPAWN_HYSTERESIS_CELLS), storeyCells, band };
}

/** Every citizen has a body: no viewport. */
export const WHOLE_ZONE: BodyZone = {
  spawn: { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity },
  despawn: { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity },
  storeyCells: 0,
  band: 0,
};

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/** What to spawn, keep and discard, given the ids that hold a body and every
 * candidate's ledger position, written into `out` (cleared first; reuse one to
 * allocate nothing in steady state). A held id that is not a candidate any
 * more is discarded. */
export function planBodies(
  held: ReadonlySet<string>,
  candidates: readonly BodyCandidate[],
  zone: BodyZone,
  out: BodyPlan = createBodyPlan(),
  count: number = candidates.length,
): BodyPlan {
  out.spawn.length = 0;
  out.keep.length = 0;
  out.despawn.length = 0;
  let heldSeen = 0;
  for (let i = 0; i < count; i++) {
    const c = candidates[i] as BodyCandidate;
    const covisible = bandOf(c.floor) === zone.band;
    const y = c.y - c.floor * zone.storeyCells;
    if (held.has(c.id)) {
      heldSeen++;
      (covisible && inRect(zone.despawn, c.x, y) ? out.keep : out.despawn).push(c.id);
    } else if (covisible && inRect(zone.spawn, c.x, y)) {
      out.spawn.push(c.id);
    }
  }
  if (heldSeen < held.size) {
    // Rare: a held id left the candidates.
    const seen = new Set<string>();
    for (let i = 0; i < count; i++) seen.add((candidates[i] as BodyCandidate).id);
    for (const id of held) if (!seen.has(id)) out.despawn.push(id);
  }
  return out;
}
