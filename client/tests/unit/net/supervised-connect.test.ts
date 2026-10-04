// Story 4.8: `connect()` under the supervisor -- stale-connection guard for
// every callback kind, row reconciliation across generations, and the
// identity a session-only tab keeps presenting. `connect` is mocked; the
// real SDK wiring is `connection.test.ts`'s and the e2e spec's.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectOptions } from "../../../src/net/connection";

const calls: ConnectOptions[] = [];
const conns: Array<{
  isSocketClosed: boolean;
  disconnect: ReturnType<typeof vi.fn>;
  procedures: { syncClock: ReturnType<typeof vi.fn> };
}> = [];

vi.mock("../../../src/net/connection", () => ({
  connect: (options: ConnectOptions) => {
    calls.push(options);
    options.onStatus?.("connecting");
    const conn = {
      isSocketClosed: false,
      disconnect: vi.fn(),
      procedures: { syncClock: vi.fn(() => Promise.resolve(0n)) },
    };
    conns.push(conn);
    return conn;
  },
}));

const { superviseConnect } = await import("../../../src/net/supervised-connect");

class Target {
  visibilityState = "visible";
  private readonly fns = new Map<string, Set<() => void>>();
  addEventListener(t: string, f: () => void) {
    this.fns.set(t, (this.fns.get(t) ?? new Set()).add(f));
  }
  removeEventListener(t: string, f: () => void) {
    this.fns.get(t)?.delete(f);
  }
  fire(t: string) {
    for (const f of [...(this.fns.get(t) ?? [])]) f();
  }
}

function setup() {
  calls.length = 0;
  conns.length = 0;
  const seen = {
    ping: vi.fn(),
    handshake: vi.fn(),
    identity: vi.fn(),
    character: vi.fn(),
    status: vi.fn(),
    clock: vi.fn(),
    attach: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    del: vi.fn(),
    upsert: vi.fn(),
    remove: vi.fn(),
    applied: vi.fn(),
  };
  const win = new Target();
  const doc = new Target();
  const sup = superviseConnect(
    {
      onPing: seen.ping,
      onHandshake: seen.handshake,
      onIdentity: seen.identity,
      onCharacter: seen.character,
      onStatus: seen.status,
      clock: {
        serverClock: undefined as never,
        visibility: undefined as never,
        onClock: seen.clock,
      },
      region: {
        controller: { attach: seen.attach },
        rows: { onInsert: seen.insert, onUpdate: seen.update, onDelete: seen.del },
        players: { onUpsert: seen.upsert, onRemove: seen.remove },
        onInitialApplied: seen.applied,
      },
    },
    { window: win, document: doc, random: () => 0 },
  );
  const reconnect = () => {
    calls.at(-1)?.onStatus?.("connected");
    calls.at(-1)?.onStatus?.("disconnected");
    win.fire("focus");
  };
  return { seen, sup, win, doc, reconnect };
}

const placed = (id: number, v = 0) => ({ objectId: BigInt(id), v }) as never;
const player = (id: string, x = 0) =>
  ({ characterId: id, tMs: 1, x, y: 0, floor: 0, fracX: 0, fracY: 0 }) as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("stale-connection guard", () => {
  it("lets no callback of a superseded connection reach the consumers", () => {
    const { seen, reconnect } = setup();
    const old = calls[0] as ConnectOptions;
    reconnect();
    expect(calls).toHaveLength(2);
    const before = seen.status.mock.calls.length;

    old.onPing(undefined as never);
    old.onHandshake?.({ defsVersion: "a", protocolVersion: "b" });
    old.onIdentity?.({ identityHex: "x", persisted: true });
    old.onCharacter?.({ characterId: 1n, createdAtMicros: 0n, linked: false });
    old.onStatus?.("connected");
    old.clock?.onClock({ epochMicros: 0n, speed: 1 }, "insert");
    old.region?.controller.attach({} as never, {} as never);
    old.region?.rows?.onInsert("placedObject", placed(1));
    old.region?.rows?.onUpdate("placedObject", placed(1), placed(1, 1));
    old.region?.rows?.onDelete("placedObject", placed(1));
    old.region?.players?.onUpsert(player("1"));
    old.region?.players?.onRemove("1");
    old.region?.onInitialApplied?.();
    old.onSession?.({ token: "late", persisted: true });

    for (const [name, spy] of Object.entries(seen)) {
      if (name === "status") expect(spy.mock.calls).toHaveLength(before);
      else expect(spy, name).not.toHaveBeenCalled();
    }
  });

  it("passes the current connection's callbacks through", () => {
    const { seen } = setup();
    const c = calls[0] as ConnectOptions;
    c.onPing(undefined as never);
    c.onHandshake?.({ defsVersion: "a", protocolVersion: "b" });
    c.onIdentity?.({ identityHex: "x", persisted: true });
    c.onCharacter?.({ characterId: 1n, createdAtMicros: 0n, linked: false });
    c.clock?.onClock({ epochMicros: 0n, speed: 1 }, "insert");
    c.region?.controller.attach({} as never, {} as never);
    c.region?.rows?.onUpdate("placedObject", placed(1), placed(1, 1));
    c.region?.rows?.onDelete("placedObject", placed(1));
    c.region?.players?.onRemove("1");
    for (const name of [
      "ping",
      "handshake",
      "identity",
      "character",
      "clock",
      "attach",
      "update",
      "del",
      "remove",
    ] as const) {
      expect(seen[name], name).toHaveBeenCalledTimes(1);
    }
  });
});

describe("one continuous world across a reconnect", () => {
  it("hands a re-inserted row on as an update, and an unchanged one as nothing", () => {
    const { seen, reconnect } = setup();
    const first = calls[0] as ConnectOptions;
    first.region?.rows?.onInsert("placedObject", placed(1, 0));
    first.region?.rows?.onInsert("placedObject", placed(2, 0));
    expect(seen.insert).toHaveBeenCalledTimes(2);
    reconnect();
    const second = calls[1] as ConnectOptions;
    second.region?.rows?.onInsert("placedObject", placed(1, 5));
    second.region?.rows?.onInsert("placedObject", placed(2, 0));
    expect(seen.insert).toHaveBeenCalledTimes(2);
    expect(seen.update).toHaveBeenCalledTimes(1);
    expect(seen.update).toHaveBeenCalledWith("placedObject", placed(1, 0), placed(1, 5));
  });

  it("deletes what the old connection held and the new region no longer has", () => {
    const { seen, reconnect } = setup();
    const first = calls[0] as ConnectOptions;
    first.region?.rows?.onInsert("placedObject", placed(1));
    first.region?.rows?.onInsert("placedObject", placed(2));
    first.region?.players?.onUpsert(player("7"));
    first.region?.players?.onUpsert(player("8"));
    reconnect();
    const second = calls[1] as ConnectOptions;
    second.region?.rows?.onInsert("placedObject", placed(2));
    second.region?.players?.onUpsert(player("8"));
    expect(seen.del).not.toHaveBeenCalled();
    second.region?.onInitialApplied?.();
    expect(seen.del).toHaveBeenCalledTimes(1);
    expect(seen.del).toHaveBeenCalledWith("placedObject", placed(1));
    expect(seen.remove).toHaveBeenCalledWith("7");
    expect(seen.remove).toHaveBeenCalledTimes(1);
    expect(seen.applied).toHaveBeenCalledTimes(1);
  });

  it("forgets a row the new connection deleted, so it is not swept twice", () => {
    const { seen, reconnect } = setup();
    (calls[0] as ConnectOptions).region?.rows?.onInsert("placedObject", placed(1));
    reconnect();
    const second = calls[1] as ConnectOptions;
    second.region?.rows?.onInsert("placedObject", placed(1));
    second.region?.rows?.onDelete("placedObject", placed(1));
    second.region?.onInitialApplied?.();
    expect(seen.del).toHaveBeenCalledTimes(1);
  });

  it("an upsert of an unchanged player raises nothing, a changed one does", () => {
    const { seen, reconnect } = setup();
    (calls[0] as ConnectOptions).region?.players?.onUpsert(player("1", 0));
    reconnect();
    const second = calls[1] as ConnectOptions;
    second.region?.players?.onUpsert(player("1", 0));
    expect(seen.upsert).toHaveBeenCalledTimes(1);
    second.region?.players?.onUpsert(player("1", 3));
    expect(seen.upsert).toHaveBeenCalledTimes(2);
  });
});

describe("identity and marks", () => {
  it("presents the first connection's token on every later one", () => {
    const { reconnect } = setup();
    expect((calls[0] as ConnectOptions).session).toBeUndefined();
    (calls[0] as ConnectOptions).onSession?.({ token: "tab-token", persisted: false });
    reconnect();
    expect((calls[1] as ConnectOptions).session).toEqual({ token: "tab-token", persisted: false });
    (calls[1] as ConnectOptions).onSession?.({ token: "other", persisted: true });
    reconnect();
    expect((calls[2] as ConnectOptions).session).toEqual({ token: "tab-token", persisted: false });
  });

  it("marks the boot only on the first connection", () => {
    const { reconnect } = setup();
    reconnect();
    expect((calls[0] as ConnectOptions).marks).toBe(true);
    expect((calls[1] as ConnectOptions).marks).toBe(false);
  });
});

describe("the supervisor's adapters", () => {
  it("probes with sync_clock, reads the socket state and closes by disconnect", async () => {
    const { sup, win } = setup();
    calls[0]?.onStatus?.("connected");
    expect(sup.current()).toBe(conns[0]);
    win.fire("focus");
    expect(conns[0]?.procedures.syncClock).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    (conns[0] as (typeof conns)[number]).isSocketClosed = true;
    win.fire("focus");
    expect(conns[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(sup.liveCount()).toBe(0);
    sup.stop();
  });

  it("defaults to real timers and Math.random", () => {
    vi.useFakeTimers();
    calls.length = 0;
    const win = new Target();
    const sup = superviseConnect({ onPing: () => {} }, { window: win, document: new Target() });
    calls[0]?.onStatus?.("disconnected");
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(calls).toHaveLength(2);
    win.fire("focus");
    sup.stop();
  });
});
