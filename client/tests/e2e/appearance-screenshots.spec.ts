// Story 1.10's screenshot-only e2e spec: leaves the crowd, the kid/adult
// pairing, a close crop per walk direction (civilian and uniformed) and
// the crowd after a reload behind as a CI artifact for visual review
// (the same idiom as `story-1.9-shots`), asserting nothing about their
// contents itself -- kept out of `appearance.spec.ts` so that spec's own
// real assertions never share a budget with this one's real-time waits.
import { type Page, test } from "@playwright/test";
import { buildCitizenFixtures, UNIFORMED_WALKER_ID, WALKER_ID } from "../../src/demo/citizens";
import type {} from "../../src/net/e2e-hooks";
import { committedDefs } from "../unit/demo/demo-world";
import { canvasOf, canvasOffset, centredClip, ready } from "./appearance-test-support";

const SHOT_DIR = "test-results/story-1.10-shots";

function balance(key: string): number {
  const entry = committedDefs().balance.find((b) => b.key === key);
  if (!entry) throw new Error(`no balance key '${key}'`);
  return entry.value;
}

const TILE_SIZE_PX = balance("render.tile_size_px");

/** The scene's own baked-in zoom (`ZOOM` in `scene.ts`) is already 3x --
 * `view.zoom` below. This is the *additional* factor a close-crop
 * screenshot applies on top of that, via a temporary CSS upscale of the
 * canvas element itself (`image-rendering: pixelated`, so the browser's
 * own resize stays nearest-neighbour, never blurring the composite's own
 * hard pixel edges) -- `1200x` isn't a canvas resolution Pixi will ever
 * be asked to render at, only how large the browser displays the same
 * backing store while a screenshot is taken. `3 * 2 = 6`, at least the
 * "≥6x" Artie asked for. */
const CROP_CSS_UPSCALE = 2;

/** Reads `walkerId`'s own current direction and its canvas offset in one
 * round trip -- both `window.__bc.walkerPositions()` and
 * `window.__bc.viewTransform` are synchronous, page-side values, so
 * combining them here (rather than a separate `page.evaluate` per value,
 * `appearance-test-support.ts`'s `canvasOffset` included) is the
 * difference between one round trip and three, with the walker's own
 * real-time motion continuing regardless -- the previous cycle's
 * multi-evaluate version measurably let the walker move on to its next
 * leg between "read where it is" and "take the screenshot", capturing
 * the wrong direction for a leg as short as `up`/`down`'s one second. */
async function readWalkerSnapshot(
  page: Page,
  walkerId: string,
): Promise<{ direction: string; canvasX: number; canvasY: number } | undefined> {
  return page.evaluate((id) => {
    const position = window.__bc?.walkerPositions?.()[id];
    const view = window.__bc?.viewTransform;
    if (!position || !view) return undefined;
    return {
      direction: position.direction,
      canvasX: position.x * view.zoom + view.offsetX,
      canvasY: position.y * view.zoom + view.offsetY,
    };
  }, walkerId);
}

/** Waits for `walkerId` to be walking in `direction`, then screenshots a
 * tight crop centred on it, close enough that one pixel of layer drift
 * (the hi-vis jacket over a moving outfit, in particular) is visible, not
 * lost in a full-canvas capture.
 *
 * `window.__bc.walkerPositions()` reporting `direction` correctly (proven
 * directly: it tracks the walker's own real x/y motion exactly) is not
 * the same guarantee as the *canvas* having painted a frame that shows
 * it -- confirmed directly too, by capturing the instant the direction
 * changes: the sprite the screenshot reads back is consistently the
 * *previous* direction's, one whole leg stale. A short, fixed real-time
 * margin after the direction changes is what actually closes that gap
 * (two `requestAnimationFrame`s was not enough, empirically); this also
 * re-verifies the direction hasn't moved on again after waiting, and
 * retries if it has -- `up`/`down` only last one second at
 * `WALK_CELLS_PER_SECOND`, so this margin is a meaningful fraction of
 * that shortest leg, worth checking rather than trusting. */
async function captureWalkerDirection(
  page: Page,
  walkerId: string,
  direction: string,
  zoom: number,
  path: string,
): Promise<void> {
  const canvas = canvasOf(page);
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.waitForFunction(
      ([id, dir]) => window.__bc?.walkerPositions?.()[id as string]?.direction === dir,
      [walkerId, direction] as const,
      { timeout: 15_000 },
    );
    await page.waitForTimeout(300);

    const [snapshot, canvasBox] = await Promise.all([
      readWalkerSnapshot(page, walkerId),
      canvas.boundingBox(),
    ]);
    if (!snapshot) throw new Error(`appearance-screenshots: no walker position for '${walkerId}'`);
    if (!canvasBox) {
      throw new Error("appearance-screenshots: the demo canvas has no bounding box");
    }
    if (snapshot.direction !== direction) continue; // already moved on -- re-wait

    const cropWidth = TILE_SIZE_PX * 3 * zoom * CROP_CSS_UPSCALE;
    const cropHeight = TILE_SIZE_PX * 5 * zoom * CROP_CSS_UPSCALE;
    await page.screenshot({
      path,
      fullPage: true,
      clip: centredClip(
        canvasBox,
        snapshot.canvasX * CROP_CSS_UPSCALE,
        snapshot.canvasY * CROP_CSS_UPSCALE,
        cropWidth,
        cropHeight,
      ),
    });
    return;
  }
  throw new Error(
    `appearance-screenshots: '${walkerId}' never held direction '${direction}' long enough to capture`,
  );
}

/** Upscales the canvas element's own CSS size (`image-rendering:
 * pixelated`, so the browser's own resize stays nearest-neighbour, never
 * blurring the composite's own hard pixel edges) once for the whole
 * block of close crops below, rather than once per crop -- the resize
 * and reflow it costs was itself adding to the real-time gap that let a
 * short `up`/`down` leg slip by uncaptured. */
async function withUpscaledCanvas(page: Page, run: () => Promise<void>): Promise<void> {
  const canvas = canvasOf(page);
  const naturalBox = await canvas.boundingBox();
  if (!naturalBox) throw new Error("appearance-screenshots: the demo canvas has no bounding box");
  await page.evaluate(
    ([width, height]) => {
      const el = document.querySelector<HTMLCanvasElement>("#demo-scene canvas");
      if (!el) return;
      el.style.imageRendering = "pixelated";
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
    },
    [naturalBox.width * CROP_CSS_UPSCALE, naturalBox.height * CROP_CSS_UPSCALE] as const,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  try {
    await run();
  } finally {
    // Every other screenshot in this file expects the canvas at its
    // natural size.
    await page.evaluate(() => {
      const el = document.querySelector<HTMLCanvasElement>("#demo-scene canvas");
      if (!el) return;
      el.style.imageRendering = "";
      el.style.width = "";
      el.style.height = "";
    });
  }
}

test.describe("story 1.10 review screenshots", () => {
  test("crowd, twin kids, walk directions (civilian and uniformed), and after a full reload", async ({
    page,
  }) => {
    // This is the one spec in the suite that pays for the full street
    // crowd's own network-bound texture build *twice* (once at mount,
    // once after `page.reload()`) plus real-time waits for two walkers to
    // each cross all four directions of their own loop.
    test.setTimeout(120_000);
    await page.goto("/");
    await ready(page);

    await canvasOf(page).screenshot({ path: `${SHOT_DIR}/crowd.png` });

    // `kid-0` and the adult standing right beside it, on the identical
    // `gridY` -- the crop is centred on the real fixture positions,
    // converted to a canvas offset the same way `citizens-layer.ts`
    // itself places every sprite (`gridX/gridY * tileSizePx`, then the
    // scene's own camera transform), so it never drifts out of step with
    // a camera move or a fixture reshuffle.
    const defs = committedDefs();
    const fixtures = buildCitizenFixtures(defs);
    const kid0 = fixtures.find((f) => f.id === "kid-0");
    if (!kid0) throw new Error("appearance-screenshots: no kid-0 fixture");
    const neighbourAdult = fixtures
      .filter((f) => f.id.startsWith("adult-") && f.gridY === kid0.gridY)
      .sort((a, b) => Math.abs(a.gridX - kid0.gridX) - Math.abs(b.gridX - kid0.gridX))[0];
    if (!neighbourAdult) {
      throw new Error("appearance-screenshots: no adult shares kid-0's own gridY");
    }
    const midWorldPx = {
      x: ((kid0.gridX + neighbourAdult.gridX) / 2) * TILE_SIZE_PX,
      y: kid0.gridY * TILE_SIZE_PX,
    };
    const view = await page.evaluate(() => window.__bc?.viewTransform);
    if (!view) throw new Error("the demo scene never recorded its view transform");
    const centre = await canvasOffset(page, midWorldPx);
    // `fullPage` screenshots and `boundingBox()` must agree on the same
    // (unscrolled) coordinate origin -- pinned to the top so a prior
    // scroll position can never shift the two out of step.
    await page.evaluate(() => window.scrollTo(0, 0));
    const canvasBox = await canvasOf(page).boundingBox();
    if (!canvasBox) throw new Error("appearance-screenshots: the demo canvas has no bounding box");
    const cropWidth = TILE_SIZE_PX * 8 * view.zoom;
    const cropHeight = TILE_SIZE_PX * 6 * view.zoom;
    await page.screenshot({
      path: `${SHOT_DIR}/kid-beside-adult.png`,
      fullPage: true,
      clip: centredClip(canvasBox, centre.x, centre.y, cropWidth, cropHeight),
    });

    // One close crop per walk direction, for both the civilian walker and
    // the uniformed one -- the extra jacket layer over a moving outfit is
    // the alignment risk the full-canvas captures above cannot show.
    const directions = ["right", "up", "left", "down"];
    await withUpscaledCanvas(page, async () => {
      for (const direction of directions) {
        await captureWalkerDirection(
          page,
          WALKER_ID,
          direction,
          view.zoom,
          `${SHOT_DIR}/walk-${direction}-civilian.png`,
        );
      }
      for (const direction of directions) {
        await captureWalkerDirection(
          page,
          UNIFORMED_WALKER_ID,
          direction,
          view.zoom,
          `${SHOT_DIR}/walk-${direction}-uniformed.png`,
        );
      }
    });

    await page.reload();
    await ready(page);
    await canvasOf(page).screenshot({ path: `${SHOT_DIR}/crowd-after-reload.png` });
  });
});
