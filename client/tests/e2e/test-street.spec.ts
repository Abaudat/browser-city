// Story 1.13's one integration spec (Quentin's direction): one scripted
// walk down the real, mounted street, driven by real `page.keyboard`
// input only -- no teleport hook, nothing writing the player's position
// or floor through `window.__bc`.
//
// It adds almost no new facts. Every geometric and ordering fact is
// already proven at unit level (`tests/unit/render/**`,
// `tests/unit/world/**`, `tests/unit/test-street/**`), and this spec never
// re-proves one. It asserts only what no single-module test can see: that
// collision, depth order, wall retraction, floor culling and appearance
// behave correctly *together*, on one real mounted scene, after a real
// walk.
//
// Every expected value is computed here from the same pure functions the
// page runs (the comparator through `sortAcrossFloors`, `computeVisibility`
// through the committed goldens) or read from the street module -- never a
// literal order, position or id typed into this file. Every wait is a
// `waitForFunction` on real page state; there is no `waitForTimeout` on
// the walk, and `retries` stays 0.
//
// It replaces `movement.spec.ts` and `render-order.spec.ts`: both walked
// the same page to prove a subset of what the walk below proves, and a
// third boot of the same scene costs the slowest job in the repo real
// wall time.
//
// Three `toHaveScreenshot` checks (Quentin's direction) catch what no
// id-based assertion can: "every check passes and it looks wrong". A
// fixed 1920x1080 viewport (`test.use` below) for all but the crowd-street
// checkpoint, which resizes to NFR48's own largest supported viewport
// (2560x1440) and back (its own comment says why), `animations:
// "disabled"`, an absolute `maxDiffPixels` sized to the objects under test
// (never a ratio of the whole canvas -- a ratio loose enough to let the
// avatar or a window vanish is not a regression check), and a masked ping
// indicator (fixed-position, recolours on a ping this scene does not
// control) keep them meaningful rather than perpetually flaky.
// `?freezeCrowd=1` (a DEV-only query flag, `main.ts`) starts the street
// crowd's own walk-cycle ticker paused, so every citizen stays at its
// initial, fixed-fixture pose -- otherwise which frame of which
// citizen's walk cycle happens to be on screen at screenshot time would
// depend on real wall-clock timing, and no baseline could ever be
// stable. Nothing else this spec asserts depends on the crowd's own
// animation being live.
//
// Baselines are committed PNGs, generated on the CI image (linux
// chromium) -- never on a contributor's own machine, whose font hinting
// and GPU rasteriser render different pixels than CI's. Regenerate them
// by running `.github/workflows/update-visual-baselines.yml` against
// this branch (`gh workflow run update-visual-baselines.yml --ref
// <branch>`, or the Actions tab's "Run workflow" button) -- it runs this
// spec with `--update-snapshots` on `ubuntu-latest` and pushes the
// changed `*-snapshots/*.png` files back to the branch it was run on.
// Look at what it produced before committing: a baseline is a human
// claim that the picture is right, not whatever the runner happened to
// generate.
import { createHash } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type {} from "../../src/net/e2e-hooks";
import { sortAcrossFloors } from "../../src/render/floor-stacks";
import { buildLayerRankTable, resolveRank } from "../../src/render/layer-ranks";
import { LAYER_TABLE } from "../../src/render/layer-table";
import { screenPositionPx, visibleCellBounds } from "../../src/render/screen-position";
import { buildCitizenFixtures } from "../../src/test-street/citizens";
import { buildPlayerDrawable, buildPropDrawables } from "../../src/test-street/drawables";
import {
  BRIDGE_DECK_Y,
  BRIDGE_FLOOR,
  BRIDGE_X0,
  BRIDGE_X1,
  furnitureBehindWindows,
  isDefStreetProp,
  LAMPPOST_CELL,
  LAMPPOST_DEF_ID,
  PLAYER_STABLE_ID,
  PLAYER_START,
  SHOP_A_BUILDING_ID,
  SHOP_B_BUILDING_ID,
  STREET_PROPS,
  type StreetWalkSegment,
  type StreetWalkUntil,
  streetWalkRoute,
  TRASH_BIN_DEF_ID,
  WINDOW_DEF_ID,
} from "../../src/test-street/fixture";
import {
  committedDefs,
  streetObjectSources,
  streetOwnershipIndex,
  streetWalkInputs,
  streetWindowDefIds,
} from "../unit/test-street/street-world";
import { canvasOf, canvasOffsetForWorldPx } from "./camera-test-support";

// The whole walk is one test on purpose: it is one continuous journey,
// and splitting it would re-boot and re-walk the scene per assertion.
test.describe.configure({ mode: "serial" });

// The fixed viewport `interior.png`/`underpass.png` need -- applies to
// the whole test except the crowd-street checkpoint's own brief resize
// (and restore, before the walk continues). The canvas is sized to the
// viewport now, always (`main.ts`'s `resizeTo: window`), and the camera
// keeps the player centred inside it, so a fixed viewport here also pins
// exactly what the player sees at each checkpoint, not only the canvas's
// own pixel dimensions.
test.use({ viewport: { width: 1920, height: 1080 } });

// A pixel budget in proportion to the objects under test, not the whole
// 1792x1456 canvas (Quentin's direction, cycle 2): `maxDiffPixelRatio:
// 0.01` on this image is ~26,000 px, wider than the avatar (~2,000px) or
// a window (~5,000px) -- either could vanish and this would stay green.
// `maxDiffPixels` is an absolute count instead; `threshold` (Playwright's
// own per-pixel colour-difference tolerance, 0-1) absorbs anti-aliasing
// noise without widening how many pixels may differ.
//
// Per-shot, not shared (Quentin's direction, cycle 3): a static shot and
// a moving one do not carry the same risk, and a budget wide enough for
// one is not a meaningful check on the other. Both checkpoints are now
// real collider rests, not timed thresholds (`fixture.ts`'s own
// `streetWalkRoute` doc comments say why) -- the position itself is
// bit-for-bit identical run to run (`street-conformance.test.ts`'s own
// "stops at the exact same position..." test pins that at unit level),
// so what is left for either budget to absorb is rendering noise alone
// (font hinting, compositor rounding), never position jitter. Below the
// smallest object under test (the avatar, ~2,000px) on both.
const SCREENSHOT_OPTIONS = {
  animations: "disabled",
  threshold: 0.2,
  // Playwright's own "wait for a stable screenshot" pre-check needs more
  // than its 5s default the first time it runs on a CI image: nothing
  // here is still animating (the crowd is frozen), but a cold headless
  // Chromium settling its own compositor/font state on an unfamiliar
  // runner has taken longer than that in practice.
  timeout: 30_000,
} as const;

// The interior checkpoint is the walk's own fixed starting position --
// no movement at all before this shot, so nothing but rendering noise
// should ever differ. Measured on CI (`ci.yml`'s own `e2e` job, two
// consecutive runs of commit 61a77b86: 34958235275, re-run to
// 104347576797): 0px differed on both -- `toHaveScreenshot` reports a
// diff count only when the comparison actually fails, and neither did.
const INTERIOR_MAX_DIFF_PIXELS = 150;

// The underpass checkpoint is reached after several segments of real,
// keyboard-driven movement, but both axes are collider rests now (story
// 1.13, cycle 3), so the position itself carries no jitter -- this
// budget is rendering noise only, the same as the interior shot's, with
// a little more headroom because the walk that reaches it is longer.
// Measured on CI, the same two runs: 0px differed on both.
const UNDERPASS_MAX_DIFF_PIXELS = 200;

// The crowd-street checkpoint (cycle 2, Quentin's direction, finding 5):
// the camera/viewport story's own regenerated 1920x1080 baselines are a
// cropped sliver of what master's world-fitted canvas guarded -- the
// whole crowd street (~46 citizens) included. This checkpoint restores
// real, non-duplicate coverage of it: taken at the exact same real,
// collider-rested position `underpass.png` already proves is jitter-free
// run to run (a second position of its own would have to re-earn that
// same proof, and an early version that tried one -- a plain
// `y-at-least` threshold release, not a rest -- measured a five-figure
// pixel diff between two otherwise identical runs purely from
// release-lag position jitter), but resized to NFR48's own largest
// supported viewport (2560x1440) rather than the fixed 1920x1080 every
// other checkpoint here uses. Cycle 2 found the first version of this
// checkpoint (same position, same 1920x1080 viewport as `underpass.png`)
// was byte-identical to it -- a `covered` claim with nothing behind it,
// since nothing on screen had actually changed between the two shots.
// The larger viewport is a genuinely different frame: taller and wider,
// so the crowd strip's own rows are more visible, not merely re-shot.
// `assertBaselinesDiffer` below is the standing guard against this
// collapsing back into a duplicate unnoticed. The frozen crowd
// (`?freezeCrowd=1`, already set for the whole test) and the real,
// computed `visibleCellBounds` prove a real, substantial (more than
// half) slice of the crowd is actually in frame before the shot is ever
// taken -- never a vacuous "the crowd exists somewhere" claim. Only the
// crowd strip's own rows inside this frame are pixel-guarded; rows
// further south are not (nothing walks the player there, since the
// strip itself is not walkable) -- `appearance.spec.ts` is what guards
// citizen compositing itself, independent of framing. Measured on CI
// (`update-visual-baselines.yml`'s own regeneration run, then `ci.yml`'s
// `e2e` job, two consecutive runs of commit 63b1e1f7: 35615960969,
// re-run to the same run id): 0px differed on both.
const CROWD_STREET_MAX_DIFF_PIXELS = 200;

const RANK_TABLE = buildLayerRankTable(LAYER_TABLE.map(({ code, rank }) => ({ code, rank })));
const CODE_BY_NAME = Object.fromEntries(LAYER_TABLE.map((row) => [row.name, row.code]));

function balance(key: string): number {
  const entry = committedDefs().balance.find((b) => b.key === key);
  if (!entry) throw new Error(`no balance key '${key}'`);
  return entry.value;
}

const TILE_SIZE_PX = balance("render.tile_size_px");
const STOREY_HEIGHT_PX = balance("render.storey_height_px");

/** A world pixel inside a cell's own drawn rect -- every drawable is
 * bottom-centre anchored on its cell (`screenPositionPx`), so the anchor
 * is the bottom-centre of that rect and half a tile above it is inside.
 * The same idiom `intents.spec.ts` uses for its own hover points. */
function worldPixelOfCell(cellX: number, cellY: number, floor: number) {
  const anchor = screenPositionPx(cellX, cellY, floor, TILE_SIZE_PX, STOREY_HEIGHT_PX);
  return { x: anchor.x, y: anchor.y - TILE_SIZE_PX / 2 };
}

async function hoverCell(page: Page, cellX: number, cellY: number, floor: number): Promise<void> {
  const position = await canvasOffsetForWorldPx(page, worldPixelOfCell(cellX, cellY, floor));
  await canvasOf(page).hover({ position });
}

/** Drives the real U1 dial through the real options menu -- `Escape` opens
 * it, the highlight slider's own committed ('change') value is what
 * `main.ts` forwards into `StreetSceneHandle.setHighlightStrength`,
 * `Escape` closes it again. Used by the FR173 pixel spec to derive a
 * diff-coverage floor from the object's own dial-100 behaviour, never a
 * hardcoded pixel count. */
async function setHighlightStrengthViaMenu(page: Page, value: number): Promise<void> {
  await page.keyboard.press("Escape");
  const slider = page.locator("[data-bc-highlight-slider]");
  await slider.fill(String(value));
  await slider.dispatchEvent("change");
  await page.keyboard.press("Escape");
}

/** The bin's own drawn rect, in canvas pixels, padded by a couple of
 * pixels of rounding slack -- the region every FR173 overlay pixel for it
 * must fall inside. The art is a real, known 16x32 LimeZu asset on a 1x1
 * footprint (`test-street/fixture.ts`'s own doc comment for `id: 15`):
 * one tile wide, two tiles tall, bottom-centre anchored, so it overhangs
 * one tile above its own row -- never measured a second, hand-typed way. */
async function binDrawnRectPx(
  page: Page,
): Promise<{ x0: number; y0: number; x1: number; y1: number }> {
  const bin = STREET_PROPS.find((p) => isDefStreetProp(p) && p.defId === TRASH_BIN_DEF_ID);
  if (!bin) throw new Error("the fixture no longer places a trash bin");
  const anchor = screenPositionPx(bin.x, bin.y, bin.floor, TILE_SIZE_PX, STOREY_HEIGHT_PX);
  const worldRect = {
    x0: anchor.x - TILE_SIZE_PX / 2,
    y0: anchor.y - TILE_SIZE_PX * 2,
    x1: anchor.x + TILE_SIZE_PX / 2,
    y1: anchor.y,
  };
  const pad = 2;
  const topLeft = await canvasOffsetForWorldPx(page, { x: worldRect.x0, y: worldRect.y0 });
  const bottomRight = await canvasOffsetForWorldPx(page, { x: worldRect.x1, y: worldRect.y1 });
  return {
    x0: topLeft.x - pad,
    y0: topLeft.y - pad,
    x1: bottomRight.x + pad,
    y1: bottomRight.y + pad,
  };
}

/** Every pixel that differs between two same-size PNG buffers, as
 * coordinates -- `pixelmatch`/`pngjs` against a real diff image, never a
 * committed baseline (the same runtime-captured idiom
 * `connection-notice.spec.ts` uses), because what is under test here is a
 * before/after relationship on one real session, not a fixed picture. */
function pixelDiffCoords(a: Buffer, b: Buffer): readonly { x: number; y: number }[] {
  const pngA = PNG.sync.read(a);
  const pngB = PNG.sync.read(b);
  expect(pngA.width).toBe(pngB.width);
  expect(pngA.height).toBe(pngB.height);
  const diff = new PNG({ width: pngA.width, height: pngA.height });
  // Far more sensitive than `connection-notice.spec.ts`'s own
  // `diffPixelCount` (0.1, pixelmatch's own default): the additive
  // highlight this spec exists to catch is a genuinely subtle colour
  // shift at the U1 dial's own default strength, well under pixelmatch's
  // default perceptual threshold -- 0.1 measured zero diff pixels even
  // directly over the hovered, in-reach bin. This canvas is deterministic
  // and unantialiased (nearest-neighbour sampling, animations disabled),
  // so there is no rendering noise for a lower threshold to wrongly pick
  // up: a raw per-channel scan (this threshold's own calibration run)
  // measured exactly zero difference anywhere outside the hovered
  // object's own drawn rect. `diffMask: true` is load-bearing, not
  // cosmetic: without it pixelmatch draws a dimmed copy of *both* input
  // images into every output pixel, matching or not, all at full alpha --
  // so the moment `count` (the real mismatch count) was non-zero
  // anywhere, every pixel in the canvas looked like a "diff" to a scan of
  // the output's own alpha channel. With the mask, only genuinely
  // differing pixels are written.
  const count = pixelmatch(pngA.data, pngB.data, diff.data, pngA.width, pngA.height, {
    threshold: 0.02,
    diffMask: true,
  });
  const coords: { x: number; y: number }[] = [];
  if (count > 0) {
    for (let y = 0; y < diff.height; y++) {
      for (let x = 0; x < diff.width; x++) {
        const i = (diff.width * y + x) << 2;
        if (diff.data[i + 3] !== 0) coords.push({ x, y });
      }
    }
  }
  return coords;
}

/** Holds `segment.key` down, waits for its own release condition, and
 * releases it again -- entirely inside the page, the same synthetic-
 * `KeyboardEvent`/`requestAnimationFrame` idiom `street-perf.spec.ts`'s
 * own `walkSegment` uses (see that file's own doc comment for why: real
 * OS-level `page.keyboard.down`/`waitForFunction`/`page.keyboard.up` is
 * the more faithful choice for a functional spec, but this spec's own
 * mouse hovers immediately before each walked segment have shown the
 * same round-trip-latency unreliability that spec already worked around
 * -- an occasional real keydown arriving late enough to stall a
 * `waitForFunction` for the whole 30s budget). This spec's own real-input
 * proof already lives in "one walk down the test street" above; what FR173
 * needs here is a reliable way to get the player into and out of one
 * object's `interact_at`, not a second proof that OS-level input works. */
async function walkSegmentSynthetic(page: Page, segment: StreetWalkSegment): Promise<void> {
  const result = await page.evaluate(
    ({ code, until, timeoutMs }) => {
      return new Promise<{ met: boolean }>((resolve) => {
        const met = (u: StreetWalkUntil): boolean => {
          const position = window.__bc?.playerPosition;
          if (!position) return false;
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
              return window.__bc?.playerFloor === u.value;
            case "cell":
              return Math.floor(position.x) === u.x && Math.floor(position.y) === u.y;
          }
        };
        const release = (ok: boolean) => {
          window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
          resolve({ met: ok });
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
    { code: segment.key, until: segment.until, timeoutMs: 30_000 },
  );
  if (!result.met) {
    throw new Error(`walkSegmentSynthetic: '${segment.label}' never met its release condition`);
  }
}

function rankOf(layer: string): number {
  const code = CODE_BY_NAME[layer];
  if (code === undefined) throw new Error(`unknown street layer ${layer}`);
  return resolveRank(RANK_TABLE, code);
}

const ownership = streetOwnershipIndex();

/** The order the comparator demands for a player standing exactly here --
 * computed by calling the real comparator, never a literal. */
function expectedOrderFor(x: number, y: number, floor: number): string[] {
  const props = buildPropDrawables({
    rankOf,
    ownership,
    windowDefIds: streetWindowDefIds(),
    objectDefs: streetObjectSources(),
  });
  const player = buildPlayerDrawable(rankOf("characters"), x, y, floor);
  return sortAcrossFloors([...props, player], (d) => d).map((d) => d.stableId.toString());
}

interface PlayerState {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}

async function playerState(page: Page): Promise<PlayerState> {
  const state = await page.evaluate(() => ({
    x: window.__bc?.playerPosition?.x,
    y: window.__bc?.playerPosition?.y,
    floor: window.__bc?.playerFloor,
  }));
  if (state.x === undefined || state.y === undefined || state.floor === undefined) {
    throw new Error("the page reported no player position");
  }
  return { x: state.x, y: state.y, floor: state.floor };
}

/** Waits for a real `page.setViewportSize` resize to have actually landed
 * -- both the canvas's own client rect matching the new size and the
 * camera having re-centred inside it -- before anything reads either
 * (`camera-viewport.spec.ts`'s own idiom, cycle 2: the canvas resize and
 * the camera's own next `requestAnimationFrame` are separate chains, so
 * asserting the instant the canvas alone matches is a real race, not
 * only a test one). */
async function waitForViewportSize(
  page: Page,
  size: { readonly width: number; readonly height: number },
): Promise<void> {
  await page.waitForFunction(
    (expected) => {
      const canvas = document.querySelector("#test-street canvas");
      if (!(canvas instanceof HTMLCanvasElement)) return false;
      const rect = canvas.getBoundingClientRect();
      if (
        Math.round(rect.width) !== expected.width ||
        Math.round(rect.height) !== expected.height
      ) {
        return false;
      }
      const bounds = window.__bc?.playerScreenBounds?.();
      if (!bounds) return false;
      const centreX = bounds.x + bounds.width / 2;
      const centreY = bounds.y + bounds.height;
      return Math.abs(centreX - rect.width / 2) <= 1 && Math.abs(centreY - rect.height / 2) <= 1;
    },
    size,
    { timeout: 10_000 },
  );
}

/** The player sprite's own real, drawn centre against the canvas's own
 * current centre (`camera-viewport.spec.ts`'s own `assertPlayerCentred`,
 * repeated here rather than imported across spec files) -- the bottom-
 * centre anchor, never the bounding box's own geometric middle. */
async function assertPlayerCentred(page: Page): Promise<void> {
  const deviation = await page.evaluate(() => {
    const canvas = document.querySelector("#test-street canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no street canvas");
    const bounds = window.__bc?.playerScreenBounds?.();
    if (!bounds) throw new Error("no playerScreenBounds hook");
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.abs(bounds.x + bounds.width / 2 - rect.width / 2),
      y: Math.abs(bounds.y + bounds.height - rect.height / 2),
    };
  });
  expect(deviation.x, "player horizontal centring").toBeLessThanOrEqual(1);
  expect(deviation.y, "player vertical centring").toBeLessThanOrEqual(1);
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function waitForSceneReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, {
    timeout: 20_000,
  });
  await page.waitForFunction(
    () => Object.keys(window.__bc?.visibility ?? {}).length > 0,
    undefined,
    { timeout: 20_000 },
  );
  // The street crowd's own composites finish loading after the first
  // visibility pass (`scene.ts` mounts it last, deliberately), and this
  // spec asserts on them -- so "ready" includes them.
  await page.waitForFunction(() => window.__bc?.playerAppearance !== undefined, undefined, {
    timeout: 30_000,
  });
}

/** Holds one key until the page itself reports the segment's own release
 * condition -- never a fixed wait. The condition is the street module's
 * own data; only the switch over its shape lives here, because it has to
 * run inside the page.
 *
 * The key goes down through real, OS-level `page.keyboard` input, but it
 * is released *inside* the page, on the animation frame the condition is
 * first seen true (a `keyup` with the same `code` -- `input/keyboard.ts`
 * binds `.code` and never checks `isTrusted`). The real `page.keyboard.up`
 * after it only resets Playwright's own key state. Releasing from Node
 * instead costs a round trip, and a slow runner's round trip carries the
 * walker past a waypoint the next segment depends on (story 15.2 cycle
 * 2: `east-to-the-lamppost` overshot the lamppost's own collider on CI
 * and the south leg walked straight by). An in-page release overshoots
 * by at most one more tick, and `street-conformance.test.ts` pins that
 * margin at the resolver's own delta clamp. */
async function walkSegment(page: Page, segment: StreetWalkSegment): Promise<void> {
  await page.keyboard.down(segment.key);
  try {
    await page.evaluate(
      ({ until, code, timeoutMs }) =>
        new Promise<void>((resolve, reject) => {
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
          const deadline = performance.now() + timeoutMs;
          const tick = (): void => {
            if (met(until)) {
              window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
              resolve();
              return;
            }
            if (performance.now() >= deadline) {
              reject(new Error(`walkSegment: ${JSON.stringify(until)} never met`));
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      { until: segment.until, code: segment.key, timeoutMs: 30_000 },
    );
  } finally {
    await page.keyboard.up(segment.key);
  }
}

/** FR137's latency guard, ported from the deleted `movement.spec.ts` onto
 * the walk's own first segment rather than run a second time (Quentin's
 * direction, cycle 1: it costs nothing extra -- the key is being pressed
 * either way). Holds `segment.key` exactly like [`walkSegment`], but
 * first installs an in-page `requestAnimationFrame` probe that counts
 * real animation frames from the browser's own `keydown` event (anchored
 * inside the page, on the event itself -- never on the `page.evaluate`
 * call that installs the probe, which is a separate CDP round trip) to
 * the first frame `window.__bc.playerPosition.y` reads past `startY`.
 * Returns that frame count. */
async function walkSegmentMeasuringLatency(
  page: Page,
  segment: StreetWalkSegment,
  startY: number,
): Promise<number> {
  await page.evaluate((y) => {
    const probe = { framesSinceKeydown: null as number | null, movedAt: null as number | null };
    (window as unknown as { __bcFrames: typeof probe }).__bcFrames = probe;
    window.addEventListener("keydown", () => {
      probe.framesSinceKeydown ??= 0;
    });
    const tick = (): void => {
      if (probe.framesSinceKeydown !== null && probe.movedAt === null) {
        probe.framesSinceKeydown++;
        if ((window.__bc?.playerPosition?.y ?? y) > y) {
          probe.movedAt = probe.framesSinceKeydown;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, startY);

  await walkSegment(page, segment);

  return page.evaluate(
    () =>
      (window as unknown as { __bcFrames?: { movedAt: number | null } }).__bcFrames?.movedAt ??
      Number.NaN,
  );
}

/** Every visibility state the real, mounted adapter just wrote, read back
 * off each sprite's own `visible`/`alpha` (never recomputed in the page). */
function currentVisibility(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => window.__bc?.visibility ?? {});
}

function currentAlpha(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => window.__bc?.visibilityAlpha ?? {});
}

function currentOrder(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__bc?.renderOrder ?? []);
}

/** The ids of every wall drawable a building owns, from the street module
 * -- so "its near-side walls" is never a hand-typed id list. */
function wallIdsOwnedBy(buildingId: bigint): string[] {
  return STREET_PROPS.filter(
    (prop) =>
      prop.layer === "walls" &&
      ownership.ownershipAt(prop.x, prop.y, prop.floor).buildingId === buildingId,
  ).map((prop) => prop.id.toString());
}

function windowIds(): string[] {
  return STREET_PROPS.filter((prop) => isDefStreetProp(prop) && prop.defId === WINDOW_DEF_ID).map(
    (prop) => prop.id.toString(),
  );
}

/** Every drawable id on a given floor -- used to prove the mounted order
 * really is grouped by floor, ascending. */
function idsOnFloor(floor: number): Set<string> {
  return new Set(
    STREET_PROPS.filter((prop) => prop.floor === floor).map((prop) => prop.id.toString()),
  );
}

test("one walk down the test street: collision, depth order, retraction, floors and appearance together", async ({
  page,
}) => {
  // The walk crosses the whole street at the committed walking speed.
  test.setTimeout(180_000);

  // FR137's own claim is "no reducer call" -- a data frame on *this app's
  // own* websocket connection to SpacetimeDB, never a control frame the
  // browser answers a keepalive with, and never a frame on some other
  // websocket the page happens to have open. Both turned out to matter:
  // Playwright's page-level `framesent` event does not distinguish a
  // control frame from a real one (a real reproduction: the committed
  // walk was briefly flaky for exactly this reason). Once counted through
  // CDP by opcode instead, a second real reproduction turned up a second
  // websocket entirely -- Vite's own HMR client, same-origin with the
  // page, which sends its own periodic `{"type":"ping"}` *text* frame,
  // indistinguishable from a real reducer call by opcode alone.
  // SpacetimeDB's own port is chosen fresh per test run
  // (`spacetime-harness.mjs`'s `findFreePort`), so it is identified the
  // one way that needs no literal: the websocket whose origin differs
  // from the page's own (`use.baseURL`), found from
  // `Network.webSocketCreated`, wired up before `page.goto` or its own
  // creation event is missed.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("no baseURL configured for this project");
  const pageOrigin = new URL(baseURL).origin;
  // Assumes the page opens exactly one cross-origin websocket: the one
  // to SpacetimeDB. True today (the client's own net/ layer holds a
  // single connection, and nothing else here opens one), so this is
  // never asserted on directly -- if that ever changes, whichever
  // cross-origin socket is created *last* silently wins here, which
  // would misattribute frames rather than fail loudly. A second
  // cross-origin socket appearing in `Network.webSocketCreated` is the
  // signal to revisit this.
  let spacetimeRequestId: string | undefined;
  cdp.on("Network.webSocketCreated", (event: { requestId: string; url: string }) => {
    const socketOrigin = new URL(event.url.replace(/^ws/, "http")).origin;
    if (socketOrigin !== pageOrigin) spacetimeRequestId = event.requestId;
  });

  let framesSentWhileWalking = 0;
  const onWsFrameSent = (event: {
    requestId: string;
    response: { opcode: number; payloadData: string };
  }): void => {
    if (event.requestId !== spacetimeRequestId) return;
    if (event.response.opcode === 1 || event.response.opcode === 2) {
      framesSentWhileWalking++;
      // Diagnostic only, never asserted on: if this ever counts again,
      // the payload says what it actually was.
      console.log(
        `[test-street] unexpected websocket data frame (opcode ${event.response.opcode}): ${event.response.payloadData.slice(0, 200)}`,
      );
    }
  };

  /** A `toHaveScreenshot` check holds the player still for as long as its
   * own stability wait takes (minutes on a cold CI run, the first time it
   * has to write a new baseline). The player is provably not moving while
   * a screenshot is taken, so nothing sent during that specific window
   * can be a result of movement, whatever caused it -- belt and braces
   * alongside the socket scoping above, not a substitute for it. */
  function trackFrames(): void {
    cdp.on("Network.webSocketFrameSent", onWsFrameSent);
  }
  function untrackFrames(): void {
    cdp.off("Network.webSocketFrameSent", onWsFrameSent);
  }

  await page.goto("/?freezeCrowd=1");
  await waitForSceneReady(page);
  const canvas = page.locator("#test-street canvas");

  // Counting starts only once the scene (and with it, the one-time
  // `SELECT * FROM demo_ping` subscription every connection opens with)
  // is fully up -- FR137's claim is "no frame while walking", not "no
  // frame for the whole page lifetime including its own bootstrap".
  trackFrames();

  // Story 1.11: the story 1.1 ping indicator (`render/bootstrap.ts`) is
  // gone -- it was a fixed-position DOM surface with no requirement
  // behind it, exactly the kind of abstract counter NFR22/FR151 forbid.
  // Nothing masks the canvas screenshot below any more; the connection
  // notice (`ui/connection-notice.ts`) stays hidden on a healthy
  // connection, so it never bleeds into the baseline either.
  async function screenshot(name: string, maxDiffPixels: number): Promise<void> {
    untrackFrames();
    try {
      await expect(canvas).toHaveScreenshot(name, {
        ...SCREENSHOT_OPTIONS,
        maxDiffPixels,
      });
    } finally {
      trackFrames();
    }
  }

  // --- inside shop A -----------------------------------------------------
  const start = await playerState(page);
  expect(start).toEqual({ x: PLAYER_START.x, y: PLAYER_START.y, floor: PLAYER_START.floor });

  const appearanceAtStart = await page.evaluate(() => window.__bc?.playerAppearance);
  expect(appearanceAtStart).toBeDefined();
  // FR61: five stored part indices, three of which are never absent.
  expect(appearanceAtStart?.body).toBeGreaterThan(0);
  expect(appearanceAtStart?.eyes).toBeGreaterThan(0);
  expect(appearanceAtStart?.outfit).toBeGreaterThan(0);

  // Story 2.6/2.13 (NFR12): the mounted street resolves against a small,
  // exact number of distinct atlas pages -- every `defId`-placed prop's
  // own "street" page (all nine rows share the one page: 1 page) plus the
  // street crowd's own shared character composite pages
  // (`AppearanceTextureCache.pageSources`, folded in by
  // `countBoundAtlasPages`): this street's own 46-citizen crowd fits its
  // slots on the first shared composite page alone, so only 1 of the 2
  // pages `CHARACTER_COMPOSITE_PAGES` reserves is ever actually bound --
  // 2 total. A loose upper bound alone would still pass with the crowd's
  // composite page never bound at all (every citizen invisible), so the
  // assertion is the exact number NFR12 names, not a placeholder. Never
  // `toBeLessThanOrEqual(8)` here: the `<= 8` bound is already asserted
  // by name at build time in `atlas/build.rs`; this job is to catch a
  // page silently not bound, or an extra one bound, on the real mounted
  // scene. `appearance.spec.ts`'s own "different people cost about as
  // much as identical ones" test is this same count's own budget proof.
  const distinctBoundAtlasPages = await page.evaluate(() => window.__bc?.distinctBoundAtlasPages);
  expect(distinctBoundAtlasPages).toBe(2);

  // Story 2.13 (Quentin's direction): `distinctBoundAtlasPages` is
  // filtered to pages the loader/appearance cache know about, so on its
  // own it is blind to a raw `ModernTileset/` import a `defId` retarget
  // should have retired -- the ratchet against that is the *unfiltered*
  // count of every distinct `TextureSource` the mounted display list
  // actually binds. Measured before this story (commit c3adca7e, the
  // same nine-`defId`-row street, still on raw imports): 20. After: 17 --
  // the four raw sheets `window`/`trashBin`/`bridgeDeck`/`bridgeStairs`
  // retired drop the count by three, not four, because `bridgeDeck` and
  // the ground pass's own `sidewalk` sheet already named the identical
  // `ModernTileset/` file before this story, so removing the former
  // `bridgeDeck` import never dropped a source Pixi's own `Assets` cache
  // had not already deduplicated by URL. Ground tiles, the shops' own
  // plain wall runs, the poster and loose furniture still bind raw
  // sheets after this story (out of scope, Quentin's direction) -- this
  // is not yet the whole mounted street's own NFR12 fact, only every
  // `defId`-placed row's.
  //
  // Story 15.2: +3, for the three new raw street-only textures (a
  // doormat, a bollard, a manhole cover) that replaced the six undrawn
  // "rest collider" boundary rects the scripted walk used to lean on --
  // every rest is now a real, drawn prop instead (`fixture.ts`'s own doc
  // comment says why).
  const allBoundTextureSources = await page.evaluate(() => window.__bc?.allBoundTextureSources);
  expect(allBoundTextureSources).toBe(20);

  // FR120, from inside: this building's own near-side walls are gone, and
  // the neighbour's are not -- keyed on the enclosure id, never proximity.
  const insideVisibility = await currentVisibility(page);
  const shopAWalls = wallIdsOwnedBy(SHOP_A_BUILDING_ID);
  const shopBWalls = wallIdsOwnedBy(SHOP_B_BUILDING_ID);
  expect(shopAWalls.some((id) => insideVisibility[id] === "hidden")).toBe(true);
  expect(shopBWalls.every((id) => insideVisibility[id] !== "hidden")).toBe(true);
  expect(await page.evaluate(() => window.__bc?.masksAllNull)).toBe(true);

  // The mounted display list is in the order the comparator demands for
  // the player's real position -- not a literal, and not a rule this spec
  // re-derives.
  expect(await currentOrder(page)).toEqual(expectedOrderFor(start.x, start.y, start.floor));

  // The interior checkpoint (Quentin's direction, cycle 1): every id-based
  // check above passes, and this is what catches it if it still looks
  // wrong.
  await screenshot("interior.png", INTERIOR_MAX_DIFF_PIXELS);

  const route = streetWalkRoute(streetWalkInputs());
  const segment = (label: string): StreetWalkSegment => {
    const found = route.find((s) => s.label === label);
    if (!found) throw new Error(`no route segment '${label}'`);
    return found;
  };

  // --- out onto the pavement --------------------------------------------
  // FR137: holding the key moves the avatar within a few real animation
  // frames of the browser's own keydown, with no round trip -- proven on
  // this segment because it is the walk's own first held key, so nothing
  // else is added by measuring it here.
  const movedAtFrame = await walkSegmentMeasuringLatency(
    page,
    segment("outside-the-shopfront"),
    start.y,
  );
  // One frame for the scene's own ticker to run after the keydown, plus
  // one for the probe's callback possibly running ahead of it on that
  // same frame. Anything beyond that is a round trip, not a frame.
  expect(movedAtFrame).toBeLessThanOrEqual(2);
  const outside = await playerState(page);
  expect(outside.floor).toBe(PLAYER_START.floor);

  const outsideVisibility = await currentVisibility(page);
  // The walls are back the moment the player is outside the enclosure.
  expect(shopAWalls.every((id) => outsideVisibility[id] !== "hidden")).toBe(true);
  // FR121: seen from the pavement, the window is translucent at exactly
  // `render.window_alpha`, and the furniture behind it is still drawn.
  const windowAlpha = committedDefs().balance.find((b) => b.key === "render.window_alpha");
  if (!windowAlpha) throw new Error("no render.window_alpha balance key");
  const alphas = await currentAlpha(page);
  for (const id of windowIds()) {
    expect(outsideVisibility[id]).toBe("translucent");
    expect(alphas[id]).toBeCloseTo(windowAlpha.value / 100, 5);
  }
  // The real "behind a window" set (Quentin's direction, cycle 1): same
  // floor, north of the window's own row, x-overlapping its footprint --
  // never every floor-0 furniture prop regardless of whether a window
  // actually sits in front of it, which would pass vacuously on a
  // re-laid street.
  const furnitureBehindTheWindow = furnitureBehindWindows(streetObjectSources()).map((id) =>
    id.toString(),
  );
  expect(furnitureBehindTheWindow.length).toBeGreaterThan(0);
  for (const id of furnitureBehindTheWindow) {
    expect(outsideVisibility[id]).not.toBe("hidden");
  }

  // --- east to the lamppost's own column ----------------------------------
  // Story 2.13: the lamppost moved off the door's own column
  // (`LAMPPOST_CELL`'s own doc comment says why), so this leg is new.
  await walkSegment(page, segment("east-to-the-lamppost"));

  // --- part-way through the lamppost -------------------------------------
  await walkSegment(page, segment("part-way-through-the-lamppost"));
  const atLamppost = await playerState(page);
  // Collision and depth together: the avatar's feet are inside the prop's
  // own footprint cell, and outside its collider (the collider is smaller
  // than the cell, so part of the cell is walkable) ...
  expect(Math.floor(atLamppost.x)).toBe(LAMPPOST_CELL.x);
  expect(Math.floor(atLamppost.y)).toBe(LAMPPOST_CELL.y);
  const lamppost = committedDefs().objects.find((object) => object.id === LAMPPOST_DEF_ID);
  if (!lamppost?.collider) throw new Error("the lamppost has no collider in defs/");
  const colliderTopY =
    LAMPPOST_CELL.y + lamppost.collider.y0 / committedDefs().colliderSubcellsPerCell;
  expect(atLamppost.y).toBeLessThanOrEqual(colliderTopY + 1e-6);
  // ... and the mounted order for that exact position is the comparator's
  // own, which puts the avatar behind the prop while it is north of the
  // prop's own sort line.
  const orderAtLamppost = await currentOrder(page);
  expect(orderAtLamppost).toEqual(expectedOrderFor(atLamppost.x, atLamppost.y, atLamppost.floor));
  // The avatar's feet are south of the prop's own sort line here (it came
  // to rest part-way into the prop's cell), so the comparator draws it in
  // *front* of the prop, and the mounted list agrees -- it is the
  // comparator's own output. The mirror case (north of the line, drawn
  // behind) is a pure fact about the comparator, proven exhaustively by
  // `inv_depth_order_total_and_stable`; walking it again here would only
  // re-prove it slower.
  const lamppostProp = STREET_PROPS.find(
    (prop) => isDefStreetProp(prop) && prop.defId === LAMPPOST_DEF_ID,
  );
  if (!lamppostProp) throw new Error("no lamppost in the street");
  expect(orderAtLamppost.indexOf(PLAYER_STABLE_ID.toString())).toBeGreaterThan(
    orderAtLamppost.indexOf(lamppostProp.id.toString()),
  );

  // --- under the bridge ----------------------------------------------------
  await walkSegment(page, segment("past-the-lamppost"));
  await walkSegment(page, segment("off-the-crossing-row"));
  await walkSegment(page, segment("east-along-the-crossing"));
  await walkSegment(page, segment("on-the-underpass-row"));
  await walkSegment(page, segment("under-the-bridge"));
  const underTheBridge = await playerState(page);
  expect(underTheBridge.floor).toBe(PLAYER_START.floor);
  expect(Math.floor(underTheBridge.y)).toBe(BRIDGE_DECK_Y);
  // Strictly inside the deck's own span (story 1.13, cycle 2: this used
  // to check `> BRIDGE_X1`, which is *past* the deck, not under it --
  // exactly the clipped framing the baseline caught).
  expect(underTheBridge.x).toBeGreaterThanOrEqual(BRIDGE_X0);
  expect(underTheBridge.x).toBeLessThanOrEqual(BRIDGE_X1);

  // The underpass checkpoint (Quentin's direction): both floors are drawn
  // here, and this is the one check that would have caught the avatar
  // reading as clipped at the canvas edge instead of visibly under a
  // deck.
  await screenshot("underpass.png", UNDERPASS_MAX_DIFF_PIXELS);
  const underpassHash = sha256(await canvas.screenshot({ animations: "disabled" }));

  // The camera/viewport story's own regenerated baselines are cropped to
  // the viewport, unlike master's world-fitted canvas -- this checkpoint
  // (cycle 2, Quentin's direction, finding 5) restores real, non-duplicate
  // crowd coverage: the exact same real, collider-rested position
  // `underpass.png` already proved jitter-free, resized to NFR48's own
  // largest supported viewport instead of reusing its 1920x1080 one --
  // `CROWD_STREET_MAX_DIFF_PIXELS`'s own doc comment says why.
  const CROWD_STREET_VIEWPORT = { width: 2560, height: 1440 };
  await page.setViewportSize(CROWD_STREET_VIEWPORT);
  await waitForViewportSize(page, CROWD_STREET_VIEWPORT);
  await assertPlayerCentred(page);

  const crowdView = await page.evaluate(() => window.__bc?.viewTransform);
  if (!crowdView) throw new Error("the street scene never recorded its view transform");
  const crowdVisible = visibleCellBounds(
    CROWD_STREET_VIEWPORT.width,
    CROWD_STREET_VIEWPORT.height,
    crowdView,
    underTheBridge.floor,
    TILE_SIZE_PX,
    STOREY_HEIGHT_PX,
  );
  // Never vacuous (Quentin's own recurring direction across this suite):
  // a real, *substantial* (more than half, cycle 2) slice of the crowd --
  // not one stray citizen at the frame's own edge -- must actually be in
  // view before the shot is taken, or this checkpoint would silently stop
  // proving anything the moment the crowd's own placement or the camera's
  // own framing moved.
  const crowd = buildCitizenFixtures(committedDefs());
  const crowdOnScreen = crowd.filter(
    (c) =>
      c.gridX >= crowdVisible.cellX0 &&
      c.gridX <= crowdVisible.cellX1 &&
      c.gridY >= crowdVisible.cellY0 &&
      c.gridY <= crowdVisible.cellY1,
  );
  expect(
    crowdOnScreen.length,
    "more than half the crowd must be in frame for this checkpoint to mean anything",
  ).toBeGreaterThan(crowd.length / 2);

  await screenshot("crowd-street.png", CROWD_STREET_MAX_DIFF_PIXELS);
  // The standing guard against this checkpoint silently collapsing back
  // into a duplicate of `underpass.png` (cycle 2 found the first version
  // of it already had): the two real, captured buffers must differ.
  const crowdStreetHash = sha256(await canvas.screenshot({ animations: "disabled" }));
  expect(crowdStreetHash, "crowd-street.png must not be byte-identical to underpass.png").not.toBe(
    underpassHash,
  );

  // Restored before the walk continues: every other checkpoint and wait
  // in this test assumes the fixed 1920x1080 viewport `test.use` set.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await waitForViewportSize(page, { width: 1920, height: 1080 });

  // Two floors at one (x, y), both drawn: the deck above is not culled
  // (FR122 culls by sign, and both floors are street-side), and the
  // mounted order puts every floor-1 drawable after every floor-0 one --
  // which is what makes the deck cover the pavement it spans.
  const underVisibility = await currentVisibility(page);
  const deckIds = idsOnFloor(BRIDGE_FLOOR);
  expect(deckIds.size).toBeGreaterThan(0);
  for (const id of deckIds) expect(underVisibility[id]).not.toBe("hidden");

  const orderUnderTheBridge = await currentOrder(page);
  expect(orderUnderTheBridge).toEqual(
    expectedOrderFor(underTheBridge.x, underTheBridge.y, underTheBridge.floor),
  );
  const streetIds = idsOnFloor(PLAYER_START.floor);
  const lastStreetIndex = Math.max(
    ...orderUnderTheBridge.map((id, index) => (streetIds.has(id) ? index : -1)),
  );
  const firstDeckIndex = orderUnderTheBridge.findIndex((id) => deckIds.has(id));
  expect(firstDeckIndex).toBeGreaterThan(lastStreetIndex);

  // --- up onto the deck --------------------------------------------------
  // Off the underpass row entirely: the support pillar just rested
  // against spans the row's own full height, so an eastward step stays
  // swept against it until the walker clears the row (story 1.13, cycle
  // 3).
  await walkSegment(page, segment("leaving-the-underpass"));
  // Past the deck's own east end, to the stairs that climb onto it.
  await walkSegment(page, segment("east-of-the-bridge"));
  await walkSegment(page, segment("on-the-bridge-deck"));
  const onDeck = await playerState(page);
  expect(onDeck.floor).toBe(BRIDGE_FLOOR);
  expect(Math.floor(onDeck.x)).toBeGreaterThanOrEqual(BRIDGE_X0);
  expect(Math.floor(onDeck.x)).toBeLessThanOrEqual(BRIDGE_X1);
  // The player itself moved into the upper floor's own stack, so the
  // mounted order still matches the comparator for its new floor.
  expect(await currentOrder(page)).toEqual(expectedOrderFor(onDeck.x, onDeck.y, onDeck.floor));
  // The street below is still drawn: a floor above the viewer is only
  // culled where the viewer's own enclosure owns it, and the street is
  // nobody's storey.
  const deckVisibility = await currentVisibility(page);
  expect([...streetIds].some((id) => deckVisibility[id] !== "hidden")).toBe(true);

  // --- back down to the street -------------------------------------------
  await walkSegment(page, segment("back-on-the-street"));
  const backOnTheStreet = await playerState(page);
  expect(backOnTheStreet.floor).toBe(PLAYER_START.floor);
  expect(await currentOrder(page)).toEqual(
    expectedOrderFor(backOnTheStreet.x, backOnTheStreet.y, backOnTheStreet.floor),
  );

  untrackFrames();
  // FR137: the whole walk was client-authoritative -- not one WebSocket
  // data frame, and therefore not one reducer call, while moving.
  expect(framesSentWhileWalking).toBe(0);

  // Appearance is the same five parts it was before the walk (FR61): the
  // avatar never lost or re-rolled a part by walking, transitioning floor
  // or crossing an enclosure -- and the same again after a reload, which
  // is what makes it a property of the pipeline rather than of this
  // session. (`appearanceTextureIds` is deliberately *not* what is
  // compared: those are opaque per-session identity counters, assigned in
  // texture-load order, and carry no meaning across a reload.)
  expect(await page.evaluate(() => window.__bc?.playerAppearance)).toEqual(appearanceAtStart);
  await page.reload();
  await waitForSceneReady(page);
  expect(await page.evaluate(() => window.__bc?.playerAppearance)).toEqual(appearanceAtStart);
});

test("FR173's affordance mark is a real pixel change, confined to the hovered object's own drawn rect (Quentin's direction)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/?freezeCrowd=1");
  await waitForSceneReady(page);

  const bin = STREET_PROPS.find((p) => isDefStreetProp(p) && p.defId === TRASH_BIN_DEF_ID);
  if (!bin) throw new Error("the fixture no longer places a trash bin");

  // A cell well away from both interactable objects (the bin and the shop
  // counter) -- any third cell never marks anything, so this is a safe,
  // stable "pointer off the object" position on either side of the walk
  // below.
  const away = { x: bin.x + 6, y: bin.y, floor: bin.floor };

  // --- pair A: before the walk, the bin is out of reach -------------------
  // Two frames at the *same* player position (still at `PLAYER_START`,
  // nothing has moved yet), so the only thing that can differ between them
  // is the hover itself.
  await hoverCell(page, away.x, away.y, away.floor);
  const baselineOutOfReach = await canvasOf(page).screenshot({ animations: "disabled" });

  await hoverCell(page, bin.x, bin.y, bin.floor);
  expect(await page.evaluate(() => window.__bc?.highlightedObjectId ?? null)).toBeNull();
  const hoveredOutOfReach = await canvasOf(page).screenshot({ animations: "disabled" });
  // AC2's withholding rule, measured rather than asserted about internal
  // state alone (Quentin's direction: this is the single most important
  // assertion in this story, because it is the only one that proves
  // reachability is taught by the highlight rather than told) -- zero
  // tolerance, not merely "no highlighted id".
  expect(pixelDiffCoords(baselineOutOfReach, hoveredOutOfReach)).toEqual([]);

  // --- walk into the bin's own `interact_at` skirt -------------------------
  // Real keyboard input (`walkSegmentSynthetic`'s own doc comment says why
  // synthetic, not `page.keyboard`, in this one spec). The first segment is
  // `streetWalkRoute`'s own proven, committed one (out of the shopfront
  // door, releasing on the real cell-arrival at `SHOPFRONT_EXIT_Y`) --
  // reused rather than re-derived, since it is already proven
  // collision-safe. Story 2.13:
  // the bin now sits between the door and the lamppost's own new column
  // (`LAMPPOST_CELL`'s own doc comment says why it moved), so the rest of
  // the route's own lamppost/underpass detour is no longer on the way --
  // this walk diverges straight from there: east under the bin's own
  // column, then north back up into its `interact_at` skirt.
  await hoverCell(page, away.x, away.y, away.floor); // mouse out of the way while walking
  for (const segment of streetWalkRoute(streetWalkInputs()).slice(0, 1)) {
    await walkSegmentSynthetic(page, segment);
  }
  await walkSegmentSynthetic(page, {
    label: "under-the-bin",
    key: "ArrowRight",
    until: { kind: "x-at-least", value: bin.x },
  });
  await walkSegmentSynthetic(page, {
    label: "up-into-the-bins-reach",
    key: "ArrowUp",
    until: { kind: "y-at-most", value: bin.y + 1 },
  });

  // --- pair B: after the walk, the bin is in reach -------------------------
  // The camera/viewport story: the camera follows the player, so the
  // bin's own drawn rect moved on screen along with the walk above --
  // computed fresh here, at the walk's own resting position, never at
  // the pre-walk position `binDrawnRectPx` would have reported before
  // the camera ever moved.
  const binRect = await binDrawnRectPx(page);

  // Two (then three) frames at the walk's own resting position -- again,
  // only the hover changes between them.
  await hoverCell(page, away.x, away.y, away.floor);
  const baselineInReach = await canvasOf(page).screenshot({ animations: "disabled" });

  await hoverCell(page, bin.x, bin.y, bin.floor);
  await expect
    .poll(() => page.evaluate(() => window.__bc?.highlightedObjectId ?? null))
    .toBe(bin.id.toString());
  const hoveredInReach = await canvasOf(page).screenshot({ animations: "disabled" });
  const diffFromBaseline = pixelDiffCoords(baselineInReach, hoveredInReach);
  // Nothing bleeds onto the bin's own tile, its neighbours or the ground
  // pass: every differing pixel lies inside the bin's own drawn rect.
  for (const { x, y } of diffFromBaseline) {
    expect(x).toBeGreaterThanOrEqual(binRect.x0);
    expect(x).toBeLessThanOrEqual(binRect.x1);
    expect(y).toBeGreaterThanOrEqual(binRect.y0);
    expect(y).toBeLessThanOrEqual(binRect.y1);
  }

  // A floor derived from the object's own behaviour, not a magic number
  // (Quentin's direction): `expect(...).toBeGreaterThan(0)` alone passes
  // on one accidentally-lit pixel, which an overlay built at near-zero
  // alpha, or built for only one of several source drawables, would still
  // satisfy while the affordance itself was broken. The dial at 100 is
  // the strongest this object can ever be marked, so its own diff-pixel
  // coverage is the natural ceiling to hold the default dial's own
  // coverage to a meaningful share of -- self-calibrating against the
  // real art, never re-tuned by hand when the art changes.
  await hoverCell(page, away.x, away.y, away.floor);
  await setHighlightStrengthViaMenu(page, 100);
  await hoverCell(page, bin.x, bin.y, bin.floor);
  await expect
    .poll(() => page.evaluate(() => window.__bc?.highlightedObjectId ?? null))
    .toBe(bin.id.toString());
  const hoveredAt100 = await canvasOf(page).screenshot({ animations: "disabled" });
  const diffAt100 = pixelDiffCoords(baselineInReach, hoveredAt100);

  const MIN_COVERAGE_RATIO = 0.5;
  expect(diffAt100.length).toBeGreaterThan(0);
  expect(diffFromBaseline.length).toBeGreaterThanOrEqual(diffAt100.length * MIN_COVERAGE_RATIO);

  // The pointer moving on leaves nothing behind -- back to the baseline
  // within zero tolerance, so "leaves nothing behind" is measured, not
  // only asserted about `highlightedObjectId`.
  await hoverCell(page, away.x, away.y, away.floor);
  await expect.poll(() => page.evaluate(() => window.__bc?.highlightedObjectId ?? null)).toBeNull();
  const afterLeaving = await canvasOf(page).screenshot({ animations: "disabled" });
  expect(pixelDiffCoords(baselineInReach, afterLeaving)).toEqual([]);
});
