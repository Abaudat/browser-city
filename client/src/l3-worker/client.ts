// The main thread's side of the L3 worker (D-L3, story 5.24): it posts the next
// frame's city time and body zone, and draws the result due this frame. It
// never blocks, never solves, and reads no clock -- a result is a pure function
// of its own city time, so which result a frame draws cannot make two clients
// disagree about a body, only draw it an instant apart.
//
// Per frame: `apply()` writes the result due this frame into the members'
// frames, then `request(t, zone)` posts the instant the frame `lookahead`
// frames on will draw -- so a result has that many frames to come back before
// it is drawn, and a hiccup of the worker or the main thread does not become a
// stale frame. Transferred buffers cycle through preallocated slots; a steady
// frame allocates one `DataView` (the buffer that came back) and nothing else.
//
// A worker that throws is replaced: the client holds everything the worker was
// told (config, declared citizens, the walkability, every live body) and
// replays it into a new one, counting the restart.

import { type CitizenFrame, createCitizenFrame } from "../l3/citizen";
import type { L3Config } from "../l3/config";
import type { LifeSample } from "../test-street/street-life";
import type { BodyZone } from "../world/body-zone";
import type { FedChunk } from "../world/walk-mirror";
import {
  B_ANIMATION,
  B_DIRECTION,
  B_FALLBACKS,
  B_FLAGS,
  B_FLAVOUR,
  B_FLOOR,
  B_FRAME_INDEX,
  byteOffset,
  type CitizenInit,
  F_BLOCKED,
  F_CAPPED,
  F_MOVING,
  F_PACE_OUT,
  F_PRESENT,
  type FromWorker,
  H_BAND,
  H_DESPAWN,
  H_DETAIL,
  H_DETAIL_SLOT,
  H_HAS_ZONE,
  H_SOLVE_MS,
  H_SPAWN,
  H_STOREY,
  H_T,
  H_WANT_DIAG,
  headingOffset,
  type Port,
  slotsIn,
  type ToWorker,
  tickBytes,
  XY_OFFSET_X,
  XY_OFFSET_Y,
  XY_X,
  XY_Y,
  xyOffset,
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
  /** Workers replaced after an error. */
  readonly restarts: number;
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
/** Buffers in the cycle: the lookahead in flight, one being applied, spares. */
const BUFFERS = 6;
/** Frames diagnostics stay refreshed after the last ask for them. */
const DIAGNOSTIC_FRAMES = 120;
/** Respawns before the client gives up on a worker that dies at once. */
const MAX_RESTARTS = 20;

interface TickMessage {
  type: "tick";
  buf: ArrayBuffer;
}

interface Pending {
  readonly resolve: (value: never) => void;
  readonly reject: (reason: Error) => void;
}

export class L3Client {
  readonly #spawn: () => Port<FromWorker, ToWorker>;
  #port: Port<FromWorker, ToWorker>;
  /** Buffers (as views) not out with the worker and not waiting to be drawn. */
  readonly #free: DataView[] = [];
  /** Results back from the worker, oldest first, in a ring; each with the
   * frame it is due to be drawn on. */
  readonly #readyView: (DataView | undefined)[] = new Array(BUFFERS);
  readonly #readyDue = new Int32Array(BUFFERS);
  #readyHead = 0;
  #readyCount = 0;
  /** Due frame of each tick in flight, in the order posted: the worker
   * answers in order. */
  readonly #dueRing = new Int32Array(BUFFERS);
  #dueHead = 0;
  #dueCount = 0;
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
  #returned = 0;
  #restarts = 0;
  #lastSolveMs = 0;
  #drawnInstant = Number.NaN;
  #diagnosticFrames = 0;
  #detailSlot = -1;
  readonly #replies = new Map<number, Pending>();
  #nextId = 1;
  #onResult: (() => void) | undefined;
  /** What the worker has been told, to tell a new one. */
  #config: L3Config | undefined;
  readonly #declared: (readonly CitizenInit[])[] = [];
  #walkSnapshot: (() => readonly FedChunk[]) | undefined;
  /** One message and one transfer list, reused for every tick: the clone is
   * taken at post time. */
  readonly #tickMessage: TickMessage = { type: "tick", buf: new ArrayBuffer(0) };
  readonly #transfer: Transferable[] = [new ArrayBuffer(0)];

  constructor(spawn: () => Port<FromWorker, ToWorker>, lookahead: number = LOOKAHEAD_FRAMES) {
    this.#spawn = spawn;
    this.#lookahead = lookahead;
    this.#port = this.#attach();
    this.#resetPipeline(MIN_CAPACITY);
  }

  #attach(): Port<FromWorker, ToWorker> {
    const port = this.#spawn();
    port.onmessage = (event) => this.#receive(event.data);
    port.onerror = () => this.#restart(port);
    port.onmessageerror = () => this.#restart(port);
    return port;
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
      restarts: this.#restarts,
      lastSolveMs: this.#lastSolveMs,
      maxLagFrames: this.#maxLag,
      lagEvents: this.#lagEvents,
    };
  }

  init(config: L3Config): void {
    this.#config = config;
    this.#port.postMessage({ type: "init", config });
  }

  /** Declares citizens, with or without a body, before any is added. */
  declare(citizens: readonly CitizenInit[]): void {
    this.#declared.push(citizens);
    this.#port.postMessage({ type: "declare", citizens });
  }

  /** Where the whole walkability can be read again: what a replacement worker
   * is given in full, where the running one only ever got what changed. */
  setWalkSnapshot(snapshot: () => readonly FedChunk[]): void {
    this.#walkSnapshot = snapshot;
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
    if (slot + 1 > this.#capacity) this.#capacity = Math.max(slot + 1, this.#capacity * 2);
    this.#port.postMessage({ type: "add", id, slot });
    return member;
  }

  remove(member: ClientMember): void {
    if (this.#members[member.slot] !== member) return;
    this.#members[member.slot] = undefined;
    this.#freeSlots.push(member.slot);
    this.#port.postMessage({ type: "remove", slot: member.slot });
  }

  /** The one body whose leg (key, depart and arrive instants, distance walked)
   * comes back with each result: the street's commuter. */
  setDetail(member: ClientMember | undefined): void {
    this.#detailSlot = member ? member.slot : -1;
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
    for (let i = 0; i < this.#readyCount; i++) {
      if ((this.#readyDue[(this.#readyHead + i) % BUFFERS] as number) <= this.#frame) take = i;
    }
    if (take < 0) {
      if (this.#applied > 0 && this.#posted > this.#returned) this.#stale++;
      return false;
    }
    for (let i = 0; i < take; i++) {
      const old = this.#readyView[(this.#readyHead + i) % BUFFERS] as DataView;
      this.#readyView[(this.#readyHead + i) % BUFFERS] = undefined;
      this.#free.push(old);
    }
    const at = (this.#readyHead + take) % BUFFERS;
    const dv = this.#readyView[at] as DataView;
    const due = this.#readyDue[at] as number;
    this.#readyView[at] = undefined;
    this.#readyHead = (this.#readyHead + take + 1) % BUFFERS;
    this.#readyCount -= take + 1;
    // The first result lands after the worker boots, however many frames on:
    // that is warming up, not lag.
    if (this.#applied > 0) {
      const lag = this.#frame - due;
      if (lag > this.#maxLag) this.#maxLag = lag;
      if (lag > 1 && this.#lagEvents.length < 8) {
        this.#lagEvents.push({
          frame: this.#frame,
          due,
          ready: this.#readyCount,
          inFlight: this.#posted - this.#returned,
        });
      }
    }
    const total = slotsIn(dv.byteLength);
    const slots = Math.min(this.#members.length, total);
    const names = this.#names;
    for (let slot = 0; slot < slots; slot++) {
      const m = this.#members[slot];
      if (!m) continue;
      const flags = dv.getUint8(byteOffset(total, slot, B_FLAGS));
      if ((flags & F_PRESENT) === 0) continue;
      const fr = m.frame;
      fr.x = dv.getFloat64(xyOffset(total, slot, XY_X), true);
      fr.y = dv.getFloat64(xyOffset(total, slot, XY_Y), true);
      fr.floor = dv.getUint8(byteOffset(total, slot, B_FLOOR)) - 128;
      fr.animation = names[dv.getUint8(byteOffset(total, slot, B_ANIMATION))] as string;
      fr.direction = names[
        dv.getUint8(byteOffset(total, slot, B_DIRECTION))
      ] as CitizenFrame["direction"];
      fr.frameIndex = dv.getUint8(byteOffset(total, slot, B_FRAME_INDEX));
      fr.headingX = dv.getFloat32(headingOffset(total, slot, 0), true);
      fr.headingY = dv.getFloat32(headingOffset(total, slot, 1), true);
      fr.moving = (flags & F_MOVING) !== 0;
      fr.flavour = names[dv.getUint8(byteOffset(total, slot, B_FLAVOUR))] as string;
      m.offsetX = dv.getFloat64(xyOffset(total, slot, XY_OFFSET_X), true);
      m.offsetY = dv.getFloat64(xyOffset(total, slot, XY_OFFSET_Y), true);
      m.capped = (flags & F_CAPPED) !== 0;
      m.blocked = (flags & F_BLOCKED) !== 0;
      m.fallbacks = dv.getUint8(byteOffset(total, slot, B_FALLBACKS));
      m.paceOutOfBand = (flags & F_PACE_OUT) !== 0;
      if (slot === this.#detailSlot) {
        fr.legKey = dv.getFloat64(H_DETAIL * 8, true);
        fr.departAt = dv.getFloat64((H_DETAIL + 1) * 8, true);
        fr.arriveAt = dv.getFloat64((H_DETAIL + 2) * 8, true);
        fr.distance = dv.getFloat64((H_DETAIL + 3) * 8, true);
      }
      m.solved = true;
    }
    this.#lastSolveMs = dv.getFloat64(H_SOLVE_MS * 8, true);
    this.#drawnInstant = dv.getFloat64(H_T * 8, true);
    this.#applied++;
    this.#free.push(dv);
    return true;
  }

  /** Posts the instant to solve, with the zone to solve it under. Returns
   * false when every buffer is out (the request is skipped and counted). */
  request(t: number, zone: BodyZone | undefined): boolean {
    let dv = this.#free.pop();
    if (dv === undefined) {
      this.#skipped++;
      return false;
    }
    if (dv.byteLength < tickBytes(this.#capacity)) {
      dv = new DataView(new ArrayBuffer(tickBytes(this.#capacity)));
    }
    dv.setFloat64(H_T * 8, t, true);
    if (zone) {
      dv.setFloat64(H_HAS_ZONE * 8, 1, true);
      dv.setFloat64(H_SPAWN * 8, zone.spawn.x0, true);
      dv.setFloat64((H_SPAWN + 1) * 8, zone.spawn.y0, true);
      dv.setFloat64((H_SPAWN + 2) * 8, zone.spawn.x1, true);
      dv.setFloat64((H_SPAWN + 3) * 8, zone.spawn.y1, true);
      dv.setFloat64(H_DESPAWN * 8, zone.despawn.x0, true);
      dv.setFloat64((H_DESPAWN + 1) * 8, zone.despawn.y0, true);
      dv.setFloat64((H_DESPAWN + 2) * 8, zone.despawn.x1, true);
      dv.setFloat64((H_DESPAWN + 3) * 8, zone.despawn.y1, true);
      dv.setFloat64(H_STOREY * 8, zone.storeyCells, true);
      dv.setFloat64(H_BAND * 8, zone.band, true);
    } else {
      dv.setFloat64(H_HAS_ZONE * 8, 0, true);
    }
    dv.setFloat64(H_DETAIL_SLOT * 8, this.#detailSlot, true);
    dv.setFloat64(H_WANT_DIAG * 8, this.#diagnosticFrames > 0 ? 1 : 0, true);
    if (this.#diagnosticFrames > 0) this.#diagnosticFrames--;
    this.#posted++;
    this.#dueRing[(this.#dueHead + this.#dueCount) % BUFFERS] = this.#frame + this.#lookahead;
    this.#dueCount++;
    this.#tickMessage.buf = dv.buffer as ArrayBuffer;
    this.#transfer[0] = dv.buffer;
    this.#port.postMessage(this.#tickMessage, this.#transfer);
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
        this.#onResult = undefined;
        resolve();
        return;
      }
      // Due on the next apply, whatever the lookahead.
      const last = (this.#dueHead + this.#dueCount - 1) % BUFFERS;
      this.#dueRing[last] = this.#frame + 1;
    });
  }

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
    return new Promise<T>((resolve, reject) => {
      this.#replies.set(id, { resolve: resolve as (value: never) => void, reject });
      this.#port.postMessage(make(id));
    });
  }

  /** Fresh buffers and empty bookkeeping, nothing waiting on a buffer a dead
   * worker held. */
  #resetPipeline(capacity: number): void {
    this.#capacity = Math.max(capacity, this.#capacity);
    this.#free.length = 0;
    this.#readyView.fill(undefined);
    this.#readyHead = 0;
    this.#readyCount = 0;
    this.#dueHead = 0;
    this.#dueCount = 0;
    this.#posted = 0;
    this.#returned = 0;
    for (let i = 0; i < BUFFERS; i++) {
      this.#free.push(new DataView(new ArrayBuffer(tickBytes(this.#capacity))));
    }
  }

  /** The worker failed: reject what waits on it, replace it, tell the new one
   * everything the old one knew. */
  #restart(failed: Port<FromWorker, ToWorker>): void {
    if (failed !== this.#port) return;
    this.#restarts++;
    failed.onmessage = null;
    failed.onerror = null;
    failed.onmessageerror = null;
    failed.terminate?.();
    for (const [, pending] of this.#replies) {
      pending.reject(new Error("the L3 worker failed and was replaced"));
    }
    this.#replies.clear();
    this.#onResult = undefined;
    this.#resetPipeline(this.#capacity);
    if (this.#restarts > MAX_RESTARTS) return;
    this.#port = this.#attach();
    if (this.#config) this.#port.postMessage({ type: "init", config: this.#config });
    for (const batch of this.#declared) {
      this.#port.postMessage({ type: "declare", citizens: batch });
    }
    const chunks = this.#walkSnapshot?.() ?? [];
    if (chunks.length > 0) {
      const transfer: Transferable[] = [];
      for (const c of chunks) if (c.blocked) transfer.push(c.blocked.buffer);
      this.#port.postMessage({ type: "walk", chunks }, transfer);
    }
    for (const m of this.#members) {
      if (m) this.#port.postMessage({ type: "add", id: m.id, slot: m.slot });
    }
  }

  #receive(message: FromWorker): void {
    switch (message.type) {
      case "result": {
        if (message.names) this.#names = message.names;
        this.#returned++;
        const due = this.#dueCount > 0 ? (this.#dueRing[this.#dueHead] as number) : this.#frame;
        if (this.#dueCount > 0) {
          this.#dueHead = (this.#dueHead + 1) % BUFFERS;
          this.#dueCount--;
        }
        if (this.#readyCount === BUFFERS) {
          // Cannot happen with a spare buffer always out; drop the oldest.
          this.#free.push(this.#readyView[this.#readyHead] as DataView);
          this.#readyHead = (this.#readyHead + 1) % BUFFERS;
          this.#readyCount--;
        }
        const at = (this.#readyHead + this.#readyCount) % BUFFERS;
        this.#readyView[at] = new DataView(message.buf);
        this.#readyDue[at] = due;
        this.#readyCount++;
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
    const pending = this.#replies.get(id);
    if (!pending) return;
    this.#replies.delete(id);
    pending.resolve(value as never);
  }
}
