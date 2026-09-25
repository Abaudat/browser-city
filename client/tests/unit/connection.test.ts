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
  subscribedSql?: string | string[];
  onAppliedCb?: () => void;
  onSubscriptionErrorCb?: (ctx: { event?: unknown }) => void;
  onInsertCb?: (ctx: unknown, row: FakeRow) => void;
  onModuleVersionInsertCb?: (ctx: unknown, row: FakeModuleVersionRow) => void;
  onWorldClockInsertCb?: (ctx: unknown, row: { epochAt: Timestamp }) => void;
  onWorldClockUpdateCb?: (ctx: unknown, old: unknown, row: { epochAt: Timestamp }) => void;
  syncCalls: number;
}

const state: FakeState = { syncCalls: 0 };

const fakeSubscriptionBuilder = {
  onApplied: (cb: () => void) => {
    state.onAppliedCb = cb;
    return fakeSubscriptionBuilder;
  },
  onError: (cb: (ctx: { event?: unknown }) => void) => {
    state.onSubscriptionErrorCb = cb;
    return fakeSubscriptionBuilder;
  },
  subscribe: (sql: string | string[]) => {
    state.subscribedSql = sql;
    return { unsubscribe: () => {} };
  },
};

const fakeConn = {
  subscriptionBuilder: () => fakeSubscriptionBuilder,
  procedures: {
    syncClock: async () => {
      state.syncCalls += 1;
      return Timestamp.fromDate(new Date(5_000));
    },
  },
  db: {
    worldClock: {
      onInsert: (cb: (ctx: unknown, row: { epochAt: Timestamp }) => void) => {
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

vi.mock("../../src/net/bindings", () => ({
  DbConnection: { builder: () => builder },
}));

const { connect } = await import("../../src/net/connection");
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

    expect(state.subscribedSql).toEqual([
      "SELECT * FROM demo_ping",
      "SELECT * FROM module_version",
      "SELECT * FROM world_clock",
    ]);
  });

  describe("in-city clock wiring (story 4.1)", () => {
    const wiring = () => {
      const epochs: Array<[bigint, string]> = [];
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
          onEpoch: (micros: bigint, kind: "insert" | "update") => epochs.push([micros, kind]),
        },
      };
    };

    it("reports the epoch row on insert and on a later rewrite", () => {
      const w = wiring();
      connect(() => {}, undefined, undefined, w.clock);
      const at = Timestamp.fromDate(new Date(1_000));
      state.onWorldClockInsertCb?.({}, { epochAt: at });
      state.onWorldClockUpdateCb?.({}, {}, { epochAt: at });
      expect(w.epochs).toEqual([
        [1_000_000n, "insert"],
        [1_000_000n, "update"],
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
