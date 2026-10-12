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
  /** The worker threw, or sent what could not be cloned. */
  onerror?: ((event: unknown) => void) | null;
  onmessageerror?: ((event: unknown) => void) | null;
  /** Stops a failed worker. */
  terminate?(): void;
}

// ---- the tick buffer: one ArrayBuffer, header then one record per slot ----
//
// Two runs, read through two views: doubles (the header, then x, y, offsetX,
// offsetY per slot -- exact) and bytes (ten a slot: see `B_*`). 42 bytes a
// body: the buffer crosses threads every frame, so its size is the traffic,
// and typed-array reads, unlike `DataView`'s, box nothing.

export const HEADER_DOUBLES = 20;
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
/** In: the one slot whose leg comes back in `H_DETAIL`, or -1. */
export const H_DETAIL_SLOT = 14;
/** Out: leg key, depart instant, arrive instant, distance walked. */
export const H_DETAIL = 16;

/** Doubles per slot, after the header: x, y, offsetX, offsetY. */
export const XY_X = 0;
export const XY_Y = 1;
export const XY_OFFSET_X = 2;
export const XY_OFFSET_Y = 3;
export const XY_PER_SLOT = 4;
/** Bytes per slot. */
export const B_FLAGS = 0;
/** The floor plus 128. */
export const B_FLOOR = 1;
export const B_ANIMATION = 2;
export const B_DIRECTION = 3;
export const B_FLAVOUR = 4;
export const B_FRAME_INDEX = 5;
export const B_FALLBACKS = 6;
/** The heading components times 127, as signed bytes (a debug readout). */
export const B_HEADING_X = 7;
export const B_HEADING_Y = 8;
export const BYTES_PER_SLOT_FIELDS = 10;
/** `B_FLAGS` bits. */
export const F_PRESENT = 1;
export const F_MOVING = 2;
export const F_CAPPED = 4;
export const F_BLOCKED = 8;
export const F_PACE_OUT = 16;

/** Bytes per slot, both runs together. */
export const BYTES_PER_SLOT = XY_PER_SLOT * 8 + BYTES_PER_SLOT_FIELDS;

/** Bytes a buffer needs to hold `slots` records. */
export function tickBytes(slots: number): number {
  return HEADER_DOUBLES * 8 + slots * BYTES_PER_SLOT;
}

/** How many slots a buffer of `byteLength` holds. */
export function slotsIn(byteLength: number): number {
  return Math.max(0, Math.floor((byteLength - HEADER_DOUBLES * 8) / BYTES_PER_SLOT));
}

/** The doubles of a buffer: header, then `XY_PER_SLOT` a slot. */
export function viewDoubles(buf: ArrayBuffer): Float64Array {
  return new Float64Array(buf, 0, HEADER_DOUBLES + slotsIn(buf.byteLength) * XY_PER_SLOT);
}

/** The bytes of a buffer: `BYTES_PER_SLOT_FIELDS` a slot. */
export function viewBytes(buf: ArrayBuffer): Uint8Array {
  const slots = slotsIn(buf.byteLength);
  return new Uint8Array(
    buf,
    (HEADER_DOUBLES + slots * XY_PER_SLOT) * 8,
    slots * BYTES_PER_SLOT_FIELDS,
  );
}
