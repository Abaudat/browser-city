// Story 4.14 (FR172): the client reports its own boot time and its resume
// outage through the one measure call -- once, only while connected, never
// from a second stopwatch, never queued on a dead connection.
import { afterEach, describe, expect, it } from "vitest";
import { BOOT_MARK, markBoot, onBootMark } from "../../../src/boot/boot-marks";
import {
  bootControllableMs,
  createMeasureReporter,
  type Measure,
  watchControllableMark,
} from "../../../src/net/measure-reporter";

function rig(boot: number | undefined = undefined) {
  const sent: Measure[] = [];
  let now = 0;
  let bootMs = boot;
  const reporter = createMeasureReporter({
    send: (m) => sent.push(m),
    bootMs: () => bootMs,
    now: () => now,
  });
  return {
    sent,
    reporter,
    at: (t: number) => {
      now = t;
    },
    setBoot: (v: number | undefined) => {
      bootMs = v;
    },
  };
}

describe("boot", () => {
  it("is sent once, when connected and the controllable mark exists", () => {
    const r = rig(912.4);
    r.reporter.setStatus("connecting");
    expect(r.sent).toEqual([]);
    r.reporter.setStatus("connected");
    expect(r.sent).toEqual([{ tag: "Boot", value: 912 }]);
    r.reporter.markControllable();
    r.reporter.setStatus("connected");
    expect(r.sent).toHaveLength(1);
  });

  it("waits for the mark when the page connects first", () => {
    const r = rig(undefined);
    r.reporter.setStatus("connected");
    expect(r.sent).toEqual([]);
    r.setBoot(1500);
    r.reporter.markControllable();
    expect(r.sent).toEqual([{ tag: "Boot", value: 1500 }]);
  });

  it("is never sent while disconnected", () => {
    const r = rig(800);
    r.reporter.markControllable();
    expect(r.sent).toEqual([]);
    r.reporter.setStatus("disconnected");
    expect(r.sent).toEqual([]);
  });

  it("is never sent after the page has lost its connection once", () => {
    const r = rig(undefined);
    r.reporter.setStatus("connected");
    r.reporter.setStatus("disconnected");
    r.reporter.setStatus("connected");
    r.setBoot(900);
    r.reporter.markControllable();
    expect(r.sent.filter((m) => m.tag === "Boot")).toEqual([]);
  });

  it("never reports zero or a non-finite figure", () => {
    for (const v of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 0.2]) {
      const r = rig(v);
      r.reporter.setStatus("connected");
      expect(r.sent.filter((m) => m.tag === "Boot" && m.value === 0)).toEqual([]);
      for (const m of r.sent) expect(Number.isInteger(m.value) && m.value > 0).toBe(true);
    }
  });
});

describe("resume", () => {
  it("reports the outage from the drop to the next connected, once per drop", () => {
    const r = rig(500);
    r.at(1000);
    r.reporter.setStatus("connected");
    r.at(5000);
    r.reporter.setStatus("disconnected");
    r.at(5000 + 1234);
    r.reporter.setStatus("connected");
    expect(r.sent).toEqual([
      { tag: "Boot", value: 500 },
      { tag: "Resumed", value: 1234 },
    ]);
    r.reporter.setStatus("connected");
    expect(r.sent).toHaveLength(2);
  });

  it("reports nothing for a page that never connected, even after retries", () => {
    const r = rig(500);
    r.reporter.setStatus("disconnected");
    r.at(9000);
    r.reporter.setStatus("connected");
    expect(r.sent.filter((m) => m.tag === "Resumed")).toEqual([]);
  });

  it("a silent drop is timed from when the page notices it, not from the drop itself", () => {
    // The socket died at t=1000 but the probe only failed at t=6000: the
    // outage the page can report starts at the status, so detection time is
    // not in it (the registry blind spot says so).
    const r = rig(500);
    r.at(500);
    r.reporter.setStatus("connected");
    r.at(6000);
    r.reporter.setStatus("disconnected");
    r.at(7000);
    r.reporter.setStatus("connected");
    expect(r.sent.filter((m) => m.tag === "Resumed")).toEqual([{ tag: "Resumed", value: 1000 }]);
  });

  it("reports an outage that never ends as nothing", () => {
    const r = rig(500);
    r.reporter.setStatus("connected");
    r.at(10);
    r.reporter.setStatus("disconnected");
    r.at(99999);
    expect(r.sent.filter((m) => m.tag === "Resumed")).toEqual([]);
  });

  it("an updating status is not a drop", () => {
    const r = rig(500);
    r.reporter.setStatus("connected");
    r.reporter.setStatus("updating");
    r.at(300);
    r.reporter.setStatus("connected");
    expect(r.sent.filter((m) => m.tag === "Resumed")).toEqual([]);
  });
});

describe("the boot figure is the player-controllable mark, not a second stopwatch", () => {
  afterEach(() => {
    performance.clearMarks(BOOT_MARK.PLAYER_CONTROLLABLE);
  });

  it("reads the PLAYER_CONTROLLABLE entry through boot-marks", () => {
    expect(bootControllableMs()).toBeUndefined();
    markBoot(BOOT_MARK.PLAYER_CONTROLLABLE, 842);
    expect(bootControllableMs()).toBe(842);
  });

  it("is told when the mark fires", () => {
    const fired: string[] = [];
    const stop = onBootMark((name) => fired.push(name));
    markBoot(BOOT_MARK.PLAYER_CONTROLLABLE, 10);
    stop();
    markBoot(BOOT_MARK.PLAYER_CONTROLLABLE, 11);
    expect(fired).toEqual([BOOT_MARK.PLAYER_CONTROLLABLE]);
  });

  it("watchControllableMark forwards only that mark", () => {
    let calls = 0;
    const stop = watchControllableMark(() => {
      calls += 1;
    });
    markBoot(BOOT_MARK.MAIN_START, 1);
    expect(calls).toBe(0);
    markBoot(BOOT_MARK.PLAYER_CONTROLLABLE, 2);
    expect(calls).toBe(1);
    stop();
    performance.clearMarks(BOOT_MARK.MAIN_START);
  });
});
