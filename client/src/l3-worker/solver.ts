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
  readonly #views = new WeakMap<ArrayBuffer, Float64Array>();
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

  #viewOf(buf: ArrayBuffer): Float64Array {
    let view = this.#views.get(buf);
    if (!view) {
      view = new Float64Array(buf);
      this.#views.set(buf, view);
    }
    return view;
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

  #readZone(f: Float64Array): BodyZone | undefined {
    if (f[H_HAS_ZONE] === 0) {
      this.#hasZone = false;
      return undefined;
    }
    const z = this.#zone;
    z.spawn.x0 = f[H_SPAWN] as number;
    z.spawn.y0 = f[H_SPAWN + 1] as number;
    z.spawn.x1 = f[H_SPAWN + 2] as number;
    z.spawn.y1 = f[H_SPAWN + 3] as number;
    z.despawn.x0 = f[H_DESPAWN] as number;
    z.despawn.y0 = f[H_DESPAWN + 1] as number;
    z.despawn.x1 = f[H_DESPAWN + 2] as number;
    z.despawn.y1 = f[H_DESPAWN + 3] as number;
    z.storeyCells = f[H_STOREY] as number;
    z.band = (f[H_BAND] as number) === 1 ? 1 : 0;
    this.#hasZone = true;
    return z;
  }

  #tick(buf: ArrayBuffer): void {
    const life = this.#life;
    const config = this.#config;
    const f = this.#viewOf(buf);
    if (!life || !config) {
      this.#host.post({ type: "result", buf });
      return;
    }
    const t = f[H_T] as number;
    const zone = this.#readZone(f);
    const start = this.#host.now();
    life.solve(t, zone);
    f[H_SOLVE_MS] = this.#host.now() - start;

    const wantDiag = f[H_WANT_DIAG] === 1;
    const msPerMilliminute = config.realMsPerCityMinute / 1000;
    const slots = Math.min(this.#slots.length, slotsIn(f.length));
    if (this.#diag.length < this.#slots.length * 2) {
      const grown = new Float64Array(this.#slots.length * 2);
      grown.set(this.#diag);
      this.#diag = grown;
    }
    for (let slot = 0; slot < slotsIn(f.length); slot++) {
      const base = HEADER_DOUBLES + slot * RECORD_DOUBLES;
      const member = slot < slots ? this.#slots[slot] : undefined;
      if (!member) {
        f[base + R_PRESENT] = 0;
        continue;
      }
      const frame = member.frame;
      f[base + R_PRESENT] = 1;
      f[base + R_X] = frame.x;
      f[base + R_Y] = frame.y;
      f[base + R_FLOOR] = frame.floor;
      f[base + R_ANIMATION] = this.#intern(frame.animation);
      f[base + R_DIRECTION] = this.#intern(frame.direction);
      f[base + R_FRAME_INDEX] = frame.frameIndex;
      f[base + R_HEADING_X] = frame.headingX;
      f[base + R_HEADING_Y] = frame.headingY;
      f[base + R_MOVING] = frame.moving ? 1 : 0;
      f[base + R_FLAVOUR] = this.#intern(frame.flavour);
      f[base + R_OFFSET_X] = life.offsetX(member);
      f[base + R_OFFSET_Y] = life.offsetY(member);
      f[base + R_CAPPED] = life.field.capped(member.index) ? 1 : 0;
      f[base + R_BLOCKED] = life.field.blocked(member.index) ? 1 : 0;
      f[base + R_LEG_KEY] = frame.legKey;
      f[base + R_DEPART_AT] = frame.departAt;
      f[base + R_ARRIVE_AT] = frame.arriveAt;
      f[base + R_DISTANCE] = frame.distance;
      if (wantDiag) {
        const report = member.body.diagnostics(msPerMilliminute, config);
        this.#diag[slot * 2] = report?.fallbacks ?? 0;
        this.#diag[slot * 2 + 1] = report?.paceOutOfBand ? 1 : 0;
      }
      f[base + R_FALLBACKS] = this.#diag[slot * 2] as number;
      f[base + R_PACE_OUT] = this.#diag[slot * 2 + 1] as number;
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
