// The one function from a citizen state and city time to the frame to draw
// (FR56, FR64). The state is FR56's: `At(node)` or `InTransit(route, t_depart,
// t_arrive)`. Pose comes from `Body`, the walk frame from distance walked, the
// facing from the path; nothing here reads a clock or keeps a position.

import { rampOf } from "./avoidance";
import { Body, type BodyPose, type Cell, createBodyPose, type Leg } from "./body";
import type { L3Config } from "./config";
import {
  createFlavourFrame,
  type FlavourDials,
  type FlavourFrame,
  flavourAt,
  NO_FLAVOUR,
} from "./flavour";
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
  animation: string;
  direction: Facing;
  frameIndex: number;
  /** Cells walked along the current leg (0 when standing at a node). */
  distance: number;
  /** Which leg this frame belongs to (0 for a node). */
  legKey: number;
  departAt: number;
  arriveAt: number;
  /** Whether the body is walking a leg, and its unit heading (0, 0 when not):
   * what avoidance needs, never what facing is drawn from. */
  moving: boolean;
  headingX: number;
  headingY: number;
  /** Cells per milliminute along its edge (0 when standing). */
  speed: number;
  /** How far into its sidestep a walker is: 0 at both ends of a leg. */
  ramp: number;
  /** The flavour a standing citizen is showing (`NO_FLAVOUR` for none). */
  flavour: string;
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
    moving: false,
    headingX: 0,
    headingY: 0,
    ramp: 0,
    speed: 0,
    flavour: NO_FLAVOUR,
  };
}

/** What a citizen's life on screen needs besides its pose: the flavour dials
 * and the distance over which a sidestep eases in from either end of an edge
 * of its path. Every body driven by a ledger leg has them. */
export interface LifeDials extends FlavourDials {
  readonly rampCells: number;
}

export interface GaitDials {
  readonly strideCells: number;
  readonly framesPerCycle: number;
}

/** What a citizen's body says about itself for the debug tooling. */
export interface CitizenDiagnostics {
  /** Segments walked straight for want of a path. */
  readonly fallbacks: number;
  /** Some segment is walked outside the walking-pace band. */
  readonly paceOutOfBand: boolean;
}

/** One citizen's body: the cache of the leg it is on and nothing else. */
export class CitizenBody {
  readonly #walk: Walkability;
  readonly #path: PathConfig;
  readonly #gait: GaitDials;
  readonly #phase: number;
  readonly #id: string;
  readonly #life: LifeDials;
  readonly #flavourFrame: FlavourFrame = createFlavourFrame();
  readonly #pose: BodyPose = createBodyPose();
  #body: Body | undefined;
  #key = Number.NaN;

  /** A standing citizen plays its idle row on city time and now and then a
   * flavour; a walker's sidestep eases from `life.rampCells`. */
  constructor(
    walk: Walkability,
    path: PathConfig,
    gait: GaitDials,
    citizenId: string,
    life: LifeDials,
  ) {
    this.#id = citizenId;
    this.#life = life;
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

  /** Standing: the idle row and, now and then, a glance. `until` is the
   * instant the next leg departs. */
  #stand(facing: Facing, t: number, until: number, out: CitizenFrame): void {
    out.animation = "idle";
    out.direction = facing;
    out.frameIndex = 0;
    out.moving = false;
    out.headingX = 0;
    out.headingY = 0;
    out.ramp = 0;
    out.speed = 0;
    const f = this.#flavourFrame;
    flavourAt(this.#id, t, facing, this.#life, until, f);
    out.animation = f.animation;
    out.direction = f.direction;
    out.frameIndex = f.frameIndex;
    out.flavour = f.flavour;
  }

  /** Writes the frame to draw for `state` at city time `t` (milliminutes). */
  frameAt(state: CitizenState, t: number, out: CitizenFrame): void {
    if (state.kind === "at") {
      out.x = state.node.x + 0.5;
      out.y = state.node.y + 0.5;
      out.floor = state.node.floor;
      out.distance = 0;
      out.legKey = 0;
      out.departAt = 0;
      out.arriveAt = 0;
      this.#stand(state.facing, t, Number.POSITIVE_INFINITY, out);
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
      out.moving = true;
      out.flavour = NO_FLAVOUR;
      out.headingX = pose.headingX;
      out.headingY = pose.headingY;
      out.ramp = rampOf(pose.vertexDistance, this.#life.rampCells);
      out.speed = pose.speed;
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
    const arrived = t >= state.leg.arriveAt;
    this.#stand(
      arrived ? state.endFacing : state.startFacing,
      t,
      arrived ? Number.POSITIVE_INFINITY : state.leg.departAt,
      out,
    );
  }

  /** The current body's diagnostics, or none while not on a leg. */
  diagnostics(
    msPerMilliminute: number,
    band: Pick<L3Config, "walkCellsPerS" | "paceBandPercent">,
  ): CitizenDiagnostics | undefined {
    const body = this.#body;
    if (!body) return undefined;
    return {
      fallbacks: body.fallbackCount,
      paceOutOfBand: !body.paceWithinBand(msPerMilliminute, band),
    };
  }
}
