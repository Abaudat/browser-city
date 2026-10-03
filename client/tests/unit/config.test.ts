import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("NET_CONFIG", () => {
  it("defaults to the local server when no VITE_ overrides are set", async () => {
    const { NET_CONFIG } = await import("../../src/net/config");

    expect(NET_CONFIG.uri).toBe("ws://127.0.0.1:3000");
    expect(NET_CONFIG.databaseName).toBe("browser-city");
  });

  it("reads build-time VITE_ variables when set", async () => {
    vi.stubEnv("VITE_SPACETIME_URI", "wss://maincloud.example/ws");
    vi.stubEnv("VITE_SPACETIME_DB", "browser-city-prod");
    const { NET_CONFIG } = await import("../../src/net/config");

    expect(NET_CONFIG.uri).toBe("wss://maincloud.example/ws");
    expect(NET_CONFIG.databaseName).toBe("browser-city-prod");
  });
});

describe("OIDC_CONFIG (story 4.5)", () => {
  it("is null when no provider is configured, so the link offer is never made", async () => {
    const { OIDC_CONFIG } = await import("../../src/net/config");
    expect(OIDC_CONFIG).toBeNull();
  });

  it("is null when only one of the two variables is set", async () => {
    vi.stubEnv("VITE_OIDC_AUTHORITY", "https://idp.example");
    const { OIDC_CONFIG } = await import("../../src/net/config");
    expect(OIDC_CONFIG).toBeNull();
  });

  it("reads the authority and client id from build-time variables", async () => {
    vi.stubEnv("VITE_OIDC_AUTHORITY", "https://idp.example");
    vi.stubEnv("VITE_OIDC_CLIENT_ID", "bc");
    const { OIDC_CONFIG } = await import("../../src/net/config");
    expect(OIDC_CONFIG).toEqual({ authority: "https://idp.example", clientId: "bc" });
  });
});
