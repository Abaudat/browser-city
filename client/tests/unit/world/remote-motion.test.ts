// Story 4.4 (FR138): how a remote player is drawn from its samples. Pure,
// with the server clock injected as a plain number. The period and delay
// derive from the committed defs' dial, never a literal, and the properties
// run across the dial's whole declared range.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseDefs } from "../../../src/defs/parse";
import { loadMovementConfig } from "../../../src/world/movement-config";
import { quantise } from "../../../src/world/position-codec";
import { createPositionScheduler } from "../../../src/world/position-scheduler";
import {
  REMOTE_MAX_SAMPLES,
  REMOTE_SNAP_CELLS,
  REMOTE_SPEED_TOLERANCE,
  RemoteMotion,
  type RemoteMotionConfig,
  remoteDelayMs,
} from "../../../src/world/remote-motion";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const defs = parseDefs(
  JSON.parse(readFileSync(`${REPO_ROOT}client/public/defs/defs.json`, "utf-8")),
);
const balance = (key: string) => {
  const e = defs.balance.find((b) => b.key === key);
  if (!e) throw new Error(`no balance ${key}`);
  return e;
};
const HZ = balance("net.player_position_hz");
const DELAY_MS = balance("net.player_interpolation_delay_ms").value;
const WALK_CELLS_PER_MS = loadMovementConfig(defs).walkSpeedCellsPerMs;
const RATES = [HZ.min, HZ.value, HZ.max];

const config = (hz: number): RemoteMotionConfig => ({
  periodMs: 1000 / hz,
  delayMs: remoteDelayMs(1000 / hz, DELAY_MS),
  snapCells: REMOTE_SNAP_CELLS,
  maxSamples: REMOTE_MAX_SAMPLES,
});

interface Interpolator {
  upsert(id: string, sample: { tMs: number; x: number; y: number; floor: number }): void;
  poseAt(id: string, serverNowMs: number): { x: number; y: number; floor: number } | undefined;
}

/** A walker at or below walk speed, with stamp jitter, bursts and late
 * updates, through any interpolator. */
function assertContinuity(
  make: (cfg: RemoteMotionConfig) => Interpolator,
  params: fc.Parameters<unknown> = {},
): void {
  const frames = fc.array(
    fc.record({
      dt: fc.double({ min: 6, max: 34, noNaN: true }),
      walk: fc.boolean(),
      turn: fc.constantFrom(-1, 1),
    }),
    { minLength: 60, maxLength: 300 },
  );
  fc.assert(
    fc.property(
      fc.constantFrom(...RATES),
      frames,
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.integer({ min: 1, max: 2 ** 30 }),
      (hz, walkFrames, jitterUnit, lagUnit, seed0) => {
        const cfg = config(hz);
        const period = cfg.periodMs;
        const m = make(cfg);
        // Stamp jitter and network lag stay inside what the delay absorbs:
        // a quarter period, and the delay less the longest gap between
        // sends (a period, a slow frame and the jitter).
        const jitter = (period / 4) * jitterUnit;
        const lagMax = Math.max(0, cfg.delayMs - 1.25 * period - 40);
        let seed = seed0;
        const rand = () => {
          seed = (seed * 1103515245 + 12345) % 2147483648;
          return seed / 2147483648;
        };
        interface Arrival {
          at: number;
          tMs: number;
          x: number;
        }
        const arrivals: Arrival[] = [];
        let t = 0;
        let x = 0;
        let dir = 1;
        let lastStamp = 0;
        let lastAt = 0;
        const sender = createPositionScheduler(period, (p) => {
          // One ordered socket: the server stamps, and the client receives,
          // in the order the player sent.
          const stamp = Math.max(lastStamp, t + rand() * jitter);
          lastStamp = stamp;
          const at = Math.max(lastAt, stamp + rand() * lagMax * lagUnit);
          lastAt = at;
          arrivals.push({
            at,
            tMs: stamp,
            x: p.x + p.fracX / defs.positionUnitsPerCell,
          });
        });
        const offer = () => sender.tick(t, quantise(x, 0, 0, defs.positionUnitsPerCell));
        for (const f of walkFrames) {
          t += f.dt;
          dir = f.turn;
          if (f.walk) x += dir * WALK_CELLS_PER_MS * f.dt;
          offer();
        }
        // The display keeps drawing until everything has arrived and rested.
        const end = t + cfg.delayMs + 2 * period + lagMax + 500;
        while (t < end) {
          t += 16;
          offer();
        }
        arrivals.sort((p, q) => p.at - q.at);

        const FRAME = 16;
        let next = 0;
        let prev: { x: number; y: number } | undefined;
        const budget =
          WALK_CELLS_PER_MS * FRAME * (1 + REMOTE_SPEED_TOLERANCE) + 2 / defs.positionUnitsPerCell;
        for (let now = 0; now <= end; now += FRAME) {
          while (next < arrivals.length && (arrivals[next]?.at ?? Infinity) <= now) {
            const a = arrivals[next++] as Arrival;
            m.upsert("a", { tMs: a.tMs, x: a.x, y: 0, floor: 0 });
          }
          const pose = m.poseAt("a", now);
          if (pose && prev) {
            expect(Math.hypot(pose.x - prev.x, pose.y - prev.y)).toBeLessThanOrEqual(budget);
          }
          if (pose) prev = pose;
        }
        // A stopped player comes to rest exactly on the last sample.
        const last = arrivals.reduce((p, q) => (q.tMs > p.tMs ? q : p), arrivals[0]);
        if (last) expect(prev).toMatchObject({ x: last.x, y: 0 });
      },
    ),
    { numRuns: 60, ...params },
  );
}

describe("RemoteMotion", () => {
  it("shows a first sample in place, whatever the clock says", () => {
    const m = new RemoteMotion(config(HZ.value));
    m.upsert("a", { tMs: 1000, x: 5, y: 6, floor: 0 });
    expect(m.poseAt("a", 0)).toEqual({ x: 5, y: 6, floor: 0 });
    expect(m.poseAt("a", 99999)).toEqual({ x: 5, y: 6, floor: 0 });
  });

  it("inv_remote_position_stays_between_samples", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...RATES),
        fc.array(fc.tuple(fc.integer({ min: 1, max: 400 }), fc.integer({ min: -40, max: 40 })), {
          minLength: 2,
          // Within the buffer: an older sample is dropped by design.
          maxLength: REMOTE_MAX_SAMPLES,
        }),
        fc.array(fc.integer({ min: 0, max: 400 }), { minLength: 1, maxLength: 40 }),
        (hz, steps, probeSteps) => {
          const cfg = config(hz);
          const m = new RemoteMotion(cfg);
          let t = 1000;
          let x = 0;
          const samples: { tMs: number; x: number }[] = [];
          for (const [dt, dx] of steps) {
            t += dt;
            x += dx / 100;
            samples.push({ tMs: t, x });
            m.upsert("a", { tMs: t, x, y: 0, floor: 0 });
          }
          // Rising probe times, from before the first sample to past the last.
          let now = 1000 + cfg.delayMs - 200;
          for (const step of probeSteps) {
            now += step;
            const pose = m.poseAt("a", now);
            expect(pose).toBeDefined();
            const at = now - cfg.delayMs;
            const first = samples[0] as { tMs: number; x: number };
            const last = samples[samples.length - 1] as { tMs: number; x: number };
            if (at <= first.tMs) {
              expect(pose?.x).toBe(first.x);
            } else if (at >= last.tMs) {
              // Never extrapolated past the newest sample.
              expect(pose?.x).toBe(last.x);
            } else {
              const i = samples.findIndex((s, k) => s.tMs <= at && (samples[k + 1]?.tMs ?? 0) > at);
              const lo = samples[i] as { tMs: number; x: number };
              const hi = samples[i + 1] as { tMs: number; x: number };
              expect(pose?.x).toBeGreaterThanOrEqual(Math.min(lo.x, hi.x) - 1e-9);
              expect(pose?.x).toBeLessThanOrEqual(Math.max(lo.x, hi.x) + 1e-9);
            }
          }
        },
      ),
    );
  });

  it("inv_remote_motion_is_continuous", () => {
    assertContinuity((cfg) => new RemoteMotion(cfg));
  });

  it("a floor change, a gap beyond the snap distance, and a first sample never glide", () => {
    const cfg = config(HZ.value);
    const m = new RemoteMotion(cfg);
    m.upsert("a", { tMs: 1000, x: 0, y: 0, floor: 0 });
    m.upsert("a", { tMs: 1000 + cfg.periodMs, x: 0.2, y: 0, floor: 1 });
    // Between the two samples, in time: the older floor holds, then the newer snaps in.
    const mid = 1000 + cfg.periodMs / 2 + cfg.delayMs;
    expect(m.poseAt("a", mid)).toEqual({ x: 0, y: 0, floor: 0 });
    expect(m.poseAt("a", 1000 + cfg.periodMs + cfg.delayMs)).toEqual({ x: 0.2, y: 0, floor: 1 });

    const t = new RemoteMotion(cfg);
    t.upsert("a", { tMs: 1000, x: 0, y: 0, floor: 0 });
    t.upsert("a", { tMs: 1000 + cfg.periodMs, x: REMOTE_SNAP_CELLS + 1, y: 0, floor: 0 });
    expect(t.poseAt("a", 1000 + cfg.periodMs / 2 + cfg.delayMs)?.x).toBe(0);
    expect(t.poseAt("a", 1000 + cfg.periodMs + cfg.delayMs)?.x).toBe(REMOTE_SNAP_CELLS + 1);
  });

  it("a pause holds the older position until one period before the newer sample", () => {
    const cfg = config(HZ.value);
    const m = new RemoteMotion(cfg);
    m.upsert("a", { tMs: 1000, x: 0, y: 0, floor: 0 });
    m.upsert("a", { tMs: 10_000, x: 1, y: 0, floor: 0 });
    expect(m.poseAt("a", 5000 + cfg.delayMs)?.x).toBe(0);
    expect(m.poseAt("a", 10_000 - cfg.periodMs / 2 + cfg.delayMs)?.x).toBeCloseTo(0.5, 6);
  });

  it("inv_interpolation_buffer_is_bounded", () => {
    const m = new RemoteMotion(config(HZ.value));
    for (let i = 0; i < REMOTE_MAX_SAMPLES * 10; i++) {
      m.upsert("a", { tMs: 1000 + i * 10, x: i / 100, y: 0, floor: 0 });
      expect(m.bufferedSamples("a")).toBeLessThanOrEqual(REMOTE_MAX_SAMPLES);
    }
    m.remove("a");
    expect(m.poseAt("a", 5000)).toBeUndefined();
    expect(m.ids()).toEqual([]);
  });

  it("a snap-to-latest interpolator fails inv_remote_motion_is_continuous (negative control)", () => {
    const snap = (): Interpolator => {
      const latest = new Map<string, { x: number; y: number; floor: number }>();
      return {
        upsert: (id, sample) => latest.set(id, sample),
        poseAt: (id) => latest.get(id),
      };
    };
    // Stop at the first failure: the control needs the failure, not a minimal one.
    expect(() => assertContinuity(snap, { endOnFailure: true })).toThrow();
  });
});

describe("RemoteMotion buffer edges", () => {
  const cfg = config(HZ.value);

  it("knows nobody it has not heard of", () => {
    expect(new RemoteMotion(cfg).poseAt("nobody", 0)).toBeUndefined();
    expect(new RemoteMotion(cfg).bufferedSamples("nobody")).toBe(0);
  });

  it("a sample for a stamp already held replaces it, and a late-arriving older one is placed by its stamp", () => {
    const m = new RemoteMotion(cfg);
    m.upsert("a", { tMs: 2000, x: 2, y: 0, floor: 0 });
    m.upsert("a", { tMs: 2000, x: 3, y: 0, floor: 0 });
    m.upsert("a", { tMs: 1000, x: 1, y: 0, floor: 0 });
    expect(m.bufferedSamples("a")).toBe(2);
    expect(m.poseAt("a", 0)?.x).toBe(1);
    expect(m.poseAt("a", 100_000)?.x).toBe(3);
  });

  it("holds the first sample until the delayed clock reaches it", () => {
    const m = new RemoteMotion(cfg);
    m.upsert("a", { tMs: 5000, x: 1, y: 0, floor: 0 });
    m.upsert("a", { tMs: 5000 + cfg.periodMs, x: 1.1, y: 0, floor: 0 });
    expect(m.poseAt("a", 5000 + cfg.delayMs - 1)?.x).toBe(1);
  });

  it("drops samples the clock has passed, keeping the bracket", () => {
    const m = new RemoteMotion(cfg);
    for (let i = 0; i < 6; i++) m.upsert("a", { tMs: 1000 + i * 10, x: i, y: 0, floor: 0 });
    m.poseAt("a", 1025 + cfg.delayMs);
    expect(m.bufferedSamples("a")).toBe(4);
  });
});
