// Story 4.4 (FR138): when a position is sent. Pure, with an injected
// monotonic clock. Every property reads the dial's declared range from the
// committed defs, never a rate literal, so retuning the rate rewrites no test.
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

function violations(factory: Factory): Set<string> {
  const out = new Set<string>();
  fc.assert(
    fc.property(framesArb, walkArb, fc.constantFrom(...RATES), (moveTimes, { moving, stride }, hz) => {
      const period = 1000 / hz;
      // The walker stops after `moving` frames; the display keeps drawing
      // for two more periods, so a trailing edge has frames to ride on.
      const times = [...moveTimes];
      const last = times[times.length - 1] ?? 0;
      for (let t = last + 1000 / 60; t <= last + 2 * period; t += 1000 / 60) times.push(t);
      const sends: { t: number; p: WirePosition }[] = [];
      let now = 0;
      const s = factory(period, (p) => sends.push({ t: now, p }));
      let x = 0;
      let rest = pos(0);
      const moveFrames = Math.min(moving, moveTimes.length);
      times.forEach((t, i) => {
        now = t;
        if (i < moveFrames) x += stride;
        rest = pos(x);
        s.tick(t, rest);
      });
      // inv_position_send_rate_never_exceeds_dial
      for (let i = 0; i < sends.length; i++) {
        for (let j = i; j < sends.length; j++) {
          const w = sends[j].t - sends[i].t;
          if (j - i + 1 > (w / 1000) * hz + 1 + 1e-9) out.add("rate");
        }
      }
      // inv_idle_player_sends_nothing: the rest position is sent once.
      if (sends.filter((e) => e.p.x === rest.x).length > 1) out.add("idle");
      // inv_last_position_always_lands: within one period of the last
      // movement, plus the frame that carries it.
      const maxGap = Math.max(...times.map((t, i) => (i === 0 ? 0 : t - times[i - 1])));
      const landed = sends.find((e) => e.p.x === rest.x);
      const stopAt = times[moveFrames - 1] ?? 0;
      if (!landed || landed.t - stopAt > period + maxGap + 1e-9) out.add("last");
    }),
    { numRuns: 150 },
  );
  return out;
}

const real: Factory = (period, send) => createPositionScheduler(period, send);

describe("the position send scheduler", () => {
  it("inv_position_send_rate_never_exceeds_dial, inv_idle_player_sends_nothing and inv_last_position_always_lands hold", () => {
    expect([...violations(real)]).toEqual([]);
  });

  it("inv_idle_player_sends_nothing: sends on the first tick, then nothing while unchanged", () => {
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
      expect(violations(noTrailingEdge).has("last")).toBe(true);
    });

    it("a sender called per frame fails inv_position_send_rate_never_exceeds_dial", () => {
      const perFrame: Factory = (_period, send) => {
        let prev: WirePosition | undefined;
        return {
          tick: (_now, p) => {
            if (!prev || prev.x !== p.x) send(p);
            prev = p;
          },
        };
      };
      expect(violations(perFrame).has("rate")).toBe(true);
    });

    it("a sender that repeats the rest position fails inv_idle_player_sends_nothing", () => {
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
      expect(violations(repeater).has("idle")).toBe(true);
    });
  });
});
