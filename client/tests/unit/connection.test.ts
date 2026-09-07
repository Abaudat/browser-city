// Tests the wiring in net/connection.ts -- that it configures the builder
// from NET_CONFIG, subscribes to demo_ping on connect, and turns an
// onInsert row into a PingObservation -- without ever opening a socket.
// The generated bindings module is mocked; the real round trip over a real
// socket is client/tests/e2e/round-trip.spec.ts's job, not this file's.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeState {
  uri?: string;
  databaseName?: string;
  onConnectCb?: (connection: unknown) => void;
  onConnectErrorCb?: (ctx: unknown, error: unknown) => void;
  subscribedSql?: string;
  onInsertCb?: (ctx: unknown, row: { id: bigint; message: string }) => void;
}

const state: FakeState = {};

const fakeConn = {
  subscriptionBuilder: () => ({
    subscribe: (sql: string) => {
      state.subscribedSql = sql;
      return { unsubscribe: () => {} };
    },
  }),
  db: {
    demoPing: {
      onInsert: (cb: (ctx: unknown, row: { id: bigint; message: string }) => void) => {
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
  state.uri = undefined;
  state.databaseName = undefined;
  state.onConnectCb = undefined;
  state.onConnectErrorCb = undefined;
  state.subscribedSql = undefined;
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
    const received: Array<{ id: bigint; message: string; observedAtMs: number }> = [];
    connect((observation) => received.push(observation));

    state.onInsertCb?.({}, { id: 5n, message: "hi" });

    expect(received).toHaveLength(1);
    expect(received[0]?.id).toBe(5n);
    expect(received[0]?.message).toBe("hi");
    expect(typeof received[0]?.observedAtMs).toBe("number");
  });

  it("logs rather than throws on a connection error (NFR42)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    connect(() => {});

    expect(() => state.onConnectErrorCb?.({}, new Error("boom"))).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
