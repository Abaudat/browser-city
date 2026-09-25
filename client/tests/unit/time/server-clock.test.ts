import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_ROUND_TRIP_MS, ServerClock } from "../../../src/time/server-clock";

function clockAt(perf: { t: number }): ServerClock {
  return new ServerClock(() => perf.t);
}

describe("ServerClock", () => {
  it("has no estimate before the first sample", () => {
    expect(clockAt({ t: 0 }).nowMicros()).toBeUndefined();
  });

  it("estimates the server at the round trip's midpoint", () => {
    const perf = { t: 1_000 };
    const clock = clockAt(perf);
    // Sent at 1000, received at 1100: the server stamped at t=1050.
    expect(clock.observe(1_000, 1_100, 5_000_000_000n)).toBe(true);
    perf.t = 1_100;
    expect(clock.nowMicros()).toBe(5_000_000_000n + 50_000n);
  });

  it("advances on the monotonic clock between samples", () => {
    const perf = { t: 0 };
    const clock = clockAt(perf);
    clock.observe(0, 0, 10_000_000n);
    perf.t = 60_000;
    expect(clock.nowMicros()).toBe(10_000_000n + 60_000_000n);
  });

  it("discards a sample whose round trip is above the ceiling, keeping the old estimate", () => {
    const perf = { t: 0 };
    const clock = clockAt(perf);
    clock.observe(0, 0, 1_000_000n);
    expect(clock.observe(0, MAX_ROUND_TRIP_MS + 1, 99_000_000_000n)).toBe(false);
    expect(clock.nowMicros()).toBe(1_000_000n);
    expect(clock.observe(0, MAX_ROUND_TRIP_MS, 2_000_000n)).toBe(true);
  });

  // No wall-clock read exists to be jumped.
  it("inv_wall_clock_jump_never_moves_city_time", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: -(2 ** 40), max: 2 ** 40 }),
        (sample, later, jump) => {
          const perf = { t: sample };
          const realDateNow = Date.now;
          const clock = new ServerClock(() => perf.t);
          clock.observe(sample, sample, 42_000_000n);
          perf.t = sample + later;
          const before = clock.nowMicros();
          // An NTP step / the user changing the system clock.
          Date.now = () => realDateNow() + jump;
          try {
            expect(clock.nowMicros()).toBe(before);
          } finally {
            Date.now = realDateNow;
          }
        },
      ),
    );
  });
});

describe("client/src/time never reads the wall clock", () => {
  it("has no Date.now, new Date or performance.timeOrigin in any module", () => {
    const dir = fileURLToPath(new URL("../../../src/time/", import.meta.url));
    for (const file of readdirSync(dir)) {
      const code = readFileSync(`${dir}${file}`, "utf8").replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "");
      expect(code, file).not.toMatch(/Date\.now|new Date\(|timeOrigin/);
    }
  });
});
