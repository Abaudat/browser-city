// Story 4.5: the two plain functions `net/` exposes for linking, without a
// socket: the generated bindings are mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface S {
  token?: string;
  uri?: string;
  onConnectCb?: (c: unknown) => void;
  onConnectErrorCb?: (ctx: unknown, e: unknown) => void;
  onDisconnectCb?: (ctx: unknown, e?: unknown) => void;
  calls: string[];
  completeResult: "ok" | "err";
}
const state: S = { calls: [], completeResult: "ok" };

const fakeConn = {
  disconnect: () => state.calls.push("disconnect"),
  reducers: {
    beginLink: async (p: { code: string }) => {
      state.calls.push(`beginLink:${p.code}`);
    },
    createCharacter: async () => {
      state.calls.push("createCharacter");
    },
    completeLink: async (p: { code: string }) => {
      state.calls.push(`completeLink:${p.code}`);
      if (state.completeResult === "err") throw new Error("both identities have a character");
    },
  },
};
const builder = {
  withUri: (u: string) => {
    state.uri = u;
    return builder;
  },
  withDatabaseName: () => builder,
  withToken: (t: string) => {
    state.token = t;
    return builder;
  },
  onConnect: (cb: (c: unknown) => void) => {
    state.onConnectCb = cb;
    return builder;
  },
  onConnectError: (cb: (ctx: unknown, e: unknown) => void) => {
    state.onConnectErrorCb = cb;
    return builder;
  },
  onDisconnect: (cb: (ctx: unknown, e?: unknown) => void) => {
    state.onDisconnectCb = cb;
    return builder;
  },
  build: () => fakeConn,
};
vi.mock("../../src/net/bindings", () => ({ DbConnection: { builder: () => builder } }));

const { newLinkCode, beginLink, completeLinkWithIdToken } = await import("../../src/net/link");

beforeEach(() => {
  state.token = undefined;
  state.onConnectCb = undefined;
  state.onConnectErrorCb = undefined;
  state.onDisconnectCb = undefined;
  state.calls = [];
  state.completeResult = "ok";
});

describe("newLinkCode", () => {
  it("is 256 bits of hex, from the injected source", () => {
    const code = newLinkCode((bytes) => {
      bytes.fill(0xab);
      return bytes;
    });
    expect(code).toBe("ab".repeat(32));
  });

  it("differs between calls with the real source", () => {
    expect(newLinkCode()).toMatch(/^[0-9a-f]{64}$/);
    expect(newLinkCode()).not.toBe(newLinkCode());
  });
});

describe("beginLink", () => {
  it("resolves once the server has stored the code", async () => {
    await beginLink(fakeConn as never, "c0de");
    expect(state.calls).toEqual(["beginLink:c0de"]);
  });
});

describe("completeLinkWithIdToken", () => {
  it("connects with the ID token, redeems the code, then closes", async () => {
    const done = completeLinkWithIdToken("id-token", "c0de");
    state.onConnectCb?.(fakeConn);
    await done;
    expect(state.token).toBe("id-token");
    expect(state.calls).toEqual(["completeLink:c0de", "disconnect"]);
  });

  it("rejects when the server refuses, and still closes", async () => {
    state.completeResult = "err";
    const done = completeLinkWithIdToken("id-token", "c0de");
    state.onConnectCb?.(fakeConn);
    await expect(done).rejects.toThrow(/character/);
    expect(state.calls).toEqual(["completeLink:c0de", "disconnect"]);
  });

  it("rejects when the server drops the connection at once (a token refused at connect)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const done = completeLinkWithIdToken("id-token", "c0de");
    state.onDisconnectCb?.({}, new Error("token was issued for another application"));
    await expect(done).rejects.toThrow(/another application/);
  });

  it("rejects when the connection fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const done = completeLinkWithIdToken("id-token", "c0de");
    state.onConnectErrorCb?.({}, new Error("401"));
    await expect(done).rejects.toThrow();
    expect(state.calls).toEqual([]);
  });
});
