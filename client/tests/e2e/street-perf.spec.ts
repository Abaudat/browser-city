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
import { screenPositionPx } from "../../src/render/screen-position";
import {
  isDefStreetProp,
  STREET_PROPS,
  type StreetWalkSegment,
  type StreetWalkUntil,
  streetBridgeLapRoute,
  streetWalkRoute,
  TRASH_BIN_DEF_ID,
} from "../../src/test-street/fixture";
import { committedDefs, streetWalkInputs } from "../unit/test-street/street-world";
import { canvasOffsetForWorldPx } from "./camera-test-support";

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

/** How long a single segment is allowed. */
const SEGMENT_TIMEOUT_MS = 60_000;

/** How long the marked phase records for (Quentin's direction): a real,
 * non-trivial share of frames must be measured with an object actually
 * marked, or the gate proves nothing about the one genuinely new
 * per-frame cost this story added. Independent of `RUN_MS`/`IS_SOAK` --
 * this phase is a work-budget check, not a leak check, so it does not
 * need to scale with the soak's own duration. */
const MARKED_PHASE_MS = 5_000;

/** Parks the mouse over a real interactable prop's own drawn rect, once
 * (Tim's direction): before this, the measured walk left the pointer
 * wherever Playwright's own default put it, so FR173's per-step hover
 * resolution (`pointer.ts`'s `refresh`, called every step `tick()`
 * actually moves) ran *outside* the p95 frame-work gate. Used for the
 * main lap phase below (where the bin stays out of reach the whole time,
 * exercising pick-resolution cost alone) and, separately, for the marked
 * phase (where the player has walked into the bin's own `interact_at`
 * first, so this also exercises `HighlightApplier`'s own per-frame
 * `refresh` -- see that phase's own comment for why it is measured on its
 * own window rather than folded into the lap). */
async function hoverAnInteractableProp(page: Page): Promise<void> {
  const bin = STREET_PROPS.find((p) => isDefStreetProp(p) && p.defId === TRASH_BIN_DEF_ID);
  if (!bin) throw new Error("the fixture no longer places a trash bin");
  const tileSizePx = committedDefs().balance.find((b) => b.key === "render.tile_size_px")?.value;
  const storeyHeightPx = committedDefs().balance.find(
    (b) => b.key === "render.storey_height_px",
  )?.value;
  if (tileSizePx === undefined || storeyHeightPx === undefined) {
    throw new Error("missing render balance keys");
  }
  const anchor = screenPositionPx(bin.x, bin.y, bin.floor, tileSizePx, storeyHeightPx, 1);
  const worldPx = { x: anchor.x, y: anchor.y - tileSizePx / 2 };
  const canvasOffset = await canvasOffsetForWorldPx(page, worldPx);
  const box = await page.locator("#test-street canvas").boundingBox();
  if (!box) throw new Error("no street canvas to hover");
  await page.mouse.move(box.x + canvasOffset.x, box.y + canvasOffset.y);
}

/** Holds `segment.key` down, waits for its own release condition, and
 * releases it again -- entirely inside the page, in one `page.evaluate`
 * call, unlike `test-street.spec.ts`'s own `page.keyboard.down`/
 * `waitForFunction`/`page.keyboard.up` sequence. That sequence is real,
 * OS-level input, the more faithful choice for a functional spec, but
 * each of its three steps is its own Node<->page round trip, and this
 * spec's own crowd keeps animating (unlike `test-street.spec.ts`'s
 * frozen one) -- a cold, busy CI runner has shown enough round-trip
 * latency between "the release condition became true" and "the key
 * actually lifts" for the walker to keep travelling for several tenths
 * of a cell past it, occasionally far enough to land somewhere this
 * route never checked (observed: released from a floor transition,
 * carried into the underpass checkpoint's own support pillar, stuck for
 * good on the very next segment). Dispatching a synthetic `KeyboardEvent`
 * (`input/keyboard.ts` binds `.code`, the same field either kind of event
 * carries, and does not check `isTrusted`) and polling with the page's
 * own `requestAnimationFrame` keeps the whole hold-and-release inside a
 * single frame's own callback, with no round trip in between. */
async function walkSegment(page: Page, segment: StreetWalkSegment): Promise<void> {
  const result = await page.evaluate(
    ({ code, until, timeoutMs }) => {
      return new Promise<{ met: boolean; position: unknown; floor: unknown }>((resolve) => {
        const met = (u: StreetWalkUntil): boolean => {
          const position = window.__bc?.playerPosition;
          const floor = window.__bc?.playerFloor;
          if (!position || floor === undefined) return false;
          switch (u.kind) {
            case "x-at-least":
              return position.x >= u.value;
            case "x-at-most":
              return position.x <= u.value;
            case "y-at-least":
              return position.y >= u.value;
            case "y-at-most":
              return position.y <= u.value;
            case "floor":
              return floor === u.value;
            case "cell":
              return Math.floor(position.x) === u.x && Math.floor(position.y) === u.y;
          }
        };
        const release = (ok: boolean) => {
          window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
          resolve({
            met: ok,
            position: window.__bc?.playerPosition,
            floor: window.__bc?.playerFloor,
          });
        };
        const deadline = performance.now() + timeoutMs;
        const tick = () => {
          if (met(until)) {
            release(true);
            return;
          }
          if (performance.now() >= deadline) {
            release(false);
            return;
          }
          requestAnimationFrame(tick);
        };
        window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
        requestAnimationFrame(tick);
      });
    },
    { code: segment.key, until: segment.until, timeoutMs: SEGMENT_TIMEOUT_MS },
  );
  if (!result.met) {
    throw new Error(
      `walkSegment: '${segment.label}' never met its release condition ` +
        `(${JSON.stringify(segment.until)}) within ${SEGMENT_TIMEOUT_MS}ms; ` +
        `stuck at ${JSON.stringify(result.position)}, floor ${JSON.stringify(result.floor)}`,
    );
  }
}

async function walkRoute(page: Page, route: readonly StreetWalkSegment[]): Promise<void> {
  for (const segment of route) await walkSegment(page, segment);
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

  // FR173: park the pointer over a real interactable prop for the whole
  // measured window (Tim's direction) -- see `hoverAnInteractableProp`'s
  // own doc comment. Before the warm-up, so the warm-up laps themselves
  // already reflect the steady state the measured ones do.
  await hoverAnInteractableProp(page);

  // Warm-up: laps with nothing recorded.
  const warmUpUntil = Date.now() + WARM_UP_MS;
  while (Date.now() < warmUpUntil) {
    await walkRoute(page, lap);
  }

  await page.evaluate(() => window.__bc?.startFrameTimings?.());

  const heapSamples: { atMs: number; usedHeapBytes: number }[] = [];
  const frameSamples: number[] = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < RUN_MS) {
    await walkRoute(page, lap);
    // Stop recording *before* `sampleHeapBytes()`'s own forced full GC
    // (Quentin's direction): `HeapProfiler.collectGarbage` is a real
    // main-thread stall, and with recording left running across it, that
    // stall could land inside whichever ticker frame happened to be
    // in-flight and get attributed to the app's own frame-work `max` --
    // measuring the harness, not the game. Restarting immediately after
    // means no frame is ever dropped for longer than one heap sample.
    const batch = (await page.evaluate(() => window.__bc?.stopFrameTimings?.() ?? [])) as number[];
    frameSamples.push(...batch);
    heapSamples.push({ atMs: Date.now() - startedAt, usedHeapBytes: await sampleHeapBytes() });
    await page.evaluate(() => window.__bc?.startFrameTimings?.());
  }
  const finalBatch = (await page.evaluate(
    () => window.__bc?.stopFrameTimings?.() ?? [],
  )) as number[];
  frameSamples.push(...finalBatch);

  const samples = frameSamples;
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

  // --- the marked phase (Quentin's direction) -------------------------
  // The lap above deliberately never marks anything -- the bin stays out
  // of reach for the whole bridge lap -- so the one genuinely new
  // per-frame cost this story added, `HighlightApplier`'s own `refresh`
  // (mirroring every overlay sprite from its own source, live only while
  // something is marked), was measured nowhere. A fresh reload back to
  // `PLAYER_START` is the cheapest way to reach the bin's own
  // `interact_at` with this file's own proven route segments, without
  // threading a second route through wherever the lap above happened to
  // leave the player.
  await page.reload();
  await page.waitForFunction(() => window.__bc?.playerAppearance !== undefined, undefined, {
    timeout: 60_000,
  });

  const bin = STREET_PROPS.find((p) => isDefStreetProp(p) && p.defId === TRASH_BIN_DEF_ID);
  if (!bin) throw new Error("the fixture no longer places a trash bin");
  // Story 2.13: the bin sits between the door and the lamppost's own new
  // column (`LAMPPOST_CELL`'s own doc comment says why it moved), so only
  // the door-exit segment is needed before turning toward it -- the rest
  // of the route's own lamppost/underpass detour is no longer on the way.
  for (const segment of streetWalkRoute(streetWalkInputs()).slice(0, 1)) {
    await walkSegment(page, segment);
  }
  await walkSegment(page, {
    label: "under-the-bin",
    key: "ArrowRight",
    until: { kind: "x-at-least", value: bin.x },
  });
  await walkSegment(page, {
    label: "up-into-the-bins-reach",
    key: "ArrowUp",
    until: { kind: "y-at-most", value: bin.y + 1 },
  });

  await hoverAnInteractableProp(page);
  await expect
    .poll(() => page.evaluate(() => window.__bc?.highlightedObjectId ?? null))
    .toBe(bin.id.toString());

  // A short, unrecorded settle: the hover transition itself builds the
  // overlay once (`HighlightApplier.set`), which this phase is not
  // measuring -- only the steady per-frame `refresh` cost while it stays
  // marked, sitting completely still, is.
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
  writeFileSync(
    "test-results/story-1.13-perf/frame-work-marked.json",
    `${JSON.stringify(markedReport, null, 2)}\n`,
    "utf-8",
  );

  // The same budget the unmarked lap is held to -- a gate that only ever
  // measures the feature switched off is not a gate.
  expect(markedReport.frameWorkMs.p95).toBeLessThanOrEqual(P95_FRAME_WORK_MS);
  expect(markedReport.frameWorkMs.max).toBeLessThanOrEqual(MAX_FRAME_WORK_MS);
});
