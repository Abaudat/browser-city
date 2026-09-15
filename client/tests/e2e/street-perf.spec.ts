// NFR2's measurement harness and its regression gate (Quentin/Tim's
// direction, story 1.13). Its own Playwright project, `perf`, so the
// functional run (`npm run test:e2e`) never pays for it:
//
//     npm run test:e2e:perf                  # the short run, ~60s
//     BC_SOAK_MS=600000 npm run test:e2e:perf  # the 10-minute soak
//
// What it measures is the whole per-frame CPU *work*, not one system's
// callback (cycle 1 finding, both leads): `test-street/scene.ts` brackets
// it with two ticker listeners, one at `UPDATE_PRIORITY.INTERACTION`
// (before everything) and one at `UPDATE_PRIORITY.UTILITY` (after Pixi's
// own render, which runs at `UPDATE_PRIORITY.LOW`) -- so movement,
// re-sorting, visibility and the street crowd's own animation update all
// fall inside the window, and so does the render call itself. It is
// deliberately not a frame *rate*. Headless CI chromium has no vsync and
// no GPU, so a wall-clock FPS number measured there is noise, and a gate
// built on one would be flaky by construction -- which is exactly why the
// FPS half of NFR2 belongs to spike 1.14 and to a real machine.
//
// NFR2 is only partly served by this: "a busy street at rush hour" needs
// NPC crowds (Epic 5), which do not exist yet. `docs/trace-matrix.md`
// marks NFR2 `partial` and names story 5.4 for the rest. What this file
// closes is the regression half -- the frame path that exists today must
// not get slower, and a session must not leak.
//
// The heap is sampled through a CDP session (`HeapProfiler.collectGarbage`
// then `Runtime.getHeapUsage().usedSize`), once per lap, never
// `performance.memory.usedJSHeapSize`: without
// `--enable-precise-memory-info` that figure is bucketed and cached, and
// sampled with no GC beforehand it measures the allocation sawtooth, not
// retained size -- a threshold on it could neither reliably catch a leak
// nor reliably stay green without one. The short run also asserts a
// (wider) growth bound, first lap vs. last lap, so a leak has a chance to
// be caught on a run every PR waits for, not only on the soak nobody does.
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import {
  type StreetWalkSegment,
  type StreetWalkUntil,
  streetBridgeLapRoute,
  streetWalkRoute,
} from "../../src/test-street/fixture";
import { streetWalkInputs } from "../unit/test-street/street-world";

/** The frame budget the scene's own work must fit inside. A 60 FPS frame
 * is 16.7 ms end to end; the app's own work getting half of that leaves
 * the other half for the renderer, the browser and everything else. This
 * now covers the whole frame (see the module doc above), not a fraction
 * of it -- measured locally (a Windows development machine) at p95
 * 0.6 ms / max 1.4 ms, and on the CI runner itself (`ubuntu-latest`,
 * `.github/workflows/ci.yml`'s `e2e` job, run 34937513478) at p95 0.8 ms
 * / max 3 ms -- comfortably inside both numbers with the render
 * included, on the machine this budget actually has to hold on. Only an
 * 8-13x margin today; NFR2's own budget, and story 5.4 tightens it under
 * real crowd load. */
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
 * sawtooth -- the soak's own window, over many laps. */
const MAX_HEAP_GROWTH_RATIO_SOAK = 1.2;

/** The short run's own, looser bound: first lap vs. last lap, with far
 * fewer samples over a far shorter session than the soak gets, so it is
 * a bound wide enough to survive ordinary noise while still catching a
 * gross regression on every PR rather than only on the soak. */
const MAX_HEAP_GROWTH_RATIO_SHORT = 1.5;

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
      // A cold, busy CI runner (this spec's own crowd keeps animating,
      // unlike `test-street.spec.ts`'s frozen one) has occasionally taken
      // markedly longer than a single segment's own real walking time to
      // render enough frames to cover it -- widened from 60s after an
      // observed CI flake, the same reason the screenshot spec's own
      // stability wait was widened.
      { timeout: 120_000 },
    );
  } finally {
    await page.keyboard.up(segment.key);
  }
}

async function walkRoute(page: Page, route: readonly StreetWalkSegment[]): Promise<void> {
  for (const segment of route) await walkSegment(page, segment);
}

test("the frame path stays inside its work budget for a whole walked session (NFR2, partial)", async ({
  page,
}) => {
  // 180s of headroom, not 120s: the initial walk's own segments (the
  // journey out, `walkRoute` below) each now individually allow up to
  // 120s on a cold, busy runner (`walkSegment`'s own doc comment says
  // why), so the fixed overhead this test's own timeout budgets for has
  // to allow for more than one of them landing badly.
  test.setTimeout(RUN_MS + 180_000);

  // NFR2's own resolution. `page.setViewportSize` rather than a project
  // `viewport`, so this stays true even run from a config someone else
  // changed.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.waitForFunction(() => window.__bc?.playerAppearance !== undefined, undefined, {
    timeout: 60_000,
  });

  const cdp = await page.context().newCDPSession(page);
  async function sampleHeapBytes(): Promise<number> {
    await cdp.send("HeapProfiler.collectGarbage");
    const usage = await cdp.send("Runtime.getHeapUsage");
    return usage.usedSize;
  }

  // The journey out is walked once: it leaves the shop (an enclosure
  // boundary), rests part-way through the lamppost, crosses under the
  // bridge and climbs onto the deck. It is not looped, because its own
  // way home would have to thread a one-cell doorway, and how far a
  // walker travels past its release condition is a property of the
  // machine, not of the route -- a loop that needs sub-cell precision is
  // a loop that hangs on a slow enough runner.
  await walkRoute(page, streetWalkRoute(streetWalkInputs()));

  // What *is* looped is the bridge lap, whose every segment ends on a
  // collider or a floor transition -- both immune to overshoot -- and
  // which starts and ends exactly where the journey out left off. Two
  // floor transitions per lap: NFR2's "including an interior
  // transition", repeatedly rather than once.
  const lap = streetBridgeLapRoute();

  // Warm-up: laps with nothing recorded.
  const warmUpUntil = Date.now() + WARM_UP_MS;
  while (Date.now() < warmUpUntil) {
    await walkRoute(page, lap);
  }

  await page.evaluate(() => window.__bc?.startFrameTimings?.());

  const heapSamples: { atMs: number; usedHeapBytes: number }[] = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < RUN_MS) {
    await walkRoute(page, lap);
    heapSamples.push({ atMs: Date.now() - startedAt, usedHeapBytes: await sampleHeapBytes() });
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

  expect(heapSamples.length).toBeGreaterThanOrEqual(2);

  if (IS_SOAK) {
    // A leak over a long session is exactly what NFR2's own duration
    // exists to catch: the second minute's median against the last
    // minute's, never the first minute (still warming up).
    const minute = 60_000;
    const secondMinute = heapSamples
      .filter((s) => s.atMs >= minute && s.atMs < 2 * minute)
      .map((s) => s.usedHeapBytes);
    const lastMinute = heapSamples
      .filter((s) => s.atMs >= RUN_MS - minute)
      .map((s) => s.usedHeapBytes);
    expect(secondMinute.length).toBeGreaterThan(0);
    expect(lastMinute.length).toBeGreaterThan(0);
    expect(median(secondMinute)).toBeGreaterThan(0);
    expect(median(lastMinute) / median(secondMinute)).toBeLessThanOrEqual(
      MAX_HEAP_GROWTH_RATIO_SOAK,
    );
  } else {
    // The short run's own, looser check: first lap vs. last lap, so a
    // gross leak has a chance of being caught on a run every PR waits
    // for, not only on the soak workflow nobody blocks on.
    const first = heapSamples[0]?.usedHeapBytes;
    const last = heapSamples[heapSamples.length - 1]?.usedHeapBytes;
    expect(first).toBeGreaterThan(0);
    expect(last).toBeGreaterThan(0);
    if (first !== undefined && last !== undefined) {
      expect(last / first).toBeLessThanOrEqual(MAX_HEAP_GROWTH_RATIO_SHORT);
    }
  }
});
