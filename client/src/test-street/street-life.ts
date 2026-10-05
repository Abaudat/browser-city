// Every ledger-driven citizen on the street, posed through one entry point:
// its ledger frame from `l3/` (pose, walk or idle frame, flavour), then every
// sidestep from one `AvoidanceField`. A citizen cannot be drawn outside it, so
// none can miss the avoidance or the flavour (FR64, FR65). Zero PixiJS; the
// layers that draw read `frame` and `offset`. Until L2 exists the timetables are
// fixture data (story 5.5 deletes them).

import type { Defs, Family } from "../defs/types";
import { AvoidanceField, type AvoidDials, type HeldPredicate } from "../l3/avoidance";
import {
  type AtState,
  type CitizenBody,
  type CitizenFrame,
  createCitizenFrame,
  type LifeDials,
  type TransitState,
} from "../l3/citizen";
import { framesByAnimation, type L3Config } from "../l3/config";
import type { Facing } from "../l3/gait";
import type { Walkability } from "../l3/micro-path";
import { CHUNK_SIZE } from "../world/chunk";

/** Every fixture is local data held whole, so every chunk counts as held. The
 * L2 caller (story 5.5) passes the subscription's held chunks instead. */
const ALL_CHUNKS_HELD: HeldPredicate = () => true;

/** What a citizen's ledger says at a city time. */
export interface LedgerSource {
  stateAt(t: number): TransitState;
}

export interface LifeMember {
  readonly id: string;
  readonly body: CitizenBody;
  readonly frame: CitizenFrame;
  /** A walker's legs; absent for a standing citizen. */
  readonly timetable?: LedgerSource;
  /** A standing citizen's state, built once. */
  readonly stand?: AtState;
  /** Where a standing citizen is drawn, when not on its tile's centre. */
  readonly standAt?: { readonly x: number; readonly y: number };
  /** Builds a fresh body and ledger for the agreement sample. */
  readonly remake: () => { body: CitizenBody; timetable?: LedgerSource };
  index: number;
}

export interface LifeSample {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly activity: string;
  readonly frameIndex: number;
  readonly facing: string;
  readonly offsetX: number;
  readonly offsetY: number;
}

export function standState(node: { x: number; y: number }, floor: number, facing: Facing): AtState {
  return { kind: "at", node: { x: node.x, y: node.y, floor }, facing };
}

export class StreetLife {
  readonly #dials: AvoidDials;
  readonly #walk: Walkability;
  readonly #members: LifeMember[] = [];
  readonly #field = new AvoidanceField();
  #scratch: { members: LifeMember[]; field: AvoidanceField } | undefined;

  constructor(config: L3Config, walk: Walkability) {
    this.#walk = walk;
    this.#dials = {
      radiusCells: config.avoidRadiusCells,
      clearanceCells: config.avoidClearanceCells,
      tieBandCells: config.avoidTieBandCells,
      maxNeighbours: config.avoidMaxNeighbours,
      halfWidthCells: config.bodyHalfWidthCells,
      chunkSize: CHUNK_SIZE,
    };
  }

  /** Registers a citizen; returns it. */
  add(member: Omit<LifeMember, "index" | "frame">): LifeMember {
    const full: LifeMember = { ...member, frame: createCitizenFrame(), index: -1 };
    this.#members.push(full);
    this.#scratch = undefined;
    return full;
  }

  get members(): readonly LifeMember[] {
    return this.#members;
  }

  get field(): AvoidanceField {
    return this.#field;
  }

  /** Poses every citizen at city time `t` and resolves every sidestep. */
  solve(t: number): void {
    solveAll(this.#members, t, this.#field, this.#dials, this.#walk);
  }

  /** The sidestep of `member` as of the last `solve`. */
  offsetX(member: LifeMember): number {
    return this.#field.offsetX(member.index);
  }

  offsetY(member: LifeMember): number {
    return this.#field.offsetY(member.index);
  }

  /** Every citizen's agreed state at `t`, computed from scratch with fresh
   * bodies, sorted by id: citizens mount in whatever order their textures
   * arrive. */
  agreementAt(t: number): readonly LifeSample[] {
    if (!this.#scratch) {
      this.#scratch = {
        members: this.#members.map((m) => ({
          ...m,
          ...m.remake(),
          frame: createCitizenFrame(),
          index: -1,
        })),
        field: new AvoidanceField(),
      };
    }
    const { members, field } = this.#scratch;
    solveAll(members, t, field, this.#dials, this.#walk);
    return [...members]
      .sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))
      .map((m) => ({
        id: m.id,
        x: m.frame.x,
        y: m.frame.y,
        activity: m.frame.animation === "walk" ? "walk" : m.frame.flavour || "idle",
        frameIndex: m.frame.frameIndex,
        facing: m.frame.direction,
        offsetX: field.offsetX(m.index),
        offsetY: field.offsetY(m.index),
      }));
  }
}

function solveAll(
  members: readonly LifeMember[],
  t: number,
  field: AvoidanceField,
  dials: AvoidDials,
  walk: Walkability,
): void {
  field.reset();
  for (const m of members) {
    const f = m.frame;
    if (m.timetable) {
      m.body.frameAt(m.timetable.stateAt(t), t, f);
    } else {
      m.body.frameAt(m.stand as AtState, t, f);
      if (m.standAt) {
        f.x = m.standAt.x;
        f.y = m.standAt.y;
      }
    }
    m.index = field.add(m.id, f.x, f.y, f.floor, f.headingX, f.headingY, f.moving, f.ramp);
  }
  field.resolve(dials, walk, ALL_CHUNKS_HELD);
}

/** The life dials of a citizen of `family`: flavour rows, the frames each of
 * its animations has, and the sidestep ramp. */
export function lifeDialsFor(defs: Defs, config: L3Config, family: Family): LifeDials {
  return {
    bucketMilliminutes: config.flavourBucketMilliminutes,
    idleFrameMilliminutes: config.idleFrameMilliminutes,
    rows: config.flavourRows,
    frames: framesByAnimation(defs, family),
    rampCells: config.avoidRampCells,
  };
}
