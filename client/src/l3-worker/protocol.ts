// The L3 worker's wire format (D-L3, story 5.24): what the main thread sends
// the solver and what comes back. Plain data only, so it crosses a
// MessagePort by structured clone; the per-frame traffic is one transferred
// `ArrayBuffer` whose layout is below.

import type { AtState, LifeDials } from "../l3/citizen";
import type { L3Config } from "../l3/config";
import type { LifeSample } from "../test-street/street-life";
import type { TimetableSpec } from "../test-street/timetable";

/** One citizen of the street, with or without a body. */
export interface CitizenInit {
  readonly id: string;
  /** A walker's legs; absent for a standing citizen. */
  readonly spec?: TimetableSpec;
  /** The ledger's walk time in milliminutes, as the main thread's own
   * timetable measured it: the solver's timetable must agree with it. */
  readonly walkMilli?: number;
  readonly stand?: AtState;
  readonly standAt?: { readonly x: number; readonly y: number };
  readonly look: string;
  readonly life: LifeDials;
  readonly gait: { readonly strideCells: number; readonly framesPerCycle: number };
}

/** One chunk of the walkability mirror: `blocked[i]` is 1 for a blocked cell
 * (row-major, chunk-size cells a side); `null` frees the chunk. */
export interface WalkChunk {
  readonly floor: number;
  readonly cx: number;
  readonly cy: number;
  readonly blocked: Uint8Array | null;
}

export type ToWorker =
  | { readonly type: "init"; readonly config: L3Config }
  /** Citizens that may have a body: each is sampled for agreement. */
  | { readonly type: "declare"; readonly citizens: readonly CitizenInit[] }
  | { readonly type: "walk"; readonly chunks: readonly WalkChunk[] }
  | { readonly type: "add"; readonly id: string; readonly slot: number }
  | { readonly type: "remove"; readonly slot: number }
  /** Solve the instant in the buffer's header; the buffer comes back filled. */
  | { readonly type: "tick"; readonly buf: ArrayBuffer }
  | {
      readonly type: "query";
      readonly kind: "live" | "agreement";
      readonly id: number;
      readonly t: number;
    }
  /** `query` for many instants in one round trip. */
  | {
      readonly type: "queryMany";
      readonly kind: "live" | "agreement";
      readonly id: number;
      readonly ts: readonly number[];
    }
  | {
      readonly type: "sweep";
      readonly id: number;
      readonly start: number;
      readonly step: number;
      readonly frames: number;
    }
  | { readonly type: "calibrate"; readonly id: number; readonly runs: number };

export type FromWorker =
  | {
      readonly type: "result";
      readonly buf: ArrayBuffer;
      /** The interned strings the buffer's indices point into, when they grew. */
      readonly names?: readonly string[];
    }
  | { readonly type: "reply"; readonly id: number; readonly samples: readonly LifeSample[] }
  | {
      readonly type: "replyMany";
      readonly id: number;
      readonly samples: readonly (readonly LifeSample[])[];
    }
  | { readonly type: "swept"; readonly id: number; readonly solveMs: Float64Array }
  | { readonly type: "calibrated"; readonly id: number; readonly ms: number };

/** The slice of a `MessagePort`/`Worker` the client and the solver use. */
export interface Port<In, Out> {
  postMessage(message: Out, transfer?: Transferable[]): void;
  onmessage: ((event: { data: In }) => void) | null;
}

// ---- the tick buffer (Float64Array): header, then one record per slot ----

export const HEADER_DOUBLES = 16;
export const H_T = 0;
export const H_HAS_ZONE = 1;
/** spawn x0, y0, x1, y1 then despawn x0, y0, x1, y1. */
export const H_SPAWN = 2;
export const H_DESPAWN = 6;
export const H_STOREY = 10;
export const H_BAND = 11;
/** Out: the solve's own time inside the worker, in ms. */
export const H_SOLVE_MS = 12;
/** In: 1 while the main thread wants diagnostics refreshed. */
export const H_WANT_DIAG = 13;

export const R_PRESENT = 0;
export const R_X = 1;
export const R_Y = 2;
export const R_FLOOR = 3;
export const R_ANIMATION = 4;
export const R_DIRECTION = 5;
export const R_FRAME_INDEX = 6;
export const R_HEADING_X = 7;
export const R_HEADING_Y = 8;
export const R_MOVING = 9;
export const R_FLAVOUR = 10;
export const R_OFFSET_X = 11;
export const R_OFFSET_Y = 12;
export const R_CAPPED = 13;
export const R_BLOCKED = 14;
export const R_FALLBACKS = 15;
export const R_PACE_OUT = 16;
export const R_LEG_KEY = 17;
export const R_DEPART_AT = 18;
export const R_ARRIVE_AT = 19;
export const R_DISTANCE = 20;
export const RECORD_DOUBLES = 21;

/** Doubles a buffer needs to hold `slots` records. */
export function bufferDoubles(slots: number): number {
  return HEADER_DOUBLES + slots * RECORD_DOUBLES;
}

/** How many slots a buffer of `doubles` holds. */
export function slotsIn(doubles: number): number {
  return Math.max(0, Math.floor((doubles - HEADER_DOUBLES) / RECORD_DOUBLES));
}
