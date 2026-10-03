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

const FLOORS = { minFloor: -1, maxFloor: 7 };

type State = "pending" | "applied" | "unsubscribing" | "ended";

/** A stand-in for the SDK handle that is as strict as the real one:
 * `unsubscribe` is only valid on an applied handle, once. */
class FakeHandle implements RegionHandle {
  state: State = "pending";
  constructor(
    readonly key: HandleKey,
    private readonly cb: HandleCallbacks,
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
    this.state = "ended";
    this.cb.onError("rejected");
  }
}

class FakeBackend implements RegionBackend {
  readonly handles: FakeHandle[] = [];
  subscribe(key: HandleKey, _range: FloorRange, cb: HandleCallbacks): RegionHandle {
    const h = new FakeHandle(key, cb);
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
  it("inv_interest_handles_never_leak", () => {
    const pos = fc.record({
      x: fc.integer({ min: -400, max: 400 }),
      y: fc.integer({ min: -400, max: 400 }),
      floor: fc.integer({ min: FLOORS.minFloor, max: FLOORS.maxFloor }),
    });
    const command = fc.oneof(
      { weight: 4, arbitrary: pos.map((p) => ({ t: "move" as const, p })) },
      { weight: 3, arbitrary: fc.nat().map((i) => ({ t: "applied" as const, i })) },
      { weight: 3, arbitrary: fc.nat().map((i) => ({ t: "ended" as const, i })) },
      { weight: 1, arbitrary: fc.nat().map((i) => ({ t: "error" as const, i })) },
    );
    fc.assert(
      fc.property(fc.array(command, { maxLength: 120 }), (commands) => {
        const backend = new FakeBackend();
        let failed = false;
        const m = manager(backend, () => {
          failed = true;
        });
        let last: { x: number; y: number; floor: number } | undefined;
        for (const c of commands) {
          if (c.t === "move") {
            m.moveTo(c.p.x, c.p.y, c.p.floor);
            last = c.p;
          } else {
            const pool = backend.handles.filter((h) =>
              c.t === "applied"
                ? h.state === "pending"
                : c.t === "ended"
                  ? h.state === "unsubscribing"
                  : h.state !== "ended",
            );
            const h = pool[c.i % Math.max(pool.length, 1)];
            if (h) {
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
      }),
    );
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

describe("a long session never accumulates what it left behind", () => {
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
      expect(grid.allocatedChunkCount()).toBeLessThanOrEqual(bound);
      expect(footprints.allocatedChunkCount()).toBeLessThanOrEqual(bound);
    }
  });
});
