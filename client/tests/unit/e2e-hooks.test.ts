// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordPingForE2e } from "../../src/net/e2e-hooks";

afterEach(() => {
  delete window.__bc;
  vi.unstubAllEnvs();
});

describe("recordPingForE2e", () => {
  it("appends to window.__bc.pings under DEV (Vitest runs non-production)", () => {
    recordPingForE2e({ id: 1n, message: "a", writtenAtMs: 1, observedAtMs: 1 });
    recordPingForE2e({ id: 2n, message: "b", writtenAtMs: 2, observedAtMs: 2 });

    expect(window.__bc?.pings).toEqual([
      { id: 1n, message: "a", writtenAtMs: 1, observedAtMs: 1 },
      { id: 2n, message: "b", writtenAtMs: 2, observedAtMs: 2 },
    ]);
  });

  it("creates the buffer lazily rather than requiring pre-existing state", () => {
    expect(window.__bc).toBeUndefined();
    recordPingForE2e({ id: 9n, message: "z", writtenAtMs: 9, observedAtMs: 9 });
    expect(window.__bc?.pings).toHaveLength(1);
  });

  it("does nothing when DEV is false -- the shape the production build ships as", () => {
    vi.stubEnv("DEV", false);

    recordPingForE2e({ id: 1n, message: "a", writtenAtMs: 1, observedAtMs: 1 });

    expect(window.__bc).toBeUndefined();
  });
});
