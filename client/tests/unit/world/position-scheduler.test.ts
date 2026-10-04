// Story 4.4 (FR138): when a position is sent. Pure, with an injected
// monotonic clock. Every property reads the dial's declared range from the
// committed defs, never a rate literal, so retuning the rate rewrites no test.
// Each property is its own `fc.assert` with the expectation inside, so a
// regression reports a counterexample and the seed that reproduces it
// (NFR50); a negative control is the same assertion run on a wrong sender,
// expected to throw.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseDefs } from "../../../src/defs/parse";
import type { WirePosition } from "../../../src/world/position-codec";
import { createPositionScheduler } from "../../../src/world/position-scheduler";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const defs = parseDefs(
  JSON.parse(readFileSync(`${REPO_ROOT}client/public/defs/defs.json`, "utf-8")),
);
const dial = defs.balance.find((b) => b.key === "net.player_position_hz");
if (!dial) throw new Error("no net.player_position_hz");
const RATES = [dial.min, dial.value, dial.max];

type Factory = (
  periodMs: number,
  send: (p: WirePosition) => void,
) => { tick: (nowMs: number, p: WirePosition) => unknown };

const pos = (x: number): WirePosition => ({ x, y: 0, floor: 0, fracX: 0, fracY: 0 });

/** Frame times for one cadence: a nominal frame rate with jitter and the
 * occasional multi-second spike. */
const framesArb = fc
  .tuple(
    fc.constantFrom(30, 60, 144),
    fc.array(fc.tuple(fc.double({ min: 0, max: 0.6, noNaN: true }), fc.boolean()), {
      minLength: 20,
      maxLength: 200,
    }),
  )
  .map(([fps, jitters]) => {
    const times: number[] = [];
    let t = 0;
    for (const [j, spike] of jitters) {
      t += (1000 / fps) * (1 + j) + (spike && j > 0.58 ? 3000 : 0);
      times.push(t);
    }
    return times;
  });

/** A walk that moves for a while, then stands still. */
const walkArb = fc.record({
  moving: fc.integer({ min: 1, max: 80 }),
  stride: fc.integer({ min: 1, max: 3 }),
});

interface Run {
  readonly sends: { t: number; p: WirePosition }[];
  readonly times: number[];
  readonly moveFrames: number;
  readonly rest: WirePosition;
  readonly period: number;
  readonly hz: number;
}

/** The walker stops after `moving` frames; the display keeps drawing for two
 * more periods, so a trailing edge has frames to ride on. */
function drive(
  factory: Factory,
  moveTimes: number[],
  moving: number,
  stride: number,
  hz: number,
): Run {
  const period = 1000 / hz;
  const times = [...moveTimes];
  const last = times[times.length - 1] ?? 0;
  for (let t = last + 1000 / 60; t <= last + 2 * period; t += 1000 / 60) times.push(t);
  const sends: { t: number; p: WirePosition }[] = [];
  let now = 0;
  const s = factory(period, (p) => sends.push({ t: now, p }));
  const moveFrames = Math.min(moving, moveTimes.length);
  let x = 0;
  let rest = pos(0);
  times.forEach((t, i) => {
    now = t;
    if (i < moveFrames) x += stride;
    rest = pos(x);
    s.tick(t, rest);
  });
  return { sends, times, moveFrames, rest, period, hz };
}

function property(check: (run: Run) => void, factory: Factory): void {
  fc.assert(
    fc.property(framesArb, walkArb, fc.constantFrom(...RATES), (moveTimes, w, hz) =>
      check(drive(factory, moveTimes, w.moving, w.stride, hz)),
    ),
    { numRuns: 150 },
  );
}

const assertRate = (factory: Factory) =>
  property((run) => {
    for (let i = 0; i < run.sends.length; i++) {
      for (let j = i; j < run.sends.length; j++) {
        const windowMs = (run.sends[j]?.t ?? 0) - (run.sends[i]?.t ?? 0);
        expect(j - i + 1).toBeLessThanOrEqual((windowMs / 1000) * run.hz + 1 + 1e-9);
      }
    }
  }, factory);

const assertIdle = (factory: Factory) =>
  property((run) => {
    expect(run.sends.filter((e) => e.p.x === run.rest.x).length).toBeLessThanOrEqual(1);
  }, factory);

const assertLands = (factory: Factory) =>
  property((run) => {
    const maxGap = Math.max(
      ...run.times.map((t, i) => (i === 0 ? 0 : t - (run.times[i - 1] ?? 0))),
    );
    const landed = run.sends.find((e) => e.p.x === run.rest.x);
    const stopAt = run.times[run.moveFrames - 1] ?? 0;
    expect(landed, "the rest position was never sent").toBeDefined();
    expect((landed?.t ?? 0) - stopAt).toBeLessThanOrEqual(run.period + maxGap + 1e-9);
  }, factory);

const real: Factory = (period, send) => createPositionScheduler(period, send);

const noTrailingEdge: Factory = (period, send) => {
  let last = Number.NEGATIVE_INFINITY;
  let prev: WirePosition | undefined;
  return {
    tick: (now, p) => {
      const moved = prev !== undefined && prev.x !== p.x;
      prev = p;
      if (moved && now - last >= period) {
        last = now;
        send(p);
      }
    },
  };
};

const perFrame: Factory = (_period, send) => {
  let prev: WirePosition | undefined;
  return {
    tick: (_now, p) => {
      if (!prev || prev.x !== p.x) send(p);
      prev = p;
    },
  };
};

const repeater: Factory = (period, send) => {
  let last = Number.NEGATIVE_INFINITY;
  return {
    tick: (now, p) => {
      if (now - last >= period) {
        last = now;
        send(p);
      }
    },
  };
};

describe("the position send scheduler", () => {
  it("inv_position_send_rate_never_exceeds_dial", () => {
    assertRate(real);
  });

  it("inv_idle_player_sends_nothing", () => {
    assertIdle(real);
  });

  it("inv_last_position_always_lands", () => {
    assertLands(real);
  });

  it("sends on the first tick, then nothing while unchanged", () => {
    const sent: WirePosition[] = [];
    const s = createPositionScheduler(100, (p) => sent.push(p));
    for (let t = 0; t < 5000; t += 16) s.tick(t, pos(4));
    expect(sent).toEqual([pos(4)]);
  });

  it("a faster display never sends more than the dial allows", () => {
    for (const fps of [30, 60, 144, 240]) {
      const sent: WirePosition[] = [];
      const s = createPositionScheduler(100, (p) => sent.push(p));
      let x = 0;
      for (let t = 0; t <= 2000; t += 1000 / fps) s.tick(t, pos(x++));
      expect(sent.length).toBeLessThanOrEqual(2000 / 100 + 1);
    }
  });

  describe("negative controls: each wrong sender fails its property", () => {
    it("a sender with no trailing edge fails inv_last_position_always_lands", () => {
      expect(() => assertLands(noTrailingEdge)).toThrow();
    });

    it("a sender called per frame fails inv_position_send_rate_never_exceeds_dial", () => {
      expect(() => assertRate(perFrame)).toThrow();
    });

    it("a sender that repeats the rest position fails inv_idle_player_sends_nothing", () => {
      expect(() => assertIdle(repeater)).toThrow();
    });
  });
});
