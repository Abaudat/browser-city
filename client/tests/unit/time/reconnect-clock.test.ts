// Story 4.8 (NFR4): the city clock never pauses while disconnected, and a
// reconnect's fresh sync lands on the server's time even when the
// monotonic clock advanced less than wall time across the gap (laptop sleep).
import { describe, expect, it } from "vitest";
import { CityClock } from "../../../src/time/city-clock";
import { ServerClock } from "../../../src/time/server-clock";

const MINUTE_MS = 1_000;

function rig() {
  let perf = 0;
  const server = new ServerClock(() => perf);
  const city = new CityClock(server);
  city.setRate(MINUTE_MS);
  city.setClock(0n, 1);
  return {
    server,
    city,
    advance: (ms: number) => {
      perf += ms;
    },
    sync: (serverMicros: bigint) => server.observe(perf, perf, serverMicros),
    total: () => {
      const t = city.now();
      if (!t) throw new Error("clock unknown");
      return t.day * 24 * 60 + t.hour * 60 + t.minute;
    },
  };
}

describe("city time across a reconnect", () => {
  it("keeps advancing while no sync can happen (a disconnected interval)", () => {
    const r = rig();
    r.sync(0n);
    const before = r.total();
    r.advance(30 * MINUTE_MS);
    expect(r.total()).toBe(before + 30);
  });

  it("a fresh sync after a sleep matches the server, not the pre-drop estimate", () => {
    const r = rig();
    r.sync(0n);
    // The machine slept for 600 city minutes; the monotonic clock saw 5.
    r.advance(5 * MINUTE_MS);
    const stale = r.total();
    expect(stale).toBe(5);
    r.sync(600n * BigInt(MINUTE_MS) * 1000n);
    expect(r.total()).toBe(600);
    expect(r.total()).not.toBe(stale);
  });
});
