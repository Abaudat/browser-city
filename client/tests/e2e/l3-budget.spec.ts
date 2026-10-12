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
import { expect, type Page, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import {
  RUSH_CROWD_SIZE,
  RUSH_MIN_WALKING_SHARE,
  RUSH_PILE_CELL,
} from "../../src/test-street/rush-crowd";
import {
  addGc,
  attributedBytes,
  distribution,
  type GcSummary,
  L3_P95_BUDGET_MS,
  L3_P99_BUDGET_MS,
  MAX_L3_ALLOC_BYTES_PER_FRAME,
  MAX_L3_HEAP_GROWTH_RATIO,
  MAX_L3_MAIN_ALLOC_BYTES_PER_FRAME,
  MIN_MEASURED_FRAMES,
  MIN_TICKER_FRAMES,
  type SamplingNode,
  splitByThread,
  summariseGc,
  type TraceEvent,
  topAllocators,
  verdict,
} from "./l3-budget-verdict";
import { attachWorker, type WorkerCdp } from "./worker-cdp";

/** The whole frame (render included) under the crowd: NFR2's "busy street"
 * half. Measured at p95 2.6 ms locally with the 200-body crowd, against the
 * 0.6 ms of the empty street (`street-perf.spec.ts`); stamped at 6 ms, the
 * measured figure with the runner's slowness and a margin on top. */
const P95_CROWD_FRAME_WORK_MS = 6;

/** The street pavement's south edge: the lamppost row is 8, the body rests
 * just short of it. */
const PAVEMENT_EDGE_PLAYER_Y = 7.3;

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

async function stopTimings(
  page: Page,
): Promise<{ l3: number[]; solve: number[]; frame: number[] }> {
  return page.evaluate(() => ({
    solve: window.__bc?.stopL3SolveTimings?.() ?? [],
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

const majorEvents: { thread: string; name: string; dur?: number; args?: unknown }[] = [];

async function startGcTrace(
  cdp: Cdp,
): Promise<{ finish(): Promise<{ main: GcSummary; worker: GcSummary }> }> {
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
      const { main, worker } = splitByThread(events);
      for (const e of main) {
        if (e.name === "MajorGC") majorEvents.push({ thread: "main", ...e });
      }
      for (const e of worker) {
        if (e.name === "MajorGC") majorEvents.push({ thread: "worker", ...e });
      }
      return { main: summariseGc(main), worker: summariseGc(worker) };
    },
  };
}

test("L3 fits the frame for a 200-body rush hour: time, allocation, GC (NFR11)", async ({
  page,
  browser,
}) => {
  test.setTimeout(RUN_MS + 300_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?rushCrowd");
  await page.waitForFunction(() => window.__bc?.playerPosition !== undefined, undefined, {
    timeout: 60_000,
  });
  // To the street's south edge, where the crowd is in view and held.
  await page.keyboard.down("ArrowDown");
  await page.waitForFunction(
    (y) => (window.__bc?.playerPosition?.y ?? 0) > y,
    PAVEMENT_EDGE_PLAYER_Y,
    { timeout: 20_000 },
  );
  await page.keyboard.up("ArrowDown");
  // Every citizen of the crowd has a body before anything is measured.
  await expect
    .poll(() => page.evaluate(() => window.__bc?.bodyCount?.() ?? 0), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(RUSH_CROWD_SIZE);
  await page.waitForTimeout(WARM_UP_MS);

  const cdp = (await page.context().newCDPSession(page)) as unknown as Cdp;
  // The solve runs in a dedicated worker, a CDP target of its own: its CPU
  // throttle and its heap sampler are sent to it separately.
  const worker: WorkerCdp = await attachWorker(browser, "l3-worker");
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
    const traced = trace ? await trace.finish() : undefined;
    return { batch, gc: traced?.main, workerGc: traced?.worker };
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
  // The worker's own profile alongside: the solve's self time is its alone.
  await worker.send("Profiler.enable");
  await worker.send("Profiler.setSamplingInterval", { interval: 200 });
  await worker.send("Profiler.start");
  await page.waitForTimeout(8_000);
  const workerCpu = (await worker.send("Profiler.stop")) as {
    profile: {
      nodes: {
        id: number;
        callFrame: { functionName: string; url: string };
        positionTicks?: { line: number; ticks: number }[];
      }[];
      samples: number[];
    };
  };
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

  const workerHits = new Map<number, number>();
  for (const id of workerCpu.profile.samples) workerHits.set(id, (workerHits.get(id) ?? 0) + 1);
  const workerSelf = new Map<string, number>();
  const workerLines = new Map<string, number>();
  for (const node of workerCpu.profile.nodes) {
    const file = node.callFrame.url.replace(/^.*\/src\//, "src/");
    const key = `${node.callFrame.functionName || "(anonymous)"} ${file}`;
    workerSelf.set(key, (workerSelf.get(key) ?? 0) + (workerHits.get(node.id) ?? 0));
    for (const t of node.positionTicks ?? []) {
      const at = `${file}:${t.line}`;
      workerLines.set(at, (workerLines.get(at) ?? 0) + t.ticks);
    }
  }
  const workerTotal = workerCpu.profile.samples.length || 1;
  const workerCpuTop = [...workerSelf.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([fn, n]) => ({ fn, share: n / workerTotal }));
  const workerLinesTop = [...workerLines.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([at, n]) => ({ at, share: n / workerTotal }));

  // Phase 2, the verdict: the same real ticker -- the same window, the same
  // GC, the same crowd -- with the rasteriser taken out, so what is measured
  // is L3's own work and its own garbage, the runner's GPU emulation aside.
  await page.evaluate(() => window.__bc?.setRender?.(false));
  // The tripwire's denominator, taken with the same page and CPU the window
  // runs on, immediately before it.
  const calibrationMs = await page.evaluate(() => window.__bc?.l3Calibrate?.(21) ?? 0);
  const workerCalibrationMs = await page.evaluate(
    async () => (await window.__bc?.l3WorkerCalibrate?.(21)) ?? 0,
  );
  // The calibrations stall the pipeline for a moment (they run on the worker
  // the ticks queue behind): let it drain before the window opens.
  await page.waitForTimeout(1_000);
  const statsBefore = await page.evaluate(() => window.__bc?.l3SolveStats?.(true));
  const heapSamples: { atMs: number; usedHeapBytes: number }[] = [];
  const l3Samples: number[] = [];
  const solveSamples: number[] = [];
  let workerGc: GcSummary = {
    minorPausesMs: [],
    minorCount: 0,
    majorCount: 0,
    totalPauseMs: 0,
    longestMinorPauseMs: 0,
    longestMajorPauseMs: 0,
  };
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
    const { batch, gc: lapGc, workerGc: lapWorkerGc } = await lap(LAP_MS, await startGcTrace(cdp));
    l3Samples.push(...batch.l3);
    solveSamples.push(...batch.solve);
    if (lapGc) gc = addGc(gc, lapGc);
    if (lapWorkerGc) workerGc = addGc(workerGc, lapWorkerGc);
    heapSamples.push({ atMs: Date.now() - startedAt, usedHeapBytes: await heapBytes(cdp) });
  }

  const statsAfter = await page.evaluate(() => window.__bc?.l3SolveStats?.());
  const staleFrames = (statsAfter?.stale ?? Number.NaN) - (statsBefore?.stale ?? 0);
  const skippedRequests = (statsAfter?.skipped ?? Number.NaN) - (statsBefore?.skipped ?? 0);
  const maxLagFrames = statsAfter?.maxLagFrames ?? Number.NaN;
  const lagEvents = statsAfter?.lagEvents ?? [];

  // The same ticker window with no trace running: reported beside the verdict
  // figure, never gated -- the trace's own cost is part of what the verdict
  // pre-registered, so it stays in the verdict figure.
  await startTimings(page);
  await page.waitForTimeout(10_000);
  const untraced = await stopTimings(page);

  // Allocation, per 60 Hz frame of city time and so independent of how fast
  // the runner draws: the render-free sweep under the sampling profiler (its
  // overhead would distort the timed window above).
  // The sweep and its allocation are the worker's: the sampler is attached to
  // its target, not the page's.
  await worker.send("HeapProfiler.enable");
  await worker.send("HeapProfiler.startSampling", {
    samplingInterval: 512,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  const allocSweep = await page.evaluate((n) => window.__bc?.l3Sweep?.(n) ?? [], SWEEP_FRAMES);
  const profile = (await worker.send("HeapProfiler.stopSampling")) as {
    profile: { head: SamplingNode };
  };
  const allocFrames = allocSweep.length;
  const allocBytes = attributedBytes(profile.profile.head);
  const allocBytesPerFrame = allocFrames > 0 ? allocBytes / allocFrames : Number.NaN;

  // The main thread's share: the real ticker, render off, under the page's own
  // sampler -- the apply, the post and the layer's update allocate next to
  // nothing; the solve's garbage is the worker's.
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.startSampling", {
    samplingInterval: 512,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  await startTimings(page);
  await page.waitForTimeout(ALLOC_WINDOW_MS);
  const mainWindow = await stopTimings(page);
  const mainProfile = (await cdp.send("HeapProfiler.stopSampling")) as {
    profile: { head: SamplingNode };
  };
  const mainAllocBytesPerFrame =
    mainWindow.l3.length > 0
      ? attributedBytes(mainProfile.profile.head) / mainWindow.l3.length
      : Number.NaN;

  // The low-end figure: reported, never gated.
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE_RATE });
  // CDP refuses the throttle on a worker target ("only supported for pages");
  // the calibration below is what proves whether it took.
  const workerThrottleError = await worker
    .send("Emulation.setCPUThrottlingRate", { rate: THROTTLE_RATE })
    .then(() => null)
    .catch((e: unknown) => String(e));
  // The throttle must be seen to reach the worker: the calibration workload
  // inside it runs about THROTTLE_RATE times slower, or the throttled worker
  // figure is not reported.
  const workerCalibrationThrottledMs = await page.evaluate(
    async () => (await window.__bc?.l3WorkerCalibrate?.(5)) ?? 0,
  );
  const workerSlowdown = workerCalibrationThrottledMs / workerCalibrationMs;
  const workerThrottleReached = workerSlowdown >= THROTTLE_RATE * 0.6;
  await startTimings(page);
  await page.waitForTimeout(THROTTLED_WINDOW_MS);
  const throttled = await stopTimings(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await worker.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => undefined);
  // The sweep: the worker's solve over successive 60 Hz instants, no ticker --
  // supplementary, gated at the same budget. Taken before the render is back
  // on: the software rasteriser competes with the worker for the runner's few
  // cores, and what is measured here is the solve.
  const sweep = await page.evaluate((n) => window.__bc?.l3Sweep?.(n) ?? [], SWEEP_FRAMES);
  await page.evaluate(() => window.__bc?.setRender?.(true));

  const first = heapSamples[1]?.usedHeapBytes ?? Number.NaN;
  const last = heapSamples[heapSamples.length - 1]?.usedHeapBytes ?? Number.NaN;
  const sweepMs = distribution(sweep);
  const l3Ms = distribution(l3Samples);
  // The solve as the worker timed it, one sample per ticker frame: recorded
  // beside the main-thread window, never folded into it.
  expect(solveSamples.length).toBe(l3Samples.length);
  const solveMs = distribution(solveSamples);
  const renderedMs = distribution(renderedL3);
  const frameMs = distribution(frameSamples);
  const requiredWalking = Math.floor(RUSH_CROWD_SIZE * RUSH_MIN_WALKING_SHARE);
  const result = verdict({
    liveBodiesMin: liveMin,
    walkingMin,
    requiredBodies: RUSH_CROWD_SIZE,
    requiredWalking,
    l3Ms,
    solveMs,
    staleFrames,
    maxLagFrames,
    sweepMs,
    allocBytesPerFrame,
    mainAllocBytesPerFrame,
    calibrationMs,
    gc,
    workerGc,
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
      pileCell: RUSH_PILE_CELL,
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
    l3SolveMs: solveMs,
    untraced: {
      l3Ms: distribution(untraced.l3),
      l3SolveMs: distribution(untraced.solve),
    },
    solveStale: { staleFrames, skippedRequests, maxLagFrames, lagEvents },
    workerCalibrationMs,
    l3SweepMs: sweepMs,
    frameWorkMs: frameMs,
    throttled4x: {
      rate: THROTTLE_RATE,
      l3Ms: distribution(throttled.l3),
      workerThrottle: {
        reached: workerThrottleReached,
        error: workerThrottleError,
        calibrationMs: workerCalibrationThrottledMs,
        slowdown: workerSlowdown,
      },
      // Only a throttle proven to reach the worker gives a figure.
      workerSolveMs: workerThrottleReached ? distribution(throttled.solve) : null,
      frameWorkMs: distribution(throttled.frame),
    },
    allocation: {
      windowMs: ALLOC_WINDOW_MS,
      frames: allocFrames,
      l3Bytes: allocBytes,
      l3BytesPerFrame: allocBytesPerFrame,
      ceilingBytesPerFrame: MAX_L3_ALLOC_BYTES_PER_FRAME,
      mainBytesPerFrame: mainAllocBytesPerFrame,
      mainCeilingBytesPerFrame: MAX_L3_MAIN_ALLOC_BYTES_PER_FRAME,
      mainTop: topAllocators(mainProfile.profile.head),
      top: topAllocators(profile.profile.head),
    },
    gc: {
      ...gc,
      minorPausesMs: undefined,
      minorP99PauseMs: distribution(gc.minorPausesMs).p99,
    },
    majorEvents,
    workerGc: {
      ...workerGc,
      minorPausesMs: undefined,
      minorP99PauseMs: distribution(workerGc.minorPausesMs).p99,
    },
    cpuTopSelf: cpuTop,
    workerCpuTopSelf: workerCpuTop,
    workerCpuTopLines: workerLinesTop,
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
