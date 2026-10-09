// Flavour (FR65): the small life of a standing citizen -- an idle row that
// plays on city time and now and then a glance. A pure function of an id, the
// city time handed in and the rest facing; nothing is stored, so a client
// joining mid-glance draws what one that watched it start draws. It writes
// frame and facing only, never a position, and means nothing to the ledger.

import type { Facing } from "./gait";
import { SALTS, seedOf, unitOf } from "./seed";

/** One flavour a standing citizen can show: a row of the catalogue. A row is
 * eligible for a citizen only if every composed layer has `animation`. */
export interface FlavourRow {
  readonly id: string;
  /** The share of buckets (percent) that resolve to this row. */
  readonly weightPercent: number;
  readonly durationMilliminutes: number;
  /** The appearance-layout animation it plays. */
  readonly animation: string;
  /** Face away from the rest facing, or keep it. */
  readonly facing: "away" | "rest";
}

export interface FlavourDials {
  /** A citizen resolves one draw per bucket this long (milliminutes). */
  readonly bucketMilliminutes: number;
  readonly idleFrameMilliminutes: number;
  readonly rows: readonly FlavourRow[];
  /** Frames in one direction of every animation all of the citizen's layers
   * have: a row is eligible only if its animation is a key here. */
  readonly frames: Readonly<Record<string, number>>;
}

/** What a bucket resolves to: a row's id, or this for nothing. */
export const NO_FLAVOUR = "";

export interface FlavourFrame {
  animation: string;
  direction: Facing;
  frameIndex: number;
  /** The id of the row being shown, or `NO_FLAVOUR`. */
  flavour: string;
}

export function createFlavourFrame(): FlavourFrame {
  return { animation: "idle", direction: "down", frameIndex: 0, flavour: NO_FLAVOUR };
}

const FACINGS: readonly Facing[] = ["down", "up", "left", "right"];
const PERCENT = 100;

/** Each citizen's own offset into the bucket grid, so a crowd's boundaries
 * never line up. */
function bucketOffset(id: string, dials: FlavourDials): number {
  return seedOf(id, SALTS.flavourOffset) % dials.bucketMilliminutes;
}

/** The citizen's bucket at city time `t`. */
export function flavourBucketOf(id: string, t: number, dials: FlavourDials): number {
  return Math.floor((t + bucketOffset(id, dials)) / dials.bucketMilliminutes);
}

/** The row a bucket resolves to, or `NO_FLAVOUR`: a weighted draw over the
 * eligible rows, a function of the id and the bucket alone. */
export function flavourKindOf(id: string, bucket: number, dials: FlavourDials): string {
  const draw = unitOf(id, SALTS.flavour, bucket) * PERCENT;
  let upTo = 0;
  for (const row of dials.rows) {
    if (dials.frames[row.animation] === undefined) continue;
    upTo += row.weightPercent;
    if (draw < upTo) return row.id;
  }
  return NO_FLAVOUR;
}

/** Writes the frame a citizen standing at `t` shows. `until` is the instant
 * its next leg departs: a flavour that would not end before it is not drawn. */
export function flavourAt(
  id: string,
  t: number,
  rest: Facing,
  dials: FlavourDials,
  until: number,
  out: FlavourFrame,
): void {
  const idleFrames = dials.frames.idle ?? 1;
  const phase = seedOf(id, SALTS.idlePhase) % (idleFrames * dials.idleFrameMilliminutes);
  out.animation = "idle";
  out.frameIndex = Math.floor((t + phase) / dials.idleFrameMilliminutes) % idleFrames;
  out.direction = rest;
  out.flavour = NO_FLAVOUR;

  const bucket = flavourBucketOf(id, t, dials);
  const kind = flavourKindOf(id, bucket, dials);
  if (kind === NO_FLAVOUR) return;
  const row = dials.rows.find((r) => r.id === kind);
  if (!row) return;
  const room = Math.max(0, dials.bucketMilliminutes - row.durationMilliminutes);
  const bucketStart = bucket * dials.bucketMilliminutes - bucketOffset(id, dials);
  const start = bucketStart + Math.floor(unitOf(id, SALTS.flavourStart, bucket) * room);
  const end = start + row.durationMilliminutes;
  if (t < start || t >= end || end > until) return;
  const frames = dials.frames[row.animation] as number;
  out.animation = row.animation;
  out.frameIndex = Math.floor((t - start) / dials.idleFrameMilliminutes) % frames;
  out.flavour = row.id;
  if (row.facing === "rest") return;
  let pick = seedOf(id, SALTS.glanceFacing, bucket) % (FACINGS.length - 1);
  for (const facing of FACINGS) {
    if (facing === rest) continue;
    if (pick === 0) {
      out.direction = facing;
      break;
    }
    pick--;
  }
}
