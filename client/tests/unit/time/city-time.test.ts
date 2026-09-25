import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cityTime } from "../../../src/time/city-time";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const RATE = 2500;

interface ClockCase {
  epoch_micros: string;
  now_micros: string;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
  real_ms_into_minute: number;
}

const fixture = JSON.parse(
  readFileSync(`${REPO_ROOT}fixtures/city-clock-conformance.v1.json`, "utf8"),
) as { real_ms_per_city_minute: number; cases: ClockCase[] };

const defsJson = JSON.parse(readFileSync(`${REPO_ROOT}client/public/defs/defs.json`, "utf8")) as {
  real_ms_per_city_minute: number;
};

describe("city constants", () => {
  it("the rate is exact: 24 hours of 60 minutes is one real hour (FR1)", () => {
    expect(24 * 60 * defsJson.real_ms_per_city_minute).toBe(3_600_000);
    expect(cityTime(0n, 150_000_000n, defsJson.real_ms_per_city_minute).hour).toBe(1);
  });

  it("the fixture and the generated defs agree on the rate", () => {
    expect(fixture.real_ms_per_city_minute).toBe(defsJson.real_ms_per_city_minute);
  });
});

describe("cityTime conformance with sim::time", () => {
  it("has the boundary cases a hand-rolled port gets wrong", () => {
    const elapsed = fixture.cases.map(
      (c) => (BigInt(c.now_micros) - BigInt(c.epoch_micros)) / 1000n,
    );
    expect(elapsed).toContain(2n ** 31n);
    expect(elapsed).toContain(2n ** 32n);
    expect(elapsed.some((e) => e < 0n)).toBe(true);
  });

  for (const [i, c] of fixture.cases.entries()) {
    it(`case ${i}: epoch ${c.epoch_micros} now ${c.now_micros}`, () => {
      const t = cityTime(BigInt(c.epoch_micros), BigInt(c.now_micros), RATE);
      expect(t).toEqual({
        day: c.day,
        hour: c.hour,
        minute: c.minute,
        weekday: c.weekday,
        realMsIntoMinute: c.real_ms_into_minute,
      });
    });
  }
});

describe("cityTime properties", () => {
  it("in-city time of day depends only on elapsed real ms modulo one real hour (FR2)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(2n ** 60n), max: 2n ** 60n }),
        fc.bigInt({ min: 0n, max: 2n ** 50n }),
        fc.integer({ min: 0, max: 10_000 }),
        (epoch, t, days) => {
          const a = cityTime(epoch, epoch + t, RATE);
          const b = cityTime(epoch, epoch + t + BigInt(days) * 86_400_000_000n, RATE);
          expect([a.hour, a.minute, a.realMsIntoMinute]).toEqual([
            b.hour,
            b.minute,
            b.realMsIntoMinute,
          ]);
        },
      ),
    );
  });

  it("advances exactly one minute per rate ms and never yields an out-of-range field", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(2n ** 60n), max: 2n ** 60n }),
        fc.bigInt({ min: -(2n ** 60n), max: 2n ** 60n }),
        (epoch, now) => {
          const t = cityTime(epoch, now, RATE);
          const u = cityTime(epoch, now + BigInt(RATE) * 1000n, RATE);
          const total = (x: typeof t) => x.day * 1440 + x.hour * 60 + x.minute;
          expect(total(u) - total(t)).toBe(1);
          expect(t.hour).toBeGreaterThanOrEqual(0);
          expect(t.hour).toBeLessThan(24);
          expect(t.minute).toBeGreaterThanOrEqual(0);
          expect(t.minute).toBeLessThan(60);
          expect(t.weekday).toBeGreaterThanOrEqual(0);
          expect(t.weekday).toBeLessThan(7);
        },
      ),
    );
  });
});
