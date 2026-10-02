import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { method: string; arg?: unknown }[] = [];
let ctorSettings: Record<string, unknown> | undefined;
let callbackUser: { id_token: string; state: unknown } | Error = {
  id_token: "id-tok",
  state: { code: "c0de" },
};

vi.mock("oidc-client-ts", () => {
  class InMemoryWebStorage {}
  class WebStorageStateStore {
    constructor(public opts: unknown) {}
  }
  class UserManager {
    constructor(settings: Record<string, unknown>) {
      ctorSettings = settings;
    }
    async signinRedirect(arg: unknown) {
      calls.push({ method: "signinRedirect", arg });
    }
    async signinRedirectCallback(url: string) {
      calls.push({ method: "signinRedirectCallback", arg: url });
      if (callbackUser instanceof Error) throw callbackUser;
      return callbackUser;
    }
    async removeUser() {
      calls.push({ method: "removeUser" });
    }
  }
  return { UserManager, WebStorageStateStore, InMemoryWebStorage };
});

const { startLink, finishLink, hasLinkCallback, stripLinkCallback } = await import(
  "../../../src/identity/link-flow"
);

const CFG = { authority: "https://idp.example", clientId: "bc" };

beforeEach(() => {
  calls.length = 0;
  ctorSettings = undefined;
  callbackUser = { id_token: "id-tok", state: { code: "c0de" } };
});

describe("hasLinkCallback", () => {
  it("is true only for a redirect carrying both code and state", () => {
    expect(hasLinkCallback("?code=a&state=b")).toBe(true);
    expect(hasLinkCallback("?code=a")).toBe(false);
    expect(hasLinkCallback("?state=b")).toBe(false);
    expect(hasLinkCallback("")).toBe(false);
  });
});

describe("startLink", () => {
  it("redirects the whole page to the provider with the link code in the library state", async () => {
    await startLink(CFG, "c0de", "https://game.example/");
    expect(calls).toEqual([{ method: "signinRedirect", arg: { state: { code: "c0de" } } }]);
    expect(ctorSettings).toMatchObject({
      authority: "https://idp.example",
      client_id: "bc",
      redirect_uri: "https://game.example/",
      response_type: "code",
      scope: "openid",
      automaticSilentRenew: false,
      monitorSession: false,
      loadUserInfo: false,
    });
  });

  it("keeps no user: the user store is in-memory, never a web storage", async () => {
    await startLink(CFG, "c0de", "https://game.example/");
    const store = ctorSettings?.userStore as { opts: { store: object } };
    expect(store.opts.store.constructor.name).toBe("InMemoryWebStorage");
  });
});

describe("finishLink", () => {
  it("returns the ID token and the code, and drops the user", async () => {
    const out = await finishLink(
      CFG,
      "https://game.example/?code=a&state=b",
      "https://game.example/",
    );
    expect(out).toEqual({ idToken: "id-tok", code: "c0de" });
    expect(calls.map((c) => c.method)).toEqual(["signinRedirectCallback", "removeUser"]);
  });

  it("returns null when the provider answer is refused, never throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    callbackUser = new Error("state mismatch");
    expect(await finishLink(CFG, "https://g/?code=a&state=b", "https://g/")).toBeNull();
  });

  it("returns null when the library hands back no code in its state", async () => {
    callbackUser = { id_token: "x", state: {} };
    expect(await finishLink(CFG, "https://g/?code=a&state=b", "https://g/")).toBeNull();
  });
});

describe("stripLinkCallback", () => {
  it("removes code, state and the other callback parameters and keeps the rest", () => {
    const url = "https://g/?code=a&state=b&session_state=c&iss=d&keep=1";
    expect(stripLinkCallback(url)).toBe("/?keep=1");
  });

  it("returns the bare path when nothing else remains, keeping the hash", () => {
    expect(stripLinkCallback("https://g/play?code=a&state=b#x")).toBe("/play#x");
  });
});
