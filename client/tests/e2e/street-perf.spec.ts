// NFR2's measurement harness and its regression gate (Quentin's
// direction, story 1.13). Its own Playwright project, `perf`, so the
// functional run (`npm run test:e2e`) never pays for it:
//
//     npm run test:e2e:perf                  # the short run, ~60s
//     BC_SOAK_MS=600000 npm run test:e2e:perf  # the 10-minute soak
//
// What it measures is per-frame *work*: the time spent inside the scene's
// own ticker callback, reported through the DEV-only `window.__bc`
// frame-timing hook. It is deliberately not a frame rate. Headless CI
// chromium has no vsync and no GPU, so a wall-clock FPS number measured
// there is noise, and a gate built on one would be flaky by
// construction -- which is exactly why the FPS half of NFR2 belongs to
// spike 1.14 and to a real machine.
//
// NFR2 is only partly served by this: "a busy street at rush hour" needs
// NPC crowds (Epic 5), which do not exist yet. `docs/trace-matrix.md`
// marks NFR2 `partial` and names story 5.4 for the rest. What this file
// closes is the regression half -- the frame path that exists today must
// not get slower, and a session must not leak.

import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import {
  type StreetWalkSegment,
  type StreetWalkUntil,
  streetReturnRoute,
  streetWalkRoute,
} from "../../src/test-street/fixture";
import { lamppostRestY } from "../unit/test-street/street-world";

/** The frame budget the scene's own work must fit inside. A 60 FPS frame
 * is 16.7 ms end to end; the app's own work getting half of that leaves
 * the other half for the renderer, the browser and everything else. */
const P95_FRAME_WORK_MS = 8;
const MAX_FRAME_WORK_MS = 16.7;

/** Samples from the first two seconds are dropped: texture uploads, the
 * first composite and JIT warm-up all land there, and none of them is
 * what a sustained session looks like. */
const WARM_UP_MS = 2_000;

/** How long the walk loops for. The short run is a PR-time regression
 * gate; `BC_SOAK_MS` turns it into NFR2's own 10-minute session. */
const RUN_MS = Number(process.env.BC_SOAK_MS ?? 60_000);
const IS_SOAK = RUN_MS >= 300_000;

/** A leaking session grows its heap monotonically. Comparing the last
 * minute's median against the second minute's (never the first, which is
 * still warming up) is what tells a leak from ordinary allocation
 * sawtooth. */
const MAX_HEAP_GROWTH_RATIO = 1.2;

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index] ?? Number.NaN;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 50);
}

async function walkSegment(page: Page, segment: StreetWalkSegment): Promise<void> {
  await page.keyboard.down(segment.key);
  try {
    await page.waitForFunction(
      (until: StreetWalkUntil) => {
        const position = window.__bc?.playerPosition;
        const floor = window.__bc?.playerFloor;
        if (!position || floor === undefined) return false;
        switch (until.kind) {
          case "x-at-least":
            return position.x >= until.value;
          case "x-at-most":
            return position.x <= until.value;
          case "y-at-least":
            return position.y >= until.value;
          case "y-at-most":
            return position.y <= until.value;
          case "floor":
            return floor === until.value;
        }
      },
      segment.until,
      { timeout: 60_000 },
    );
  } finally {
    await page.keyboard.up(segment.key);
  }
}

test("the frame path stays inside its work budget for a whole walked session (NFR2, partial)", async ({
  page,
}) => {
  test.setTimeout(RUN_MS + 120_000);

  // NFR2's own resolution. `page.setViewportSize` rather than a project
  // `viewport`, so this stays true even run from a config someone else
  // changed.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.waitForFunction(() => window.__bc?.playerAppearance !== undefined, undefined, {
    timeout: 60_000,
  });

  const inputs = { lamppostRestY: lamppostRestY() };
  // One lap: out to the bridge and back to the shop. Every lap crosses
  // both floor transitions, both enclosures and the underpass.
  const lap = [...streetWalkRoute(inputs), ...streetReturnRoute(inputs)];

  // Warm-up: one full lap, with nothing recorded.
  const warmUpUntil = Date.now() + WARM_UP_MS;
  while (Date.now() < warmUpUntil) {
    for (const segment of lap) await walkSegment(page, segment);
  }

  await page.evaluate(() => window.__bc?.startFrameTimings?.());

  const heapSamples: { atMs: number; usedJsHeapSize: number }[] = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < RUN_MS) {
    // NFR2's "including an interior transition", repeatedly rather than
    // once: every lap crosses both of them.
    for (const segment of lap) await walkSegment(page, segment);
    const usedJsHeapSize = await page.evaluate(() => {
      const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return memory?.usedJSHeapSize ?? 0;
    });
    heapSamples.push({ atMs: Date.now() - startedAt, usedJsHeapSize });
  }

  const samples = (await page.evaluate(() => window.__bc?.stopFrameTimings?.() ?? [])) as number[];
  expect(samples.length).toBeGreaterThan(100);

  const sorted = [...samples].sort((a, b) => a - b);
  const report = {
    runMs: RUN_MS,
    soak: IS_SOAK,
    viewport: { width: 1920, height: 1080 },
    frames: samples.length,
    frameWorkMs: {
      p50: percentile(sorted, 50),
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted[sorted.length - 1],
    },
    heapSamples,
  };
  mkdirSync("test-results/story-1.13-perf", { recursive: true });
  writeFileSync(
    "test-results/story-1.13-perf/frame-work.json",
    `${JSON.stringify(report, null, 2)}\n`,
    "utf-8",
  );

  expect(report.frameWorkMs.p95).toBeLessThanOrEqual(P95_FRAME_WORK_MS);
  expect(report.frameWorkMs.max).toBeLessThanOrEqual(MAX_FRAME_WORK_MS);

  if (IS_SOAK) {
    // A leak over a long session is exactly what NFR2's own duration
    // exists to catch, so it is only asserted on the run that is long
    // enough to see one.
    const minute = 60_000;
    const secondMinute = heapSamples
      .filter((s) => s.atMs >= minute && s.atMs < 2 * minute)
      .map((s) => s.usedJsHeapSize);
    const lastMinute = heapSamples
      .filter((s) => s.atMs >= RUN_MS - minute)
      .map((s) => s.usedJsHeapSize);
    // `performance.memory` is chromium-only and may be absent; a run that
    // could not measure the heap must say so rather than pass silently.
    expect(secondMinute.length).toBeGreaterThan(0);
    expect(lastMinute.length).toBeGreaterThan(0);
    expect(median(secondMinute)).toBeGreaterThan(0);
    expect(median(lastMinute) / median(secondMinute)).toBeLessThanOrEqual(MAX_HEAP_GROWTH_RATIO);
  }
});
