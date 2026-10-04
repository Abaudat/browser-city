// A fixture standing in for L2 (story 5.5 deletes it): one citizen's
// deterministic timetable over city time, out along a route and back, standing
// `At(node)` between legs. It supplies data only -- the legs it hands L3 are
// `InTransit(route, t_depart, t_arrive)` records; every pose comes from
// `l3/`. Zero PixiJS.

import { Body, type BodyPose, type Cell, createBodyPose, type Leg } from "../l3/body";
import type { L3Config } from "../l3/config";
import { type Facing, FacingHold, facingOfHeading, phaseOffsetFor, walkFrame } from "../l3/gait";
import type { PathConfig, Walkability } from "../l3/micro-path";

/** Frames in one direction's walk row of a character sheet. */
export const WALK_FRAMES_PER_CYCLE = 6;

export interface TimetableSpec {
  /** The route out; the way back is its reverse. */
  readonly out: readonly Cell[];
  /** Cells the walk is longer than its Manhattan length, for going around
   * solid props. The leg duration is sized for the path actually walked. */
  readonly detourCells: number;
  /** Real milliseconds spent standing at each end before the next leg. */
  readonly dwellMs: number;
  readonly homeFacing: Facing;
  readonly outFacing: Facing;
}

export interface Timetable {
  readonly spec: TimetableSpec;
  /** Milliminutes. */
  readonly walkMilli: number;
  readonly dwellMilli: number;
  readonly halfMilli: number;
  readonly periodMilli: number;
}

export interface TimetableLeg {
  /** Distinct for every leg of the timetable. */
  readonly key: number;
  readonly leg: Leg;
  readonly startFacing: Facing;
  readonly endFacing: Facing;
}

function manhattanOf(route: readonly Cell[]): number {
  let n = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as Cell;
    const b = route[i] as Cell;
    n += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
  return n;
}

export function buildTimetable(spec: TimetableSpec, config: L3Config): Timetable {
  const msPerMilli = config.realMsPerCityMinute / 1000;
  const cells = manhattanOf(spec.out) + spec.detourCells;
  const walkMilli = Math.max(1, Math.round(((cells / config.walkCellsPerS) * 1000) / msPerMilli));
  const dwellMilli = Math.max(1, Math.round(spec.dwellMs / msPerMilli));
  const halfMilli = 2 * dwellMilli + walkMilli;
  return { spec, walkMilli, dwellMilli, halfMilli, periodMilli: 2 * halfMilli };
}

/** The leg in force at city time `t`: a pure function of `t`. */
export function legAt(timetable: Timetable, t: number): TimetableLeg {
  const { spec, periodMilli, halfMilli, dwellMilli, walkMilli } = timetable;
  const cycle = Math.floor(t / periodMilli);
  const second = t - cycle * periodMilli >= halfMilli;
  const departAt = cycle * periodMilli + (second ? halfMilli : 0) + dwellMilli;
  return {
    key: cycle * 2 + (second ? 1 : 0),
    leg: {
      waypoints: second ? [...spec.out].reverse() : spec.out,
      departAt,
      arriveAt: departAt + walkMilli,
    },
    startFacing: second ? spec.outFacing : spec.homeFacing,
    endFacing: second ? spec.homeFacing : spec.outFacing,
  };
}

export interface WalkerFrame {
  x: number;
  y: number;
  floor: number;
  /** Cells walked along the current leg, and which leg it is. */
  distance: number;
  legKey: number;
  departAt: number;
  arriveAt: number;
  animation: "walk" | "idle";
  direction: Facing;
  frameIndex: number;
}

export function createWalkerFrame(): WalkerFrame {
  return {
    x: 0,
    y: 0,
    floor: 0,
    distance: 0,
    legKey: 0,
    departAt: 0,
    arriveAt: 0,
    animation: "idle", direction: "down", frameIndex: 0 };
}

/** One citizen following a timetable through L3. Holds only caches and the
 * presentation facing; where it stands is a function of the time passed in. */
export class TimetableWalker {
  readonly #timetable: Timetable;
  readonly #walk: Walkability;
  readonly #path: PathConfig;
  readonly #config: L3Config;
  readonly #phase: number;
  readonly #hold: FacingHold;
  readonly #pose: BodyPose = createBodyPose();
  #body: Body | undefined;
  #key = Number.NaN;
  #facing: Facing;

  constructor(
    timetable: Timetable,
    walk: Walkability,
    path: PathConfig,
    config: L3Config,
    citizenId: string,
  ) {
    this.#timetable = timetable;
    this.#walk = walk;
    this.#path = path;
    this.#config = config;
    this.#phase = phaseOffsetFor(citizenId);
    this.#facing = timetable.spec.homeFacing;
    this.#hold = new FacingHold(config.facingHoldMs, this.#facing);
  }

  /** Searches run by the current leg's body (a test hook). */
  get searchCount(): number {
    return this.#body?.searchCount ?? 0;
  }

  /** Writes the frame to draw at city time `t` (milliminutes) into `out`. */
  frameAt(t: number, out: WalkerFrame): void {
    const current = legAt(this.#timetable, t);
    if (current.key !== this.#key || !this.#body) {
      this.#key = current.key;
      this.#body = new Body(current.leg, this.#walk, this.#path);
    }
    const pose = this.#pose;
    this.#body.poseAt(t, pose);
    out.x = pose.x;
    out.y = pose.y;
    out.floor = pose.floor;
    out.distance = pose.distance;
    out.legKey = current.key;
    out.departAt = current.leg.departAt;
    out.arriveAt = current.leg.arriveAt;
    if (pose.moving) {
      const nowMs = (t * this.#config.realMsPerCityMinute) / 1000;
      this.#facing = this.#hold.update(
        facingOfHeading(pose.headingX, pose.headingY, this.#facing),
        nowMs,
      );
      out.animation = "walk";
      out.direction = this.#facing;
      out.frameIndex = walkFrame(
        pose.distance,
        this.#config.strideCells,
        this.#phase,
        WALK_FRAMES_PER_CYCLE,
      );
      return;
    }
    this.#facing = t >= current.leg.arriveAt ? current.endFacing : current.startFacing;
    out.animation = "idle";
    out.direction = this.#facing;
    out.frameIndex = 0;
  }
}
