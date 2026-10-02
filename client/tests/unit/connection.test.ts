// Tests the wiring in net/connection.ts -- that it configures the builder
// from NET_CONFIG, subscribes to demo_ping on connect, and turns an
// onInsert row into a PingObservation -- without ever opening a socket.
// The generated bindings module is mocked; the real round trip over a real
// socket is client/tests/e2e/round-trip.spec.ts's job, not this file's.
import { Timestamp } from "spacetimedb";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeRow {
  id: bigint;
  message: string;
  writtenAt: Timestamp;
}

interface FakeModuleVersionRow {
  defsVersion: string;
  protocolVersion: string;
}

interface FakeState {
  uri?: string;
  databaseName?: string;
  onConnectCb?: (connection: unknown) => void;
  onConnectErrorCb?: (ctx: unknown, error: unknown) => void;
  onDisconnectCb?: (ctx: unknown, error?: unknown) => void;
  subscribedSql?: unknown;
  /** Every `subscribe` call, in order: the global one first, then one per region handle. */
  subs: Array<{
    queries: unknown;
    onApplied?: () => void;
    onError?: (ctx: { event?: unknown }) => void;
    unsubscribed: boolean;
  }>;
  onAppliedCb?: () => void;
  onSubscriptionErrorCb?: (ctx: { event?: unknown }) => void;
  onInsertCb?: (ctx: unknown, row: FakeRow) => void;
  onModuleVersionInsertCb?: (ctx: unknown, row: FakeModuleVersionRow) => void;
  onWorldClockInsertCb?: (ctx: unknown, row: { epochAt: Timestamp; speed: number }) => void;
  onWorldClockUpdateCb?: (
    ctx: unknown,
    old: unknown,
    row: { epochAt: Timestamp; speed: number },
  ) => void;
  syncCalls: number;
}

const state: FakeState = { syncCalls: 0, subs: [] };

function makeSubscriptionBuilder() {
  const sub: FakeState["subs"][number] = { queries: undefined, unsubscribed: false };
  const b = {
    onApplied: (cb: () => void) => {
      sub.onApplied = cb;
      if (state.subs.length === 0) state.onAppliedCb = cb;
      return b;
    },
    onError: (cb: (ctx: { event?: unknown }) => void) => {
      sub.onError = cb;
      if (state.subs.length === 0) state.onSubscriptionErrorCb = cb;
      return b;
    },
    subscribe: (queries: unknown) => {
      sub.queries = queries;
      if (state.subs.length === 0) state.subscribedSql = queries;
      state.subs.push(sub);
      return {
        unsubscribe: () => {},
        unsubscribeThen: (cb: () => void) => {
          sub.unsubscribed = true;
          cb();
        },
      };
    },
  };
  return b;
}

const fakeConn = {
  subscriptionBuilder: () => makeSubscriptionBuilder(),
  procedures: {
    syncClock: async () => {
      state.syncCalls += 1;
      return Timestamp.fromDate(new Date(5_000));
    },
  },
  db: {
    worldClock: {
      onInsert: (cb: (ctx: unknown, row: { epochAt: Timestamp; speed: number }) => void) => {
        state.onWorldClockInsertCb = cb;
      },
      onUpdate: (cb: (ctx: unknown, old: unknown, row: { epochAt: Timestamp }) => void) => {
        state.onWorldClockUpdateCb = cb;
      },
    },
    demoPing: {
      onInsert: (cb: (ctx: unknown, row: FakeRow) => void) => {
        state.onInsertCb = cb;
      },
    },
    moduleVersion: {
      onInsert: (cb: (ctx: unknown, row: FakeModuleVersionRow) => void) => {
        state.onModuleVersionInsertCb = cb;
      },
    },
  },
};

const builder = {
  withUri: (uri: string) => {
    state.uri = uri;
    return builder;
  },
  withDatabaseName: (name: string) => {
    state.databaseName = name;
    return builder;
  },
  onConnect: (cb: (connection: unknown) => void) => {
    state.onConnectCb = cb;
    return builder;
  },
  onConnectError: (cb: (ctx: unknown, error: unknown) => void) => {
    state.onConnectErrorCb = cb;
    return builder;
  },
  onDisconnect: (cb: (ctx: unknown, error?: unknown) => void) => {
    state.onDisconnectCb = cb;
    return builder;
  },
  build: () => fakeConn,
};

/** A table whose typed query is a marker naming it, so a test can tell
 * which tables a subscription named without any SQL string existing. */
function fakeTable(name: string) {
  return {
    build: () => `query:${name}`,
    where: () => ({ build: () => `query:${name}:where` }),
  };
}

vi.mock("../../src/net/bindings", () => ({
  DbConnection: { builder: () => builder },
  tables: {
    demoPing: fakeTable("demo_ping"),
    moduleVersion: fakeTable("module_version"),
    worldClock: fakeTable("world_clock"),
    placedObject: fakeTable("placed_object"),
    floorTransition: fakeTable("floor_transition"),
    buildingArea: fakeTable("building_area"),
    roomArea: fakeTable("room_area"),
    actorLocation: fakeTable("actor_location"),
  },
}));

const { connect } = await import("../../src/net/connection");
const regionModule = await import("../../src/net/region-subscription");
const { ServerClock } = await import("../../src/time/server-clock");
const { CLOCK_SYNC_INTERVAL_MS } = await import("../../src/time/clock-sync");

beforeEach(() => {
  state.uri = undefined;
  state.databaseName = undefined;
  state.onConnectCb = undefined;
  state.onConnectErrorCb = undefined;
  state.onDisconnectCb = undefined;
  state.subscribedSql = undefined;
  state.onAppliedCb = undefined;
  state.onSubscriptionErrorCb = undefined;
  state.onInsertCb = undefined;
  state.onModuleVersionInsertCb = undefined;
  state.onWorldClockInsertCb = undefined;
  state.onWorldClockUpdateCb = undefined;
  state.syncCalls = 0;
  state.subs = [];
});

describe("connect", () => {
  it("configures the builder from NET_CONFIG and returns the built connection", () => {
    const conn = connect(() => {});

    expect(state.uri).toBe("ws://127.0.0.1:3000");
    expect(state.databaseName).toBe("browser-city");
    expect(conn).toBe(fakeConn);
  });

  it("subscribes to demo_ping, module_version and world_clock, in one call, once the connection is established (FR147: no extra round trip)", () => {
    connect(() => {});

    state.onConnectCb?.(fakeConn);

    // Typed queries, never SQL strings: the whole-table set is exactly
    // the three global singletons.
    expect(state.subscribedSql).toEqual([
      "query:demo_ping",
      "query:module_version",
      "query:world_clock",
    ]);
  });

  describe("interest region (story 4.3)", () => {
    const { RegionController } = regionModule;
    const FLOORS = { minFloor: -1, maxFloor: 7 };

    function wired() {
      const controller = new RegionController();
      controller.configure(FLOORS);
      controller.moveTo(0, 0, 0);
      const statuses: string[] = [];
      const rows: string[] = [];
      connect(
        () => {},
        (status) => statuses.push(status),
        undefined,
        undefined,
        { controller },
      );
      return { controller, statuses, rows };
    }

    it("subscribes the region on connect, one handle per column, never a whole table", () => {
      wired();
      state.onConnectCb?.(fakeConn);
      // The global subscription plus one handle per column of the 5x5 region.
      expect(state.subs).toHaveLength(1 + 25);
      for (const sub of state.subs.slice(1)) {
        expect(sub.queries).toEqual(
          expect.arrayContaining(["query:placed_object:where", "query:actor_location:where"]),
        );
        expect(sub.queries).not.toContain("query:placed_object");
      }
    });

    it("marks the region applied once, when every initial handle has applied", () => {
      const markSpy = vi.spyOn(performance, "mark");
      wired();
      state.onConnectCb?.(fakeConn);
      const handles = state.subs.slice(1);
      for (const sub of handles.slice(0, -1)) sub.onApplied?.();
      expect(markSpy).not.toHaveBeenCalledWith("bc-boot:region-applied");
      handles.at(-1)?.onApplied?.();
      expect(markSpy).toHaveBeenCalledWith("bc-boot:region-applied");
      markSpy.mockRestore();
    });

    it("a rejected region subscription goes through the status path", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { statuses } = wired();
      state.onConnectCb?.(fakeConn);
      state.subs[3]?.onError?.({ event: new Error("rejected") });
      expect(statuses).toEqual(["connecting", "connected", "disconnected"]);
      errorSpy.mockRestore();
    });

    it("a reconnect is a new connect() and re-subscribes around the current position", () => {
      const { controller } = wired();
      state.onConnectCb?.(fakeConn);
      controller.moveTo(40 * 32, 0, 0);
      state.subs = [];
      connect(() => {}, undefined, undefined, undefined, { controller });
      state.onConnectCb?.(fakeConn);
      expect(state.subs).toHaveLength(1 + 25);
    });

    it("registers each region table's row callbacks once and forwards plain data", () => {
      const inserted: string[] = [];
      const registered: string[] = [];
      const db = fakeConn.db as Record<string, unknown>;
      for (const t of [
        "placedObject",
        "floorTransition",
        "buildingArea",
        "roomArea",
        "actorLocation",
      ]) {
        db[t] = {
          onInsert: (cb: (ctx: unknown, row: { chunkKey: bigint }) => void) => {
            registered.push(t);
            cb({}, { chunkKey: 7n });
          },
          onUpdate: () => {},
          onDelete: () => {},
        };
      }
      const controller = new RegionController();
      connect(() => {}, undefined, undefined, undefined, {
        controller,
        rows: {
          onInsert: (table, row) =>
            inserted.push(`${table}:${(row as { chunkKey: bigint }).chunkKey}`),
          onUpdate: () => {},
          onDelete: () => {},
        },
      });
      expect(registered.sort()).toEqual([
        "actorLocation",
        "buildingArea",
        "floorTransition",
        "placedObject",
        "roomArea",
      ]);
      expect(inserted).toHaveLength(5);
      for (const t of registered) delete db[t];
    });
  });

  describe("in-city clock wiring (story 4.1)", () => {
    const wiring = () => {
      const epochs: Array<[bigint, number, string]> = [];
      const serverClock = new ServerClock(() => 0);
      return {
        epochs,
        serverClock,
        clock: {
          serverClock,
          visibility: {
            visibilityState: "visible",
            addEventListener: () => {},
            removeEventListener: () => {},
          },
          onClock: (clock: { epochMicros: bigint; speed: number }, kind: "insert" | "update") =>
            epochs.push([clock.epochMicros, clock.speed, kind]),
        },
      };
    };

    it("reports the epoch row on insert and on a later rewrite", () => {
      const w = wiring();
      connect(() => {}, undefined, undefined, w.clock);
      const at = Timestamp.fromDate(new Date(1_000));
      state.onWorldClockInsertCb?.({}, { epochAt: at, speed: 1 });
      state.onWorldClockUpdateCb?.({}, {}, { epochAt: at, speed: 10 });
      expect(w.epochs).toEqual([
        [1_000_000n, 1, "insert"],
        [1_000_000n, 10, "update"],
      ]);
    });

    it("registers no world_clock callbacks and makes no sync call without wiring", () => {
      connect(() => {});
      state.onConnectCb?.(fakeConn);
      expect(state.onWorldClockInsertCb).toBeUndefined();
      expect(state.syncCalls).toBe(0);
    });

    it("starts a stamped sync on connect and stops it on disconnect", async () => {
      vi.useFakeTimers();
      try {
        const w = wiring();
        connect(() => {}, undefined, undefined, w.clock);
        state.onConnectCb?.(fakeConn);
        await vi.advanceTimersByTimeAsync(10);
        expect(state.syncCalls).toBe(1);
        expect(w.serverClock.nowMicros()).toBeDefined();
        state.onDisconnectCb?.({}, undefined);
        await vi.advanceTimersByTimeAsync(CLOCK_SYNC_INTERVAL_MS * 2);
        expect(state.syncCalls).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("turns an onInsert row into a PingObservation via observePingInsert", () => {
    const received: Array<{
      id: bigint;
      message: string;
      writtenAtMs: number;
      observedAtMs: number;
    }> = [];
    connect((observation) => received.push(observation));

    state.onInsertCb?.({}, { id: 5n, message: "hi", writtenAt: Timestamp.fromDate(new Date(123)) });

    expect(received).toHaveLength(1);
    expect(received[0]?.id).toBe(5n);
    expect(received[0]?.message).toBe("hi");
    expect(received[0]?.writtenAtMs).toBe(123);
    expect(typeof received[0]?.observedAtMs).toBe("number");
  });

  it("marks the handshake open and the subscription applied (NFR1) at their own distinct moments", () => {
    const markSpy = vi.spyOn(performance, "mark");
    connect(() => {});

    expect(markSpy).not.toHaveBeenCalledWith("bc-boot:handshake-open");
    state.onConnectCb?.(fakeConn);
    expect(markSpy).toHaveBeenCalledWith("bc-boot:handshake-open");
    expect(markSpy).not.toHaveBeenCalledWith("bc-boot:subscription-applied");

    state.onAppliedCb?.();
    expect(markSpy).toHaveBeenCalledWith("bc-boot:subscription-applied");

    markSpy.mockRestore();
  });

  it("logs rather than throws on a connection error (NFR42)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    connect(() => {});

    expect(() => state.onConnectErrorCb?.({}, new Error("boom"))).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  describe("onStatus (story 1.11)", () => {
    it("is called synchronously with 'connecting' before anything else happens", () => {
      const statuses: string[] = [];
      connect(
        () => {},
        (status) => statuses.push(status),
      );
      expect(statuses).toEqual(["connecting"]);
    });

    it("moves to 'connected' once the handshake completes", () => {
      const statuses: string[] = [];
      connect(
        () => {},
        (status) => statuses.push(status),
      );
      state.onConnectCb?.(fakeConn);
      expect(statuses).toEqual(["connecting", "connected"]);
    });

    it("moves to 'disconnected' on a connect error at boot -- never having connected", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const statuses: string[] = [];
      connect(
        () => {},
        (status) => statuses.push(status),
      );
      state.onConnectErrorCb?.({}, new Error("boom"));
      expect(statuses).toEqual(["connecting", "disconnected"]);
    });

    it("moves to 'disconnected' on a drop after a successful connect", () => {
      const statuses: string[] = [];
      connect(
        () => {},
        (status) => statuses.push(status),
      );
      state.onConnectCb?.(fakeConn);
      state.onDisconnectCb?.({}, undefined);
      expect(statuses).toEqual(["connecting", "connected", "disconnected"]);
    });

    it("a drop's error, when there is one, is logged rather than thrown (NFR42)", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      connect(() => {});
      state.onConnectCb?.(fakeConn);
      expect(() => state.onDisconnectCb?.({}, new Error("closed"))).not.toThrow();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("connect() never throws when no onStatus listener is given at all", () => {
      expect(() => {
        connect(() => {});
        state.onConnectCb?.(fakeConn);
        state.onDisconnectCb?.({}, undefined);
      }).not.toThrow();
    });

    it("a rejected subscription moves to 'disconnected' too (Tim's finding 6: no onError left the boot gate waiting forever)", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const statuses: string[] = [];
      connect(
        () => {},
        (status) => statuses.push(status),
      );
      state.onConnectCb?.(fakeConn);
      expect(() =>
        state.onSubscriptionErrorCb?.({ event: new Error("subscribe rejected") }),
      ).not.toThrow();
      expect(statuses).toEqual(["connecting", "connected", "disconnected"]);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe("onHandshake (story 2.8, FR147)", () => {
    it("is called with the module_version row's defsVersion/protocolVersion once it inserts", () => {
      const received: Array<{ defsVersion: string; protocolVersion: string }> = [];
      connect(
        () => {},
        undefined,
        (version) => received.push(version),
      );
      state.onConnectCb?.(fakeConn);

      state.onModuleVersionInsertCb?.({}, { defsVersion: "d1", protocolVersion: "p1" });

      expect(received).toEqual([{ defsVersion: "d1", protocolVersion: "p1" }]);
    });

    it("connect() never throws when no onHandshake listener is given at all", () => {
      expect(() => {
        connect(() => {});
        state.onConnectCb?.(fakeConn);
        state.onModuleVersionInsertCb?.({}, { defsVersion: "d1", protocolVersion: "p1" });
      }).not.toThrow();
    });
  });
});
