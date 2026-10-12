// D-L3 (story 5.24): the low-end figure for the solve. CDP cannot throttle a
// worker, so the whole browser is pinned to one core (`taskset -c 0`, in
// `perf-soak.yml`): the frame's thread, the worker and the rasteriser fight for
// it, as on a low-end laptop. Reported, never gated -- but a starved worker must
// show up as counted stale frames and lag, not as silence, so those are read
// beside the timings. Run alone: `npm run test:e2e:low-end`.
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { expect, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import { RUSH_CROWD_SIZE } from "../../src/test-street/rush-crowd";
import { distribution } from "./l3-budget-verdict";

const WINDOW_MS = Number(process.env.BC_LOW_END_MS ?? 30_000);
const REPORT_DIR = "test-results/story-5.24-l3-low-end";

test("L3 on one core: the worker's solve, the frame's window, stale and late frames (reported)", async ({
  page,
}) => {
  test.setTimeout(WINDOW_MS + 240_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?rushCrowd");
  await page.waitForFunction(() => window.__bc?.playerPosition !== undefined, undefined, {
    timeout: 120_000,
  });
  await page.keyboard.down("ArrowDown");
  await page.waitForFunction((y) => (window.__bc?.playerPosition?.y ?? 0) > y, 7.3, {
    timeout: 60_000,
  });
  await page.keyboard.up("ArrowDown");
  await expect
    .poll(() => page.evaluate(() => window.__bc?.bodyCount?.() ?? 0), { timeout: 120_000 })
    .toBeGreaterThanOrEqual(RUSH_CROWD_SIZE);
  await page.evaluate(() => window.__bc?.setRender?.(false));
  await page.waitForTimeout(5_000);

  await page.evaluate(() => {
    window.__bc?.l3SolveStats?.(true);
    window.__bc?.startL3Timings?.();
  });
  const before = await page.evaluate(() => window.__bc?.l3SolveStats?.());
  await page.waitForTimeout(WINDOW_MS);
  const samples = await page.evaluate(() => ({
    window: window.__bc?.stopL3Timings?.() ?? [],
    solve: window.__bc?.stopL3SolveTimings?.() ?? [],
    stats: window.__bc?.l3SolveStats?.(),
  }));
  const calibrationMs = await page.evaluate(() => window.__bc?.l3Calibrate?.(11) ?? 0);
  const workerCalibrationMs = await page.evaluate(
    async () => (await window.__bc?.l3WorkerCalibrate?.(11)) ?? 0,
  );

  const report = {
    story: "5.24",
    nfr: "NFR11",
    note: "the whole browser on one core (taskset -c 0); reported, not gated",
    environment: {
      cpu: cpus()[0]?.model ?? "unknown",
      ci: Boolean(process.env.CI),
      runId: process.env.GITHUB_RUN_ID ?? null,
      runner: process.env.RUNNER_NAME ?? null,
      affinity: process.env.BC_AFFINITY ?? null,
    },
    windowMs: WINDOW_MS,
    calibrationMs,
    workerCalibrationMs,
    mainWindowMs: distribution(samples.window),
    workerSolveMs: distribution(samples.solve),
    staleFrames: (samples.stats?.stale ?? Number.NaN) - (before?.stale ?? 0),
    skippedRequests: (samples.stats?.skipped ?? Number.NaN) - (before?.skipped ?? 0),
    restarts: samples.stats?.restarts ?? Number.NaN,
    maxLagFrames: samples.stats?.maxLagFrames ?? Number.NaN,
  };
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(`${REPORT_DIR}/l3-low-end.json`, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  // Not vacuous: frames were measured, and the worker never died.
  expect(samples.window.length).toBeGreaterThan(20);
  expect(report.restarts).toBe(0);
});
