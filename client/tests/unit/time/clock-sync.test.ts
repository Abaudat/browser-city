import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CityClock } from "../../../src/time/city-clock";
import { cityTime } from "../../../src/time/city-time";
import { CLOCK_SYNC_INTERVAL_MS, startClockSync } from "../../../src/time/clock-sync";
import { ServerClock } from "../../../src/time/server-clock";

const RATE = 2500;
const EPOCH = 1_700_000_000_123_456n;
/** The server's truth at fake t=0, in micros. */
const SERVER_START_MICROS = EPOCH + 5_000_000_000n;

let visibilityListeners: Array<() => void> = [];
const onVisible = (cb: () => void) => {
  visibilityListeners.push(cb);
  return () => {
    visibilityListeners = visibilityListeners.filter((l) => l !== cb);
  };
};

/** True server now, driven by the same fake clock as everything else. */
const serverNow = () => SERVER_START_MICROS + BigInt(Math.round(performance.now() * 1000));

function setup(latencyMs = 40) {
  const serverClock = new ServerClock(() => performance.now());
  const city = new CityClock(serverClock);
  city.setRate(RATE);
  city.setEpoch(EPOCH);
  const calls = { n: 0 };
  const fetchServerMicros = async () => {
    calls.n += 1;
    await new Promise((r) => setTimeout(r, latencyMs / 2));
    const stamped = serverNow();
    await new Promise((r) => setTimeout(r, latencyMs / 2));
    return stamped;
  };
  const sync = startClockSync({
    serverClock,
    perfNow: () => performance.now(),
    fetchServerMicros,
    onVisible,
  });
  return { serverClock, city, calls, sync };
}

function expectWithinOneCityMinute(city: CityClock) {
  const truth = cityTime(EPOCH, serverNow(), RATE);
  const got = city.now();
  expect(got).toBeDefined();
  const total = (t: { day: number; hour: number; minute: number }) =>
    t.day * 1440 + t.hour * 60 + t.minute;
  expect(Math.abs(total(got as NonNullable<typeof got>) - total(truth))).toBeLessThanOrEqual(1);
}

beforeEach(() => {
  vi.useFakeTimers();
  visibilityListeners = [];
});
afterEach(() => vi.useRealTimers());

describe("startClockSync", () => {
  // A wall clock hours wrong still yields the server's city time.
  it("inv_skewed_client_corrected", async () => {
    vi.setSystemTime(new Date(Date.now() + 7 * 3_600_000)); // wall clock 7 h ahead
    const { city, sync } = setup();
    expect(city.now()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    expectWithinOneCityMinute(city);
    sync.stop();
  });

  it("a wall clock that jumps mid-session is corrected at the next sample", async () => {
    const { city, calls, sync } = setup();
    await vi.advanceTimersByTimeAsync(100);
    vi.setSystemTime(new Date(Date.now() - 3 * 3_600_000)); // laptop lid
    await vi.advanceTimersByTimeAsync(CLOCK_SYNC_INTERVAL_MS + 100);
    expect(calls.n).toBe(2);
    expectWithinOneCityMinute(city);
    sync.stop();
  });

  it("re-samples on a fixed cadence, exercised by fake timers", async () => {
    const { calls, sync } = setup();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.n).toBe(1);
    await vi.advanceTimersByTimeAsync(CLOCK_SYNC_INTERVAL_MS * 3);
    expect(calls.n).toBe(4);
    sync.stop();
    await vi.advanceTimersByTimeAsync(CLOCK_SYNC_INTERVAL_MS * 3);
    expect(calls.n).toBe(4);
  });

  it("re-samples when the tab becomes visible again", async () => {
    const { calls, sync } = setup();
    await vi.advanceTimersByTimeAsync(100);
    for (const l of visibilityListeners) l();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.n).toBe(2);
    sync.stop();
    expect(visibilityListeners).toHaveLength(0);
  });

  it("a failed sample keeps the previous estimate and never throws", async () => {
    const serverClock = new ServerClock(() => performance.now());
    serverClock.observe(0, 0, 1_000_000n);
    let fail = true;
    const sync = startClockSync({
      serverClock,
      perfNow: () => performance.now(),
      fetchServerMicros: async () => {
        if (fail) throw new Error("offline");
        return 2_000_000n;
      },
      onVisible,
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(serverClock.nowMicros()).toBe(1_000_000n + 10_000n);
    fail = false;
    await sync.syncNow();
    expect(serverClock.nowMicros()).toBeGreaterThanOrEqual(2_000_000n);
    sync.stop();
  });
});

describe("CityClock", () => {
  it("has no city time until both the epoch and a server sample exist", () => {
    const serverClock = new ServerClock(() => 0);
    const city = new CityClock(serverClock);
    city.setRate(RATE);
    expect(city.now()).toBeUndefined();
    city.setEpoch(EPOCH);
    expect(city.now()).toBeUndefined();
    serverClock.observe(0, 0, EPOCH + 150_000_000n);
    expect(city.now()?.hour).toBe(1);
  });

  it("has no city time before the rate is known", () => {
    const serverClock = new ServerClock(() => 0);
    serverClock.observe(0, 0, EPOCH);
    const city = new CityClock(serverClock);
    city.setEpoch(EPOCH);
    expect(city.now()).toBeUndefined();
  });

  it("follows an epoch rewrite without a reload", () => {
    const serverClock = new ServerClock(() => 0);
    serverClock.observe(0, 0, EPOCH);
    const city = new CityClock(serverClock);
    city.setRate(RATE);
    city.setEpoch(EPOCH);
    expect(city.now()?.day).toBe(0);
    city.setEpoch(EPOCH - 3_600_000_000n);
    expect(city.now()?.day).toBe(1);
  });
});
