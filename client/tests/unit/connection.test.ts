// Tests the wiring in net/connection.ts -- that it configures the builder
// from NET_CONFIG, subscribes to demo_ping on connect, and turns an
// onInsert row into a PingObservation -- without ever opening a socket.
// The generated bindings module is mocked; the real round trip over a real
// socket is client/tests/e2e/round-trip.spec.ts's job, not this file's.
import { Timestamp } from "spacetimedb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_STORAGE_KEY } from "../../src/identity/identity-storage";
import type {
  ClockWiring,
  ConnectionStatus,
  ConnectOptions,
  HandshakeVersion,
} from "../../src/net/connection";
import type { PingObservation } from "../../src/net/observe-ping";
import type { SettingsStorage } from "../../src/settings/settings-storage";

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
  onConnectCb?: (connection: unknown, identity?: unknown, token?: string) => void;
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
  token?: string;
  withTokenCalls: number;
  subscribeCalls: number;
  disconnectCalls: number;
  builds: number;
  onMyCharacterInsertCb?: (ctx: unknown, row: FakeMyCharacterRow) => void;
}

interface FakeMyCharacterRow {
  characterId: bigint;
  createdAt: Timestamp;
  linked: boolean;
}

const state: FakeState = {
  syncCalls: 0,
  subs: [],
  withTokenCalls: 0,
  subscribeCalls: 0,
  disconnectCalls: 0,
  builds: 0,
};

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
      if (state.subs.length === 0) state.subscribeCalls += 1;
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
  // The SDK fires `onDisconnect` for a client-initiated close too; a fake
  // that stayed silent would hide any status a deliberate close reports.
  disconnect: () => {
    state.disconnectCalls += 1;
    state.onDisconnectCb?.({}, undefined);
  },
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
    myCharacter: {
      onInsert: (cb: (ctx: unknown, row: FakeMyCharacterRow) => void) => {
        state.onMyCharacterInsertCb = cb;
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
  withToken: (token: string) => {
    state.token = token;
    state.withTokenCalls += 1;
    return builder;
  },
  onConnect: (cb: (connection: unknown, identity?: unknown, token?: string) => void) => {
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
  build: () => {
    state.builds += 1;
    return fakeConn;
  },
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
    myCharacter: fakeTable("my_character"),
    placedObject: fakeTable("placed_object"),
    floorTransition: fakeTable("floor_transition"),
    buildingArea: fakeTable("building_area"),
    roomArea: fakeTable("room_area"),
    actorLocation: fakeTable("actor_location"),
    playerPosition: fakeTable("player_position"),
  },
}));

const { connect: connectWith } = await import("../../src/net/connection");
const regionModule = await import("../../src/net/region-subscription");

/** The pre-4.5 positional shape these tests were written in, over the
 * options object `connect` takes now. */
function connect(
  onPing: (o: PingObservation) => void,
  onStatus?: (s: ConnectionStatus) => void,
  onHandshake?: (v: HandshakeVersion) => void,
  clock?: ClockWiring,
  extra: Partial<ConnectOptions> = {},
) {
  return connectWith({ onPing, onStatus, onHandshake, clock, ...extra });
}
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
  state.token = undefined;
  state.withTokenCalls = 0;
  state.subscribeCalls = 0;
  state.subs = [];
  state.disconnectCalls = 0;
  state.builds = 0;
  state.onMyCharacterInsertCb = undefined;
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
      "query:my_character",
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
        { region: { controller } },
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
      connect(() => {}, undefined, undefined, undefined, { region: { controller } });
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
        "playerPosition",
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
        region: {
          controller,
          rows: {
            onInsert: (table, row) =>
              inserted.push(`${table}:${(row as { chunkKey: bigint }).chunkKey}`),
            onUpdate: () => {},
            onDelete: () => {},
          },
        },
      });
      expect(registered.sort()).toEqual([
        "actorLocation",
        "buildingArea",
        "floorTransition",
        "placedObject",
        "playerPosition",
        "roomArea",
      ]);
      expect(inserted).toHaveLength(6);
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

// ---------------------------------------------------------------------------
// Story 4.5 (FR141): the identity token's whole lifecycle.
// ---------------------------------------------------------------------------

function fakeStorage(initial: Record<string, string> = {}, failWrites = false) {
  const data = new Map(Object.entries(initial));
  const writes: [string, string][] = [];
  const storage: SettingsStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (failWrites) throw new Error("QuotaExceededError");
      writes.push([k, v]);
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
  return { storage, data, writes };
}

const blob = (token: string) => JSON.stringify({ version: 1, token });
const identity = { toHexString: () => "c200abcd" };

describe("identity token (story 4.5, FR141)", () => {
  it("connects with withToken when a token is stored, and without when none is", () => {
    const withStored = fakeStorage({ [IDENTITY_STORAGE_KEY]: blob("stored-tok") });
    connect(() => {}, undefined, undefined, undefined, { storage: withStored.storage });
    expect(state.withTokenCalls).toBe(1);
    expect(state.token).toBe("stored-tok");

    state.withTokenCalls = 0;
    connect(() => {}, undefined, undefined, undefined, { storage: fakeStorage().storage });
    expect(state.withTokenCalls).toBe(0);
  });

  it("still subscribes exactly once, with or without a token", () => {
    const f = fakeStorage({ [IDENTITY_STORAGE_KEY]: blob("t") });
    connect(() => {}, undefined, undefined, undefined, { storage: f.storage });
    state.onConnectCb?.(fakeConn, identity, "t");
    expect(state.subscribeCalls).toBe(1);
  });

  it("stores the token a first visit is handed, once, and reports the identity persisted", () => {
    const f = fakeStorage();
    const seen: unknown[] = [];
    connect(() => {}, undefined, undefined, undefined, {
      storage: f.storage,
      onIdentity: (i) => seen.push(i),
    });
    state.onConnectCb?.(fakeConn, identity, "fresh-tok");
    expect(f.writes).toEqual([[IDENTITY_STORAGE_KEY, blob("fresh-tok")]]);
    expect(seen).toEqual([{ identityHex: "c200abcd", persisted: true }]);
  });

  it("writes nothing on a returning visit (the stored token is presented back)", () => {
    const f = fakeStorage({ [IDENTITY_STORAGE_KEY]: blob("t") });
    connect(() => {}, undefined, undefined, undefined, { storage: f.storage });
    state.onConnectCb?.(fakeConn, identity, "t");
    expect(f.writes).toEqual([]);
  });

  it("a storage write that throws does not break the session", () => {
    const f = fakeStorage({}, true);
    const statuses: string[] = [];
    const seen: unknown[] = [];
    connect(
      () => {},
      (s) => statuses.push(s),
      undefined,
      undefined,
      { storage: f.storage, onIdentity: (i) => seen.push(i) },
    );
    expect(() => state.onConnectCb?.(fakeConn, identity, "t")).not.toThrow();
    expect(statuses).toEqual(["connecting", "connected"]);
    expect(state.subscribeCalls).toBe(1);
    expect(seen).toEqual([{ identityHex: "c200abcd", persisted: false }]);
  });

  it("a second tab that stored a token first wins: this tab keeps its connection as a session-only identity", () => {
    const f = fakeStorage();
    const statuses: string[] = [];
    const seen: unknown[] = [];
    connect(
      () => {},
      (s) => statuses.push(s),
      undefined,
      undefined,
      { storage: f.storage, onIdentity: (i) => seen.push(i) },
    );
    // The other tab writes between this connect starting and its handshake.
    f.data.set(IDENTITY_STORAGE_KEY, blob("other-tab"));
    state.onConnectCb?.(fakeConn, identity, "mine");
    expect(f.writes).toEqual([]);
    expect(f.data.get(IDENTITY_STORAGE_KEY)).toBe(blob("other-tab"));
    expect(state.builds).toBe(1);
    expect(state.disconnectCalls).toBe(0);
    expect(statuses).toEqual(["connecting", "connected"]);
    expect(state.subscribeCalls).toBe(1);
    expect(seen).toEqual([{ identityHex: "c200abcd", persisted: false }]);
  });

  describe("the stored token is never replaced or removed by a failure", () => {
    const stored = { [IDENTITY_STORAGE_KEY]: blob("precious") };

    it("a connect error", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const f = fakeStorage(stored);
      connect(() => {}, undefined, undefined, undefined, { storage: f.storage });
      state.onConnectErrorCb?.({}, new Error("boom"));
      expect(f.writes).toEqual([]);
      expect(f.data.get(IDENTITY_STORAGE_KEY)).toBe(blob("precious"));
    });

    it("a rejected token keeps the token and reports disconnected, never an anonymous fallback", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const f = fakeStorage(stored);
      const statuses: string[] = [];
      connect(
        () => {},
        (s) => statuses.push(s),
        undefined,
        undefined,
        { storage: f.storage },
      );
      state.onConnectErrorCb?.({}, new Error("401 token rejected"));
      expect(statuses).toEqual(["connecting", "disconnected"]);
      expect(state.builds).toBe(1);
      expect(f.data.get(IDENTITY_STORAGE_KEY)).toBe(blob("precious"));
    });

    it("a dropped connection", () => {
      const f = fakeStorage(stored);
      connect(() => {}, undefined, undefined, undefined, { storage: f.storage });
      state.onConnectCb?.(fakeConn, identity, "precious");
      state.onDisconnectCb?.({}, new Error("closed"));
      expect(f.writes).toEqual([]);
      expect(f.data.get(IDENTITY_STORAGE_KEY)).toBe(blob("precious"));
    });

    it("a rejected subscription", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const f = fakeStorage(stored);
      connect(() => {}, undefined, undefined, undefined, { storage: f.storage });
      state.onConnectCb?.(fakeConn, identity, "precious");
      state.onSubscriptionErrorCb?.({ event: new Error("rejected") });
      expect(f.writes).toEqual([]);
      expect(f.data.get(IDENTITY_STORAGE_KEY)).toBe(blob("precious"));
    });

    it("a corrupt stored value survives a successful anonymous connect byte for byte", () => {
      const f = fakeStorage({ [IDENTITY_STORAGE_KEY]: "{corrupt" });
      connect(() => {}, undefined, undefined, undefined, { storage: f.storage });
      expect(state.withTokenCalls).toBe(0);
      state.onConnectCb?.(fakeConn, identity, "new-anon");
      expect(f.writes).toEqual([]);
      expect(f.data.get(IDENTITY_STORAGE_KEY)).toBe("{corrupt");
    });
  });

  it("reports the player's own character from the my_character view", () => {
    const seen: unknown[] = [];
    connect(() => {}, undefined, undefined, undefined, {
      storage: fakeStorage().storage,
      onCharacter: (c) => seen.push(c),
    });
    state.onMyCharacterInsertCb?.(
      {},
      { characterId: 7n, createdAt: Timestamp.fromDate(new Date(2_000)), linked: true },
    );
    expect(seen).toEqual([{ characterId: 7n, createdAtMicros: 2_000_000n, linked: true }]);
  });
});
