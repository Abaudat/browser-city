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

/** Frames the measured window must hold. */
export const MIN_MEASURED_FRAMES = 3_000;

/** Allocation attributed to `src/l3/` and the crowd update, bytes per
 * frame, steady state, for the fixed rush-hour crowd (HeapProfiler sampling,
 * 15 s window). Measured 102 KB/frame (`docs/spikes/5.4-l3-frame-budget.md`);
 * stamped at 2x the measured value, rounded up. A regression in L3
 * allocation fails CI against it; lower it when the figure falls. */
export const MAX_L3_ALLOC_BYTES_PER_FRAME = 204_800;

/** A single scavenge may not take longer than this many L3 budgets: it
 * would cost a frame and more. The routine pause is held to the budget at
 * its p99 instead (`L3_P95_BUDGET_MS`): one outlier on a shared runner is
 * noise, a distribution that shifts is not. */
export const MAX_MINOR_PAUSE_BUDGETS = 4;

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
export const L3_FRAME_URL = /\/src\/(l3\/|test-street\/(street-life|citizens-layer))/;

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
  readonly l3Ms: Distribution;
  readonly allocBytesPerFrame: number;
  readonly gc: GcSummary;
  readonly heapGrowthRatio: number;
}

export interface Verdict {
  readonly met: boolean;
  readonly failures: readonly string[];
}

/** NFR11's verdict, and every precondition that stops it being vacuous. */
export function verdict(m: L3Measurement): Verdict {
  const failures: string[] = [];
  if (!(m.liveBodiesMin >= m.requiredBodies)) {
    failures.push(`only ${m.liveBodiesMin} live bodies, ${m.requiredBodies} required`);
  }
  if (!(m.walkingMin >= m.requiredWalking)) {
    failures.push(`only ${m.walkingMin} walking bodies, ${m.requiredWalking} required`);
  }
  if (!(m.l3Ms.frames >= MIN_MEASURED_FRAMES)) {
    failures.push(`${m.l3Ms.frames} frames measured, ${MIN_MEASURED_FRAMES} required`);
  }
  if (!(m.l3Ms.p95 <= L3_P95_BUDGET_MS)) {
    failures.push(`L3 p95 ${m.l3Ms.p95.toFixed(3)} ms over ${L3_P95_BUDGET_MS} ms`);
  }
  if (!(m.l3Ms.p99 <= L3_P99_BUDGET_MS)) {
    failures.push(`L3 p99 ${m.l3Ms.p99.toFixed(3)} ms over ${L3_P99_BUDGET_MS} ms`);
  }
  if (!(m.allocBytesPerFrame <= MAX_L3_ALLOC_BYTES_PER_FRAME)) {
    failures.push(
      `L3 allocates ${m.allocBytesPerFrame.toFixed(0)} B/frame over ${MAX_L3_ALLOC_BYTES_PER_FRAME}`,
    );
  }
  if (m.gc.majorCount > 0) failures.push(`${m.gc.majorCount} major GCs in the window`);
  const minorP99 = percentile(
    [...m.gc.minorPausesMs].sort((x, y) => x - y),
    99,
  );
  if (m.gc.minorPausesMs.length > 0 && !(minorP99 <= L3_P95_BUDGET_MS)) {
    failures.push(`minor GC p99 ${minorP99.toFixed(2)} ms over ${L3_P95_BUDGET_MS} ms`);
  }
  if (!(m.gc.longestMinorPauseMs <= MAX_MINOR_PAUSE_BUDGETS * L3_P95_BUDGET_MS)) {
    failures.push(`longest minor GC ${m.gc.longestMinorPauseMs.toFixed(2)} ms is a dropped frame`);
  }
  if (!(m.heapGrowthRatio <= MAX_L3_HEAP_GROWTH_RATIO)) {
    failures.push(`retained heap grew ${m.heapGrowthRatio.toFixed(2)}x`);
  }
  return { met: failures.length === 0, failures };
}
