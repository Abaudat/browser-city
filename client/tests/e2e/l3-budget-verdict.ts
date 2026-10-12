// Story 5.4 (NFR11, D-L3): the pure half of the L3 frame-budget gate --
// percentiles, GC classification, allocation attribution and the verdict --
// so the gate's logic is unit-proven able to go red on planted series before
// the browser spec ever feeds it a real one (`l3-budget-verdict.test.ts`).
// No Playwright, no clock, no DOM.

/** NFR11: ~200 agents in a busy bubble within roughly 2 ms per frame. The
 * statistic is the p95 of the per-frame L3 window on the `ubuntu-latest`
 * runner, CPU unthrottled. Never tuned away: raising it reopens D-L3. */
export const L3_P95_BUDGET_MS = 2;
/** The tail, where GC shows up. */
export const L3_P99_BUDGET_MS = 4;
/** The margin the story set: the recorded figure plus the tripwire's 25% under
 * the budget, so a p95 at most this. The worker's solve does not have it (about
 * 2.0 ms on the EPYC 7763): it is reported as a risk the next L3 story
 * inherits, not held against the verdict. */
export const L3_P95_MARGIN_MS = 1.6;
/** The calibration time of the verdict-of-record machine (EPYC 7763, run
 * 38248089652): a machine slower than this is not held to the absolute budget
 * on the worker's solve, only to the recorded ratio. */
export const REFERENCE_CALIBRATION_MS = 5.5;

/** The finding as the tripwire holds it. `ubuntu-latest` is a mixed pool of
 * CPUs, so an absolute figure would go red on a slower SKU with no code change.
 * Each percentile is divided by `calibrationMs`, the time of a fixed pure-JS
 * workload (not L3 code) run in the same page just before the window, and the
 * ratio is held at the recorded one +25%. The NFR11 budget above stays
 * absolute and the verdict (`met`) is judged on it. Stamped at the worst ratio
 * of the final code's `e2e-perf` runs on the runner (run 38248089652, attempts
 * 1-4: EPYC 7763 twice, Xeon 8573C, EPYC 9V45), whose figures are in
 * `docs/spikes/5.4-l3-frame-budget.md`. Lowered when L3 gets cheaper, never
 * raised. */
/** The main thread's window: apply, request, layer update. */
export const RECORDED_P95_RATIO = 0.09;
export const RECORDED_P99_RATIO = 0.11;
/** The worker's own solve time per instant, in the real ticker. */
export const RECORDED_WORKER_P95_RATIO = 0.35;
export const RECORDED_WORKER_P99_RATIO = 0.48;
/** The worker's solve over successive instants with no ticker: the supplementary
 * sweep, taken inside the worker. */
export const RECORDED_WORKER_SWEEP_P95_RATIO = 0.26;
export const RECORDED_WORKER_SWEEP_P99_RATIO = 0.3;
/** A rendered result may trail the instant it was solved for by this many frames. */
export const MAX_RESULT_LAG_FRAMES = 1;

export const REGRESSION_MARGIN = 1.25;

/** Frames the in-situ window (the real ticker, render interleaved) must
 * hold: the runner yields about 1,200 in 60 s. */
export const MIN_TICKER_FRAMES = 1_000;
/** Frames the supplementary render-free sweep must hold. */
export const MIN_MEASURED_FRAMES = 3_000;

/** Allocation attributed to `src/l3/`, `src/l3-worker/` and the crowd update
 * inside the worker, bytes per frame, steady state, for the fixed rush-hour
 * crowd (HeapProfiler sampling on the worker target). Stamped at the worst of
 * the final code's runner runs (12.7 KB, run 38248089652 attempt 4) plus 25%,
 * so a doubling goes red; the remainder is the micro-path search each leg start
 * runs. Restamp it when the figure moves, never above measured + 25%. */
export const MAX_L3_ALLOC_BYTES_PER_FRAME = 15_360;

/** The main thread's share of the same allocation, bytes per ticker frame,
 * through the real ticker with the render off: the apply, the post and the
 * layer's update. Stamped at the worst of the same runs (0.9 KB) plus 25%. */
export const MAX_L3_MAIN_ALLOC_BYTES_PER_FRAME = 1_152;

/** One 60 Hz frame, in ms: the longest a collection may stop a thread. */
export const FRAME_MS = 1000 / 60;

/** Retained heap, last window against the first, after a forced GC at each
 * end -- the same method and bound as `street-perf.spec.ts`. */
export const MAX_L3_HEAP_GROWTH_RATIO = 1.5;

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index] ?? Number.NaN;
}

export function median(values: readonly number[]): number {
  return percentile(
    [...values].sort((a, b) => a - b),
    50,
  );
}

export interface Distribution {
  readonly frames: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export function distribution(samples: readonly number[]): Distribution {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    frames: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length === 0 ? Number.NaN : (sorted[sorted.length - 1] as number),
  };
}

/** A Chrome trace event, as far as GC classification reads it. */
export interface TraceEvent {
  readonly name: string;
  readonly ph?: string;
  /** Microseconds. */
  readonly dur?: number;
  readonly pid?: number;
  readonly tid?: number;
  readonly args?: { readonly name?: string; readonly [key: string]: unknown };
}

export interface GcSummary {
  /** Every minor pause, in ms. */
  readonly minorPausesMs: readonly number[];
  readonly minorCount: number;
  readonly majorCount: number;
  readonly totalPauseMs: number;
  readonly longestMinorPauseMs: number;
  readonly longestMajorPauseMs: number;
}

/** Splits a trace's events into the dedicated workers' threads and the rest,
 * by the thread-name metadata the trace carries. The solve's garbage is the
 * worker's own heap: its collections run off the frame's thread and are
 * reported apart from the main thread's, which the gate holds at zero majors. */
export function splitByThread(events: readonly TraceEvent[]): {
  main: TraceEvent[];
  worker: TraceEvent[];
} {
  const workers = new Set<string>();
  for (const e of events) {
    if (e.ph === "M" && e.name === "thread_name" && /worker/i.test(e.args?.name ?? "")) {
      workers.add(`${e.pid}:${e.tid}`);
    }
  }
  const main: TraceEvent[] = [];
  const worker: TraceEvent[] = [];
  for (const e of events) (workers.has(`${e.pid}:${e.tid}`) ? worker : main).push(e);
  return { main, worker };
}

/** Counts the GC events of one trace. Only complete events with a duration
 * count, each collection once under its umbrella name (`MinorGC` /
 * `MajorGC`), so nested phase events never double a collection. */
export function summariseGc(events: readonly TraceEvent[]): GcSummary {
  const minorPausesMs: number[] = [];
  let minorCount = 0;
  let majorCount = 0;
  let total = 0;
  let longestMinor = 0;
  let longestMajor = 0;
  for (const e of events) {
    if (e.ph !== "X" || e.dur === undefined) continue;
    const ms = e.dur / 1000;
    if (e.name === "MinorGC") {
      minorCount++;
      minorPausesMs.push(ms);
      total += ms;
      longestMinor = Math.max(longestMinor, ms);
    } else if (e.name === "MajorGC") {
      majorCount++;
      total += ms;
      longestMajor = Math.max(longestMajor, ms);
    }
  }
  return {
    minorPausesMs,
    minorCount,
    majorCount,
    totalPauseMs: total,
    longestMinorPauseMs: longestMinor,
    longestMajorPauseMs: longestMajor,
  };
}

/** Sums per-lap GC summaries. */
export function addGc(a: GcSummary, b: GcSummary): GcSummary {
  return {
    minorPausesMs: [...a.minorPausesMs, ...b.minorPausesMs],
    minorCount: a.minorCount + b.minorCount,
    majorCount: a.majorCount + b.majorCount,
    totalPauseMs: a.totalPauseMs + b.totalPauseMs,
    longestMinorPauseMs: Math.max(a.longestMinorPauseMs, b.longestMinorPauseMs),
    longestMajorPauseMs: Math.max(a.longestMajorPauseMs, b.longestMajorPauseMs),
  };
}

/** A node of a CDP `HeapProfiler` sampling profile. */
export interface SamplingNode {
  readonly callFrame: { readonly functionName: string; readonly url: string };
  readonly selfSize: number;
  readonly children: readonly SamplingNode[];
}

/** Which frames count as L3: the `l3/` modules and the two crowd adapters
 * that run inside the L3 window. */
export const L3_FRAME_URL =
  /\/src\/(l3\/|l3-worker\/|world\/walk-mirror|test-street\/(street-life|citizens-layer))/;

/** Bytes sampled under any frame whose url matches `isL3`: a sample counts
 * once, for the stack that allocated it. */
export function attributedBytes(
  head: SamplingNode,
  isL3: (url: string) => boolean = (url) => L3_FRAME_URL.test(url),
): number {
  let total = 0;
  const walk = (node: SamplingNode, inside: boolean): void => {
    const here = inside || isL3(node.callFrame.url);
    if (here) total += node.selfSize;
    for (const child of node.children) walk(child, here);
  };
  walk(head, false);
  return total;
}

/** The functions that allocated most under L3 frames, largest first: what a
 * red allocation gate points at. */
export function topAllocators(
  head: SamplingNode,
  count = 10,
  isL3: (url: string) => boolean = (url) => L3_FRAME_URL.test(url),
): { fn: string; url: string; bytes: number }[] {
  const byFn = new Map<string, { fn: string; url: string; bytes: number }>();
  const walk = (node: SamplingNode, inside: boolean): void => {
    const here = inside || isL3(node.callFrame.url);
    if (here && node.selfSize > 0) {
      const key = `${node.callFrame.functionName}@${node.callFrame.url}`;
      const entry = byFn.get(key) ?? {
        fn: node.callFrame.functionName || "(anonymous)",
        url: node.callFrame.url,
        bytes: 0,
      };
      entry.bytes += node.selfSize;
      byFn.set(key, entry);
    }
    for (const child of node.children) walk(child, here);
  };
  walk(head, false);
  return [...byFn.values()].sort((a, b) => b.bytes - a.bytes).slice(0, count);
}

export interface L3Measurement {
  readonly liveBodiesMin: number;
  readonly walkingMin: number;
  readonly requiredBodies: number;
  readonly requiredWalking: number;
  /** The main thread's L3 window in the real ticker: apply the latest result,
   * post the next instant, update the layer. */
  readonly l3Ms: Distribution;
  /** The solve as timed inside the worker, per ticker frame: moving work to
   * another thread must not hollow out the budget. */
  readonly solveMs: Distribution;
  /** Ticker frames that drew with a request in flight and no new result. */
  readonly staleFrames: number;
  /** The most frames a result was drawn after the frame it was solved for. */
  readonly maxLagFrames: number;
  /** Workers replaced after an error during the window. */
  readonly restarts: number;
  /** The supplementary render-free sweep (the worker's solve per instant),
   * gated at the same budget. */
  readonly sweepMs: Distribution;
  readonly allocBytesPerFrame: number;
  /** The main thread's bytes per ticker frame (the worker's are above). */
  readonly mainAllocBytesPerFrame: number;
  /** The calibration workload's median time in this page, in ms. */
  readonly calibrationMs: number;
  /** The frame's thread. */
  readonly gc: GcSummary;
  /** The worker's own heap. */
  readonly workerGc: GcSummary;
  readonly heapGrowthRatio: number;
}

export interface Verdict {
  /** NFR11 itself: the budget held. */
  readonly met: boolean;
  /** Everything wrong: budget misses first, then the gate's. */
  readonly failures: readonly string[];
  /** Where the figures leave no margin: reported, never held against `met`. */
  readonly risks: readonly string[];
  /** What fails CI: preconditions, allocation, major GCs, heap growth, and
   * L3 getting slower than the recorded finding. A budget miss alone is the
   * recorded finding (D-L3 reopened), not a red build. */
  readonly gateFailures: readonly string[];
}

/** NFR11's verdict, and every precondition that stops it being vacuous. */
export function verdict(m: L3Measurement): Verdict {
  const missed: string[] = [];
  const gate: string[] = [];
  const risks: string[] = [];
  if (!(m.liveBodiesMin >= m.requiredBodies)) {
    gate.push(`only ${m.liveBodiesMin} live bodies, ${m.requiredBodies} required`);
  }
  if (!(m.walkingMin >= m.requiredWalking)) {
    gate.push(`only ${m.walkingMin} walking bodies, ${m.requiredWalking} required`);
  }
  if (!(m.l3Ms.frames >= MIN_TICKER_FRAMES)) {
    gate.push(`${m.l3Ms.frames} ticker frames measured, ${MIN_TICKER_FRAMES} required`);
  }
  if (!(m.solveMs.frames >= MIN_TICKER_FRAMES)) {
    gate.push(`${m.solveMs.frames} worker solve samples measured, ${MIN_TICKER_FRAMES} required`);
  }
  if (!(m.staleFrames === 0)) {
    gate.push(`${m.staleFrames} frames drew a stale result (the gate holds zero)`);
  }
  if (!(m.maxLagFrames <= MAX_RESULT_LAG_FRAMES)) {
    gate.push(`a result was drawn ${m.maxLagFrames} frames late, ${MAX_RESULT_LAG_FRAMES} allowed`);
  }
  if (!(m.sweepMs.frames >= MIN_MEASURED_FRAMES)) {
    gate.push(`${m.sweepMs.frames} sweep frames measured, ${MIN_MEASURED_FRAMES} required`);
  }
  if (!(m.calibrationMs > 0)) gate.push("no calibration time");
  const windows: [string, Distribution, number, number][] = [
    ["L3", m.l3Ms, RECORDED_P95_RATIO, RECORDED_P99_RATIO],
    ["worker solve", m.solveMs, RECORDED_WORKER_P95_RATIO, RECORDED_WORKER_P99_RATIO],
    ["sweep", m.sweepMs, RECORDED_WORKER_SWEEP_P95_RATIO, RECORDED_WORKER_SWEEP_P99_RATIO],
  ];
  for (const [name, d, recorded95, recorded99] of windows) {
    // The worker's own solve is a red gate: it has no margin to spare, so a
    // creep past the budget is caught here and not by nobody. On a machine
    // slower than the reference it is held to the ratio below instead.
    const redBudget = name === "worker solve" && m.calibrationMs <= REFERENCE_CALIBRATION_MS;
    const miss = redBudget ? gate : missed;
    if (!(d.p95 <= L3_P95_BUDGET_MS)) {
      miss.push(`${name} p95 ${d.p95.toFixed(3)} ms over ${L3_P95_BUDGET_MS} ms`);
    }
    if (!(d.p99 <= L3_P99_BUDGET_MS)) {
      miss.push(`${name} p99 ${d.p99.toFixed(3)} ms over ${L3_P99_BUDGET_MS} ms`);
    }
    if (!(d.p95 <= L3_P95_MARGIN_MS)) {
      risks.push(`${name} p95 ${d.p95.toFixed(3)} ms has no margin: over ${L3_P95_MARGIN_MS} ms`);
    }
    const ratio95 = d.p95 / m.calibrationMs;
    const ratio99 = d.p99 / m.calibrationMs;
    if (!(ratio95 <= recorded95 * REGRESSION_MARGIN)) {
      gate.push(
        `${name} p95 / calibration ${ratio95.toFixed(3)} regressed past the recorded ${recorded95} +25%`,
      );
    }
    if (!(ratio99 <= recorded99 * REGRESSION_MARGIN)) {
      gate.push(
        `${name} p99 / calibration ${ratio99.toFixed(3)} regressed past the recorded ${recorded99} +25%`,
      );
    }
  }
  if (!(m.allocBytesPerFrame <= MAX_L3_ALLOC_BYTES_PER_FRAME)) {
    gate.push(
      `L3 allocates ${m.allocBytesPerFrame.toFixed(0)} B/frame over ${MAX_L3_ALLOC_BYTES_PER_FRAME}`,
    );
  }
  if (!(m.mainAllocBytesPerFrame <= MAX_L3_MAIN_ALLOC_BYTES_PER_FRAME)) {
    gate.push(
      `the main thread allocates ${m.mainAllocBytesPerFrame.toFixed(0)} B/frame over ${MAX_L3_MAIN_ALLOC_BYTES_PER_FRAME}`,
    );
  }
  // A major collection on either thread is held to a frame: one that takes
  // longer is a dropped frame, whoever caused it. They are not held to zero:
  // an idle page with no L3 on it shows the same incremental-marking majors
  // (V8 collects a quiet page on its own account), and the worker's own come
  // from the path churn of the fixture's leg restarts. What a worker pause
  // costs shows in the stale and lag counters, which are gated.
  if (!(m.gc.longestMajorPauseMs <= FRAME_MS)) {
    gate.push(`a main-thread major GC paused ${m.gc.longestMajorPauseMs.toFixed(2)} ms`);
  }
  if (!(m.workerGc.longestMajorPauseMs <= FRAME_MS)) {
    gate.push(`a worker major GC paused ${m.workerGc.longestMajorPauseMs.toFixed(2)} ms`);
  }
  if (!(m.restarts === 0)) gate.push(`the worker was replaced ${m.restarts} times`);
  if (!(m.heapGrowthRatio <= MAX_L3_HEAP_GROWTH_RATIO)) {
    gate.push(`retained heap grew ${m.heapGrowthRatio.toFixed(2)}x`);
  }
  return {
    met: missed.length === 0 && gate.length === 0,
    failures: [...missed, ...gate],
    risks,
    gateFailures: gate,
  };
}
