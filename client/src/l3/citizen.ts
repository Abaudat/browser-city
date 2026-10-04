// The one function from a citizen state and city time to the frame to draw
// (FR56, FR64). The state is FR56's: `At(node)` or `InTransit(route, t_depart,
// t_arrive)`. Pose comes from `Body`, the walk frame from distance walked, the
// facing from the path; nothing here reads a clock or keeps a position.

import { Body, type BodyPose, type Cell, createBodyPose, type Leg } from "./body";
import { type Facing, facingOfHeading, phaseOffsetFor, walkFrame } from "./gait";
import type { PathConfig, Walkability } from "./micro-path";

/** Standing at a node, facing the thing it is there for. */
export interface AtState {
  readonly kind: "at";
  readonly node: Cell;
  readonly facing: Facing;
}

/** A leg in progress or about to start or just finished: before depart the
 * citizen stands at the origin facing `startFacing`, from arrive on at the
 * destination facing `endFacing`. `key` tells one leg from the next. */
export interface TransitState {
  readonly kind: "transit";
  readonly key: number;
  readonly leg: Leg;
  readonly startFacing: Facing;
  readonly endFacing: Facing;
}

export type CitizenState = AtState | TransitState;

export interface CitizenFrame {
  x: number;
  y: number;
  floor: number;
  animation: "walk" | "idle";
  direction: Facing;
  frameIndex: number;
  /** Cells walked along the current leg (0 when standing at a node). */
  distance: number;
  /** Which leg this frame belongs to (0 for a node). */
  legKey: number;
  departAt: number;
  arriveAt: number;
}

export function createCitizenFrame(): CitizenFrame {
  return {
    x: 0,
    y: 0,
    floor: 0,
    animation: "idle",
    direction: "down",
    frameIndex: 0,
    distance: 0,
    legKey: 0,
    departAt: 0,
    arriveAt: 0,
  };
}

export interface GaitDials {
  readonly strideCells: number;
  readonly framesPerCycle: number;
}

/** What a citizen's body says about itself for the debug tooling. */
export interface CitizenDiagnostics {
  /** Segments walked straight for want of a path. */
  readonly fallbacks: number;
  /** Per-segment walked pace, cells per real second. */
  readonly paces: readonly number[];
}

/** One citizen's body: the cache of the leg it is on and nothing else. */
export class CitizenBody {
  readonly #walk: Walkability;
  readonly #path: PathConfig;
  readonly #gait: GaitDials;
  readonly #phase: number;
  readonly #pose: BodyPose = createBodyPose();
  #body: Body | undefined;
  #key = Number.NaN;

  constructor(walk: Walkability, path: PathConfig, gait: GaitDials, citizenId: string) {
    this.#walk = walk;
    this.#path = path;
    this.#gait = gait;
    this.#phase = phaseOffsetFor(citizenId);
  }

  /** Searches run by the current leg's body. */
  get searchCount(): number {
    return this.#body?.searchCount ?? 0;
  }

  /** The current leg's body, if the citizen is on one. */
  get body(): Body | undefined {
    return this.#body;
  }

  /** Writes the frame to draw for `state` at city time `t` (milliminutes). */
  frameAt(state: CitizenState, t: number, out: CitizenFrame): void {
    if (state.kind === "at") {
      out.x = state.node.x + 0.5;
      out.y = state.node.y + 0.5;
      out.floor = state.node.floor;
      out.animation = "idle";
      out.direction = state.facing;
      out.frameIndex = 0;
      out.distance = 0;
      out.legKey = 0;
      out.departAt = 0;
      out.arriveAt = 0;
      return;
    }
    if (state.key !== this.#key || !this.#body) {
      this.#key = state.key;
      this.#body = new Body(state.leg, this.#walk, this.#path);
    }
    const pose = this.#pose;
    this.#body.poseAt(t, pose);
    out.x = pose.x;
    out.y = pose.y;
    out.floor = pose.floor;
    out.distance = pose.distance;
    out.legKey = state.key;
    out.departAt = state.leg.departAt;
    out.arriveAt = state.leg.arriveAt;
    if (pose.moving) {
      out.animation = "walk";
      out.direction = facingOfHeading(pose.headingX, pose.headingY);
      out.frameIndex = walkFrame(
        pose.distance,
        this.#gait.strideCells,
        this.#phase,
        this.#gait.framesPerCycle,
      );
      return;
    }
    out.animation = "idle";
    out.direction = t >= state.leg.arriveAt ? state.endFacing : state.startFacing;
    out.frameIndex = 0;
  }

  /** The current body's diagnostics, or none while not on a leg. */
  diagnostics(msPerMilliminute: number): CitizenDiagnostics | undefined {
    const body = this.#body;
    if (!body) return undefined;
    return { fallbacks: body.fallbackCount, paces: body.walkedPaces(msPerMilliminute) };
  }
}
