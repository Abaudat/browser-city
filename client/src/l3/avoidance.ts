// Local avoidance (FR64): walking citizens step around each other. A draw-only
// layer over the ledger pose -- it writes nothing and nothing reads it but the
// drawing. The sidestep of a body is a closed form of the ledger poses and
// straight-line velocities of the bodies near it at one city time: no history,
// no frame count. A client that joined a moment ago and one that watched all
// along draw the same frame.
//
// The rules (Derek, Artie): the side of a pass comes from the closest-approach
// miss of the two bodies' straight-line motion, a quantity that holds for the
// whole encounter, so the side never changes mid-pass. On one line (the tie
// band) the city passes on the right, relative to heading; otherwise each
// steps away from the other's side. A body whose line already clears the other
// by the clearance walks straight. Two walkers share the clearance; a walker
// passing a standing citizen gives it whole. The sidestep is lateral only, so
// time and arrival never move and facing stays the ledger heading's. Two
// walkers running alongside on one line spread by id order.
//
// Continuity (Tim): everything that picks a side is constant while both bodies
// are on straight edges. A neighbour easing into or out of a corner or the end
// of its leg is treated as standing at that corner (its anchor) in proportion
// to how far its ramp is from full, so its own rule changes happen where its
// weight is zero. The sidestep itself is zero at every corner of the walked
// path and at both ends of a leg (`ramp`). Walls and other standing bodies
// limit the sidestep by their distance across, with a slope along the walk. A
// walker passing a standing body goes to the side with room for the clearance,
// decided once for the pass at the point abeam of the stander.
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
/** Of the clearance, how much more room on the other side swings the pass to it. */
const SIDE_SWING = 0.25;
/** Of the speed, how much of the relative motion across the line makes two
 * walkers cross rather than run alongside (so the id order does not apply). */
const ALONGSIDE_CROSS = 0.2;
/** Of the radius, how far in a standing body is fully an obstacle. */
const OBSTACLE_FADE_IN = 0.25;
/** Gaps are compared to the tie band in units of this fraction of a cell. */
const GAP_GRID = 10000;
/** Of the speed, how much relative motion across the line puts a pair that
 * walks the same way in the shallow-merge regime, where lateral steps cannot
 * separate them and would pull them together: off from `MERGE_FROM`
 * to `MERGE_TO`, back on from `MERGE_BACK` over `MERGE_BACK_WIDTH`, whole outside.
 * About 20 to 35 degrees of convergence. */
const MERGE_FROM = 0.02;
const MERGE_TO = 0.06;
const MERGE_BACK = 0.55;
const MERGE_BACK_WIDTH = 0.1;
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
 * `band`), away from it otherwise. The gap holds for the whole pass, so this
 * never changes mid-pass. */
function directionFor(gap: number, tie: number, band: number): number {
  const a = gap < 0 ? -gap : gap;
  // Compared on a grid far coarser than float noise, so a gap that sits on the
  // band lands on one side for the whole pass.
  if (Math.round(a * GAP_GRID) <= Math.round(band * GAP_GRID)) return tie;
  return gap > 0 ? -1 : 1;
}

/** An obstacle's `limit` on the room, faded in as it comes round to the side
 * the body steps to (`across` from 0 to `reach`), so an obstacle level with the
 * body's own line, which only just counts as on that side, limits nothing yet:
 * the limit never jumps as the obstacle passes from one side to the other. */
function fadeIn(across: number, reach: number, limit: number, want: number): number {
  const s = smooth(across / reach);
  return limit * s + (want + 1) * (1 - s);
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
  #anchorX = new Float64Array(0);
  #anchorY = new Float64Array(0);
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
  /** Blocked tiles round the body being resolved, as offsets of their centres
   * from its centre; scanned once per body per frame. */
  #wallDx = new Float64Array(0);
  #wallDy = new Float64Array(0);
  #walls = 0;
  /** Written by `#closestApproach`: the side (positive: right of the heading)
   * and size of the miss, and how much of the relative motion crosses the line. */
  #gap = 0;
  #miss = 0;
  #cross = 0;
  /** The squared relative speed of the last `#closestApproach`. */
  #relSq = 0;
  /** Pair distances examined in the last `resolve`. */
  pairChecks = 0;
  /** Bodies whose neighbours were cut at the cap in the last `resolve`. */
  capHits = 0;
  /** Sidesteps shortened or given up for a wall in the last `resolve`. */
  blockedSteps = 0;
  /** `walkable` lookups in the last `resolve`. */
  walkableCalls = 0;

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
    this.#anchorX = f64(this.#anchorX);
    this.#anchorY = f64(this.#anchorY);
    this.#offX = f64(this.#offX);
    this.#offY = f64(this.#offY);
    this.#candD = f64(this.#candD);
    this.#candMiss = f64(this.#candMiss);
    this.#floor = i32(this.#floor);
    this.#cellX = i32(this.#cellX);
    this.#cellY = i32(this.#cellY);
    this.#rank = i32(this.#rank);
    this.#candJ = i32(this.#candJ);
    this.#moving = u8(this.#moving);
    this.#flags = u8(this.#flags);
  }

  /** Adds a body at its ledger pose; returns its index. `ramp` is `rampOf`'s,
   * `speed` its pace along its heading in cells per milliminute, and the
   * anchor the corner or end of its path nearest it; a standing body passes
   * `moving` false, ramp and speed 0 and its own position as the anchor. */
  add(
    id: string,
    x: number,
    y: number,
    floor: number,
    headingX: number,
    headingY: number,
    moving: boolean,
    ramp: number,
    speed: number,
    anchorX: number,
    anchorY: number,
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
    this.#anchorX[i] = moving ? anchorX : x;
    this.#anchorY[i] = moving ? anchorY : y;
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

  /** Where two bodies at constant velocities pass: `dp` is the other's position
   * from this body, `dv` its velocity from this body's. The miss is the
   * separation at closest approach, held for the whole pass; its side is along
   * `(rx, ry)`. With no relative motion, the lateral gap. */
  #closestApproach(
    dpx: number,
    dpy: number,
    dvx: number,
    dvy: number,
    rx: number,
    ry: number,
  ): void {
    const vv = dvx * dvx + dvy * dvy;
    if (vv < 1e-18) {
      this.#gap = dpx * rx + dpy * ry;
      this.#miss = this.#gap < 0 ? -this.#gap : this.#gap;
      this.#cross = 0;
      this.#relSq = 0;
      return;
    }
    this.#relSq = vv;
    const across = dvx * rx + dvy * ry;
    this.#cross = (across < 0 ? -across : across) / Math.sqrt(vv);
    const t = -(dpx * dvx + dpy * dvy) / vv;
    const px = dpx + dvx * t;
    const py = dpy + dvy * t;
    this.#gap = px * rx + py * ry;
    this.#miss = Math.sqrt(px * px + py * py);
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
    this.walkableCalls = 0;
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

  /** Scans the blocked tiles within reach of body `i`: its sidestep reaches the
   * clearance, a pass is decided at the point abeam of a neighbour up to the
   * radius along its line, and a limit climbs one cell in three along the walk.
   * Once per body per frame; every later query shifts what this found. */
  #scanWalls(i: number, dials: AvoidDials, walk: Walkability): void {
    const span = scanSpan(dials);
    const x = this.#x[i] as number;
    const y = this.#y[i] as number;
    const floor = this.#floor[i] as number;
    const x0 = Math.floor(x) - span;
    const y0 = Math.floor(y) - span;
    const side = 2 * span + 1;
    if (this.#wallDx.length < side * side) {
      this.#wallDx = new Float64Array(side * side);
      this.#wallDy = new Float64Array(side * side);
    }
    let walls = 0;
    for (let ty = y0; ty < y0 + side; ty++) {
      for (let tx = x0; tx < x0 + side; tx++) {
        this.walkableCalls++;
        if (walk.walkable(floor, tx, ty)) continue;
        this.#wallDx[walls] = tx + 0.5 - x;
        this.#wallDy[walls] = ty + 0.5 - y;
        walls++;
      }
    }
    this.#walls = walls;
  }

  #resolveBody(i: number, dials: AvoidDials, walk: Walkability): void {
    const radius = dials.radiusCells;
    const clearance = dials.clearanceCells;
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
    this.#walls = -1;
    const vix = hx * (this.#speed[i] as number);
    const viy = hy * (this.#speed[i] as number);
    // How each neighbour passes, if it stood at its anchor: its miss.
    for (let a = 0; a < found; a++) {
      const j = this.#candJ[a] as number;
      this.#closestApproach(
        (this.#anchorX[j] as number) - xi,
        (this.#anchorY[j] as number) - yi,
        -vix,
        -viy,
        rx,
        ry,
      );
      this.#candMiss[a] = this.#miss;
    }
    let acc = 0;
    for (let a = 0; a < found; a++) {
      const j = this.#candJ[a] as number;
      const weight = smooth(1 - (this.#candD[a] as number) / radius);
      // A walking neighbour mid-edge shares the clearance by its own motion; one
      // easing into or out of a corner or an end is treated as standing there
      // (its anchor) in proportion to how little its ramp has come in, so what
      // changes about it changes where its weight is zero.
      const settled = this.#ramp[j] as number;
      let asWalker = 0;
      if (settled > 0) {
        const vjx = (this.#hx[j] as number) * (this.#speed[j] as number);
        const vjy = (this.#hy[j] as number) * (this.#speed[j] as number);
        this.#closestApproach(
          (this.#x[j] as number) - xi,
          (this.#y[j] as number) - yi,
          vjx - vix,
          vjy - viy,
          rx,
          ry,
        );
        // Alongside on one line: the id decides; crossing: the right hand.
        let tie = 1;
        const same = hx * (this.#hx[j] as number) + hy * (this.#hy[j] as number) > 0;
        if (same && (this.#ids[i] as string) > (this.#ids[j] as string)) {
          tie = 1 - 2 * (1 - smooth(this.#cross / ALONGSIDE_CROSS));
        }
        // Walking the same way and converging only shallowly, lateral steps move
        // two bodies together as much as apart: do nothing there.
        let merge = 1;
        if (same) {
          const speed = this.#speed[i] as number;
          const lateral = speed > 0 ? (this.#cross * Math.sqrt(this.#relSq)) / speed : 0;
          merge =
            1 -
            smooth((lateral - MERGE_FROM) / (MERGE_TO - MERGE_FROM)) *
              (1 - smooth((lateral - MERGE_BACK) / MERGE_BACK_WIDTH));
        }
        asWalker =
          directionFor(this.#gap, tie, dials.tieBandCells) *
          Math.max(0, clearance - this.#miss) *
          0.5 *
          merge;
      }
      let asStander = 0;
      if (settled < 1) {
        const shortfall = Math.max(0, clearance - (this.#candMiss[a] as number));
        if (shortfall > 0) {
          const dpx = (this.#anchorX[j] as number) - xi;
          const dpy = (this.#anchorY[j] as number) - yi;
          this.#closestApproach(dpx, dpy, -vix, -viy, rx, ry);
          let dir = directionFor(this.#gap, 1, dials.tieBandCells);
          // Pass on the side with room for the clearance, decided at the point
          // abeam of the stander, which holds for the whole pass.
          const along = dpx * hx + dpy * hy;
          const here = this.#roomOn(i, along, dir, shortfall, dials, walk, j, 0);
          if (here < shortfall) {
            const other = this.#roomOn(i, along, -dir, shortfall, dials, walk, j, 0);
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
    const allowed = this.#roomOn(i, 0, side, want, dials, walk, -1, 1);
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

  /** How far body `i`, moved `along` its heading, may sidestep to `side` (+1
   * its right, -1 its left) before its edge meets a blocked tile or a standing
   * body, at most `want`. Every obstacle limits it by its distance across,
   * rising with a slope along the walk, so the limit moves continuously as the
   * body passes a wall's end. The walls are scanned once per body; `skip` is a
   * neighbour not to count (the one being passed); `mode` 1 counts only
   * standing bodies the walker already clears. */
  #roomOn(
    i: number,
    along: number,
    side: number,
    want: number,
    dials: AvoidDials,
    walk: Walkability,
    skip: number,
    mode: number,
  ): number {
    if (this.#walls < 0) this.#scanWalls(i, dials, walk);
    const hx = this.#hx[i] as number;
    const hy = this.#hy[i] as number;
    const sx = side * -hy;
    const sy = side * hx;
    // The point asked about, from the body's centre.
    const ox = hx * along;
    const oy = hy * along;
    let room = want;
    const reach = TILE_RADIUS_CELLS + dials.halfWidthCells;
    for (let w = 0; w < this.#walls; w++) {
      const dx = (this.#wallDx[w] as number) - ox;
      const dy = (this.#wallDy[w] as number) - oy;
      const across = dx * sx + dy * sy;
      if (across <= 0) continue;
      const alongTo = dx * hx + dy * hy;
      const past = (alongTo < 0 ? -alongTo : alongTo) - reach;
      const limit = fadeIn(
        across,
        reach,
        across - reach + (past > 0 ? past * WALL_SLOPE : 0),
        want,
      );
      if (limit < room) room = limit;
    }
    const reachBody = 2 * dials.halfWidthCells;
    const x = (this.#x[i] as number) + ox;
    const y = (this.#y[i] as number) + oy;
    for (let a = 0; a < this.#found; a++) {
      const j = this.#candJ[a] as number;
      if (j === skip) continue;
      if (mode === 1 && (this.#candMiss[a] as number) < dials.clearanceCells) continue;
      // A body is an obstacle where it stands, or at its anchor while it eases
      // into or out of a corner or an end, and as much as it is not yet walking.
      // It comes into force over the outer quarter of the radius, so one that
      // enters range does not move the limit at once.
      const standing =
        (1 - (this.#ramp[j] as number)) *
        smooth((1 - (this.#candD[a] as number) / dials.radiusCells) / OBSTACLE_FADE_IN);
      if (standing <= 0) continue;
      const dx = (this.#anchorX[j] as number) - x;
      const dy = (this.#anchorY[j] as number) - y;
      const across = dx * sx + dy * sy;
      if (across <= 0) continue;
      const alongTo = dx * hx + dy * hy;
      const past = (alongTo < 0 ? -alongTo : alongTo) - reachBody;
      const limit = fadeIn(
        across,
        reachBody,
        across - reachBody + (past > 0 ? past * WALL_SLOPE : 0),
        want,
      );
      const weighted = limit * standing + (want + 1) * (1 - standing);
      if (weighted < room) room = weighted;
    }
    return room < 0 ? 0 : room;
  }
}

/** Cells round a body that its wall scan covers: a limit reaches the clearance
 * `(clearance + reach) / slope` along the walk, and a pass is decided up to the
 * radius along the line. */
export function scanSpan(dials: AvoidDials): number {
  const reach = TILE_RADIUS_CELLS + dials.halfWidthCells;
  return Math.ceil(reach + (dials.clearanceCells + reach) / WALL_SLOPE + dials.radiusCells);
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
