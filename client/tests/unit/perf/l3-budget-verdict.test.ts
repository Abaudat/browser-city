import { describe, expect, it } from "vitest";
import {
  addGc,
  attributedBytes,
  distribution,
  type L3Measurement,
  MAX_L3_ALLOC_BYTES_PER_FRAME,
  MIN_MEASURED_FRAMES,
  MIN_TICKER_FRAMES,
  median,
  percentile,
  type SamplingNode,
  summariseGc,
  verdict,
} from "../../e2e/l3-budget-verdict";

const GOOD: L3Measurement = {
  liveBodiesMin: 200,
  walkingMin: 150,
  requiredBodies: 200,
  requiredWalking: 120,
  l3Ms: distribution(Array.from({ length: MIN_TICKER_FRAMES }, (_, i) => 0.3 + (i % 10) * 0.01)),
  sweepMs: distribution(
    Array.from({ length: MIN_MEASURED_FRAMES }, (_, i) => 0.3 + (i % 10) * 0.01),
  ),
  allocBytesPerFrame: 0,
  calibrationMs: 2,
  gc: {
    minorPausesMs: [0.5, 0.7, 0.9, 1],
    minorCount: 4,
    majorCount: 0,
    totalPauseMs: 3,
    longestMinorPauseMs: 1,
    longestMajorPauseMs: 0,
  },
  heapGrowthRatio: 1.01,
};

describe("L3 budget verdict (NFR11)", () => {
  it("is met by a healthy run", () => {
    expect(verdict(GOOD)).toEqual({ met: true, failures: [], gateFailures: [] });
  });

  it("records a budget miss within the recorded finding as MISSED without failing the gate", () => {
    const recorded = distribution(Array.from({ length: MIN_TICKER_FRAMES }, () => 2.2));
    const v = verdict({ ...GOOD, l3Ms: recorded, calibrationMs: 6 });
    expect(v.met).toBe(false);
    expect(v.failures.join()).toContain("p95");
    expect(v.gateFailures).toEqual([]);
  });

  it("normalises by the calibration: a slower CPU stays green, an L3 regression goes red", () => {
    const at = (p95: number, p99: number) =>
      distribution(Array.from({ length: MIN_TICKER_FRAMES }, (_, i) => (i % 20 === 0 ? p99 : p95)));
    // The recorded ratio: L3 4.3 ms on a 10 ms calibration.
    const recorded = { ...GOOD, l3Ms: at(4.3, 4.8), calibrationMs: 10 };
    expect(verdict(recorded).gateFailures).toEqual([]);
    // The same L3 on a 1.5x slower CPU: both times scale, the ratio holds.
    const slower = { ...GOOD, l3Ms: at(6.45, 7.2), calibrationMs: 15 };
    expect(verdict(slower).gateFailures).toEqual([]);
    // 1.5x the L3 on the same calibration is a regression.
    const regressed = { ...GOOD, l3Ms: at(6.45, 7.2), calibrationMs: 10 };
    expect(verdict(regressed).gateFailures.join()).toContain("calibration");
  });

  it("FAILS a planted over-budget series", () => {
    const slow = distribution(
      Array.from({ length: MIN_TICKER_FRAMES }, (_, i) => (i % 10 < 2 ? 3 : 0.5)),
    );
    const v = verdict({ ...GOOD, l3Ms: slow });
    expect(v.met).toBe(false);
    expect(v.failures.join()).toContain("p95");
    expect(v.gateFailures.join()).toContain("regressed");
  });

  it("FAILS a planted tail the p95 hides", () => {
    const tail = distribution(
      Array.from({ length: MIN_TICKER_FRAMES }, (_, i) => (i % 50 === 0 ? 9 : 0.4)),
    );
    const v = verdict({ ...GOOD, l3Ms: tail });
    expect(v.met).toBe(false);
    expect(v.failures.join()).toContain("p99");
    expect(v.gateFailures.join()).toContain("regressed");
  });

  it("FAILS a planted allocating series", () => {
    const v = verdict({ ...GOOD, allocBytesPerFrame: MAX_L3_ALLOC_BYTES_PER_FRAME + 1 });
    expect(v.met).toBe(false);
    expect(v.gateFailures.join()).toContain("B/frame");
  });

  it("FAILS on a major GC and on heap growth, but never on a scavenge's duration", () => {
    expect(verdict({ ...GOOD, gc: { ...GOOD.gc, majorCount: 1 } }).met).toBe(false);
    expect(verdict({ ...GOOD, heapGrowthRatio: 1.6 }).met).toBe(false);
    const slowScavenges = { ...GOOD.gc, minorPausesMs: [4.5, 5], longestMinorPauseMs: 9 };
    expect(verdict({ ...GOOD, gc: slowScavenges }).met).toBe(true);
  });

  it("FAILS a render-free sweep over budget even when the ticker is green", () => {
    const slow = distribution(Array.from({ length: MIN_MEASURED_FRAMES }, () => 2.5));
    expect(verdict({ ...GOOD, sweepMs: slow }).gateFailures).not.toEqual([]);
  });

  it("FAILS a vacuous run: too few bodies, too few walking, too few frames", () => {
    expect(verdict({ ...GOOD, liveBodiesMin: 199 }).met).toBe(false);
    expect(verdict({ ...GOOD, walkingMin: 10 }).met).toBe(false);
    expect(verdict({ ...GOOD, l3Ms: distribution([0.1, 0.2]) }).met).toBe(false);
    expect(verdict({ ...GOOD, sweepMs: distribution([0.1, 0.2]) }).met).toBe(false);
  });

  it("FAILS on NaN rather than passing it", () => {
    expect(verdict({ ...GOOD, l3Ms: distribution([]) }).met).toBe(false);
    expect(verdict({ ...GOOD, allocBytesPerFrame: Number.NaN }).met).toBe(false);
  });
});

describe("percentiles", () => {
  it("picks the nearest rank and clamps", () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(s, 50)).toBe(6);
    expect(percentile(s, 100)).toBe(10);
    expect(median([5, 1, 3])).toBe(3);
    expect(percentile([], 50)).toBeNaN();
    expect(distribution([3, 1, 2]).max).toBe(3);
  });
});

describe("GC classification", () => {
  const events = [
    { name: "MinorGC", ph: "X", dur: 800 },
    { name: "V8.GCScavenger", ph: "X", dur: 700 },
    { name: "MinorGC", ph: "X", dur: 1_500 },
    { name: "MajorGC", ph: "X", dur: 9_000 },
    { name: "MajorGC", ph: "B" },
  ];

  it("counts each collection once, by umbrella event, and sums pauses", () => {
    const gc = summariseGc(events);
    expect(gc.minorCount).toBe(2);
    expect(gc.majorCount).toBe(1);
    expect(gc.totalPauseMs).toBeCloseTo(11.3);
    expect(gc.longestMinorPauseMs).toBe(1.5);
    expect(gc.longestMajorPauseMs).toBe(9);
  });

  it("adds laps", () => {
    const one = summariseGc(events);
    const two = addGc(one, one);
    expect(two.minorCount).toBe(4);
    expect(two.longestMajorPauseMs).toBe(9);
  });
});

describe("allocation attribution", () => {
  const node = (url: string, selfSize: number, children: SamplingNode[] = []): SamplingNode => ({
    callFrame: { functionName: "f", url },
    selfSize,
    children,
  });

  it("sums samples whose stack runs through l3/ or the crowd adapters", () => {
    const head = node("", 0, [
      node("http://x/src/render/world-scene.ts", 100, [
        node("http://x/src/l3/avoidance.ts", 40, [node("http://x/node_modules/a.js", 8)]),
        node("http://x/src/render/citizens-layer.ts", 10),
        node("http://x/src/render/body-sprite.ts", 500),
      ]),
    ]);
    expect(attributedBytes(head)).toBe(58);
  });
});
