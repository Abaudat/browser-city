// The main thread's side of the L3 worker (D-L3, story 5.24): it posts the next
// frame's city time and body zone, and draws the latest completed result. It
// never blocks, never solves, and reads no clock -- a result is a pure function
// of its own city time, so which result a frame draws cannot make two clients
// disagree about a body, only draw it an instant apart.
//
// Per frame: `apply()` writes the result due this frame into the members'
// frames, then `request(t, zone)` posts the instant the frame `lookahead`
// frames on will draw -- so a result has that many frames to come back before
// it is drawn, and a hiccup of the worker or the main thread does not become a
// stale frame. Transferred buffers cycle; neither side allocates per frame
// beyond the message object.

import { type CitizenFrame, createCitizenFrame } from "../l3/citizen";
import type { L3Config } from "../l3/config";
import type { LifeSample } from "../test-street/street-life";
import type { BodyZone } from "../world/body-zone";
import type { FedChunk } from "../world/walk-mirror";
import {
  bufferDoubles,
  type CitizenInit,
  type FromWorker,
  H_BAND,
  H_DESPAWN,
  H_HAS_ZONE,
  H_SOLVE_MS,
  H_SPAWN,
  H_STOREY,
  H_T,
  H_WANT_DIAG,
  HEADER_DOUBLES,
  type Port,
  R_ANIMATION,
  R_ARRIVE_AT,
  R_BLOCKED,
  R_CAPPED,
  R_DEPART_AT,
  R_DIRECTION,
  R_DISTANCE,
  R_FALLBACKS,
  R_FLAVOUR,
  R_FLOOR,
  R_FRAME_INDEX,
  R_HEADING_X,
  R_HEADING_Y,
  R_LEG_KEY,
  R_MOVING,
  R_OFFSET_X,
  R_OFFSET_Y,
  R_PACE_OUT,
  R_PRESENT,
  R_X,
  R_Y,
  RECORD_DOUBLES,
  slotsIn,
  type ToWorker,
} from "./protocol";

/** A body the worker solves: its frame and sidestep as of the last result
 * that carried it. */
export interface ClientMember {
  readonly id: string;
  readonly slot: number;
  readonly frame: CitizenFrame;
  offsetX: number;
  offsetY: number;
  capped: boolean;
  blocked: boolean;
  fallbacks: number;
  paceOutOfBand: boolean;
  /** A result has carried this body: until then its frame is a placeholder
   * and it is not drawn. */
  solved: boolean;
}

export interface SolveStats {
  /** Results applied. */
  readonly applied: number;
  /** Frames that drew with no new result since the last (after the first). */
  readonly stale: number;
  /** Requests not posted for want of a free buffer. */
  readonly skipped: number;
  /** The worker's own time for the latest applied solve, in ms. */
  readonly lastSolveMs: number;
  /** The most frames a result was drawn after the frame it was solved for. */
  readonly maxLagFrames: number;
  /** The first few frames that drew a result late, for a report to show. */
  readonly lagEvents: readonly { frame: number; due: number; ready: number; inFlight: number }[];
}

const MIN_CAPACITY = 256;
/** Frames ahead of the draw an instant is requested by default. */
export const LOOKAHEAD_FRAMES = 2;
/** Buffers in the cycle: the lookahead in flight, one being applied, one spare. */
const BUFFERS = 4;
/** Frames diagnostics stay refreshed after the last ask for them. */
const DIAGNOSTIC_FRAMES = 120;

export class L3Client {
  readonly #port: Port<FromWorker, ToWorker>;
  readonly #free: ArrayBuffer[] = [];
  /** Results back from the worker, oldest first, each with the frame it is
   * due to be drawn on. */
  readonly #ready: { buf: ArrayBuffer; due: number }[] = [];
  /** Due frame of each tick in flight, in the order posted: the worker
   * answers in order. */
  readonly #dueQueue: number[] = [];
  readonly #lookahead: number;
  #frame = 0;
  #maxLag = 0;
  readonly #lagEvents: { frame: number; due: number; ready: number; inFlight: number }[] = [];
  #capacity = 0;
  readonly #members: (ClientMember | undefined)[] = [];
  readonly #freeSlots: number[] = [];
  #names: readonly string[] = [];
  #applied = 0;
  #stale = 0;
  #skipped = 0;
  #posted = 0;
  #lastSolveMs = 0;
  #drawnInstant = Number.NaN;
  #diagnosticFrames = 0;
  readonly #replies = new Map<number, (value: never) => void>();
  #nextId = 1;
  readonly #views = new WeakMap<ArrayBuffer, Float64Array>();

  constructor(port: Port<FromWorker, ToWorker>, lookahead: number = LOOKAHEAD_FRAMES) {
    this.#port = port;
    this.#lookahead = lookahead;
    port.onmessage = (event) => this.#receive(event.data);
    this.#grow(MIN_CAPACITY);
  }

  /** The city time (milliminutes) the frames now in the members were solved
   * for: what a body drawn this frame is a function of. */
  get drawnInstant(): number {
    return this.#drawnInstant;
  }

  /** Forgets the peak lag, to measure a window. */
  resetLag(): void {
    this.#maxLag = 0;
    this.#lagEvents.length = 0;
  }

  get stats(): SolveStats {
    return {
      applied: this.#applied,
      stale: this.#stale,
      skipped: this.#skipped,
      lastSolveMs: this.#lastSolveMs,
      maxLagFrames: this.#maxLag,
      lagEvents: this.#lagEvents,
    };
  }

  init(config: L3Config): void {
    this.#port.postMessage({ type: "init", config });
  }

  /** Declares citizens, with or without a body, before any is added. */
  declare(citizens: readonly CitizenInit[]): void {
    this.#port.postMessage({ type: "declare", citizens });
  }

  /** Sends the walkability chunks that changed; their buffers are handed over. */
  feedWalk(chunks: readonly FedChunk[]): void {
    if (chunks.length === 0) return;
    const transfer: Transferable[] = [];
    for (const c of chunks) if (c.blocked) transfer.push(c.blocked.buffer);
    this.#port.postMessage({ type: "walk", chunks }, transfer);
  }

  add(id: string): ClientMember {
    const slot = this.#freeSlots.pop() ?? this.#members.length;
    const member: ClientMember = {
      id,
      slot,
      frame: createCitizenFrame(),
      offsetX: 0,
      offsetY: 0,
      capped: false,
      blocked: false,
      fallbacks: 0,
      paceOutOfBand: false,
      solved: false,
    };
    this.#members[slot] = member;
    if (slot + 1 > this.#capacity) this.#grow(Math.max(slot + 1, this.#capacity * 2));
    this.#port.postMessage({ type: "add", id, slot });
    return member;
  }

  remove(member: ClientMember): void {
    if (this.#members[member.slot] !== member) return;
    this.#members[member.slot] = undefined;
    this.#freeSlots.push(member.slot);
    this.#port.postMessage({ type: "remove", slot: member.slot });
  }

  /** Asks for the diagnostics (fallbacks, pace band) to be kept fresh. */
  wantDiagnostics(): void {
    this.#diagnosticFrames = DIAGNOSTIC_FRAMES;
  }

  /** Writes the result due this frame into the members' frames. When it has
   * not come back, the previous frame's draw stands and the frame is counted
   * stale; a result that comes back overdue is the next one drawn. */
  apply(): boolean {
    this.#frame++;
    // The newest result that is due; older ones are recycled unseen.
    let take = -1;
    for (let i = 0; i < this.#ready.length; i++) {
      if ((this.#ready[i] as { due: number }).due <= this.#frame) take = i;
    }
    if (take < 0) {
      if (this.#applied > 0 && this.#inFlight() > 0) this.#stale++;
      return false;
    }
    for (let i = 0; i < take; i++) this.#free.push((this.#ready[i] as { buf: ArrayBuffer }).buf);
    const { buf, due } = this.#ready[take] as { buf: ArrayBuffer; due: number };
    this.#ready.splice(0, take + 1);
    // The first result lands after the worker boots, however many frames on:
    // that is warming up, not lag.
    if (this.#applied > 0) {
      this.#maxLag = Math.max(this.#maxLag, this.#frame - due);
      if (this.#frame - due > 1 && this.#lagEvents.length < 8) {
        this.#lagEvents.push({
          frame: this.#frame,
          due,
          ready: this.#ready.length,
          inFlight: this.#inFlight(),
        });
      }
    }
    const f = this.#viewOf(buf);
    const names = this.#names;
    const slots = Math.min(this.#members.length, slotsIn(f.length));
    for (let slot = 0; slot < slots; slot++) {
      const m = this.#members[slot];
      if (!m) continue;
      const base = HEADER_DOUBLES + slot * RECORD_DOUBLES;
      if (f[base + R_PRESENT] === 0) continue;
      const fr = m.frame;
      fr.x = f[base + R_X] as number;
      fr.y = f[base + R_Y] as number;
      fr.floor = f[base + R_FLOOR] as number;
      fr.animation = names[f[base + R_ANIMATION] as number] as string;
      fr.direction = names[f[base + R_DIRECTION] as number] as CitizenFrame["direction"];
      fr.frameIndex = f[base + R_FRAME_INDEX] as number;
      fr.headingX = f[base + R_HEADING_X] as number;
      fr.headingY = f[base + R_HEADING_Y] as number;
      fr.moving = f[base + R_MOVING] === 1;
      fr.flavour = names[f[base + R_FLAVOUR] as number] as string;
      fr.legKey = f[base + R_LEG_KEY] as number;
      fr.departAt = f[base + R_DEPART_AT] as number;
      fr.arriveAt = f[base + R_ARRIVE_AT] as number;
      fr.distance = f[base + R_DISTANCE] as number;
      m.offsetX = f[base + R_OFFSET_X] as number;
      m.offsetY = f[base + R_OFFSET_Y] as number;
      m.capped = f[base + R_CAPPED] === 1;
      m.blocked = f[base + R_BLOCKED] === 1;
      m.fallbacks = f[base + R_FALLBACKS] as number;
      m.paceOutOfBand = f[base + R_PACE_OUT] === 1;
      m.solved = true;
    }
    this.#lastSolveMs = f[H_SOLVE_MS] as number;
    this.#drawnInstant = f[H_T] as number;
    this.#applied++;
    this.#free.push(buf);
    return true;
  }

  /** Posts the instant to solve, with the zone to solve it under. Returns
   * false when both buffers are out (the request is skipped and counted). */
  request(t: number, zone: BodyZone | undefined): boolean {
    const buf = this.#free.pop();
    if (buf === undefined) {
      this.#skipped++;
      return false;
    }
    let use = buf;
    if (use.byteLength < bufferDoubles(this.#capacity) * 8) {
      use = new ArrayBuffer(bufferDoubles(this.#capacity) * 8);
    }
    const f = this.#viewOf(use);
    f[H_T] = t;
    if (zone) {
      f[H_HAS_ZONE] = 1;
      f[H_SPAWN] = zone.spawn.x0;
      f[H_SPAWN + 1] = zone.spawn.y0;
      f[H_SPAWN + 2] = zone.spawn.x1;
      f[H_SPAWN + 3] = zone.spawn.y1;
      f[H_DESPAWN] = zone.despawn.x0;
      f[H_DESPAWN + 1] = zone.despawn.y0;
      f[H_DESPAWN + 2] = zone.despawn.x1;
      f[H_DESPAWN + 3] = zone.despawn.y1;
      f[H_STOREY] = zone.storeyCells;
      f[H_BAND] = zone.band;
    } else {
      f[H_HAS_ZONE] = 0;
    }
    f[H_WANT_DIAG] = this.#diagnosticFrames > 0 ? 1 : 0;
    if (this.#diagnosticFrames > 0) this.#diagnosticFrames--;
    this.#posted++;
    this.#dueQueue.push(this.#frame + this.#lookahead);
    this.#port.postMessage({ type: "tick", buf: use }, [use]);
    return true;
  }

  /** Solves `t` once and applies it: a pinned scene (a frozen crowd) that no
   * ticker drives. Resolves when the result has been applied. */
  settle(t: number, zone: BodyZone | undefined): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#onResult = () => {
        this.apply();
        resolve();
      };
      if (!this.request(t, zone)) {
        resolve();
        return;
      }
      // Due on the next apply, whatever the lookahead.
      this.#dueQueue[this.#dueQueue.length - 1] = this.#frame + 1;
    });
  }

  #onResult: (() => void) | undefined;

  /** The bodies this client holds, solved at `t` as they are. */
  liveAt(t: number): Promise<readonly LifeSample[]> {
    return this.#ask((id) => ({ type: "query", kind: "live", id, t }));
  }

  /** Every citizen's agreed state at `t`, from scratch. */
  agreementAt(t: number): Promise<readonly LifeSample[]> {
    return this.#ask((id) => ({ type: "query", kind: "agreement", id, t }));
  }

  /** `liveAt` for many instants in one round trip. */
  liveAtMany(ts: readonly number[]): Promise<readonly (readonly LifeSample[])[]> {
    return this.#ask((id) => ({ type: "queryMany", kind: "live", id, ts }));
  }

  /** `agreementAt` for many instants in one round trip. */
  agreementAtMany(ts: readonly number[]): Promise<readonly (readonly LifeSample[])[]> {
    return this.#ask((id) => ({ type: "queryMany", kind: "agreement", id, ts }));
  }

  /** The worker's solve time for each of `frames` successive instants. */
  sweep(start: number, step: number, frames: number): Promise<Float64Array> {
    return this.#ask((id) => ({ type: "sweep", id, start, step, frames }));
  }

  /** The calibration workload's median inside the worker, in ms. */
  calibrate(runs: number): Promise<number> {
    return this.#ask((id) => ({ type: "calibrate", id, runs }));
  }

  #ask<T>(make: (id: number) => ToWorker): Promise<T> {
    const id = this.#nextId++;
    return new Promise<T>((resolve) => {
      this.#replies.set(id, resolve as (value: never) => void);
      this.#port.postMessage(make(id));
    });
  }

  #viewOf(buf: ArrayBuffer): Float64Array {
    let v = this.#views.get(buf);
    if (!v) {
      v = new Float64Array(buf);
      this.#views.set(buf, v);
    }
    return v;
  }

  #grow(capacity: number): void {
    this.#capacity = capacity;
    // The buffers here are replaced at their next use; those out with the
    // worker come back under-sized and are replaced then.
    for (let i = 0; i < this.#free.length; i++) {
      this.#free[i] = new ArrayBuffer(bufferDoubles(capacity) * 8);
    }
    while (this.#free.length + this.#ready.length + this.#inFlight() < BUFFERS) {
      this.#free.push(new ArrayBuffer(bufferDoubles(capacity) * 8));
    }
  }

  #inFlight(): number {
    return this.#posted - this.#returned;
  }

  #returned = 0;

  #receive(message: FromWorker): void {
    switch (message.type) {
      case "result": {
        if (message.names) this.#names = message.names;
        this.#returned++;
        this.#ready.push({ buf: message.buf, due: this.#dueQueue.shift() ?? this.#frame });
        if (this.#onResult) {
          const done = this.#onResult;
          this.#onResult = undefined;
          done();
        }
        return;
      }
      case "reply":
        this.#settle(message.id, message.samples);
        return;
      case "replyMany":
        this.#settle(message.id, message.samples);
        return;
      case "swept":
        this.#settle(message.id, message.solveMs);
        return;
      case "calibrated":
        this.#settle(message.id, message.ms);
    }
  }

  #settle(id: number, value: unknown): void {
    const resolve = this.#replies.get(id);
    if (!resolve) return;
    this.#replies.delete(id);
    resolve(value as never);
  }
}
