// The L3 solve, as the worker runs it (D-L3, story 5.24): the one place the
// street's life is posed and sidestepped. It owns the citizens' bodies, the
// walkability mirror and a `StreetLife`; the main thread sends deltas (members
// entering and leaving, walkability chunks that changed) and one tick buffer
// per frame, and draws what comes back. Nothing here reads a clock or a global:
// the host injects the clock and the transport, so the whole protocol runs in a
// unit test, and the worker file is a thin shell around this class.

import { CitizenBody } from "../l3/citizen";
import { type L3Config, pathConfigOf } from "../l3/config";
import { type LifeMember, StreetLife } from "../test-street/street-life";
import { Timetable } from "../test-street/timetable";
import type { BodyZone } from "../world/body-zone";
import { WalkMirror } from "../world/walk-mirror";
import { calibrationWorkload } from "./calibration";
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
  slotsIn,
  type ToWorker,
  XY_OFFSET_X,
  XY_OFFSET_Y,
  XY_X,
  XY_Y,
  xyOffset,
} from "./protocol";

/** Ticks between diagnostic refreshes. */
const DIAGNOSTIC_EVERY = 30;

export interface SolverHost {
  post(message: FromWorker, transfer?: Transferable[]): void;
  /** Milliseconds, monotonic: the only clock the solver has. */
  now(): number;
}

interface MutableRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface MutableZone {
  spawn: MutableRect;
  despawn: MutableRect;
  storeyCells: number;
  band: 0 | 1;
}

export class L3Solver {
  readonly #host: SolverHost;
  readonly #walk = new WalkMirror();
  #life: StreetLife | undefined;
  #config: L3Config | undefined;
  readonly #citizens = new Map<string, CitizenInit>();
  readonly #slots: (LifeMember | undefined)[] = [];
  /** Interned strings (animations, facings, flavours) the buffer indexes. */
  readonly #names: string[] = [];
  readonly #nameIndex = new Map<string, number>();
  #namesSent = 0;
  /** Pace-band and fallback reports per slot (2 doubles), refreshed on demand. */
  #diag = new Float64Array(0);
  readonly #zone: MutableZone = {
    spawn: { x0: 0, y0: 0, x1: 0, y1: 0 },
    despawn: { x0: 0, y0: 0, x1: 0, y1: 0 },
    storeyCells: 0,
    band: 0,
  };
  #hasZone = false;
  #ticks = 0;

  constructor(host: SolverHost) {
    this.#host = host;
  }

  handle(message: ToWorker): void {
    switch (message.type) {
      case "init":
        this.#init(message.config);
        return;
      case "declare":
        this.#declare(message.citizens);
        return;
      case "walk":
        for (const c of message.chunks) this.#walk.setChunk(c.floor, c.cx, c.cy, c.blocked);
        return;
      case "add":
        this.#add(message.id, message.slot);
        return;
      case "remove": {
        const member = this.#slots[message.slot];
        if (member) this.#life?.remove(member);
        this.#slots[message.slot] = undefined;
        return;
      }
      case "tick":
        this.#tick(message.buf);
        return;
      case "query": {
        const life = this.#life;
        if (!life) return;
        const samples =
          message.kind === "live" ? life.liveAt(message.t) : life.agreementAt(message.t);
        this.#host.post({ type: "reply", id: message.id, samples });
        return;
      }
      case "queryMany": {
        const life = this.#life;
        if (!life) return;
        const samples = message.ts.map((t) =>
          message.kind === "live" ? life.liveAt(t) : life.agreementAt(t),
        );
        this.#host.post({ type: "replyMany", id: message.id, samples });
        return;
      }
      case "sweep":
        this.#sweep(message.id, message.start, message.step, message.frames);
        return;
      case "calibrate":
        this.#host.post({
          type: "calibrated",
          id: message.id,
          ms: calibrationWorkload(message.runs, () => this.#host.now()),
        });
    }
  }

  #init(config: L3Config): void {
    this.#config = config;
    this.#life = new StreetLife(config, this.#walk);
  }

  #declare(citizens: readonly CitizenInit[]): void {
    const life = this.#life;
    const config = this.#config;
    if (!life || !config) return;
    for (const c of citizens) {
      this.#citizens.set(c.id, c);
      life.declare({
        id: c.id,
        timetable: this.#ledgerOf(c, config),
        stand: c.stand,
        standAt: c.standAt,
        look: c.look,
        remake: () => this.#make(c, config),
      });
    }
  }

  #ledgerOf(c: CitizenInit, config: L3Config): Timetable | undefined {
    return c.spec
      ? new Timetable(c.spec, config, this.#walk, pathConfigOf(config), c.walkMilli)
      : undefined;
  }

  #make(c: CitizenInit, config: L3Config): { body: CitizenBody; timetable?: Timetable } {
    return {
      timetable: this.#ledgerOf(c, config),
      body: new CitizenBody(this.#walk, pathConfigOf(config), c.gait, c.id, c.life),
    };
  }

  #add(id: string, slot: number): void {
    const life = this.#life;
    const config = this.#config;
    const c = this.#citizens.get(id);
    if (!life || !config || !c) return;
    const old = this.#slots[slot];
    if (old) life.remove(old);
    this.#slots[slot] = life.add({
      id,
      ...this.#make(c, config),
      stand: c.stand,
      standAt: c.standAt,
      look: c.look,
      remake: () => this.#make(c, config),
    });
  }

  #intern(name: string): number {
    let i = this.#nameIndex.get(name);
    if (i === undefined) {
      i = this.#names.length;
      this.#names.push(name);
      this.#nameIndex.set(name, i);
    }
    return i;
  }

  #readZone(dv: DataView): BodyZone | undefined {
    const h = (i: number): number => dv.getFloat64(i * 8, true);
    if (h(H_HAS_ZONE) === 0) {
      this.#hasZone = false;
      return undefined;
    }
    const z = this.#zone;
    z.spawn.x0 = h(H_SPAWN);
    z.spawn.y0 = h(H_SPAWN + 1);
    z.spawn.x1 = h(H_SPAWN + 2);
    z.spawn.y1 = h(H_SPAWN + 3);
    z.despawn.x0 = h(H_DESPAWN);
    z.despawn.y0 = h(H_DESPAWN + 1);
    z.despawn.x1 = h(H_DESPAWN + 2);
    z.despawn.y1 = h(H_DESPAWN + 3);
    z.storeyCells = h(H_STOREY);
    z.band = h(H_BAND) === 1 ? 1 : 0;
    this.#hasZone = true;
    return z;
  }

  #tick(buf: ArrayBuffer): void {
    const life = this.#life;
    const config = this.#config;
    if (!life || !config) {
      this.#host.post({ type: "result", buf });
      return;
    }
    const dv = new DataView(buf);
    const slots = slotsIn(buf.byteLength);
    const zone = this.#readZone(dv);
    const start = this.#host.now();
    life.solve(dv.getFloat64(H_T * 8, true), zone);
    dv.setFloat64(H_SOLVE_MS * 8, this.#host.now() - start, true);

    // Diagnostics walk each body's segments: refreshed on request, at most
    // twice a second, never in the frame's critical path every frame.
    this.#ticks++;
    const wantDiag =
      dv.getFloat64(H_WANT_DIAG * 8, true) === 1 && this.#ticks % DIAGNOSTIC_EVERY === 0;
    const msPerMilliminute = config.realMsPerCityMinute / 1000;
    if (this.#diag.length < this.#slots.length * 2) {
      const grown = new Float64Array(this.#slots.length * 2);
      grown.set(this.#diag);
      this.#diag = grown;
    }
    const detail = dv.getFloat64(H_DETAIL_SLOT * 8, true);
    for (let slot = 0; slot < slots; slot++) {
      const member = this.#slots[slot];
      if (!member) {
        dv.setUint8(byteOffset(slots, slot, B_FLAGS), 0);
        continue;
      }
      const frame = member.frame;
      dv.setFloat64(xyOffset(slots, slot, XY_X), frame.x, true);
      dv.setFloat64(xyOffset(slots, slot, XY_Y), frame.y, true);
      dv.setFloat64(xyOffset(slots, slot, XY_OFFSET_X), life.offsetX(member), true);
      dv.setFloat64(xyOffset(slots, slot, XY_OFFSET_Y), life.offsetY(member), true);
      dv.setFloat32(headingOffset(slots, slot, 0), frame.headingX, true);
      dv.setFloat32(headingOffset(slots, slot, 1), frame.headingY, true);
      if (wantDiag) {
        const report = member.body.diagnostics(msPerMilliminute, config);
        this.#diag[slot * 2] = report?.fallbacks ?? 0;
        this.#diag[slot * 2 + 1] = report?.paceOutOfBand ? 1 : 0;
      }
      dv.setUint8(
        byteOffset(slots, slot, B_FLAGS),
        F_PRESENT |
          (frame.moving ? F_MOVING : 0) |
          (life.field.capped(member.index) ? F_CAPPED : 0) |
          (life.field.blocked(member.index) ? F_BLOCKED : 0) |
          (this.#diag[slot * 2 + 1] ? F_PACE_OUT : 0),
      );
      dv.setUint8(byteOffset(slots, slot, B_FLOOR), frame.floor + 128);
      dv.setUint8(byteOffset(slots, slot, B_ANIMATION), this.#intern(frame.animation));
      dv.setUint8(byteOffset(slots, slot, B_DIRECTION), this.#intern(frame.direction));
      dv.setUint8(byteOffset(slots, slot, B_FLAVOUR), this.#intern(frame.flavour));
      dv.setUint8(byteOffset(slots, slot, B_FRAME_INDEX), frame.frameIndex);
      dv.setUint8(
        byteOffset(slots, slot, B_FALLBACKS),
        Math.min(255, this.#diag[slot * 2] as number),
      );
      if (slot === detail) {
        dv.setFloat64(H_DETAIL * 8, frame.legKey, true);
        dv.setFloat64((H_DETAIL + 1) * 8, frame.departAt, true);
        dv.setFloat64((H_DETAIL + 2) * 8, frame.arriveAt, true);
        dv.setFloat64((H_DETAIL + 3) * 8, frame.distance, true);
      }
    }
    if (this.#names.length > this.#namesSent) {
      this.#namesSent = this.#names.length;
      this.#host.post({ type: "result", buf, names: [...this.#names] }, [buf]);
    } else {
      this.#host.post({ type: "result", buf }, [buf]);
    }
  }

  #sweep(id: number, start: number, step: number, frames: number): void {
    const life = this.#life;
    const out = new Float64Array(frames);
    if (life) {
      const zone = this.#hasZone ? this.#zone : undefined;
      for (let k = 0; k < frames; k++) {
        const at = this.#host.now();
        life.solve(start + k * step, zone);
        out[k] = this.#host.now() - at;
      }
    }
    this.#host.post({ type: "swept", id, solveMs: out }, [out.buffer]);
  }
}
