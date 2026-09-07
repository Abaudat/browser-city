// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { recordPingForE2e } from "../../src/net/e2e-hooks";

afterEach(() => {
  delete window.__bc;
});

describe("recordPingForE2e", () => {
  it("appends to window.__bc.pings under DEV (Vitest runs non-production)", () => {
    recordPingForE2e({ id: 1n, message: "a", observedAtMs: 1 });
    recordPingForE2e({ id: 2n, message: "b", observedAtMs: 2 });

    expect(window.__bc?.pings).toEqual([
      { id: 1n, message: "a", observedAtMs: 1 },
      { id: 2n, message: "b", observedAtMs: 2 },
    ]);
  });

  it("creates the buffer lazily rather than requiring pre-existing state", () => {
    expect(window.__bc).toBeUndefined();
    recordPingForE2e({ id: 9n, message: "z", observedAtMs: 9 });
    expect(window.__bc?.pings).toHaveLength(1);
  });
});
