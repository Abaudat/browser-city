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

// ---- the tick buffer: one ArrayBuffer, header then one record per slot ----
//
// Header (`HEADER_DOUBLES` doubles), then per slot, in three runs: four doubles
// (x, y, offsetX, offsetY -- exact), two float32 (heading) and eight bytes (the
// `B_*` fields). 48 bytes a body: the buffer crosses threads every frame, so
// its size is the traffic.

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

/** Per slot, in `Tick.xy`. */
export const XY_X = 0;
export const XY_Y = 1;
export const XY_OFFSET_X = 2;
export const XY_OFFSET_Y = 3;
export const XY_PER_SLOT = 4;
/** Per slot, in `Tick.heading`. */
export const HEADING_PER_SLOT = 2;
/** Per slot, in `Tick.bytes`. */
export const B_FLAGS = 0;
/** The floor plus 128. */
export const B_FLOOR = 1;
export const B_ANIMATION = 2;
export const B_DIRECTION = 3;
export const B_FLAVOUR = 4;
export const B_FRAME_INDEX = 5;
export const B_FALLBACKS = 6;
export const BYTES_PER_SLOT_FIELDS = 8;
/** `B_FLAGS` bits. */
export const F_PRESENT = 1;
export const F_MOVING = 2;
export const F_CAPPED = 4;
export const F_BLOCKED = 8;
export const F_PACE_OUT = 16;

/** Bytes per slot, the three runs together. */
export const BYTES_PER_SLOT = XY_PER_SLOT * 8 + HEADING_PER_SLOT * 4 + BYTES_PER_SLOT_FIELDS;

/** Bytes a buffer needs to hold `slots` records. */
export function tickBytes(slots: number): number {
  return HEADER_DOUBLES * 8 + slots * BYTES_PER_SLOT;
}

/** How many slots a buffer of `byteLength` holds. */
export function slotsIn(byteLength: number): number {
  return Math.max(0, Math.floor((byteLength - HEADER_DOUBLES * 8) / BYTES_PER_SLOT));
}

export interface Tick {
  readonly head: Float64Array;
  readonly xy: Float64Array;
  readonly heading: Float32Array;
  readonly bytes: Uint8Array;
  readonly slots: number;
}

/** Typed views over the runs of a tick buffer. */
export function viewTick(buf: ArrayBuffer): Tick {
  const slots = slotsIn(buf.byteLength);
  const head = HEADER_DOUBLES * 8;
  return {
    head: new Float64Array(buf, 0, HEADER_DOUBLES),
    xy: new Float64Array(buf, head, slots * XY_PER_SLOT),
    heading: new Float32Array(buf, head + slots * XY_PER_SLOT * 8, slots * HEADING_PER_SLOT),
    bytes: new Uint8Array(
      buf,
      head + slots * (XY_PER_SLOT * 8 + HEADING_PER_SLOT * 4),
      slots * BYTES_PER_SLOT_FIELDS,
    ),
    slots,
  };
}
