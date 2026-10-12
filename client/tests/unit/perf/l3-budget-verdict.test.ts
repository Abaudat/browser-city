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
  RECORDED_P95_RATIO,
  RECORDED_P99_RATIO,
  type SamplingNode,
  splitByThread,
  summariseGc,
  verdict,
} from "../../e2e/l3-budget-verdict";

const GOOD: L3Measurement = {
  liveBodiesMin: 200,
  walkingMin: 150,
  requiredBodies: 200,
  requiredWalking: 120,
  l3Ms: distribution(Array.from({ length: MIN_TICKER_FRAMES }, (_, i) => 0.3 + (i % 10) * 0.01)),
  solveMs: distribution(Array.from({ length: MIN_TICKER_FRAMES }, (_, i) => 0.3 + (i % 10) * 0.01)),
  staleFrames: 0,
  maxLagFrames: 0,
  restarts: 0,
  sweepMs: distribution(
    Array.from({ length: MIN_MEASURED_FRAMES }, (_, i) => 0.3 + (i % 10) * 0.01),
  ),
  allocBytesPerFrame: 0,
  mainAllocBytesPerFrame: 0,
  calibrationMs: 6,
  gc: {
    minorPausesMs: [0.5, 0.7, 0.9, 1],
    minorCount: 4,
    majorCount: 0,
    totalPauseMs: 3,
    longestMinorPauseMs: 1,
    longestMajorPauseMs: 0,
    majorTypes: [],
  },
  workerGc: {
    minorPausesMs: [0.5],
    minorCount: 1,
    majorCount: 0,
    totalPauseMs: 0.5,
    longestMinorPauseMs: 0.5,
    longestMajorPauseMs: 0,
    majorTypes: [],
  },
  quietGc: {
    minorPausesMs: [0.5],
    minorCount: 1,
    majorCount: 0,
    totalPauseMs: 0.5,
    longestMinorPauseMs: 0.5,
    longestMajorPauseMs: 0,
    majorTypes: [],
  },
  quietWorkerGc: {
    minorPausesMs: [0.5],
    minorCount: 1,
    majorCount: 0,
    totalPauseMs: 0.5,
    longestMinorPauseMs: 0.5,
    longestMajorPauseMs: 0,
    majorTypes: [],
  },
  controlGc: {
    minorPausesMs: [],
    minorCount: 0,
    majorCount: 2,
    totalPauseMs: 2,
    longestMinorPauseMs: 0,
    longestMajorPauseMs: 1.3,
    majorTypes: ["finalize incremental marking via task", "finalize incremental marking via task"],
  },
  cpu: "AMD EPYC 7763 64-Core Processor",
  heapGrowthRatio: 1.01,
};

describe("L3 budget verdict (NFR11)", () => {
  it("is met by a healthy run", () => {
    expect(verdict(GOOD)).toEqual({ met: true, failures: [], risks: [], gateFailures: [] });
  });

  it("records a budget miss within the recorded finding as MISSED without failing the gate", () => {
    const recorded = distribution(Array.from({ length: MIN_TICKER_FRAMES }, () => 2.2));
    // A slow machine: the figure is over the budget in ms, not in ratio.
    const v = verdict({ ...GOOD, l3Ms: recorded, calibrationMs: 25 });
    expect(v.met).toBe(false);
    expect(v.failures.join()).toContain("p95");
    expect(v.gateFailures).toEqual([]);
  });

  it("normalises by the calibration: a slower CPU stays green, an L3 regression goes red", () => {
    const at = (p95: number, p99: number) =>
      distribution(Array.from({ length: MIN_TICKER_FRAMES }, (_, i) => (i % 20 === 0 ? p99 : p95)));
    // The recorded ratio: L3 4.3 ms on a 10 ms calibration.
    const recorded = {
      ...GOOD,
      l3Ms: at(RECORDED_P95_RATIO * 10, RECORDED_P99_RATIO * 10),
      calibrationMs: 10,
    };
    expect(verdict(recorded).gateFailures).toEqual([]);
    // The same L3 on a 1.5x slower CPU: both times scale, the ratio holds.
    const slower = {
      ...GOOD,
      l3Ms: at(RECORDED_P95_RATIO * 15, RECORDED_P99_RATIO * 15),
      calibrationMs: 15,
    };
    expect(verdict(slower).gateFailures).toEqual([]);
    // 1.5x the L3 on the same calibration is a regression.
    const regressed = {
      ...GOOD,
      l3Ms: at(RECORDED_P95_RATIO * 15, RECORDED_P99_RATIO * 15),
      calibrationMs: 10,
    };
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

  it("FAILS a main thread that allocates per frame", () => {
    const v = verdict({ ...GOOD, mainAllocBytesPerFrame: 1_000_000 });
    expect(v.gateFailures.join()).toContain("main thread allocates");
  });

  it("FAILS on a major GC and on heap growth, but never on a scavenge's duration", () => {
    const task = "finalize incremental marking via task";
    const some = (n: number, pause: number) => ({
      ...GOOD.gc,
      majorCount: n,
      longestMajorPauseMs: pause,
      majorTypes: Array.from({ length: n }, () => task),
    });
    // At the recorded figures, green; one major or a millisecond more, red.
    expect(verdict({ ...GOOD, gc: some(2, 6.8) }).met).toBe(true);
    expect(verdict({ ...GOOD, gc: some(3, 3) }).gateFailures.join()).toContain(
      "frame-thread rendered window: 3 major GCs, 2 allowed",
    );
    expect(verdict({ ...GOOD, gc: some(1, 7) }).gateFailures.join()).toContain("paused 7.00 ms");
    expect(verdict({ ...GOOD, workerGc: some(4, 3) }).gateFailures.join()).toContain(
      "worker rendered window: 4 major GCs",
    );
    expect(verdict({ ...GOOD, quietWorkerGc: some(3, 1) }).gateFailures.join()).toContain(
      "worker verdict window: 3 major GCs",
    );
    // The quiet frame thread may not show more than the idle control did.
    const quiet = {
      ...GOOD.quietGc,
      majorCount: 3,
      longestMajorPauseMs: 4,
      majorTypes: [task, task, task],
    };
    expect(verdict({ ...GOOD, quietGc: quiet }).gateFailures.join()).toContain(
      "the idle control 2",
    );
    expect(verdict({ ...GOOD, quietGc: some(2, 4) }).met).toBe(true);
    // Any other kind of major is red: it is the one L3's own garbage would cause.
    const failing = { ...some(1, 2), majorTypes: ["allocation failure"] };
    expect(verdict({ ...GOOD, workerGc: failing }).gateFailures.join()).toContain(
      "'allocation failure', not an incremental finalisation",
    );
    expect(verdict({ ...GOOD, heapGrowthRatio: 1.6 }).met).toBe(false);
    const slowScavenges = { ...GOOD.gc, minorPausesMs: [4.5, 5], longestMinorPauseMs: 9 };
    expect(verdict({ ...GOOD, gc: slowScavenges }).met).toBe(true);
  });

  it("FAILS a render-free sweep over budget even when the ticker is green", () => {
    const slow = distribution(Array.from({ length: MIN_MEASURED_FRAMES }, () => 2.5));
    expect(verdict({ ...GOOD, sweepMs: slow }).gateFailures).not.toEqual([]);
  });

  it("FAILS a worker whose own solve is over budget while the main-thread window is green", () => {
    const slow = distribution(Array.from({ length: MIN_TICKER_FRAMES }, () => 3.2));
    const v = verdict({ ...GOOD, solveMs: slow });
    expect(v.met).toBe(false);
    expect(v.failures.join()).toContain("worker solve p95");
    expect(v.gateFailures.join()).toContain("worker solve p95 / calibration");
    // The absolute budget is the verdict's, not a CI gate: a solve over it with
    // its ratio inside the tripwire reads MISSED and fails nothing.
    const quick = distribution(Array.from({ length: MIN_TICKER_FRAMES }, () => 2.2));
    const v2 = verdict({ ...GOOD, solveMs: quick, calibrationMs: 6.2 });
    expect(v2.met).toBe(false);
    expect(v2.failures.join()).toContain("worker solve p95 2.200 ms over 2 ms");
    expect(v2.gateFailures).toEqual([]);
  });

  it("reads a 7763 over the budget as MISSED whatever its calibration reads, without failing CI", () => {
    const over = distribution(Array.from({ length: MIN_TICKER_FRAMES }, () => 2.1));
    const v = verdict({
      ...GOOD,
      solveMs: over,
      calibrationMs: 6,
      cpu: "AMD EPYC 7763 64-Core Processor",
    });
    expect(v.met).toBe(false);
    expect(v.failures.join()).toContain("worker solve p95 2.100 ms over 2 ms");
    expect(v.gateFailures).toEqual([]);
  });

  it("names an unknown, slower CPU's miss as a risk, not a verdict", () => {
    const over = distribution(Array.from({ length: MIN_TICKER_FRAMES }, () => 2.4));
    const v = verdict({ ...GOOD, solveMs: over, calibrationMs: 7, cpu: "Some New SKU @ 2.0GHz" });
    expect(v.failures.join()).not.toContain("worker solve p95 2.400 ms over 2 ms");
    expect(v.risks.join()).toContain("Some New SKU @ 2.0GHz is not a known pool SKU");
    expect(v.risks.join()).toContain("worker solve p95 2.400 ms over 2 ms");
    // Unknown but as fast as the reference within the spread: the verdict's.
    const fast = verdict({
      ...GOOD,
      solveMs: over,
      calibrationMs: 6,
      cpu: "Some New SKU @ 2.0GHz",
    });
    expect(fast.failures.join()).toContain("worker solve p95 2.400 ms over 2 ms");
  });

  it("reports a solve with no margin as a risk, not as a miss", () => {
    const v = verdict({
      ...GOOD,
      calibrationMs: 6,
      solveMs: distribution(Array.from({ length: MIN_TICKER_FRAMES }, () => 1.9)),
    });
    expect(v.met).toBe(true);
    expect(v.risks.join()).toContain("worker solve p95 1.900 ms has no margin");
    expect(verdict(GOOD).risks).toEqual([]);
  });

  it("FAILS any stale frame: a worker that falls behind is a bug whatever the timings say", () => {
    const v = verdict({ ...GOOD, staleFrames: 1 });
    expect(v.met).toBe(false);
    expect(v.gateFailures.join()).toContain("stale");
  });

  it("FAILS a worker that had to be replaced", () => {
    const v = verdict({ ...GOOD, restarts: 1 });
    expect(v.met).toBe(false);
    expect(v.gateFailures.join()).toContain("replaced");
  });

  it("FAILS a result drawn more than one frame after its instant", () => {
    const v = verdict({ ...GOOD, maxLagFrames: 2 });
    expect(v.gateFailures.join()).toContain("frames late");
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

describe("GC by thread", () => {
  it("keeps a worker's collections out of the main thread's count", () => {
    const events = [
      { name: "thread_name", ph: "M", pid: 1, tid: 7, args: { name: "DedicatedWorker thread" } },
      { name: "thread_name", ph: "M", pid: 1, tid: 1, args: { name: "CrRendererMain" } },
      { name: "MajorGC", ph: "X", dur: 1000, pid: 1, tid: 7 },
      { name: "MinorGC", ph: "X", dur: 500, pid: 1, tid: 1 },
    ];
    const { main, worker } = splitByThread(events);
    expect(summariseGc(main).majorCount).toBe(0);
    expect(summariseGc(main).minorCount).toBe(1);
    expect(summariseGc(worker).majorCount).toBe(1);
  });

  it("counts a major on the main thread", () => {
    const { main } = splitByThread([{ name: "MajorGC", ph: "X", dur: 1000, pid: 1, tid: 1 }]);
    expect(summariseGc(main).majorCount).toBe(1);
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
      node("http://x/src/test-street/scene.ts", 100, [
        node("http://x/src/l3/avoidance.ts", 40, [node("http://x/node_modules/a.js", 8)]),
        node("http://x/src/test-street/citizens-layer.ts", 10),
        node("http://x/src/render/body-sprite.ts", 500),
      ]),
    ]);
    expect(attributedBytes(head)).toBe(58);
  });
});
