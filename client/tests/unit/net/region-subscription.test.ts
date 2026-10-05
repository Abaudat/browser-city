import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type HandleCallbacks,
  type RegionBackend,
  RegionController,
  type RegionHandle,
  RegionSubscriptions,
} from "../../../src/net/region-subscription";
import { CHUNK_SIZE } from "../../../src/world/chunk";
import { CollisionGrid } from "../../../src/world/collision-grid";
import { FootprintIndex } from "../../../src/world/footprint-index";
import {
  bandOf,
  columnOf,
  type FloorRange,
  type HandleKey,
  handleId,
  REGION_MAX_HANDLES,
  REGION_RADIUS_CHUNKS,
} from "../../../src/world/region";
import { sizeProbe } from "../setup/size-probe";

const FLOORS = { minFloor: -1, maxFloor: 7 };

type State = "pending" | "applied" | "unsubscribing" | "ended";

/** A stand-in for the SDK handle that is as strict as the real one:
 * `unsubscribe` is only valid on an applied handle, once. */
class FakeHandle implements RegionHandle {
  state: State = "pending";
  constructor(
    readonly key: HandleKey,
    readonly cb: HandleCallbacks,
    private readonly swallowErrorWhenEnding = false,
  ) {}
  unsubscribe(): void {
    if (this.state !== "applied") {
      throw new Error(`unsubscribe on a ${this.state} handle ${handleId(this.key)}`);
    }
    this.state = "unsubscribing";
  }
  deliverApplied(): void {
    if (this.state !== "pending") return;
    this.state = "applied";
    this.cb.onApplied();
  }
  deliverEnded(): void {
    if (this.state !== "unsubscribing") return;
    this.state = "ended";
    this.cb.onEnded();
  }
  deliverError(): void {
    if (this.state === "ended") return;
    const swallow = this.swallowErrorWhenEnding && this.state === "unsubscribing";
    this.state = "ended";
    if (swallow) return;
    this.cb.onError("rejected");
  }
}

class FakeBackend implements RegionBackend {
  readonly handles: FakeHandle[] = [];
  /** Negative control: an ending handle that takes an error without telling
   * the manager, which is a manager that keeps the handle. */
  constructor(private readonly swallowErrorWhenEnding = false) {}
  subscribe(key: HandleKey, _range: FloorRange, cb: HandleCallbacks): RegionHandle {
    const h = new FakeHandle(key, cb, this.swallowErrorWhenEnding);
    this.handles.push(h);
    return h;
  }
  live(): number {
    return this.handles.filter((h) => h.state !== "ended").length;
  }
  flush(): void {
    for (let guard = 0; guard < 10_000; guard++) {
      const next = this.handles.find((h) => h.state === "pending" || h.state === "unsubscribing");
      if (!next) return;
      next.deliverApplied();
      next.deliverEnded();
    }
    throw new Error("flush did not settle");
  }
}

const noop = (): void => {};

function manager(backend: FakeBackend, onError: (m: string) => void = noop): RegionSubscriptions {
  return new RegionSubscriptions(backend, FLOORS, { onError });
}

type Command =
  | { t: "move"; p: { x: number; y: number; floor: number } }
  /** One chunk from the last position, on the same floor. */
  | { t: "step"; dx: number; dy: number }
  /** Applies every pending handle. */
  | { t: "applyAll" }
  | { t: DeliveryKind; i: number };

/** Each delivery draws from its own pool of handles. `error` draws from
 * every handle not yet ended; the three below from one state each. */
const POOLS = {
  applied: ["pending"],
  ended: ["unsubscribing"],
  error: ["pending", "applied", "unsubscribing"],
  errorPending: ["pending"],
  errorApplied: ["applied"],
  errorEnding: ["unsubscribing"],
} as const satisfies Record<string, readonly State[]>;
type DeliveryKind = keyof typeof POOLS;

/** What a delivery hit: the command and the handle's state beforehand. */
interface Delivery {
  t: DeliveryKind;
  before: State;
}

/** What a schedule did, so a caller can check its premise and the depth
 * of the generator that drew it. */
interface Report {
  trace: Delivery[];
  /** Moves that requested at least one new handle. */
  subscribingMoves: number;
  /** An error reached the manager. */
  failed: boolean;
  /** An old handle was still ending when a fresh one for its column was requested. */
  oldPlusFresh: boolean;
}

/** Runs a schedule against a fresh manager, asserting after every step and
 * at the end. */
function runSchedule(commands: Command[], backend: FakeBackend = new FakeBackend()): Report {
  const trace: Delivery[] = [];
  let subscribingMoves = 0;
  let oldPlusFresh = false;
  let failed = false;
  const m = manager(backend, () => {
    failed = true;
  });
  let last: { x: number; y: number; floor: number } | undefined;
  for (const c of commands) {
    if (c.t === "move" || c.t === "step") {
      const p =
        c.t === "move"
          ? c.p
          : {
              x: (last?.x ?? 0) + c.dx * CHUNK_SIZE,
              y: (last?.y ?? 0) + c.dy * CHUNK_SIZE,
              floor: last?.floor ?? 0,
            };
      const before = backend.handles.length;
      m.moveTo(p.x, p.y, p.floor);
      last = p;
      const fresh = backend.handles.slice(before);
      if (fresh.length > 0) subscribingMoves++;
      for (const h of fresh) {
        const id = handleId(h.key);
        if (backend.handles.some((o) => o.state === "unsubscribing" && handleId(o.key) === id)) {
          oldPlusFresh = true;
        }
      }
    } else if (c.t === "applyAll") {
      for (const h of [...backend.handles]) h.deliverApplied();
    } else {
      const states: readonly State[] = POOLS[c.t];
      const pool = backend.handles.filter((h) => states.includes(h.state));
      const h = pool[c.i % Math.max(pool.length, 1)];
      if (h) {
        trace.push({ t: c.t, before: h.state });
        if (c.t === "applied") h.deliverApplied();
        else if (c.t === "ended") h.deliverEnded();
        else h.deliverError();
      }
    }
    // The manager's own count never drifts from the truth.
    expect(m.liveHandleCount()).toBe(backend.live());
  }
  backend.flush();
  expect(m.liveHandleCount()).toBe(backend.live());
  expect(backend.live()).toBeLessThanOrEqual(REGION_MAX_HANDLES);
  if (!failed && last) {
    expect(backend.live()).toBe(m.heldKeys().length);
    const { cx, cy } = columnOf(last.x, last.y);
    const band = bandOf(last.floor);
    const held = new Set(m.heldKeys().map(handleId));
    for (let dx = -REGION_RADIUS_CHUNKS; dx <= REGION_RADIUS_CHUNKS; dx++) {
      for (let dy = -REGION_RADIUS_CHUNKS; dy <= REGION_RADIUS_CHUNKS; dy++) {
        expect(held.has(handleId({ cx: cx + dx, cy: cy + dy, band }))).toBe(true);
      }
    }
  }
  return { trace, subscribingMoves, failed, oldPlusFresh };
}

describe("RegionSubscriptions", () => {
  it("requests the initial region around the first position, nearest first", () => {
    const backend = new FakeBackend();
    const m = manager(backend);
    m.moveTo(5, 5, 0);
    expect(backend.handles).toHaveLength((2 * REGION_RADIUS_CHUNKS + 1) ** 2);
    expect(backend.handles[0]?.key).toEqual({ cx: 0, cy: 0, band: 0 });
  });

  it("never resubscribes however many frames are spent inside one chunk", () => {
    const backend = new FakeBackend();
    const m = manager(backend);
    m.moveTo(0, 0, 0);
    const requested = backend.handles.length;
    for (let i = 0; i < 5000; i++) m.moveTo((i % CHUNK_SIZE) + 0.25, (i % 31) + 0.5, 0);
    expect(backend.handles).toHaveLength(requested);
  });

  it("a crossing requests only the new columns and keeps the old ones", () => {
    const backend = new FakeBackend();
    const m = manager(backend);
    m.moveTo(0, 0, 0);
    backend.flush();
    const before = backend.handles.length;
    m.moveTo(CHUNK_SIZE, 0, 0);
    expect(backend.handles.length - before).toBe(2 * REGION_RADIUS_CHUNKS + 1);
    expect(backend.handles.slice(before).every((h) => h.key.cx === 1 + REGION_RADIUS_CHUNKS)).toBe(
      true,
    );
    // Nothing was released: the column left behind is still inside the
    // hysteresis band.
    expect(backend.handles.every((h) => h.state !== "unsubscribing")).toBe(true);
  });

  it("releases a handle only after it has applied, never while pending", () => {
    const backend = new FakeBackend();
    const m = manager(backend);
    m.moveTo(0, 0, 0);
    // Teleport far away before anything applied: every old handle is
    // wanted no more, but still pending.
    m.moveTo(50 * CHUNK_SIZE, 0, 0);
    expect(backend.handles.some((h) => h.state === "unsubscribing")).toBe(false);
    for (const h of backend.handles) h.deliverApplied();
    backend.flush();
    expect(m.liveHandleCount()).toBe(backend.live());
    expect(backend.live()).toBe((2 * REGION_RADIUS_CHUNKS + 1) ** 2);
  });

  it("A -> B -> A while B is still pending reuses B's handle", () => {
    const backend = new FakeBackend();
    const m = manager(backend);
    m.moveTo(0, 0, 0);
    backend.flush();
    m.moveTo(10 * CHUNK_SIZE, 0, 0); // B, pending
    m.moveTo(0, 0, 0); // back to A before B applied
    backend.flush();
    expect(m.liveHandleCount()).toBe(backend.live());
    expect(m.heldKeys().length).toBe(backend.live());
  });

  it("reports a rejected region subscription through the status path and stops", () => {
    const backend = new FakeBackend();
    const errors: string[] = [];
    const m = manager(backend, (e) => errors.push(e));
    m.moveTo(0, 0, 0);
    backend.handles[3]?.deliverError();
    expect(errors).toEqual(["rejected"]);
    const before = backend.handles.length;
    m.moveTo(10 * CHUNK_SIZE, 0, 0);
    expect(backend.handles).toHaveLength(before);
    expect(m.liveHandleCount()).toBe(backend.live());
  });

  it("an error on a handle that is already unsubscribing ends it, with liveHandleCount() equal to backend.live()", () => {
    const backend = new FakeBackend();
    const errors: string[] = [];
    const m = manager(backend, (e) => errors.push(e));
    m.moveTo(0, 0, 0);
    backend.flush();
    m.moveTo(0, -97, 0);
    const ending = backend.handles.find((h) => h.state === "unsubscribing");
    expect(ending).toBeDefined();
    ending?.deliverError();
    expect(errors).toEqual(["rejected"]);
    expect(m.liveHandleCount()).toBe(backend.live());
  });

  it("an error on an old ending handle leaves the new handle for the same column held and counted", () => {
    const backend = new FakeBackend();
    const m = manager(backend);
    m.moveTo(0, 0, 0);
    backend.flush();
    m.moveTo(0, -97, 0); // the near columns leave: unsubscribing
    m.moveTo(0, 0, 0); // and are requested again while the old ones still end
    const id = handleId({ cx: 0, cy: 0, band: 0 });
    const old = backend.handles.find((h) => handleId(h.key) === id && h.state === "unsubscribing");
    const fresh = backend.handles.find((h) => handleId(h.key) === id && h.state === "pending");
    expect(old).toBeDefined();
    expect(fresh).toBeDefined();
    old?.deliverError();
    expect(m.liveHandleCount()).toBe(backend.live());
    expect(m.heldKeys().map(handleId)).toContain(id);
  });

  it("a handle leaves the live count exactly once, whichever of onError and onEnded comes second", () => {
    for (const errorFirst of [true, false]) {
      const backend = new FakeBackend();
      const m = manager(backend);
      m.moveTo(0, 0, 0);
      backend.flush();
      m.moveTo(0, -97, 0);
      const ending = backend.handles.find((h) => h.state === "unsubscribing");
      if (!ending) throw new Error("no ending handle");
      if (errorFirst) {
        ending.deliverError();
        ending.cb.onEnded();
      } else {
        ending.deliverEnded();
        ending.cb.onError("late");
      }
      expect(m.liveHandleCount()).toBe(backend.live());
      expect(m.liveHandleCount()).toBeGreaterThanOrEqual(0);
    }
  });

  it("calls onApplied for every handle that applies, with its key", () => {
    const backend = new FakeBackend();
    const applied: string[] = [];
    const m = new RegionSubscriptions(backend, FLOORS, {
      onError: noop,
      onApplied: (k) => applied.push(handleId(k)),
    });
    m.moveTo(0, 0, 0);
    backend.handles[0]?.deliverApplied();
    expect(applied).toEqual([handleId({ cx: 0, cy: 0, band: 0 })]);
  });

  // any schedule of crossings and deliveries ends with live handles == held set <= bound
  // CI worst case under coverage: 0.73 s (run 37229489003); the property's case count is the thing under test, so the work
  // cannot shrink. 60 s is over 10x that.
  const PROPERTY_TIMEOUT_MS = 60_000;
  it("inv_interest_handles_never_leak", { timeout: PROPERTY_TIMEOUT_MS }, () => {
    const pos = fc.record({
      x: fc.integer({ min: -400, max: 400 }),
      y: fc.integer({ min: -400, max: 400 }),
      floor: fc.integer({ min: FLOORS.minFloor, max: FLOORS.maxFloor }),
    });
    const nat = fc.nat();
    const unit = fc.integer({ min: -1, max: 1 });
    const walkStep: fc.Arbitrary<Command> = fc.oneof(
      { weight: 1, arbitrary: pos.map((p) => ({ t: "move" as const, p })) },
      { weight: 4, arbitrary: fc.record({ t: fc.constant("step" as const), dx: unit, dy: unit }) },
      { weight: 3, arbitrary: nat.map((i) => ({ t: "applied" as const, i })) },
      { weight: 2, arbitrary: fc.constant({ t: "applyAll" as const }) },
      { weight: 3, arbitrary: nat.map((i) => ({ t: "ended" as const, i })) },
    );
    // The error may follow a move at once, while the handles it requested
    // or released are still pending or ending.
    const firstError: fc.Arbitrary<Command[] | null> = fc
      .option(
        fc.tuple<[Command | null, Command | null, Command]>(
          fc.option<Command | null>(
            fc.oneof(
              { weight: 3, arbitrary: pos.map((p) => ({ t: "move" as const, p })) },
              {
                weight: 1,
                arbitrary: fc.record({ t: fc.constant("step" as const), dx: unit, dy: unit }),
              },
            ),
            { freq: 3, nil: null },
          ),
          fc.option<Command | null>(fc.constant({ t: "applyAll" as const }), {
            freq: 2,
            nil: null,
          }),
          fc.oneof(
            { weight: 10, arbitrary: nat.map((i) => ({ t: "errorPending" as const, i })) },
            { weight: 3, arbitrary: nat.map((i) => ({ t: "errorApplied" as const, i })) },
            { weight: 3, arbitrary: nat.map((i) => ({ t: "errorEnding" as const, i })) },
          ),
        ),
        { freq: 3, nil: null },
      )
      .map((e) => (e ? [e[0], e[1], e[2]].filter((c): c is Command => c !== null) : null));
    const tailStep: fc.Arbitrary<Command> = fc.oneof(
      walkStep,
      nat.map((i) => ({ t: "errorPending" as const, i })),
      nat.map((i) => ({ t: "errorApplied" as const, i })),
      nat.map((i) => ({ t: "errorEnding" as const, i })),
    );
    // An error-free walk, then at most one error, then a tail of deliveries.
    // Stated: up to 120 walk steps, 3 error steps and 30 tail steps. Fast-check's
    // default stops each array at 10, so 23 is the most it would reach.
    const probe = sizeProbe({ min: 0, max: 153, ceiling: 23 });
    const schedule = fc
      .tuple(
        fc.array(walkStep, { maxLength: 120 }),
        firstError,
        fc.array(tailStep, { maxLength: 30 }),
      )
      .map(([walk, error, tail]) =>
        error
          ? [...walk, ...error, ...tail]
          : [...walk, ...tail.filter((c) => !c.t.startsWith("error"))],
      )
      .map((commands) => {
        probe.record(commands.length);
        return commands;
      });

    const reports: Report[] = [];
    fc.assert(
      fc.property(schedule, (commands) => {
        reports.push(runSchedule(commands));
      }),
    );

    probe.expectReached(100);

    // The generator's depth is a tested fact: the run holds at least one
    // schedule of each kind (each is drawn in about 20% of schedules, so a
    // fresh seed misses one with negligible probability).
    const firstErrorState = (r: Report): State | undefined =>
      r.trace.find((d) => d.t.startsWith("error"))?.before;
    const count = (pred: (r: Report) => boolean): number => reports.filter(pred).length;
    expect(count((r) => r.subscribingMoves >= 10 && !r.failed)).toBeGreaterThan(0);
    expect(count((r) => firstErrorState(r) === "pending")).toBeGreaterThan(0);
    expect(count((r) => firstErrorState(r) === "applied")).toBeGreaterThan(0);
    expect(count((r) => firstErrorState(r) === "unsubscribing")).toBeGreaterThan(0);
    expect(count((r) => r.oldPlusFresh)).toBeGreaterThan(0);
  });

  // Shrunk counterexamples of the property, pinned as plain schedules.
  const move = (x: number, y: number): Command => ({ t: "move", p: { x, y, floor: 0 } });
  const PINNED: [string, Command[]][] = [
    [
      "seed 2: move, move, applied, error on the ending handle",
      [move(0, 0), move(0, 160), { t: "applied", i: 1064248856 }, { t: "error", i: 6 }],
    ],
    [
      "seed 11: move, applied, move four chunks away, error on the ending handle",
      [move(0, 0), { t: "applied", i: 0 }, move(0, -97), { t: "error", i: 0 }],
    ],
    [
      "seed 27: move, move, move, applied, error on the ending handle",
      [
        move(0, 320),
        move(0, 0),
        move(32, 352),
        { t: "applied", i: 636130896 },
        { t: "error", i: 831279709 },
      ],
    ],
    [
      "seed 28: move, move, applied, error on the ending handle",
      [move(0, 0), move(0, -129), { t: "applied", i: 1531636474 }, { t: "error", i: 1274411124 }],
    ],
    [
      "seed 38: move, applied, move, error on the ending handle",
      [move(0, 0), { t: "applied", i: 77 }, move(0, 128), { t: "error", i: 1062737552 }],
    ],
  ];

  it.each(PINNED)("%s", (_name, commands) => {
    const { trace } = runSchedule(commands);
    expect(trace.at(-1)).toMatchObject({ t: "error", before: "unsubscribing" });
  });

  it("negative control: a manager that keeps an errored ending handle fails every pinned schedule", () => {
    for (const [, commands] of PINNED) {
      expect(() => runSchedule(commands, new FakeBackend(true))).toThrow(/expected \d+ to be \d+/);
    }
  });

  it("fires onInitialApplied exactly once even when first-region handles are released while pending", () => {
    const backend = new FakeBackend();
    let initial = 0;
    const m = new RegionSubscriptions(backend, FLOORS, {
      onError: noop,
      onInitialApplied: () => initial++,
    });
    m.moveTo(0, 0, 0);
    // Past the leave radius before anything applied: every first handle is
    // unwanted while still pending.
    m.moveTo(50 * CHUNK_SIZE, 0, 0);
    backend.flush();
    expect(initial).toBe(1);
    expect(m.liveHandleCount()).toBe(backend.live());
  });

  it("keeps a handle a backend applies synchronously, inside subscribe()", () => {
    class SyncBackend extends FakeBackend {
      override subscribe(key: HandleKey, _range: FloorRange, cb: HandleCallbacks): RegionHandle {
        const h = new FakeHandle(key, cb);
        this.handles.push(h);
        h.deliverApplied();
        return h;
      }
    }
    const backend = new SyncBackend();
    let initial = 0;
    const m = new RegionSubscriptions(backend, FLOORS, {
      onError: noop,
      onInitialApplied: () => initial++,
    });
    m.moveTo(0, 0, 0);
    expect(m.appliedKeys()).toHaveLength((2 * REGION_RADIUS_CHUNKS + 1) ** 2);
    expect(initial).toBe(1);
    // Releasing them later reaches real handles.
    m.moveTo(50 * CHUNK_SIZE, 0, 0);
    backend.flush();
    expect(m.liveHandleCount()).toBe(backend.live());
  });
});

describe("RegionController", () => {
  it("a reconnect re-subscribes around the current position, not the spawn", () => {
    const first = new FakeBackend();
    const ctl = new RegionController();
    ctl.configure(FLOORS);
    ctl.moveTo(0, 0, 0);
    ctl.attach(first, { onError: noop });
    first.flush();
    ctl.moveTo(30 * CHUNK_SIZE, -7 * CHUNK_SIZE, 0);
    const second = new FakeBackend();
    ctl.attach(second, { onError: noop });
    expect(second.handles[0]?.key).toEqual({ cx: 30, cy: -7, band: 0 });
    expect(second.handles.every((h) => Math.abs(h.key.cx - 30) <= REGION_RADIUS_CHUNKS)).toBe(true);
  });

  it("holds nothing until it has a floor range, a backend and a position", () => {
    const backend = new FakeBackend();
    const ctl = new RegionController();
    ctl.attach(backend, { onError: noop });
    ctl.moveTo(0, 0, 0);
    expect(backend.handles).toHaveLength(0);
    ctl.configure(FLOORS);
    expect(backend.handles.length).toBeGreaterThan(0);
  });

  it("a position change after the first is edge-triggered through the controller", () => {
    const backend = new FakeBackend();
    const ctl = new RegionController();
    ctl.configure(FLOORS);
    ctl.attach(backend, { onError: noop });
    ctl.moveTo(0, 0, 0);
    const n = backend.handles.length;
    for (let i = 0; i < 100; i++) ctl.moveTo(i % 30, 3, 0);
    expect(backend.handles).toHaveLength(n);
  });

  it("fires onInitialApplied once, when every first handle has applied", () => {
    const backend = new FakeBackend();
    let initial = 0;
    const ctl = new RegionController();
    ctl.configure(FLOORS);
    ctl.attach(backend, { onError: noop, onInitialApplied: () => initial++ });
    ctl.moveTo(0, 0, 0);
    for (const h of backend.handles.slice(0, -1)) h.deliverApplied();
    expect(initial).toBe(0);
    backend.handles.at(-1)?.deliverApplied();
    expect(initial).toBe(1);
    ctl.moveTo(CHUNK_SIZE, 0, 0);
    backend.flush();
    expect(initial).toBe(1);
  });
});

// The 10,000-step session length is the property under test, so the work
// cannot shrink. CI worst case under coverage: 5.26 s (run 37219562625; 4.03 s
// in run 37229489003); 60 s is over 10x that, the same stated bound `camera-scroll.test.ts` gives its walk.
const LONG_WALK_TIMEOUT_MS = 60_000;

describe("a long session never accumulates what it left behind", {
  timeout: LONG_WALK_TIMEOUT_MS,
}, () => {
  it("a 10,000-step seeded walk over streamed rows keeps both indexes under the same bound at every step", () => {
    const grid = new CollisionGrid(
      16,
      new Map([[1, { width: 1, height: 1, collider: { x0: 0, y0: 0, x1: 16, y1: 16 } }]]),
    );
    const footprints = new FootprintIndex(new Map([[1, { width: 1, height: 1 }]]));
    const backend = new FakeBackend();
    const m = manager(backend);
    // One object at the centre of every column's chunk, inserted when the
    // column's handle applies and removed when it ends.
    const rowsOf = new Map<string, ReturnType<typeof rowFor>>();
    function rowFor(k: HandleKey) {
      return {
        objectId: BigInt(k.cx * 100000 + k.cy * 10 + k.band),
        defId: 1,
        x: k.cx * CHUNK_SIZE + 5,
        y: k.cy * CHUNK_SIZE + 5,
        floor: k.band === 0 ? 0 : -1,
        layer: 0,
        orientation: 0,
        chunkKey: 0n,
      };
    }
    const bound = REGION_MAX_HANDLES;
    let x = 0;
    let y = 0;
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let worst = 0;
    for (let step = 0; step < 10_000; step++) {
      // A biased random walk plus a rare teleport.
      x += Math.round((rnd() - 0.45) * 40);
      y += Math.round((rnd() - 0.5) * 40);
      if (rnd() < 0.002) x += 5000;
      m.moveTo(x, y, rnd() < 0.05 ? -1 : 0);
      for (const h of backend.handles) {
        if (h.state === "pending") {
          h.deliverApplied();
          const row = rowFor(h.key);
          rowsOf.set(handleId(h.key), row);
          grid.insert(row);
          footprints.insert(row);
        } else if (h.state === "unsubscribing") {
          h.deliverEnded();
          const row = rowsOf.get(handleId(h.key));
          if (row) {
            grid.delete(row);
            footprints.delete(row);
            rowsOf.delete(handleId(h.key));
          }
        }
      }
      const g = grid.allocatedChunkCount();
      const f = footprints.allocatedChunkCount();
      if (g > bound || f > bound) {
        throw new Error(`step ${step}: grid ${g} / footprints ${f} > ${bound}`);
      }
      worst = Math.max(worst, g, f);
    }
    expect(worst).toBeLessThanOrEqual(bound);
  });
});
