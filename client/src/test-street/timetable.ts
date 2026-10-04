// A fixture standing in for L2 (story 5.5 deletes it): one citizen's
// deterministic timetable over city time, out along a route and back, standing
// between legs. It is data only -- it says which `InTransit` leg holds at a
// given time. Every pose, frame and facing comes from `l3/`. Zero PixiJS.

import { Body, type Cell, type Leg } from "../l3/body";
import type { TransitState } from "../l3/citizen";
import type { L3Config } from "../l3/config";
import type { Facing } from "../l3/gait";
import type { PathConfig, Walkability } from "../l3/micro-path";
import { milliminutesFor, periodOf } from "../l3/timeline";

export interface TimetableSpec {
  /** The route out; the way back is its reverse. */
  readonly out: readonly Cell[];
  /** Real milliseconds spent standing at each end before the next leg. */
  readonly dwellMs: number;
  /** Facing at the first node, and at the last. */
  readonly homeFacing: Facing;
  readonly outFacing: Facing;
}

export class Timetable {
  /** All in milliminutes. */
  readonly walkMilli: number;
  readonly dwellMilli: number;
  readonly halfMilli: number;
  readonly periodMilli: number;
  readonly #out: readonly Cell[];
  readonly #back: readonly Cell[];
  readonly #spec: TimetableSpec;
  #key = Number.NaN;
  #state: TransitState | undefined;

  /** The walk is sized so the route is walked at canonical pace over the
   * tiles it actually takes on `walk`. */
  constructor(spec: TimetableSpec, config: L3Config, walk: Walkability, path: PathConfig) {
    const msPerMilli = config.realMsPerCityMinute / 1000;
    const probe = new Body({ waypoints: spec.out, departAt: 0, arriveAt: 1 }, walk, path);
    this.walkMilli = milliminutesFor((probe.totalLength / config.walkCellsPerS) * 1000, msPerMilli);
    this.dwellMilli = milliminutesFor(spec.dwellMs, msPerMilli);
    this.halfMilli = 2 * this.dwellMilli + this.walkMilli;
    this.periodMilli = 2 * this.halfMilli;
    this.#spec = spec;
    this.#out = spec.out;
    this.#back = [...spec.out].reverse();
  }

  /** The leg in force at city time `t`: a pure function of `t`. The same
   * object is returned for as long as the leg holds. */
  stateAt(t: number): TransitState {
    const cycle = periodOf(t, this.periodMilli);
    const second = t - cycle * this.periodMilli >= this.halfMilli;
    const key = cycle * 2 + (second ? 1 : 0);
    if (key === this.#key && this.#state) return this.#state;
    const departAt = cycle * this.periodMilli + (second ? this.halfMilli : 0) + this.dwellMilli;
    const leg: Leg = {
      waypoints: second ? this.#back : this.#out,
      departAt,
      arriveAt: departAt + this.walkMilli,
    };
    this.#key = key;
    this.#state = {
      kind: "transit",
      key,
      leg,
      startFacing: second ? this.#spec.outFacing : this.#spec.homeFacing,
      endFacing: second ? this.#spec.homeFacing : this.#spec.outFacing,
    };
    return this.#state;
  }
}
