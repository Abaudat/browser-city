// Every ledger-driven citizen on the street, posed through one entry point:
// its ledger frame from `l3/` (pose, walk or idle frame, flavour), then every
// sidestep from one `AvoidanceField`. A citizen cannot be drawn outside it, so
// none can miss the avoidance or the flavour (FR64, FR65). Zero PixiJS; the
// layers that draw read `frame` and `offset`. Until L2 exists the timetables are
// fixture data (story 5.5 deletes them).

import type { Defs, Family } from "../defs/types";
import {
  AvoidanceField,
  type AvoidDials,
  type HeldPredicate,
  type HeldRect,
} from "../l3/avoidance";
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
import { type BodyCandidate, type BodyZone, planBodies, zoneHoldsRect } from "../world/body-zone";
import { CHUNK_SIZE } from "../world/chunk";

/** No body zone (an agreement sample, a frozen crowd): every chunk counts as
 * held, the whole street being local data. */
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
  /** The composite-cache key of the citizen's look: its five stored indices
   * and the uniform override. Never re-derived from the id. */
  readonly look: string;
  /** Builds a fresh body and ledger for the agreement sample. */
  readonly remake: () => { body: CitizenBody; timetable?: LedgerSource };
  index: number;
}

/** What agreement needs of a citizen whether or not it has a body: its id,
 * its ledger and how to build a fresh body. */
export type LifeDeclared = Pick<
  LifeMember,
  "id" | "remake" | "timetable" | "stand" | "standAt" | "look"
>;

export interface LifeSample {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly activity: string;
  readonly frameIndex: number;
  readonly facing: string;
  readonly offsetX: number;
  readonly offsetY: number;
  /** Whether the offset is one every client agrees on (see
   * `AvoidanceField.agreed`): only those are compared between bubbles. */
  readonly agreed: boolean;
  /** The look: what must be identical on every client and every respawn. */
  readonly look: string;
}

export function standState(node: { x: number; y: number }, floor: number, facing: Facing): AtState {
  return { kind: "at", node: { x: node.x, y: node.y, floor }, facing };
}

export class StreetLife {
  readonly #dials: AvoidDials;
  /** The same dials with chunks as small as a sidestep's reach, so "held"
   * is judged against the body zone to within a few cells. */
  readonly #zoneDials: AvoidDials;
  #zone: BodyZone | undefined;
  /** The instant of the last `solve`: what `liveAt` puts back. */
  #lastT: number | undefined;
  readonly #zoneHeld: HeldRect = {
    rect: (floor, x0, y0, x1, y1) =>
      this.#zone === undefined || zoneHoldsRect(this.#zone, floor, x0, y0, x1, y1),
  };
  readonly #walk: Walkability;
  /** Citizens with a body: what `solve` poses and sidesteps. */
  readonly #members: LifeMember[] = [];
  /** Every citizen of the street, with a body or not: what `agreementAt`
   * samples, so it never depends on who is near a viewport. */
  readonly #declared = new Map<string, LifeDeclared>();
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
    this.#zoneDials = {
      ...this.#dials,
      chunkSize: Math.ceil(config.avoidRadiusCells),
      strayCells: config.marginCells,
    };
  }

  /** Registers a citizen with a body; returns it. It is also declared. */
  add(member: Omit<LifeMember, "index" | "frame">): LifeMember {
    const full: LifeMember = { ...member, frame: createCitizenFrame(), index: -1 };
    this.#members.push(full);
    this.declare(full);
    return full;
  }

  /** Declares a citizen that may never have a body: it is sampled for
   * agreement only. */
  declare(entry: LifeDeclared): void {
    this.#declared.set(entry.id, {
      id: entry.id,
      remake: entry.remake,
      timetable: entry.timetable,
      stand: entry.stand,
      standAt: entry.standAt,
      look: entry.look,
    });
    this.#scratch = undefined;
  }

  /** Poses one body alone at `t` (its ledger frame, no sidestep), so a body
   * is built at the position its ledger says it has at its spawn instant. */
  pose(member: LifeMember, t: number): void {
    poseMember(member, t);
  }

  /** Drops a body: it stops being posed and sidestepped; it stays declared. */
  remove(member: LifeMember): void {
    const i = this.#members.indexOf(member);
    if (i >= 0) this.#members.splice(i, 1);
  }

  get members(): readonly LifeMember[] {
    return this.#members;
  }

  get field(): AvoidanceField {
    return this.#field;
  }

  /** Poses every citizen at city time `t` and resolves every sidestep. With
   * a body `zone`, only a body whose whole neighbourhood is inside the zone's
   * spawn rect sidesteps -- there every neighbour has a body on every client,
   * so the offset does not depend on the bubble; outside it the body walks
   * its ledger line (off screen, in the margin). */
  solve(t: number, zone?: BodyZone): void {
    this.#zone = zone;
    this.#lastT = t;
    this.#run(this.#members, t, this.#field);
  }

  #run(members: readonly LifeMember[], t: number, field: AvoidanceField): void {
    if (this.#zone) {
      solveAll(members, t, field, this.#zoneDials, this.#walk, this.#zoneHeld);
    } else {
      solveAll(members, t, field, this.#dials, this.#walk, ALL_CHUNKS_HELD);
    }
  }

  /** The sidestep of `member` as of the last `solve`. */
  offsetX(member: LifeMember): number {
    return this.#field.offsetX(member.index);
  }

  offsetY(member: LifeMember): number {
    return this.#field.offsetY(member.index);
  }

  /** The bodies this client would hold at `t`, solved there, sorted by id:
   * its bodies the zone keeps at `t`, and a fresh body for every citizen the
   * zone would spawn -- what a frame at `t` would draw. What the e2e
   * divergence check compares between two clients whose bubbles differ. A
   * read, not a step: afterwards the poses and the field are put back to the
   * last `solve`, so nothing the next frame draws from changes. */
  liveAt(t: number): readonly LifeSample[] {
    const members = this.#zone ? this.#heldAt(t, this.#zone) : this.#members;
    this.#run(members, t, this.#field);
    const sample = sampleOf(members, this.#field);
    if (this.#lastT !== undefined) this.#run(this.#members, this.#lastT, this.#field);
    return sample;
  }

  #heldAt(t: number, zone: BodyZone): readonly LifeMember[] {
    const scratch = this.#scratchMembers();
    const candidates: BodyCandidate[] = scratch.map((m) => {
      poseMember(m, t);
      return { id: m.id, x: m.frame.x, y: m.frame.y, floor: m.frame.floor };
    });
    const plan = planBodies(new Set(this.#members.map((m) => m.id)), candidates, zone);
    const keep = new Set(plan.keep);
    const spawn = new Set(plan.spawn);
    return [
      ...this.#members.filter((m) => keep.has(m.id)),
      ...scratch.filter((m) => spawn.has(m.id)),
    ];
  }

  #scratchMembers(): LifeMember[] {
    if (!this.#scratch) {
      this.#scratch = {
        members: [...this.#declared.values()].map((m) => ({
          ...m,
          ...m.remake(),
          frame: createCitizenFrame(),
          index: -1,
        })),
        field: new AvoidanceField(),
      };
    }
    return this.#scratch.members;
  }

  /** Every citizen's agreed state at `t`, computed from scratch with fresh
   * bodies, sorted by id: citizens mount in whatever order their textures
   * arrive. */
  agreementAt(t: number): readonly LifeSample[] {
    const members = this.#scratchMembers();
    const field = (this.#scratch as { field: AvoidanceField }).field;
    solveAll(members, t, field, this.#dials, this.#walk, ALL_CHUNKS_HELD);
    return sampleOf(members, field);
  }
}

function sampleOf(members: readonly LifeMember[], field: AvoidanceField): readonly LifeSample[] {
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
      agreed: field.agreed(m.index),
      look: m.look,
    }));
}

function poseMember(m: LifeMember, t: number): void {
  const f = m.frame;
  if (m.timetable) {
    m.body.frameAt(m.timetable.stateAt(t), t, f);
  } else {
    m.body.frameAt(m.stand as AtState, t, f);
    if (m.standAt) {
      f.x = m.standAt.x;
      f.y = m.standAt.y;
      f.anchorX = f.x;
      f.anchorY = f.y;
    }
  }
}

function solveAll(
  members: readonly LifeMember[],
  t: number,
  field: AvoidanceField,
  dials: AvoidDials,
  walk: Walkability,
  held: HeldPredicate | HeldRect,
): void {
  field.reset();
  for (const m of members) {
    poseMember(m, t);
    const f = m.frame;
    m.index = field.add(
      m.id,
      f.x,
      f.y,
      f.floor,
      f.headingX,
      f.headingY,
      f.moving,
      f.ramp,
      f.speed,
      f.anchorX,
      f.anchorY,
    );
  }
  field.resolve(dials, walk, held);
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
