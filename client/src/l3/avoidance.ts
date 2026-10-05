// Local avoidance (FR64): walking citizens step around each other. A draw-only
// layer over the ledger pose -- it writes nothing and nothing reads it. The
// sidestep of a body is a closed form of the ledger poses of the bodies near
// it at one city time: no history, no velocity, no frame count. A client that
// joined a moment ago and one that watched all along draw the same frame.
//
// The rules (Derek, Artie): the city passes on the right, relative to
// heading. A sidestep is lateral only, so time and arrival never move and
// facing stays the ledger heading's. A standing body is never displaced; a
// walker gives all the clearance. Two walkers on one heading spread by id.
// The sidestep eases in with the gap and out at both ends of a leg, and never
// puts the body, edge included, in a blocked tile.
//
// Which bodies a client computes is a matter of what it holds: a body is
// resolved only when its chunk and the chunks round it are held (`isHeld`),
// so every neighbour within the avoidance radius is known. Anywhere else it
// is drawn at its ledger pose. The answer for a held body depends on the
// bodies within the radius, never on which client computes it.

import type { Walkability } from "./micro-path";

export interface AvoidDials {
  readonly radiusCells: number;
  readonly maxOffsetCells: number;
  readonly maxNeighbours: number;
  /** Half a body's width: its leading edge must stand on walkable ground. */
  readonly halfWidthCells: number;
  /** The side of a chunk, in cells; the radius must not exceed it. */
  readonly chunkSize: number;
}

/** Whether the client holds the chunk `(cx, cy)` of `floor`. */
export type HeldPredicate = (floor: number, cx: number, cy: number) => boolean;

/** A standing neighbour further right than this (cells) is stepped round on
 * the left; nearer the line, on the right. */
const STANDER_LEFT_THRESHOLD_CELLS = 0.25;
/** The sidestep is tried whole, then at two thirds and one third, before it
 * is given up as blocked. */
const SCALES: readonly number[] = [1, 2 / 3, 1 / 3];

const CAPPED = 1;
const BLOCKED = 2;

/** 0 at 0 and 1 at 1, flat at both ends. */
function smooth(s: number): number {
  const c = s < 0 ? 0 : s > 1 ? 1 : s;
  return c * c * (3 - 2 * c);
}

/** How far into a leg's sidestep a body is: 0 at either end of the leg,
 * easing to 1 a radius in, so the sidestep is zero where the body starts and
 * stops. */
export function endpointRamp(distance: number, total: number, radiusCells: number): number {
  if (radiusCells <= 0) return 1;
  const toEnd = Math.min(distance, total - distance);
  return smooth(toEnd / radiusCells);
}

export class AvoidanceField {
  #n = 0;
  #ids: string[] = [];
  #x = new Float64Array(0);
  #y = new Float64Array(0);
  #hx = new Float64Array(0);
  #hy = new Float64Array(0);
  #ramp = new Float64Array(0);
  #floor = new Int32Array(0);
  #moving = new Uint8Array(0);
  #offX = new Float64Array(0);
  #offY = new Float64Array(0);
  #flags = new Uint8Array(0);
  #order: number[] = [];
  /** Pair distances examined in the last `resolve`. */
  pairChecks = 0;
  /** Bodies whose neighbours were cut at the cap in the last `resolve`. */
  capHits = 0;
  /** Sidesteps shortened or given up for a blocked tile in the last `resolve`. */
  blockedSteps = 0;

  /** Forgets the bodies of the last frame; keeps the buffers. */
  reset(): void {
    this.#n = 0;
  }

  get size(): number {
    return this.#n;
  }

  /** Room for bodies before the next growth. */
  get capacity(): number {
    return this.#x.length;
  }

  #grow(): void {
    const next = Math.max(16, this.#x.length * 2);
    const widen = (a: Float64Array<ArrayBuffer>): Float64Array<ArrayBuffer> => {
      const b = new Float64Array(next);
      b.set(a);
      return b;
    };
    this.#x = widen(this.#x);
    this.#y = widen(this.#y);
    this.#hx = widen(this.#hx);
    this.#hy = widen(this.#hy);
    this.#ramp = widen(this.#ramp);
    this.#offX = widen(this.#offX);
    this.#offY = widen(this.#offY);
    const floor = new Int32Array(next);
    floor.set(this.#floor);
    this.#floor = floor;
    const moving = new Uint8Array(next);
    moving.set(this.#moving);
    this.#moving = moving;
    const flags = new Uint8Array(next);
    flags.set(this.#flags);
    this.#flags = flags;
  }

  /** Adds a body at its ledger pose; returns its index. `ramp` is
   * `endpointRamp`'s; a standing body passes `moving` false. */
  add(
    id: string,
    x: number,
    y: number,
    floor: number,
    headingX: number,
    headingY: number,
    moving: boolean,
    ramp: number,
  ): number {
    if (this.#n === this.#x.length) this.#grow();
    const i = this.#n++;
    this.#ids[i] = id;
    this.#x[i] = x;
    this.#y[i] = y;
    this.#floor[i] = floor;
    this.#hx[i] = headingX;
    this.#hy[i] = headingY;
    this.#moving[i] = moving ? 1 : 0;
    this.#ramp[i] = ramp;
    this.#offX[i] = 0;
    this.#offY[i] = 0;
    this.#flags[i] = 0;
    return i;
  }

  offsetX(i: number): number {
    return this.#offX[i] as number;
  }

  offsetY(i: number): number {
    return this.#offY[i] as number;
  }

  /** Whether body `i`'s neighbours were cut at the cap. */
  capped(i: number): boolean {
    return ((this.#flags[i] as number) & CAPPED) !== 0;
  }

  /** Whether body `i`'s sidestep was shortened or given up for a blocked tile. */
  blocked(i: number): boolean {
    return ((this.#flags[i] as number) & BLOCKED) !== 0;
  }

  /** Resolves every held body's sidestep. */
  resolve(dials: AvoidDials, walk: Walkability, isHeld?: HeldPredicate): void {
    const n = this.#n;
    const order = this.#order;
    order.length = n;
    for (let i = 0; i < n; i++) order[i] = i;
    const xs = this.#x;
    const ids = this.#ids;
    // A canonical order -- by position, then id -- never the order bodies
    // were added in, so every client sums in the same order.
    order.sort((a, b) => {
      const d = (xs[a] as number) - (xs[b] as number);
      if (d !== 0) return d;
      const ia = ids[a] as string;
      const ib = ids[b] as string;
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    });
    this.pairChecks = 0;
    this.capHits = 0;
    this.blockedSteps = 0;
    const radius = dials.radiusCells;
    let lo = 0;
    for (let p = 0; p < n; p++) {
      const i = order[p] as number;
      const xi = xs[i] as number;
      while (lo < p && (xs[order[lo] as number] as number) < xi - radius) lo++;
      if (!this.#moving[i] || (this.#ramp[i] as number) <= 0) continue;
      const yi = this.#y[i] as number;
      const floor = this.#floor[i] as number;
      if (isHeld && !heldWhole(isHeld, floor, xi, yi, dials.chunkSize)) continue;
      const hx = this.#hx[i] as number;
      const hy = this.#hy[i] as number;
      // Right of the heading, on a screen whose y points down.
      const rx = -hy;
      const ry = hx;
      let acc = 0;
      let neighbours = 0;
      for (let q = lo; q < n; q++) {
        const j = order[q] as number;
        const xj = xs[j] as number;
        if (xj > xi + radius) break;
        if (j === i || (this.#floor[j] as number) !== floor) continue;
        this.pairChecks++;
        const dx = xj - xi;
        const dy = (this.#y[j] as number) - yi;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= radius) continue;
        if (++neighbours > dials.maxNeighbours) {
          this.capHits++;
          this.#flags[i] = (this.#flags[i] as number) | CAPPED;
          break;
        }
        const w = smooth(1 - d / radius);
        let sign = 1;
        if (this.#moving[j]) {
          const same = hx * (this.#hx[j] as number) + hy * (this.#hy[j] as number) > 0;
          if (same && (ids[i] as string) > (ids[j] as string)) sign = -1;
        } else if (dx * rx + dy * ry > STANDER_LEFT_THRESHOLD_CELLS) {
          sign = -1;
        }
        acc += sign * w;
      }
      if (acc === 0) continue;
      const magnitude = (acc < -1 ? -1 : acc > 1 ? 1 : acc) * (this.#ramp[i] as number);
      const full = magnitude * dials.maxOffsetCells;
      let placed = false;
      for (const scale of SCALES) {
        const ox = rx * full * scale + 0;
        const oy = ry * full * scale + 0;
        const edge = (full < 0 ? -1 : 1) * dials.halfWidthCells;
        if (
          walk.walkable(floor, Math.floor(xi + ox + rx * edge), Math.floor(yi + oy + ry * edge))
        ) {
          this.#offX[i] = ox;
          this.#offY[i] = oy;
          if (scale !== 1) this.#markBlocked(i);
          placed = true;
          break;
        }
      }
      if (!placed) this.#markBlocked(i);
    }
  }

  #markBlocked(i: number): void {
    this.blockedSteps++;
    this.#flags[i] = (this.#flags[i] as number) | BLOCKED;
  }
}

function heldWhole(
  isHeld: HeldPredicate,
  floor: number,
  x: number,
  y: number,
  chunkSize: number,
): boolean {
  const cx = Math.floor(x / chunkSize);
  const cy = Math.floor(y / chunkSize);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!isHeld(floor, cx + dx, cy + dy)) return false;
    }
  }
  return true;
}
