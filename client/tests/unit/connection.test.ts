// @vitest-environment jsdom
// Tests the wiring in net/connection.ts -- that it configures the builder
// from NET_CONFIG, subscribes to demo_ping on connect, and turns an
// onInsert row into a PingObservation -- without ever opening a socket.
// The generated bindings module is mocked; the real round trip over a real
// socket is client/tests/e2e/round-trip.spec.ts's job, not this file's.
// jsdom (not the default `node` environment): `connect` now reads
// `window.location.search` for the `?bc-token=` deploy-smoke override.
import { Timestamp } from "spacetimedb";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeRow {
  id: bigint;
  message: string;
  writtenAt: Timestamp;
}

interface FakeState {
  uri?: string;
  databaseName?: string;
  token?: string | undefined;
  tokenCalled?: boolean;
  onConnectCb?: (connection: unknown) => void;
  onConnectErrorCb?: (ctx: unknown, error: unknown) => void;
  subscribedSql?: string;
  onAppliedCb?: () => void;
  onInsertCb?: (ctx: unknown, row: FakeRow) => void;
}

const state: FakeState = {};

const fakeSubscriptionBuilder = {
  onApplied: (cb: () => void) => {
    state.onAppliedCb = cb;
    return fakeSubscriptionBuilder;
  },
  subscribe: (sql: string) => {
    state.subscribedSql = sql;
    return { unsubscribe: () => {} };
  },
};

const fakeConn = {
  subscriptionBuilder: () => fakeSubscriptionBuilder,
  db: {
    demoPing: {
      onInsert: (cb: (ctx: unknown, row: FakeRow) => void) => {
        state.onInsertCb = cb;
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
  withToken: (token?: string) => {
    state.token = token;
    state.tokenCalled = true;
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
  build: () => fakeConn,
};

vi.mock("../../src/net/bindings", () => ({
  DbConnection: { builder: () => builder },
}));

const { connect } = await import("../../src/net/connection");

beforeEach(() => {
  window.history.pushState({}, "", "/");
  state.uri = undefined;
  state.databaseName = undefined;
  state.token = undefined;
  state.tokenCalled = undefined;
  state.onConnectCb = undefined;
  state.onConnectErrorCb = undefined;
  state.subscribedSql = undefined;
  state.onAppliedCb = undefined;
  state.onInsertCb = undefined;
});

describe("connect", () => {
  it("configures the builder from NET_CONFIG and returns the built connection", () => {
    const conn = connect(() => {});

    expect(state.uri).toBe("ws://127.0.0.1:3000");
    expect(state.databaseName).toBe("browser-city");
    expect(conn).toBe(fakeConn);
  });

  it("subscribes to demo_ping once the connection is established", () => {
    connect(() => {});

    state.onConnectCb?.(fakeConn);

    expect(state.subscribedSql).toBe("SELECT * FROM demo_ping");
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

  it("connects with no token when the URL carries no ?bc-token= override (every real player, always)", () => {
    connect(() => {});

    expect(state.tokenCalled).toBe(true);
    expect(state.token).toBeUndefined();
  });

  it("connects with the ?bc-token= query param's value when present (client/tests/e2e/deploy-smoke.spec.ts's own fixed identity, NFR39 live-database hygiene)", () => {
    window.history.pushState({}, "", "/?bc-token=fixed-smoke-identity");

    connect(() => {});

    expect(state.token).toBe("fixed-smoke-identity");
  });

  it("logs rather than throws on a connection error (NFR42)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    connect(() => {});

    expect(() => state.onConnectErrorCb?.({}, new Error("boom"))).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
