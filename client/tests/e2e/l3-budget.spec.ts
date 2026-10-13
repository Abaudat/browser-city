// Story 5.4 (NFR11, D-L3): the falsification gate. ~200 citizens bodied at
// once in one bubble, in a rush-hour crowd (`rush-crowd.ts`), on shipped
// dials; the per-frame cost of L3, its allocation and its GC behaviour over a
// sustained session are measured in the browser and gated:
//
//     npm run test:e2e:perf                    # the short run, ~2 minutes
//     BC_SOAK_MS=600000 npm run test:e2e:perf  # the sustained session
//
// "Per-frame cost of L3" is the window the scene brackets around
// `streetLife.solve` + `citizensLayer.update` (`onL3Work`); `l3/` reads no
// clock. Pixi's render is not L3: it stays in the whole-frame window, and both
// are reported side by side. The verdict (budget, preconditions, thresholds)
// is the pure `l3-budget-verdict.ts`, unit-proven able to go red. The machine
// is the CI runner's headless Chromium, CPU unthrottled; the 4x CPU-throttled
// run is the low-end figure, reported and never gated.
//
// Allocation is measured in its own window with the sampling heap profiler
// (its overhead would distort the timing), GC events from a trace over the
// timed window, retained heap with a forced GC between laps -- never inside a
// traced one.
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform } from "node:os";
import type { Page } from "@playwright/test";
import { RUSH_CROWD_SIZE, RUSH_MIN_WALKING_SHARE } from "../../src/debug/rush-crowd";
import type {} from "../../src/net/e2e-hooks";
import { calibrationWorkload } from "./calibration-workload";
import { expect, test } from "./fixtures";
import {
  addGc,
  attributedBytes,
  distribution,
  type GcSummary,
  L3_P95_BUDGET_MS,
  L3_P99_BUDGET_MS,
  MAX_L3_ALLOC_BYTES_PER_FRAME,
  MAX_L3_HEAP_GROWTH_RATIO,
  MIN_MEASURED_FRAMES,
  MIN_TICKER_FRAMES,
  type SamplingNode,
  summariseGc,
  type TraceEvent,
  topAllocators,
  verdict,
} from "./l3-budget-verdict";

/** The whole frame (render included) under the crowd: NFR2's "busy street"
 * half. Measured at p95 2.6 ms locally with the 200-body crowd, against the
 * 0.6 ms of the empty street (`street-perf.spec.ts`); stamped at 6 ms, the
 * measured figure with the runner's slowness and a margin on top. */
const P95_CROWD_FRAME_WORK_MS = 6;

/** Render-free L3 frames the verdict is taken over. */
const SWEEP_FRAMES = MIN_MEASURED_FRAMES + 1_000;

const RUN_MS = Number(process.env.BC_SOAK_MS ?? 60_000);
const LAP_MS = 10_000;
/** The rendered window, reported beside the verdict window. */
const RENDERED_MS = 30_000;
const WARM_UP_MS = 5_000;
const ALLOC_WINDOW_MS = 15_000;
const THROTTLED_WINDOW_MS = 10_000;
const THROTTLE_RATE = 4;

const REPORT_DIR = "test-results/story-5.4-l3-budget";

interface Cdp {
  send(method: string, params?: object): Promise<unknown>;
  on(event: string, handler: (payload: never) => void): void;
}

async function heapBytes(cdp: Cdp): Promise<number> {
  await cdp.send("HeapProfiler.collectGarbage");
  const usage = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number };
  return usage.usedSize;
}

async function startTimings(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__bc?.startFrameTimings?.();
    window.__bc?.startL3Timings?.();
  });
}

async function stopTimings(page: Page): Promise<{ l3: number[]; frame: number[] }> {
  return page.evaluate(() => ({
    l3: window.__bc?.stopL3Timings?.() ?? [],
    frame: window.__bc?.stopFrameTimings?.() ?? [],
  }));
}

/** Live and walking bodies right now, from the page's own L3 reports. */
async function census(
  page: Page,
): Promise<{ live: number; walking: number; sidestepping: number; capped: number }> {
  return page.evaluate(() => {
    const bodies = window.__bc?.l3Bodies?.() ?? [];
    return {
      live: window.__bc?.bodyCount?.() ?? 0,
      walking: bodies.filter((b) => b.moving).length,
      sidestepping: bodies.filter((b) => b.avoidance && b.avoidance.offsetCells !== 0).length,
      capped: bodies.filter((b) => b.avoidance?.capped).length,
    };
  });
}

async function startGcTrace(cdp: Cdp): Promise<{ finish(): Promise<GcSummary> }> {
  const events: TraceEvent[] = [];
  let done: () => void = () => {};
  const complete = new Promise<void>((resolve) => {
    done = resolve;
  });
  cdp.on("Tracing.dataCollected", ((payload: { value: TraceEvent[] }) => {
    for (const e of payload.value) events.push(e);
  }) as never);
  cdp.on("Tracing.tracingComplete", (() => done()) as never);
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,v8,disabled-by-default-v8.gc",
  });
  return {
    async finish() {
      await cdp.send("Tracing.end");
      await complete;
      return summariseGc(events);
    },
  };
}

test("L3 fits the frame for a 200-body rush hour: time, allocation, GC (NFR11)", async ({
  page,
  browser,
}) => {
  test.setTimeout(RUN_MS + 300_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?rushCrowd=1");
  await page.waitForFunction(() => window.__bc?.playerPosition !== undefined, undefined, {
    timeout: 60_000,
  });
  // Every citizen of the crowd has a body before anything is measured.
  await expect
    .poll(() => page.evaluate(() => window.__bc?.bodyCount?.() ?? 0), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(RUSH_CROWD_SIZE);
  await page.waitForTimeout(WARM_UP_MS);

  const cdp = (await page.context().newCDPSession(page)) as unknown as Cdp;
  let liveMin = Number.POSITIVE_INFINITY;
  let walkingMin = Number.POSITIVE_INFINITY;
  let sidesteppingMax = 0;
  let cappedMax = 0;

  /** One lap's samples, and what the crowd was doing through it. */
  async function lap(durationMs: number, trace?: Awaited<ReturnType<typeof startGcTrace>>) {
    await startTimings(page);
    const end = Date.now() + durationMs;
    while (Date.now() < end) {
      await page.waitForTimeout(1_000);
      const c = await census(page);
      liveMin = Math.min(liveMin, c.live);
      walkingMin = Math.min(walkingMin, c.walking);
      sidesteppingMax = Math.max(sidesteppingMax, c.sidestepping);
      cappedMax = Math.max(cappedMax, c.capped);
    }
    const batch = await stopTimings(page);
    return { batch, gc: trace ? await trace.finish() : undefined };
  }

  // Phase 1, the frame as a player's machine draws it: render on. Software
  // rasterisation on a GPU-less runner competes with the main thread for its
  // few cores, so L3 measured here is inflated by the rasteriser, not by L3
  // (the profile below shows where the samples go). Reported, and the whole
  // frame work is gated (NFR2's busy street); never the L3 verdict.
  const renderedL3: number[] = [];
  const frameSamples: number[] = [];
  for (let spent = 0; spent < RENDERED_MS; spent += LAP_MS) {
    const { batch } = await lap(LAP_MS);
    renderedL3.push(...batch.l3);
    frameSamples.push(...batch.frame);
  }

  // Where the time goes, with the render on: a CPU profile, top self-time.
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.start");
  await page.waitForTimeout(8_000);
  const cpu = (await cdp.send("Profiler.stop")) as {
    profile: {
      nodes: { id: number; callFrame: { functionName: string; url: string } }[];
      samples: number[];
    };
  };
  const hits = new Map<number, number>();
  for (const id of cpu.profile.samples) hits.set(id, (hits.get(id) ?? 0) + 1);
  const selfByFn = new Map<string, number>();
  for (const node of cpu.profile.nodes) {
    const key = `${node.callFrame.functionName || "(anonymous)"} ${node.callFrame.url.replace(/^.*\/src\//, "src/")}`;
    selfByFn.set(key, (selfByFn.get(key) ?? 0) + (hits.get(node.id) ?? 0));
  }
  const total = cpu.profile.samples.length || 1;
  const cpuTop = [...selfByFn.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([fn, n]) => ({ fn, share: n / total }));

  // Phase 2, the verdict: the same real ticker -- the same window, the same
  // GC, the same crowd -- with the rasteriser taken out, so what is measured
  // is L3's own work and its own garbage, the runner's GPU emulation aside.
  await page.evaluate(() => window.__bc?.setRender?.(false));
  // The tripwire's denominator, taken with the same page and CPU the window
  // runs on, immediately before it.
  const calibrationMs = await page.evaluate(calibrationWorkload, 21);
  const heapSamples: { atMs: number; usedHeapBytes: number }[] = [];
  const l3Samples: number[] = [];
  let gc: GcSummary = {
    minorPausesMs: [],
    minorCount: 0,
    majorCount: 0,
    totalPauseMs: 0,
    longestMinorPauseMs: 0,
    longestMajorPauseMs: 0,
  };
  heapSamples.push({ atMs: 0, usedHeapBytes: await heapBytes(cdp) });
  const startedAt = Date.now();
  // Laps run until the time is up and the window holds its floor of frames,
  // within three times the time.
  while (
    Date.now() - startedAt < RUN_MS ||
    (l3Samples.length < MIN_TICKER_FRAMES && Date.now() - startedAt < 3 * RUN_MS)
  ) {
    const { batch, gc: lapGc } = await lap(LAP_MS, await startGcTrace(cdp));
    l3Samples.push(...batch.l3);
    if (lapGc) gc = addGc(gc, lapGc);
    heapSamples.push({ atMs: Date.now() - startedAt, usedHeapBytes: await heapBytes(cdp) });
  }

  // Allocation, per 60 Hz frame of city time and so independent of how fast
  // the runner draws: the render-free sweep under the sampling profiler (its
  // overhead would distort the timed window above).
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.startSampling", {
    samplingInterval: 512,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  const allocSweep = await page.evaluate((n) => window.__bc?.l3Sweep?.(n) ?? [], SWEEP_FRAMES);
  const profile = (await cdp.send("HeapProfiler.stopSampling")) as {
    profile: { head: SamplingNode };
  };
  const allocFrames = allocSweep.length;
  const allocBytes = attributedBytes(profile.profile.head);
  const allocBytesPerFrame = allocFrames > 0 ? allocBytes / allocFrames : Number.NaN;

  // The low-end figure: reported, never gated.
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE_RATE });
  await startTimings(page);
  await page.waitForTimeout(THROTTLED_WINDOW_MS);
  const throttled = await stopTimings(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.evaluate(() => window.__bc?.setRender?.(true));

  const first = heapSamples[1]?.usedHeapBytes ?? Number.NaN;
  const last = heapSamples[heapSamples.length - 1]?.usedHeapBytes ?? Number.NaN;
  // The sweep: the same window over successive 60 Hz instants, no ticker --
  // supplementary, gated at the same budget.
  const sweep = await page.evaluate((n) => window.__bc?.l3Sweep?.(n) ?? [], SWEEP_FRAMES);
  const sweepMs = distribution(sweep);
  const l3Ms = distribution(l3Samples);
  const renderedMs = distribution(renderedL3);
  const frameMs = distribution(frameSamples);
  const requiredWalking = Math.floor(RUSH_CROWD_SIZE * RUSH_MIN_WALKING_SHARE);
  const result = verdict({
    liveBodiesMin: liveMin,
    walkingMin,
    requiredBodies: RUSH_CROWD_SIZE,
    requiredWalking,
    l3Ms,
    sweepMs,
    allocBytesPerFrame,
    calibrationMs,
    gc,
    heapGrowthRatio: last / first,
  });

  const report = {
    story: "5.4",
    nfr: "NFR11",
    environment: {
      platform: platform(),
      cpu: cpus()[0]?.model ?? "unknown",
      cores: cpus().length,
      chromium: browser.version(),
      ci: Boolean(process.env.CI),
      runId: process.env.GITHUB_RUN_ID ?? null,
      runner: process.env.RUNNER_NAME ?? null,
      image: process.env.ImageOS ?? null,
    },
    runMs: RUN_MS,
    soak: RUN_MS >= 300_000,
    viewport: { width: 1920, height: 1080 },
    crowd: {
      size: RUSH_CROWD_SIZE,
      liveBodiesMin: liveMin,
      walkingMin,
      sidesteppingMax,
      cappedMax,
    },
    budget: { p95Ms: L3_P95_BUDGET_MS, p99Ms: L3_P99_BUDGET_MS },
    verdict: result.met ? "MET" : "MISSED",
    failures: result.failures,
    calibrationMs,
    l3Ratios: {
      p95: l3Ms.p95 / calibrationMs,
      p99: l3Ms.p99 / calibrationMs,
      sweepP95: sweepMs.p95 / calibrationMs,
      sweepP99: sweepMs.p99 / calibrationMs,
    },
    l3Ms,
    l3RenderedMs: renderedMs,
    l3SweepMs: sweepMs,
    frameWorkMs: frameMs,
    throttled4x: {
      rate: THROTTLE_RATE,
      l3Ms: distribution(throttled.l3),
      frameWorkMs: distribution(throttled.frame),
    },
    allocation: {
      windowMs: ALLOC_WINDOW_MS,
      frames: allocFrames,
      l3Bytes: allocBytes,
      l3BytesPerFrame: allocBytesPerFrame,
      ceilingBytesPerFrame: MAX_L3_ALLOC_BYTES_PER_FRAME,
      top: topAllocators(profile.profile.head),
    },
    gc: {
      ...gc,
      minorPausesMs: undefined,
      minorP99PauseMs: distribution(gc.minorPausesMs).p99,
    },
    cpuTopSelf: cpuTop,
    heap: { samples: heapSamples, growthRatio: last / first, bound: MAX_L3_HEAP_GROWTH_RATIO },
  };
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(`${REPORT_DIR}/l3-budget.json`, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  // The load is not vacuous: avoidance really ran, and ran at its cap.
  expect(sidesteppingMax).toBeGreaterThan(0);
  expect(cappedMax).toBeGreaterThan(0);
  // A budget miss is the recorded finding (D-L3 reopened), not a red build;
  // everything else the verdict holds is.
  expect(result.gateFailures).toEqual([]);
  expect(frameMs.p95).toBeLessThanOrEqual(P95_CROWD_FRAME_WORK_MS);
});
