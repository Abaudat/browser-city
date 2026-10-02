// The interest region (FR136, FR58, FR145): which chunk columns the client
// holds subscriptions to, as a pure function of where the player stands --
// no SDK type, no Pixi, no DOM, no table read. `net/region-subscription.ts`
// is what turns a plan into subscriptions. Every constant of the region is
// declared here, once.

import { CHUNK_SIZE, chunkKey } from "./chunk";

/** A column is wanted when its Chebyshev distance from the player's column
 * is at most this. Justified by `tests/unit/world/region.test.ts`: it must
 * cover a maximum half-viewport, the body margin, the footprint halo and
 * the upper-floor shift. */
export const REGION_RADIUS_CHUNKS = 2;

/** A column is released only when it is farther than the radius plus this.
 * The asymmetry is the whole hysteresis; there is no timer. */
export const REGION_HYSTERESIS_CHUNKS = 1;

export const REGION_LEAVE_RADIUS_CHUNKS = REGION_RADIUS_CHUNKS + REGION_HYSTERESIS_CHUNKS;

/** Cells of region beyond the viewport so a walk across a boundary finds
 * the next columns already applied: at the canonical walk speed this is
 * well over `REGION_LATENCY_BUDGET_MS` of walking. */
export const REGION_BODY_MARGIN_CELLS = 8;

/** The round trip a crossing is budgeted: request to applied. Arithmetic
 * only -- no test reads a clock against it. */
export const REGION_LATENCY_BUDGET_MS = 3000;

/** The largest and smallest renderer the region is declared to cover. A
 * window larger than the maximum is not guaranteed pop-free. */
export const REGION_MAX_VIEWPORT_PX = { width: 3840, height: 2160 } as const;
export const REGION_MIN_VIEWPORT_PX = { width: 320, height: 240 } as const;

/** Every handle the client may hold at once: each column inside the leave
 * radius, in both bands. */
export const REGION_MAX_HANDLES = (2 * REGION_LEAVE_RADIUS_CHUNKS + 1) ** 2 * 2;

/** A floor band: the floors that are co-visible. Band 0 is `0..=maxFloor`,
 * band 1 is `minFloor..=-1`. */
export type Band = 0 | 1;

export interface FloorRange {
  readonly minFloor: number;
  readonly maxFloor: number;
}

/** One subscription handle: a chunk column in one band. */
export interface HandleKey {
  readonly cx: number;
  readonly cy: number;
  readonly band: Band;
}

export interface RegionCentre {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}

export interface RegionPlan {
  /** Handles to request, nearest column first. */
  readonly subscribe: HandleKey[];
  /** Held handles now farther than the leave radius. */
  readonly release: HandleKey[];
}

export function bandOf(floor: number): Band {
  return floor >= 0 ? 0 : 1;
}

export function bandFloors(band: Band, range: FloorRange): number[] {
  const lo = band === 0 ? 0 : range.minFloor;
  const hi = band === 0 ? range.maxFloor : -1;
  const out: number[] = [];
  for (let f = lo; f <= hi; f++) out.push(f);
  return out;
}

/** The chunk column a cell falls in -- floor division, so a negative cell
 * columns the way a positive one does. */
export function columnOf(x: number, y: number): { cx: number; cy: number } {
  return { cx: Math.floor(x / CHUNK_SIZE), cy: Math.floor(y / CHUNK_SIZE) };
}

export function handleId(k: HandleKey): string {
  return `${k.cx},${k.cy},${k.band}`;
}

/** Every chunk key one handle covers, one per floor of its band. Always
 * `bigint`: a negative chunk coordinate puts the key above 2^53. */
export function chunkKeysOfHandle(k: HandleKey, range: FloorRange): bigint[] {
  return bandFloors(k.band, range).map((f) => chunkKey(k.cx * CHUNK_SIZE, k.cy * CHUNK_SIZE, f));
}

function distance(k: HandleKey, cx: number, cy: number): number {
  return Math.max(Math.abs(k.cx - cx), Math.abs(k.cy - cy));
}

/**
 * What to subscribe and what to release, given what is held and where the
 * player stands. Guarantees `enter(centre) <= held <= keep(centre)` once
 * the plan is applied: every column within the radius in the player's band
 * is held, and nothing within the leave radius is dropped.
 */
export function planRegion(
  held: Iterable<HandleKey>,
  centre: RegionCentre,
  _range: FloorRange,
): RegionPlan {
  const { cx, cy } = columnOf(centre.x, centre.y);
  const band = bandOf(centre.floor);
  const have = new Set<string>();
  const release: HandleKey[] = [];
  for (const k of held) {
    if (distance(k, cx, cy) > REGION_LEAVE_RADIUS_CHUNKS) release.push(k);
    else have.add(handleId(k));
  }
  const subscribe: HandleKey[] = [];
  for (let dx = -REGION_RADIUS_CHUNKS; dx <= REGION_RADIUS_CHUNKS; dx++) {
    for (let dy = -REGION_RADIUS_CHUNKS; dy <= REGION_RADIUS_CHUNKS; dy++) {
      const k: HandleKey = { cx: cx + dx, cy: cy + dy, band };
      if (!have.has(handleId(k))) subscribe.push(k);
    }
  }
  subscribe.sort(
    (a, b) =>
      distance(a, cx, cy) - distance(b, cx, cy) ||
      (a.cx - cx) ** 2 + (a.cy - cy) ** 2 - ((b.cx - cx) ** 2 + (b.cy - cy) ** 2),
  );
  return { subscribe, release };
}
