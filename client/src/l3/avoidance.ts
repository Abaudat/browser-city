// Local avoidance (FR64): walking citizens step around each other. A draw-only
// layer over the ledger pose -- it writes nothing and nothing reads it but the
// drawing. The sidestep of a body is a closed form of the ledger poses of the
// bodies near it at one city time: no history, no velocity, no frame count. A
// client that joined a moment ago and one that watched all along draw the same
// frame.
//
// The rules (Derek, Artie): the side of a pass comes from the closest-approach
// miss of the two bodies' straight-line motion (a quantity that holds for the
// whole encounter, so the side never changes mid-pass, and that is the lateral
// gap for a standing body). On one line (the tie band) the city passes on the
// right, relative to heading; otherwise each steps away from the other's side.
// A body whose line already clears the other by the clearance walks straight. Two walkers share the clearance; a walker passing a
// standing citizen gives it whole. The sidestep is lateral only, so time and
// arrival never move and facing stays the ledger heading's. Two walkers on one
// heading and one line spread by id order.
//
// Continuity (Tim): the sidestep is zero at every corner of the walked path and
// at both ends of a leg (`ramp`), and a neighbour's own rule changes (its
// heading, arriving) only where its own ramp is zero, because its contribution
// is blended from the walker rule to the standing rule by that ramp. The
// distance to a wall, or to another standing body, limits the sidestep
// continuously, with a slope. A walker passing a standing body goes to the
// side with room for the clearance, decided once for the pass at the point
// abeam of the stander.
//
// Which bodies a client computes is a matter of what it holds: a body is
// resolved only when its chunk and the chunks round it are held (`isHeld`), so
// every neighbour within the radius is known. Anywhere else it is drawn at its
// ledger pose. The answer for a held body depends on the bodies within the
// radius, never on which client computes it.

import type { Walkability } from "./micro-path";

export interface AvoidDials {
  /** Bodies further apart than this ignore each other. */
  readonly radiusCells: number;
  /** The gap two bodies keep at closest approach. */
  readonly clearanceCells: number;
  /** Lines closer than this are one line. */
  readonly tieBandCells: number;
  readonly maxNeighbours: number;
  /** Half a body's width: its leading edge must stand on walkable ground. */
  readonly halfWidthCells: number;
  /** The side of a chunk, in cells; the radius must not exceed it. */
  readonly chunkSize: number;
}

/** Whether the client holds the chunk `(cx, cy)` of `floor`. */
export type HeldPredicate = (floor: number, cx: number, cy: number) => boolean;

/** The most a wall may limit a sidestep faster than the body walks towards it:
 * one cell sideways in three along. */
const WALL_SLOPE = 1 / 3;
/** A blocked tile is a disc this big (cells) round its centre, for the
 * distance a sidestep may keep from it. */
const TILE_RADIUS_CELLS = 0.5;
/** Of the clearance, how wide a crossing pair fades through "which side". */
const CROSSING_FADE = 0.5;
/** Of the clearance, how much more room on the other side swings the pass to it. */
const SIDE_SWING = 0.25;
const CAPPED = 1;
const BLOCKED = 2;

/** 0 at 0 and 1 at 1, flat at both ends. */
function smooth(s: number): number {
  const c = s < 0 ? 0 : s > 1 ? 1 : s;
  return c * c * (3 - 2 * c);
}

/** How far into its sidestep a walker is, from the distance to the nearest
 * corner of its path or end of its leg: 0 there, easing to 1 `rampCells` away. */
export function rampOf(vertexDistance: number, rampCells: number): number {
  if (rampCells <= 0) return 1;
  return smooth(vertexDistance / rampCells);
}

/** The direction (+1 right, -1 left) a body steps for another that passes
 * `gap` to its right (negative: to its left): `tie` on one line (within
 * `band`), away from it otherwise. Where the bodies cross each other's lines
 * rather than run alongside (`width` > 0) the gap changes during the pass, so
 * the direction fades through zero over `width` instead of switching. */
function directionFor(gap: number, tie: number, band: number, width: number): number {
  const a = gap < 0 ? -gap : gap;
  if (a <= band) return tie;
  const away = gap > 0 ? -1 : 1;
  if (a >= band + width) return away;
  const t = (a - band) / width;
  return tie * (1 - t) + away * t;
}

export class AvoidanceField {
  #n = 0;
  #ids: string[] = [];
  #x = new Float64Array(0);
  #y = new Float64Array(0);
  #hx = new Float64Array(0);
  #hy = new Float64Array(0);
  #ramp = new Float64Array(0);
  #speed = new Float64Array(0);
  #floor = new Int32Array(0);
  #moving = new Uint8Array(0);
  #offX = new Float64Array(0);
  #offY = new Float64Array(0);
  #flags = new Uint8Array(0);
  #cellX = new Int32Array(0);
  #cellY = new Int32Array(0);
  #rank = new Int32Array(0);
  #candD = new Float64Array(0);
  #candMiss = new Float64Array(0);
  #candJ = new Int32Array(0);
  #found = 0;
  #order: number[] = [];
  #cells: number[] = [];
  /** Pair distances examined in the last `resolve`. */
  pairChecks = 0;
  /** Bodies whose neighbours were cut at the cap in the last `resolve`. */
  capHits = 0;
  /** Sidesteps shortened or given up for a wall in the last `resolve`. */
  blockedSteps = 0;

  /** Position first, then id: the order every client sums in. */
  readonly #byPosition = (a: number, b: number): number => {
    const d = (this.#x[a] as number) - (this.#x[b] as number);
    if (d !== 0) return d;
    const ia = this.#ids[a] as string;
    const ib = this.#ids[b] as string;
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  };

  /** Floor, then row, then column of its cell, then position rank. */
  readonly #byCell = (a: number, b: number): number =>
    (this.#floor[a] as number) - (this.#floor[b] as number) ||
    (this.#cellY[a] as number) - (this.#cellY[b] as number) ||
    (this.#cellX[a] as number) - (this.#cellX[b] as number) ||
    (this.#rank[a] as number) - (this.#rank[b] as number);

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
    const f64 = (a: Float64Array<ArrayBuffer>): Float64Array<ArrayBuffer> => {
      const b = new Float64Array(next);
      b.set(a);
      return b;
    };
    const i32 = (a: Int32Array<ArrayBuffer>): Int32Array<ArrayBuffer> => {
      const b = new Int32Array(next);
      b.set(a);
      return b;
    };
    const u8 = (a: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => {
      const b = new Uint8Array(next);
      b.set(a);
      return b;
    };
    this.#x = f64(this.#x);
    this.#y = f64(this.#y);
    this.#hx = f64(this.#hx);
    this.#hy = f64(this.#hy);
    this.#ramp = f64(this.#ramp);
    this.#speed = f64(this.#speed);
    this.#candMiss = f64(this.#candMiss);
    this.#offX = f64(this.#offX);
    this.#offY = f64(this.#offY);
    this.#candD = f64(this.#candD);
    this.#floor = i32(this.#floor);
    this.#cellX = i32(this.#cellX);
    this.#cellY = i32(this.#cellY);
    this.#rank = i32(this.#rank);
    this.#candJ = i32(this.#candJ);
    this.#moving = u8(this.#moving);
    this.#flags = u8(this.#flags);
  }

  /** Adds a body at its ledger pose; returns its index. `ramp` is
   * `rampOf`'s; a standing body passes `moving` false and ramp 0. */
  add(
    id: string,
    x: number,
    y: number,
    floor: number,
    headingX: number,
    headingY: number,
    moving: boolean,
    ramp: number,
    speed = 0,
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
    this.#ramp[i] = moving ? ramp : 0;
    this.#speed[i] = moving ? speed : 0;
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

  /** Whether body `i`'s sidestep was shortened or given up for a wall. */
  blocked(i: number): boolean {
    return ((this.#flags[i] as number) & BLOCKED) !== 0;
  }

  /** The first position in the cell order whose key is not before
   * `(floor, cy, cx)`. */
  #lowerBound(floor: number, cy: number, cx: number): number {
    let lo = 0;
    let hi = this.#n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const j = this.#cells[mid] as number;
      const before =
        (this.#floor[j] as number) < floor ||
        ((this.#floor[j] as number) === floor &&
          ((this.#cellY[j] as number) < cy ||
            ((this.#cellY[j] as number) === cy && (this.#cellX[j] as number) < cx)));
      if (before) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Resolves every held body's sidestep. `isHeld` says which chunks the
   * client holds; a body is resolved only when its chunk and the eight round
   * it are. */
  resolve(dials: AvoidDials, walk: Walkability, isHeld: HeldPredicate): void {
    if (dials.radiusCells > dials.chunkSize) {
      throw new Error("L3 avoidance: the radius must not exceed a chunk");
    }
    const n = this.#n;
    const radius = dials.radiusCells;
    const order = this.#order;
    const cells = this.#cells;
    order.length = n;
    cells.length = n;
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort(this.#byPosition);
    for (let p = 0; p < n; p++) this.#rank[order[p] as number] = p;
    for (let i = 0; i < n; i++) {
      cells[i] = i;
      this.#cellX[i] = Math.floor((this.#x[i] as number) / radius);
      this.#cellY[i] = Math.floor((this.#y[i] as number) / radius);
    }
    cells.sort(this.#byCell);
    this.pairChecks = 0;
    this.capHits = 0;
    this.blockedSteps = 0;
    for (let p = 0; p < n; p++) {
      const i = order[p] as number;
      if (!this.#moving[i] || (this.#ramp[i] as number) <= 0) continue;
      const floor = this.#floor[i] as number;
      if (!heldWhole(isHeld, floor, this.#x[i] as number, this.#y[i] as number, dials.chunkSize)) {
        continue;
      }
      this.#resolveBody(i, dials, walk);
    }
  }

  #resolveBody(i: number, dials: AvoidDials, walk: Walkability): void {
    const radius = dials.radiusCells;
    const clearance = dials.clearanceCells;
    // Crossing paths fade through zero over half a clearance of gap.
    const fade = clearance * CROSSING_FADE;
    const xi = this.#x[i] as number;
    const yi = this.#y[i] as number;
    const floor = this.#floor[i] as number;
    const hx = this.#hx[i] as number;
    const hy = this.#hy[i] as number;
    // Right of the heading, on a screen whose y points down.
    const rx = -hy;
    const ry = hx;
    const cx = this.#cellX[i] as number;
    const cy = this.#cellY[i] as number;

    // The neighbours within the radius.
    let found = 0;
    for (let row = cy - 1; row <= cy + 1; row++) {
      for (let p = this.#lowerBound(floor, row, cx - 1); p < this.#n; p++) {
        const j = this.#cells[p] as number;
        if (
          (this.#floor[j] as number) !== floor ||
          (this.#cellY[j] as number) !== row ||
          (this.#cellX[j] as number) > cx + 1
        ) {
          break;
        }
        if (j === i) continue;
        this.pairChecks++;
        const dx = (this.#x[j] as number) - xi;
        const dy = (this.#y[j] as number) - yi;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= radius) continue;
        this.#candJ[found] = j;
        this.#candD[found] = d;
        found++;
      }
    }
    if (found === 0) return;

    // At most `maxNeighbours`: the nearest, ties by id.
    if (found > dials.maxNeighbours) {
      this.capHits++;
      this.#flags[i] = (this.#flags[i] as number) | CAPPED;
      found = this.#keepNearest(found, dials.maxNeighbours);
    }
    // Summed in position order, whatever order they were found in.
    for (let a = 1; a < found; a++) {
      const j = this.#candJ[a] as number;
      const d = this.#candD[a] as number;
      let b = a - 1;
      while (
        b >= 0 &&
        (this.#rank[this.#candJ[b] as number] as number) > (this.#rank[j] as number)
      ) {
        this.#candJ[b + 1] = this.#candJ[b] as number;
        this.#candD[b + 1] = this.#candD[b] as number;
        b--;
      }
      this.#candJ[b + 1] = j;
      this.#candD[b + 1] = d;
    }

    this.#found = found;
    const vix = hx * (this.#speed[i] as number);
    const viy = hy * (this.#speed[i] as number);
    // First, how each neighbour passes a standing body would: its miss.
    for (let a = 0; a < found; a++) {
      const j = this.#candJ[a] as number;
      closestApproach((this.#x[j] as number) - xi, (this.#y[j] as number) - yi, -vix, -viy, rx, ry);
      this.#candMiss[a] = missOut;
    }
    let acc = 0;
    for (let a = 0; a < found; a++) {
      const j = this.#candJ[a] as number;
      const d = this.#candD[a] as number;
      const dpx = (this.#x[j] as number) - xi;
      const dpy = (this.#y[j] as number) - yi;
      const weight = smooth(1 - d / radius);
      // A walker neighbour shares the clearance and has a heading; a standing
      // one gives none. Blended by the neighbour's own ramp, so a neighbour
      // turning a corner or arriving changes the rule where its ramp is zero.
      const settled = this.#ramp[j] as number;
      let asWalker = 0;
      if (settled > 0) {
        const vjx = (this.#hx[j] as number) * (this.#speed[j] as number);
        const vjy = (this.#hy[j] as number) * (this.#speed[j] as number);
        closestApproach(dpx, dpy, vjx - vix, vjy - viy, rx, ry);
        let tie = 1;
        const same = hx * (this.#hx[j] as number) + hy * (this.#hy[j] as number) > 0;
        if (same && (this.#ids[i] as string) > (this.#ids[j] as string)) tie = -1;
        asWalker =
          directionFor(gapOut, tie, dials.tieBandCells, crossOut * fade) *
          Math.max(0, clearance - missOut) *
          0.5;
      }
      let asStander = 0;
      if (settled < 1) {
        closestApproach(dpx, dpy, -vix, -viy, rx, ry);
        const shortfall = Math.max(0, clearance - missOut);
        if (shortfall > 0) {
          // A walking neighbour's gap moves with it: fade through "which side"
          // over its ramp instead of switching, so that it stops (ramp zero)
          // into a plain switch without a jump.
          let dir = directionFor(gapOut, 1, dials.tieBandCells, fade * settled);
          // Pass on the side with room for the clearance, decided at the point
          // abeam of the neighbour, which holds for the whole pass.
          const along = dpx * hx + dpy * hy;
          const px = xi + hx * along;
          const py = yi + hy * along;
          const here = this.#roomOn(
            floor,
            px,
            py,
            hx,
            hy,
            dir * rx,
            dir * ry,
            shortfall,
            dials,
            walk,
            j,
            0,
          );
          if (here < shortfall) {
            const other = this.#roomOn(
              floor,
              px,
              py,
              hx,
              hy,
              -dir * rx,
              -dir * ry,
              shortfall,
              dials,
              walk,
              j,
              0,
            );
            // Go the other way as the room there beats the room here, and as
            // the room here falls short of the clearance: a smooth swing, so
            // rooms that tie never flip the side from one frame to the next.
            const lacking = smooth((shortfall - here) / (SIDE_SWING * shortfall));
            const better = smooth((other - here) / (SIDE_SWING * shortfall));
            dir *= 1 - 2 * lacking * better;
          }
          asStander = dir * shortfall;
        }
      }
      acc += weight * (settled * asWalker + (1 - settled) * asStander);
    }
    if (acc === 0) return;
    const side = acc < 0 ? -1 : 1;
    const want = Math.min(clearance, side * acc) * (this.#ramp[i] as number);
    const allowed = this.#roomOn(
      floor,
      xi,
      yi,
      hx,
      hy,
      side * rx,
      side * ry,
      want,
      dials,
      walk,
      -1,
      1,
    );
    const used = Math.min(want, allowed);
    if (used < want) {
      this.blockedSteps++;
      this.#flags[i] = (this.#flags[i] as number) | BLOCKED;
    }
    this.#offX[i] = side * rx * used + 0;
    this.#offY[i] = side * ry * used + 0;
  }

  /** Moves the `keep` nearest candidates (ties by id) to the front; returns
   * `keep`. */
  #keepNearest(found: number, keep: number): number {
    for (let a = 0; a < keep; a++) {
      let best = a;
      for (let b = a + 1; b < found; b++) {
        const db = this.#candD[b] as number;
        const dbest = this.#candD[best] as number;
        if (
          db < dbest ||
          (db === dbest &&
            (this.#ids[this.#candJ[b] as number] as string) <
              (this.#ids[this.#candJ[best] as number] as string))
        ) {
          best = b;
        }
      }
      const j = this.#candJ[a] as number;
      const d = this.#candD[a] as number;
      this.#candJ[a] = this.#candJ[best] as number;
      this.#candD[a] = this.#candD[best] as number;
      this.#candJ[best] = j;
      this.#candD[best] = d;
    }
    return keep;
  }

  /** How far the body at `(x, y)` may sidestep along `(sx, sy)` before its
   * edge meets a blocked tile or a standing body, at most `want`. Every
   * obstacle limits it by its distance across, rising with a slope along the
   * walk, so the limit moves continuously as the body passes a wall's end.
   * `skip` is a neighbour not to count (the one being passed); `mode` 1 counts
   * only standing bodies the walker already clears. */
  #roomOn(
    floor: number,
    x: number,
    y: number,
    hx: number,
    hy: number,
    sx: number,
    sy: number,
    want: number,
    dials: AvoidDials,
    walk: Walkability,
    skip: number,
    mode: number,
  ): number {
    let room = want;
    const reach = TILE_RADIUS_CELLS + dials.halfWidthCells;
    // A limit reaches the clearance this far along the walk.
    const span = Math.ceil(reach + (dials.clearanceCells + reach) / WALL_SLOPE);
    const x0 = Math.floor(x) - span;
    const y0 = Math.floor(y) - span;
    for (let ty = y0; ty <= y0 + 2 * span; ty++) {
      for (let tx = x0; tx <= x0 + 2 * span; tx++) {
        if (walk.walkable(floor, tx, ty)) continue;
        const dx = tx + 0.5 - x;
        const dy = ty + 0.5 - y;
        const across = dx * sx + dy * sy;
        if (across <= 0) continue;
        const along = dx * hx + dy * hy;
        const past = (along < 0 ? -along : along) - reach;
        const limit = fadeIn(
          across,
          reach,
          across - reach + (past > 0 ? past * WALL_SLOPE : 0),
          want,
        );
        if (limit < room) room = limit;
      }
    }
    const reachBody = 2 * dials.halfWidthCells;
    for (let a = 0; a < this.#found; a++) {
      const j = this.#candJ[a] as number;
      if (j === skip || this.#moving[j]) continue;
      if (mode === 1 && (this.#candMiss[a] as number) < dials.clearanceCells) continue;
      const dx = (this.#x[j] as number) - x;
      const dy = (this.#y[j] as number) - y;
      const across = dx * sx + dy * sy;
      if (across <= 0) continue;
      const along = dx * hx + dy * hy;
      const past = (along < 0 ? -along : along) - reachBody;
      const limit = fadeIn(
        across,
        reachBody,
        across - reachBody + (past > 0 ? past * WALL_SLOPE : 0),
        want,
      );
      if (limit < room) room = limit;
    }
    return room < 0 ? 0 : room;
  }
}

/** An obstacle's `limit` on the room, faded in as it comes round to the side
 * the body steps to (`across` from 0 to `reach`), so an obstacle level with the
 * body's own line, which only just counts as on that side, limits nothing yet:
 * the limit never jumps as the obstacle passes from one side to the other. */
function fadeIn(across: number, reach: number, limit: number, want: number): number {
  const s = smooth(across / reach);
  return limit * s + (want + 1) * (1 - s);
}

/** Written by `closestApproach`: the side (positive: right of the heading) and
 * the size of the miss. */
let gapOut = 0;
let missOut = 0;
/** How much of the relative motion crosses the heading: 0 alongside, 1 across. */
let crossOut = 0;

/** Where two bodies at constant velocities pass: `dp` is the other's position
 * from this body, `dv` its velocity from this body's. The miss is the
 * separation at closest approach, held for the whole pass; its side is along
 * `(rx, ry)`. With no relative motion, the lateral gap. */
function closestApproach(
  dpx: number,
  dpy: number,
  dvx: number,
  dvy: number,
  rx: number,
  ry: number,
): void {
  const vv = dvx * dvx + dvy * dvy;
  if (vv < 1e-18) {
    gapOut = dpx * rx + dpy * ry;
    missOut = gapOut < 0 ? -gapOut : gapOut;
    crossOut = 0;
    return;
  }
  const across = dvx * rx + dvy * ry;
  crossOut = (across < 0 ? -across : across) / Math.sqrt(vv);
  const t = -(dpx * dvx + dpy * dvy) / vv;
  const px = dpx + dvx * t;
  const py = dpy + dvy * t;
  gapOut = px * rx + py * ry;
  missOut = Math.sqrt(px * px + py * py);
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
