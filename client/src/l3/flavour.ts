// Flavour (FR65): the small life of a standing citizen -- an idle row that
// plays on city time and now and then a glance. A pure function of an id, the
// city time handed in and the rest facing; nothing is stored, so a client
// joining mid-glance draws what one that watched it start draws. It writes
// frame and facing only, never a position, and means nothing to the ledger.

import type { Facing } from "./gait";
import { SALTS, seedOf, unitOf } from "./seed";

export interface FlavourDials {
  /** A citizen resolves one draw per bucket this long (milliminutes). */
  readonly bucketMilliminutes: number;
  /** The share of buckets that resolve to a glance. */
  readonly glancePercent: number;
  readonly glanceMilliminutes: number;
  readonly idleFrameMilliminutes: number;
  /** Frames in one direction of the idle row. */
  readonly idleFrames: number;
}

export type FlavourKind = "none" | "glance";

export interface FlavourFrame {
  direction: Facing;
  frameIndex: number;
  glancing: boolean;
}

export function createFlavourFrame(): FlavourFrame {
  return { direction: "down", frameIndex: 0, glancing: false };
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

/** What a bucket resolves to: a function of the id and the bucket alone. */
export function flavourKindOf(id: string, bucket: number, dials: FlavourDials): FlavourKind {
  return unitOf(id, SALTS.flavour, bucket) * PERCENT < dials.glancePercent ? "glance" : "none";
}

/** Writes the frame a citizen standing at `t` shows. `until` is the instant
 * its next leg departs: a glance that would not end before it is not drawn. */
export function flavourAt(
  id: string,
  t: number,
  rest: Facing,
  dials: FlavourDials,
  until: number,
  out: FlavourFrame,
): void {
  const phase = seedOf(id, SALTS.idlePhase) % (dials.idleFrames * dials.idleFrameMilliminutes);
  out.frameIndex = Math.floor((t + phase) / dials.idleFrameMilliminutes) % dials.idleFrames;
  out.direction = rest;
  out.glancing = false;

  const bucket = flavourBucketOf(id, t, dials);
  if (flavourKindOf(id, bucket, dials) !== "glance") return;
  const room = Math.max(0, dials.bucketMilliminutes - dials.glanceMilliminutes);
  const bucketStart = bucket * dials.bucketMilliminutes - bucketOffset(id, dials);
  const start = bucketStart + Math.floor(unitOf(id, SALTS.flavourStart, bucket) * room);
  const end = start + dials.glanceMilliminutes;
  if (t < start || t >= end || end > until) return;
  let pick = seedOf(id, SALTS.glanceFacing, bucket) % (FACINGS.length - 1);
  for (const facing of FACINGS) {
    if (facing === rest) continue;
    if (pick === 0) {
      out.direction = facing;
      break;
    }
    pick--;
  }
  out.glancing = true;
}
