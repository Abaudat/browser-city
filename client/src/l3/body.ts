// An L3 body: a pure function of a ledger-shaped leg, the city time handed in
// and tile walkability (FR63, FR64, NFR23). It keeps no position, no progress
// and no clock of its own -- only caches (a leg cursor, the micro paths of the
// current grid revision). Despawning one discards the cache and nothing else;
// there is nothing to merge back.

import type { L3Config } from "./config";
import { findMicroPath, type PathConfig, type Walkability } from "./micro-path";

export interface Cell {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}

/** FR56's `InTransit(route, t_depart, t_arrive)`: instants are in-city
 * milliminutes. */
export interface Leg {
  readonly waypoints: readonly Cell[];
  readonly departAt: number;
  readonly arriveAt: number;
}

/** Written into by `Body.poseAt`; owned by the caller. Positions are in
 * cells, at cell centres along the path. */
export interface BodyPose {
  x: number;
  y: number;
  floor: number;
  moving: boolean;
  /** Cells walked along the route so far. */
  distance: number;
  /** Unit direction of travel on the current edge; 0, 0 when not moving. */
  headingX: number;
  headingY: number;
}

export function createBodyPose(): BodyPose {
  return { x: 0, y: 0, floor: 0, moving: false, distance: 0, headingX: 0, headingY: 0 };
}

function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function routeManhattan(leg: Leg): number {
  let total = 0;
  for (let i = 1; i < leg.waypoints.length; i++) {
    total += manhattan(leg.waypoints[i - 1] as Cell, leg.waypoints[i] as Cell);
  }
  return total;
}

/** Each waypoint's integer instant: the leg duration shared by cumulative
 * Manhattan length, floor division. Depends on the route alone. */
export function legInstants(leg: Leg): number[] {
  const duration = Math.max(0, leg.arriveAt - leg.departAt);
  const total = routeManhattan(leg);
  const instants = [leg.departAt];
  let cumulative = 0;
  for (let i = 1; i < leg.waypoints.length; i++) {
    cumulative += manhattan(leg.waypoints[i - 1] as Cell, leg.waypoints[i] as Cell);
    if (total === 0) instants.push(leg.departAt);
    else if (i === leg.waypoints.length - 1) instants.push(leg.departAt + duration);
    else instants.push(leg.departAt + Math.floor((duration * cumulative) / total));
  }
  return instants;
}

/** The pace a leg asks for, in cells per real second, at `msPerMilliminute`
 * real milliseconds per milliminute. Infinite for an instantaneous leg. */
export function legPaceCellsPerS(leg: Leg, msPerMilliminute: number): number {
  const seconds = (Math.max(0, leg.arriveAt - leg.departAt) * msPerMilliminute) / 1000;
  const cells = routeManhattan(leg);
  if (cells === 0) return 0;
  return seconds === 0 ? Number.POSITIVE_INFINITY : cells / seconds;
}

/** Whether the leg pace is inside canonical walking speed +/- the band. A
 * leg outside it is a defect in whoever issued it; L3 still honours its
 * arrival time. */
export function paceWithinBand(
  leg: Leg,
  msPerMilliminute: number,
  config: Pick<L3Config, "walkCellsPerS" | "paceBandPercent">,
): boolean {
  if (routeManhattan(leg) === 0) return true;
  const pace = legPaceCellsPerS(leg, msPerMilliminute);
  const slack = config.walkCellsPerS * (config.paceBandPercent / 100);
  return pace >= config.walkCellsPerS - slack && pace <= config.walkCellsPerS + slack;
}

interface SegmentPath {
  /** x0, y0, x1, y1, ... at cell centres. */
  readonly points: Float64Array;
  readonly length: number;
}

function centrePath(cells: Int32Array): SegmentPath {
  const points = new Float64Array(cells.length);
  let length = 0;
  for (let i = 0; i < cells.length; i += 2) {
    points[i] = (cells[i] ?? 0) + 0.5;
    points[i + 1] = (cells[i + 1] ?? 0) + 0.5;
    if (i > 0) {
      length += Math.hypot(
        (points[i] ?? 0) - (points[i - 2] ?? 0),
        (points[i + 1] ?? 0) - (points[i - 1] ?? 0),
      );
    }
  }
  return { points, length };
}

export class Body {
  readonly #leg: Leg;
  readonly #walk: Walkability;
  readonly #path: PathConfig;
  readonly #instants: readonly number[];
  readonly #floor: number;
  #revision = Number.NaN;
  #segments: SegmentPath[] = [];
  #segmentStart: number[] = [];
  #total = 0;
  #cursor = 0;
  #searches = 0;
  #fallbacks = 0;

  constructor(leg: Leg, walk: Walkability, path: PathConfig) {
    const first = leg.waypoints[0];
    if (!first) throw new Error("L3: a leg needs at least one waypoint");
    for (const w of leg.waypoints) {
      if (w.floor !== first.floor) {
        throw new Error("L3: a leg whose waypoints are on different floors is not supported");
      }
    }
    this.#leg = leg;
    this.#walk = walk;
    this.#path = path;
    this.#floor = first.floor;
    this.#instants = legInstants(leg);
  }

  /** Micro-path searches run so far -- one per segment per grid revision. */
  get searchCount(): number {
    return this.#searches;
  }

  /** Segments currently walked as a straight line for want of a path. */
  get fallbackCount(): number {
    return this.#fallbacks;
  }

  /** Cells of the whole route, on the current grid revision. */
  get totalLength(): number {
    this.#ensurePaths();
    return this.#total;
  }

  #ensurePaths(): void {
    const revision = this.#walk.revision();
    if (revision === this.#revision) return;
    this.#revision = revision;
    const floor = this.#floor;
    const walkable = (x: number, y: number): boolean => this.#walk.walkable(floor, x, y);
    const waypoints = this.#leg.waypoints;
    this.#segments = [];
    this.#segmentStart = [];
    this.#fallbacks = 0;
    this.#total = 0;
    if (waypoints.length === 1) {
      const only = waypoints[0] as Cell;
      this.#segments.push(centrePath(Int32Array.of(only.x, only.y)));
      this.#segmentStart.push(0);
      return;
    }
    for (let i = 1; i < waypoints.length; i++) {
      const a = waypoints[i - 1] as Cell;
      const b = waypoints[i] as Cell;
      this.#searches++;
      const found = findMicroPath(walkable, a, b, this.#path.marginCells, this.#path.nodeBudget);
      let segment: SegmentPath;
      if (found.ok) {
        segment = centrePath(found.cells);
      } else {
        this.#fallbacks++;
        segment = centrePath(Int32Array.of(a.x, a.y, b.x, b.y));
      }
      this.#segmentStart.push(this.#total);
      this.#segments.push(segment);
      this.#total += segment.length;
    }
  }

  /** Writes the pose at city time `t` (milliminutes) into `out`. */
  poseAt(t: number, out: BodyPose): void {
    this.#ensurePaths();
    const instants = this.#instants;
    const last = instants.length - 1;
    out.floor = this.#floor;
    out.moving = false;
    out.headingX = 0;
    out.headingY = 0;
    const first = this.#segments[0] as SegmentPath;
    if (last === 0 || t < (instants[0] as number)) {
      out.x = first.points[0] as number;
      out.y = first.points[1] as number;
      out.distance = 0;
      return;
    }
    if (t >= (instants[last] as number)) {
      const tail = this.#segments[last - 1] as SegmentPath;
      out.x = tail.points[tail.points.length - 2] as number;
      out.y = tail.points[tail.points.length - 1] as number;
      out.distance = this.#total;
      return;
    }
    let s = this.#cursor;
    if (s > last - 1) s = last - 1;
    while (s > 0 && t < (instants[s] as number)) s--;
    while (s < last - 1 && t >= (instants[s + 1] as number)) s++;
    this.#cursor = s;

    const segment = this.#segments[s] as SegmentPath;
    const a = instants[s] as number;
    const b = instants[s + 1] as number;
    const along = (segment.length * (t - a)) / (b - a);
    const pts = segment.points;
    let remaining = along;
    let i = 0;
    let ex = 0;
    let ey = 0;
    let edge = 0;
    for (; i + 3 < pts.length; i += 2) {
      ex = (pts[i + 2] as number) - (pts[i] as number);
      ey = (pts[i + 3] as number) - (pts[i + 1] as number);
      edge = Math.hypot(ex, ey);
      if (remaining <= edge || i + 5 >= pts.length) break;
      remaining -= edge;
    }
    if (edge === 0) {
      out.x = pts[0] as number;
      out.y = pts[1] as number;
    } else {
      const f = Math.min(1, remaining / edge);
      out.x = (pts[i] as number) + ex * f;
      out.y = (pts[i + 1] as number) + ey * f;
      out.headingX = ex / edge;
      out.headingY = ey / edge;
    }
    out.distance = (this.#segmentStart[s] as number) + along;
    out.moving = edge !== 0;
  }
}
