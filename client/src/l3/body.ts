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
 * cells, on the taut route between tile centres. */
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
  /** Cells to the nearest end of the current edge, so the nearest corner of
   * the walked path or end of the leg; 0 when not moving. */
  vertexDistance: number;
}

export function createBodyPose(): BodyPose {
  return {
    x: 0,
    y: 0,
    floor: 0,
    moving: false,
    distance: 0,
    headingX: 0,
    headingY: 0,
    vertexDistance: 0,
  };
}

/** The straight-line distance between two waypoints. The square root of an
 * integer sum is correctly rounded, so every client computes the same value. */
function straight(a: Cell, b: Cell): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function routeStraight(leg: Leg): number {
  let total = 0;
  for (let i = 1; i < leg.waypoints.length; i++) {
    total += straight(leg.waypoints[i - 1] as Cell, leg.waypoints[i] as Cell);
  }
  return total;
}

/** Each waypoint's integer instant: the leg duration shared by cumulative
 * straight-line distance between waypoints, floor division. Depends on the
 * route alone, never on walkability, so every client agrees which segment a
 * citizen is on; on open ground every segment is then walked at one pace. */
export function legInstants(leg: Leg): number[] {
  const duration = Math.max(0, leg.arriveAt - leg.departAt);
  const total = routeStraight(leg);
  const instants = [leg.departAt];
  let cumulative = 0;
  for (let i = 1; i < leg.waypoints.length; i++) {
    cumulative += straight(leg.waypoints[i - 1] as Cell, leg.waypoints[i] as Cell);
    if (total === 0) instants.push(leg.departAt);
    else if (i === leg.waypoints.length - 1) instants.push(leg.departAt + duration);
    else instants.push(leg.departAt + Math.floor((duration * cumulative) / total));
  }
  return instants;
}

interface SegmentPath {
  /** x0, y0, x1, y1, ... the taut route through tile centres. */
  readonly points: Float64Array;
  /** Walked length from the first point to each point. */
  readonly along: Float64Array;
  readonly length: number;
}

function segmentLength(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

function buildSegment(points: Float64Array): SegmentPath {
  const along = new Float64Array(points.length / 2);
  for (let i = 1; i < along.length; i++) {
    along[i] =
      (along[i - 1] as number) +
      segmentLength(
        (points[i * 2] as number) - (points[i * 2 - 2] as number),
        (points[i * 2 + 1] as number) - (points[i * 2 - 1] as number),
      );
  }
  return { points, along, length: along[along.length - 1] as number };
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
  #edge = 0;
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
      this.#segments.push(buildSegment(Float64Array.of(only.x + 0.5, only.y + 0.5)));
      this.#segmentStart.push(0);
      return;
    }
    for (let i = 1; i < waypoints.length; i++) {
      const a = waypoints[i - 1] as Cell;
      const b = waypoints[i] as Cell;
      this.#searches++;
      const found = findMicroPath(
        walkable,
        a,
        b,
        this.#path.marginCells,
        this.#path.nodeBudget,
        this.#path.maxCells,
      );
      let segment: SegmentPath;
      if (found.ok) {
        segment = buildSegment(found.route);
      } else {
        this.#fallbacks++;
        segment = buildSegment(Float64Array.of(a.x + 0.5, a.y + 0.5, b.x + 0.5, b.y + 0.5));
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
    // A time that is not a number is before the leg: the origin, standing.
    if (!Number.isFinite(t)) t = Number.NEGATIVE_INFINITY;
    out.floor = this.#floor;
    out.moving = false;
    out.headingX = 0;
    out.headingY = 0;
    out.vertexDistance = 0;
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
    const d = (segment.length * (t - a)) / (b - a);
    const pts = segment.points;
    const along = segment.along;
    const edges = along.length - 1;
    out.distance = (this.#segmentStart[s] as number) + d;
    if (edges < 1) {
      out.x = pts[0] as number;
      out.y = pts[1] as number;
      return;
    }
    let e = Math.min(this.#edge, edges - 1);
    while (e > 0 && d < (along[e] as number)) e--;
    while (e < edges - 1 && d > (along[e + 1] as number)) e++;
    this.#edge = e;
    const ex = (pts[e * 2 + 2] as number) - (pts[e * 2] as number);
    const ey = (pts[e * 2 + 3] as number) - (pts[e * 2 + 1] as number);
    const edge = (along[e + 1] as number) - (along[e] as number);
    const f = Math.min(1, (d - (along[e] as number)) / edge);
    out.x = (pts[e * 2] as number) + ex * f;
    out.y = (pts[e * 2 + 1] as number) + ey * f;
    out.headingX = ex / edge;
    out.headingY = ey / edge;
    out.vertexDistance = Math.min(d - (along[e] as number), (along[e + 1] as number) - d);
    out.moving = true;
  }

  /** The pace each segment is actually walked at, in cells per real second:
   * its walked length over its own interval. Infinity for a segment given no
   * time; 0 for one with nowhere to go. */
  walkedPaces(msPerMilliminute: number): number[] {
    this.#ensurePaths();
    return this.#segments.map((segment, i) => {
      if (segment.length === 0) return 0;
      const interval = (this.#instants[i + 1] as number) - (this.#instants[i] as number);
      if (interval <= 0) return Number.POSITIVE_INFINITY;
      return segment.length / ((interval * msPerMilliminute) / 1000);
    });
  }

  /** Whether every segment is walked inside canonical walking speed +/- the
   * band. A leg outside it is a defect in whoever issued it; the body still
   * arrives when the leg says. */
  paceWithinBand(
    msPerMilliminute: number,
    config: Pick<L3Config, "walkCellsPerS" | "paceBandPercent">,
  ): boolean {
    const slack = config.walkCellsPerS * (config.paceBandPercent / 100);
    return this.walkedPaces(msPerMilliminute).every(
      (pace) =>
        pace === 0 ||
        (pace >= config.walkCellsPerS - slack && pace <= config.walkCellsPerS + slack),
    );
  }
}
