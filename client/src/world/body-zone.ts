// The body zone (FR58): which citizens have a body, as a pure function of the
// camera's viewport rect and each citizen's ledger position at the frame's
// city time -- no Pixi, no clock, no table read. A body is spawned inside the
// spawn rect (viewport + `REGION_BODY_MARGIN_CELLS`) and kept until it is
// outside the despawn rect (+ `BODY_DESPAWN_HYSTERESIS_CELLS`). Spatial only:
// no timer, no frame-count grace.

import { BODY_DESPAWN_HYSTERESIS_CELLS, REGION_BODY_MARGIN_CELLS } from "./region";

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
  readonly spawn: Rect;
  readonly despawn: Rect;
}

export interface BodyCandidate {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface BodyPlan {
  /** Ids that need a body now. */
  readonly spawn: string[];
  /** Held ids that keep theirs. */
  readonly keep: string[];
  /** Held ids to discard. */
  readonly despawn: string[];
}

function grow(r: Rect, by: number): Rect {
  return { x0: r.x0 - by, y0: r.y0 - by, x1: r.x1 + by, y1: r.y1 + by };
}

export function bodyZoneOf(viewport: Rect): BodyZone {
  const spawn = grow(viewport, REGION_BODY_MARGIN_CELLS);
  return { spawn, despawn: grow(spawn, BODY_DESPAWN_HYSTERESIS_CELLS) };
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/** What to spawn, keep and discard, given the ids that hold a body and every
 * candidate's ledger position. A held id that is not a candidate any more is
 * discarded. */
export function planBodies(
  held: ReadonlySet<string>,
  candidates: Iterable<BodyCandidate>,
  zone: BodyZone,
): BodyPlan {
  const spawn: string[] = [];
  const keep: string[] = [];
  const despawn: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    seen.add(c.id);
    if (held.has(c.id)) {
      (inRect(zone.despawn, c.x, c.y) ? keep : despawn).push(c.id);
    } else if (inRect(zone.spawn, c.x, c.y)) {
      spawn.push(c.id);
    }
  }
  for (const id of held) if (!seen.has(id)) despawn.push(id);
  return { spawn, keep, despawn };
}
