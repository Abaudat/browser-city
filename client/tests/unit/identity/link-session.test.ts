import { describe, expect, it, vi } from "vitest";
import { offerLink, resumeLinkIfPending } from "../../../src/identity/link-session";

const CFG = { authority: "https://idp.example", clientId: "bc" };

function flow(
  over: Partial<{
    finish: () => Promise<{ idToken: string; code: string } | null>;
    start: () => Promise<void>;
  }> = {},
) {
  const calls: string[] = [];
  return {
    calls,
    module: {
      stripLinkCallback: () => "/clean",
      startLink: vi.fn(async (_c: unknown, code: string) => {
        calls.push(`start:${code}`);
        await over.start?.();
      }),
      finishLink: vi.fn(async () => {
        calls.push("finish");
        return over.finish ? over.finish() : { idToken: "id-tok", code: "c0de" };
      }),
    },
  };
}

describe("resumeLinkIfPending", () => {
  it("does nothing, and loads nothing, without a pending callback", async () => {
    const loadFlow = vi.fn();
    const out = await resumeLinkIfPending({
      config: CFG,
      search: "?x=1",
      href: "https://g/?x=1",
      redirectUri: "https://g/",
      loadFlow,
      completeLink: vi.fn(),
      replaceUrl: vi.fn(),
    });
    expect(out).toBe("none");
    expect(loadFlow).not.toHaveBeenCalled();
  });

  it("does nothing when no provider is configured", async () => {
    const loadFlow = vi.fn();
    const out = await resumeLinkIfPending({
      config: null,
      search: "?code=a&state=b",
      href: "https://g/?code=a&state=b",
      redirectUri: "https://g/",
      loadFlow,
      completeLink: vi.fn(),
      replaceUrl: vi.fn(),
    });
    expect(out).toBe("none");
    expect(loadFlow).not.toHaveBeenCalled();
  });

  it("strips the callback from the address bar, then redeems the code with the ID token", async () => {
    const f = flow();
    const order: string[] = [];
    const out = await resumeLinkIfPending({
      config: CFG,
      search: "?code=a&state=b",
      href: "https://g/?code=a&state=b",
      redirectUri: "https://g/",
      loadFlow: async () => f.module,
      completeLink: async (t, c) => {
        order.push(`complete:${t}:${c}`);
      },
      replaceUrl: (u) => order.push(`replace:${u}`),
    });
    expect(out).toBe("linked");
    expect(order).toEqual(["replace:/clean", "complete:id-tok:c0de"]);
  });

  it("reports failed, never throwing, when the provider answer is refused", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = flow({ finish: async () => null });
    const completeLink = vi.fn();
    const out = await resumeLinkIfPending({
      config: CFG,
      search: "?code=a&state=b",
      href: "h",
      redirectUri: "r",
      loadFlow: async () => f.module,
      completeLink,
      replaceUrl: vi.fn(),
    });
    expect(out).toBe("failed");
    expect(errorSpy).toHaveBeenCalled();
    expect(completeLink).not.toHaveBeenCalled();
  });

  it("reports failed when the server refuses the redemption", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = flow();
    const out = await resumeLinkIfPending({
      config: CFG,
      search: "?code=a&state=b",
      href: "h",
      redirectUri: "r",
      loadFlow: async () => f.module,
      completeLink: async () => {
        throw new Error("both identities have a different character");
      },
      replaceUrl: vi.fn(),
    });
    expect(out).toBe("failed");
  });

  it("reports failed when the flow chunk cannot load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await resumeLinkIfPending({
      config: CFG,
      search: "?code=a&state=b",
      href: "h",
      redirectUri: "r",
      loadFlow: async () => {
        throw new Error("chunk failed");
      },
      completeLink: vi.fn(),
      replaceUrl: vi.fn(),
    });
    expect(out).toBe("failed");
  });
});

describe("offerLink", () => {
  it("stores a fresh code on the server first, and only then leaves for the provider", async () => {
    const f = flow();
    const order: string[] = [];
    await offerLink({
      config: CFG,
      redirectUri: "https://g/",
      loadFlow: async () => f.module,
      newCode: () => "c0de",
      beginLink: async (code) => {
        order.push(`begin:${code}`);
      },
    });
    expect(order).toEqual(["begin:c0de"]);
    expect(f.calls).toEqual(["start:c0de"]);
  });

  it("never leaves for the provider when the server refused the code", async () => {
    const f = flow();
    await expect(
      offerLink({
        config: CFG,
        redirectUri: "r",
        loadFlow: async () => f.module,
        newCode: () => "c0de",
        beginLink: async () => {
          throw new Error("linking is not available");
        },
      }),
    ).rejects.toThrow(/not available/);
    expect(f.calls).toEqual([]);
  });

  it("is a no-op when no provider is configured", async () => {
    const loadFlow = vi.fn();
    const beginLink = vi.fn();
    await offerLink({
      config: null,
      redirectUri: "r",
      loadFlow,
      newCode: () => "c",
      beginLink,
    });
    expect(loadFlow).not.toHaveBeenCalled();
    expect(beginLink).not.toHaveBeenCalled();
  });
});
