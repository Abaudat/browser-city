// NFR2's measurement harness and its regression gate (Quentin/Tim's
// direction, story 1.13), over the generated district (story 3.16). Its own
// Playwright project, `perf`, so the functional run (`npm run test:e2e`)
// never pays for it:
//
//     npm run test:e2e:perf                  # the short run, ~60s
//     BC_SOAK_MS=600000 npm run test:e2e:perf  # the 10-minute soak
//
// What it measures is the whole per-frame CPU *work*, not one system's
// callback: `render/world-scene.ts` brackets it with two ticker listeners,
// one at `UPDATE_PRIORITY.INTERACTION` (before everything) and one at
// `UPDATE_PRIORITY.UTILITY` (after Pixi's own render, which runs at
// `UPDATE_PRIORITY.LOW`) -- so movement, re-sorting, visibility, chunk
// streaming and the render call itself all fall inside the window. It is
// deliberately not a frame *rate*: headless CI chromium has no vsync and no
// GPU, so a wall-clock FPS figure measured there is noise.
//
// The walk is the district's own: a lap east and back along a street that
// crosses a chunk border, so every lap draws a chunk in and releases it
// again -- streaming, body-zone spawn and atlas pages at the scale the
// hand-laid street never reached. Besides the frame budget it holds the
// leak check Quentin asked for: after walking out and back, the chunks
// drawn, the sprites alive and the atlas pages bound return to where they
// started, and the heap does not climb.
//
// The heap is sampled through a CDP session (`HeapProfiler.collectGarbage`
// then `Runtime.getHeapUsage().usedSize`), once per lap, never
// `performance.memory.usedJSHeapSize`: without
// `--enable-precise-memory-info` that figure is bucketed and cached.
import { mkdirSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import { ZOOM } from "../../src/render/camera";
import { cellBottomCentre, worldPointPx } from "../../src/render/screen-position";
import { committedDefs } from "../unit/support/committed-defs";
import { canvasOffsetForWorldPx } from "./camera-test-support";
import {
  arrivalCell,
  type Cell,
  nearestInteractable,
  reachPositionOf,
  routeBetween,
  streetAcrossChunkBorder,
  walkToPosition,
} from "./district-support";
import { expect, test } from "./fixtures";
import { median, percentile } from "./l3-budget-verdict";
import { segmentsOf, walkSyntheticSegment } from "./walk-support";
import type { WalkSegment } from "./walk-types";

/** The frame budget the scene's own work must fit inside. A 60 FPS frame is
 * 16.7 ms end to end; the app's own work getting half of that leaves the
 * other half for the renderer, the browser and everything else. Under the
 * 200-body rush-hour crowd the same window is gated by `l3-budget.spec.ts`. */
const P95_FRAME_WORK_MS = 8;
const MAX_FRAME_WORK_MS = 16.7;

/** Samples from the first two seconds are dropped: texture uploads, the
 * first composite and JIT warm-up all land there. */
const WARM_UP_MS = 2_000;

/** How long the walk loops for. The short run is a PR-time regression gate;
 * `BC_SOAK_MS` turns it into NFR2's own 10-minute session. */
const RUN_MS = Number(process.env.BC_SOAK_MS ?? 60_000);
const IS_SOAK = RUN_MS >= 300_000;

/** A leaking session grows its heap monotonically: the last minute's median
 * against the second minute's (never the first, which is still warming up). */
const MAX_HEAP_GROWTH_RATIO_SOAK = 1.2;
/** The short run's own, looser bound: first lap against last lap. */
const MAX_HEAP_GROWTH_RATIO_SHORT = 1.5;

/** How long a single segment is allowed. */
const SEGMENT_TIMEOUT_MS = 60_000;

/** How long the marked phase records for: a real share of frames must be
 * measured with an object actually marked. */
const MARKED_PHASE_MS = 5_000;

/** NFR12: simultaneously bound atlas textures stay under the GPU texture-unit
 * limit (target ~8). */
const MAX_BOUND_ATLAS_PAGES = 8;

/** The walk must cross at least this many chunk borders to count. */
const MIN_BORDER_CROSSINGS = 3;

/** How many sprites, drawn chunks and bound pages may differ between the
 * start of a lap and its end: the walk is a loop, so streaming is symmetric,
 * but a chunk is released a whole chunk past its margin, never at once. */
const LEAK_CHUNK_TOLERANCE = 1;
const LEAK_SPRITE_TOLERANCE_RATIO = 0.35;

async function walkSynthetic(page: Page, route: readonly Cell[]): Promise<void> {
  const segments: WalkSegment[] = segmentsOf(route);
  for (const segment of segments) await walkSyntheticSegment(page, segment, SEGMENT_TIMEOUT_MS);
}

async function world(page: Page) {
  const w = await page.evaluate(() => window.__bc?.world?.());
  if (!w) throw new Error("no world hook");
  return w;
}

test("the frame path stays inside its work budget for a whole walked session, and streaming leaks nothing (NFR2, NFR12)", async ({
  page,
}) => {
  test.setTimeout(RUN_MS + 180_000);

  await page.setViewportSize({ width: 1920, height: 1080 });
  // Opts in to remote players: the gate must hold the subscription and the
  // layer every production client runs (its own instance, so no leftovers).
  await page.goto("/?remotePlayers=1");
  await page.waitForFunction(() => window.__bc?.playerAppearance !== undefined, undefined, {
    timeout: 60_000,
  });
  await page.waitForFunction(() => (window.__bc?.world?.().drawnChunks ?? 0) > 0);

  const cdp = await page.context().newCDPSession(page);
  async function sampleHeapBytes(): Promise<number> {
    await cdp.send("HeapProfiler.collectGarbage");
    const usage = await cdp.send("Runtime.getHeapUsage");
    return usage.usedSize;
  }

  // A street that crosses a chunk border, found in the district; walked out
  // to once, then lapped.
  const found = streetAcrossChunkBorder(arrivalCell(), 12);
  const street = {
    border: found.border,
    start: { x: found.border - 12, y: found.start.y },
    end: { x: found.border + 12, y: found.start.y },
  };
  const out = routeBetween(arrivalCell(), street.start);
  await walkSynthetic(page, out);
  const lap = [
    ...routeBetween(street.start, street.end),
    ...routeBetween(street.end, street.start).slice(1),
  ];
  const startWorld = await world(page);

  // Warm-up: laps with nothing recorded.
  const warmUpUntil = Date.now() + WARM_UP_MS;
  while (Date.now() < warmUpUntil) await walkSynthetic(page, lap);

  // The leak check's reference: where the street's own end stands once warm.
  const settled = await world(page);

  await page.evaluate(() => window.__bc?.startFrameTimings?.());

  const heapSamples: { atMs: number; usedHeapBytes: number }[] = [];
  const frameSamples: number[] = [];
  const frameStamps: number[] = [];
  let maxBound = 0;
  let laps = 0;
  const startedAt = Date.now();
  // At least two laps whatever the run length: a lap is the unit of streaming.
  while (Date.now() - startedAt < RUN_MS || laps < 2) {
    await walkSynthetic(page, lap);
    laps++;
    maxBound = Math.max(maxBound, (await world(page)).boundAtlasPages);
    // Stop recording *before* the heap sample's own forced full GC: it is a
    // real main-thread stall that would otherwise be attributed to the app.
    const batch = (await page.evaluate(() => window.__bc?.stopFrameTimings?.() ?? [])) as number[];
    frameSamples.push(...batch);
    frameStamps.push(
      ...((await page.evaluate(() => window.__bc?.lastFrameStamps ?? [])) as number[]),
    );
    heapSamples.push({ atMs: Date.now() - startedAt, usedHeapBytes: await sampleHeapBytes() });
    await page.evaluate(() => window.__bc?.startFrameTimings?.());
  }
  const finalBatch = (await page.evaluate(
    () => window.__bc?.stopFrameTimings?.() ?? [],
  )) as number[];
  frameSamples.push(...finalBatch);
  frameStamps.push(
    ...((await page.evaluate(() => window.__bc?.lastFrameStamps ?? [])) as number[]),
  );

  const samples = frameSamples;
  expect(samples.length).toBeGreaterThan(100);

  const sorted = [...samples].sort((a, b) => a - b);
  const endWorld = await world(page);
  // A lap goes out across the chunk border and back across it.
  const crossings = 2 * laps;
  const report = {
    runMs: RUN_MS,
    soak: IS_SOAK,
    viewport: { width: 1920, height: 1080 },
    street: { start: street.start, end: street.end, chunkBorderX: street.border },
    frames: samples.length,
    frameWorkMs: {
      p50: percentile(sorted, 50),
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted[sorted.length - 1],
    },
    maxFrame: (() => {
      const index = frameSamples.indexOf(sorted[sorted.length - 1] as number);
      return { ms: frameSamples[index], atMs: frameStamps[index] };
    })(),
    world: { start: startWorld, settled, end: endWorld, maxBoundAtlasPages: maxBound },
    laps,
    borderCrossings: crossings,
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
  expect(crossings).toBeGreaterThanOrEqual(MIN_BORDER_CROSSINGS);

  // NFR12: bound atlas pages stayed inside the texture-unit target.
  expect(maxBound).toBeGreaterThan(0);
  expect(maxBound).toBeLessThanOrEqual(MAX_BOUND_ATLAS_PAGES);

  // The leak check: the walk is a loop, so what is drawn at its end is what
  // was drawn at its start, within what hysteresis holds on to.
  expect(Math.abs(endWorld.drawnChunks - settled.drawnChunks)).toBeLessThanOrEqual(
    LEAK_CHUNK_TOLERANCE,
  );
  expect(
    Math.abs(endWorld.liveSprites - settled.liveSprites) / Math.max(1, settled.liveSprites),
  ).toBeLessThanOrEqual(LEAK_SPRITE_TOLERANCE_RATIO);

  expect(heapSamples.length).toBeGreaterThanOrEqual(2);
  if (IS_SOAK) {
    const minute = 60_000;
    const secondMinute = heapSamples
      .filter((s) => s.atMs >= minute && s.atMs < 2 * minute)
      .map((s) => s.usedHeapBytes);
    const lastMinute = heapSamples
      .filter((s) => s.atMs >= RUN_MS - minute)
      .map((s) => s.usedHeapBytes);
    expect(secondMinute.length).toBeGreaterThan(0);
    expect(lastMinute.length).toBeGreaterThan(0);
    expect(median(lastMinute) / median(secondMinute)).toBeLessThanOrEqual(
      MAX_HEAP_GROWTH_RATIO_SOAK,
    );
  } else {
    const first = heapSamples[0]?.usedHeapBytes;
    const last = heapSamples[heapSamples.length - 1]?.usedHeapBytes;
    expect(first).toBeGreaterThan(0);
    expect(last).toBeGreaterThan(0);
    if (first !== undefined && last !== undefined) {
      expect(last / first).toBeLessThanOrEqual(MAX_HEAP_GROWTH_RATIO_SHORT);
    }
  }
});

test("a marked object costs no more per frame than none (FR173, NFR2)", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?remotePlayers=1");
  await page.waitForFunction(() => window.__bc?.playerAppearance !== undefined, undefined, {
    timeout: 60_000,
  });
  await page.waitForFunction(() => (window.__bc?.world?.().drawnChunks ?? 0) > 0);

  // The nearest counter the generator placed: walk into its reach and point
  // at it, so `HighlightApplier` has an overlay to mirror every frame.
  const counter = nearestInteractable(arrivalCell());
  const reach = reachPositionOf(counter.defId, counter.x, counter.y);
  await walkToPosition(page, reach);

  const defs = committedDefs();
  const tile = defs.balance.find((b) => b.key === "render.tile_size_px")?.value ?? 16;
  const storey = defs.balance.find((b) => b.key === "render.storey_height_px")?.value ?? 48;
  const centre = cellBottomCentre(counter.x, counter.y);
  const anchor = worldPointPx(centre.x, centre.y, counter.floor, tile, storey, ZOOM, 0);
  const offset = await canvasOffsetForWorldPx(page, { x: anchor.x, y: anchor.y - tile / 2 });
  const box = await page.locator("#world canvas").boundingBox();
  if (!box) throw new Error("no canvas to hover");
  await page.mouse.move(box.x + offset.x, box.y + offset.y);
  await expect
    .poll(() => page.evaluate(() => window.__bc?.highlightedObjectId ?? null))
    .toBe(counter.objectId.toString());

  // A short, unrecorded settle: the hover transition builds the overlay once,
  // which this phase is not measuring -- only the steady per-frame cost.
  await page.waitForTimeout(300);

  await page.evaluate(() => window.__bc?.startFrameTimings?.());
  await page.waitForTimeout(MARKED_PHASE_MS);
  const markedSamples = (await page.evaluate(
    () => window.__bc?.stopFrameTimings?.() ?? [],
  )) as number[];

  expect(markedSamples.length).toBeGreaterThan(20);
  const markedSorted = [...markedSamples].sort((a, b) => a - b);
  const markedReport = {
    markedPhaseMs: MARKED_PHASE_MS,
    frames: markedSamples.length,
    frameWorkMs: {
      p50: percentile(markedSorted, 50),
      p90: percentile(markedSorted, 90),
      p95: percentile(markedSorted, 95),
      p99: percentile(markedSorted, 99),
      max: markedSorted[markedSorted.length - 1],
    },
  };
  mkdirSync("test-results/story-1.13-perf", { recursive: true });
  writeFileSync(
    "test-results/story-1.13-perf/frame-work-marked.json",
    `${JSON.stringify(markedReport, null, 2)}\n`,
    "utf-8",
  );
  expect(markedReport.frameWorkMs.p95).toBeLessThanOrEqual(P95_FRAME_WORK_MS);
  expect(markedReport.frameWorkMs.max).toBeLessThanOrEqual(MAX_FRAME_WORK_MS);
});
