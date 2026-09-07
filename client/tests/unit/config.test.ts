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
