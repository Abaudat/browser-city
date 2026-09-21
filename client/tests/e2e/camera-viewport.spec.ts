// NFR48's own e2e proof (Quentin's direction): the camera stays centred
// on the player through real, held keyboard movement and through a real
// floor transition; the page renders full-viewport with no browser
// scroll chrome at any supported viewport size, DOM surfaces included;
// and the scene's own incremental load never changes camera zoom or
// canvas size once the first frame exists. Everything real, mounted and
// unit level (camera maths, scene wiring) is proven lower
// (`tests/unit/render/camera.test.ts`, `tests/unit/test-street/
// scene.test.ts`) -- this spec only proves what real layout and real
// frames can show. Runs in the default `chromium` project.
import { expect, type Page, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import {
  PLATFORM_LANDING_X,
  PLATFORM_LANDING_Y,
  PLAYER_START,
} from "../../src/test-street/fixture";
import { committedDefs, lamppostRestY } from "../unit/test-street/street-world";
import { waitForPlayerControllable } from "./boot-test-support";

function balance(key: string): number {
  const entry = committedDefs().balance.find((b) => b.key === key);
  if (!entry) throw new Error(`no balance key '${key}'`);
  return entry.value;
}
const TILE_SIZE_PX = balance("render.tile_size_px");

/** `WebSocketRoute` is not re-exported by name from `@playwright/test`
 * (`connection-notice.spec.ts`'s own idiom, repeated here). */
type WebSocketRoute = Parameters<Parameters<Page["routeWebSocket"]>[1]>[0];

// NFR48's own supported-viewport range (`docs/requirements.md`): 800x600
// to 2560x1440, either orientation. This list is that requirement's own
// size matrix, not a second, hand-picked one -- `camera.test.ts`'s own
// property range is drawn from the same numbers.
const SUPPORTED_VIEWPORTS: readonly { width: number; height: number }[] = [
  { width: 800, height: 600 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 768, height: 1024 }, // portrait orientation
];

async function waitForSceneReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, {
    timeout: 20_000,
  });
  await waitForPlayerControllable(page);
}

async function walkTo(
  page: Page,
  key: "ArrowDown" | "ArrowRight" | "ArrowUp" | "ArrowLeft",
  target: { x: number; y: number },
): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForFunction(
    ({ x, y }) => {
      const pos = window.__bc?.playerPosition;
      return !!pos && Math.abs(pos.x - x) < 0.01 && Math.abs(pos.y - y) < 0.01;
    },
    target,
    { timeout: 15_000 },
  );
  await page.keyboard.up(key);
}

/** One centre check against the player sprite's own real, live global
 * bounds -- never recomputed from `viewTransform`, which is the
 * implementation under test (Quentin's direction). The sprite is
 * bottom-centre anchored (`test-street/scene.ts`'s own `anchor.set(0.5,
 * 1)`), and that anchor -- not the bounding box's own vertical centre --
 * is the point the camera actually centres (`screenPositionPx`'s own
 * `screenPositionPx`); a tall sprite's real drawn top sits well above the
 * viewport's own centre by design (FR124/Artie's bottom-centre
 * anchoring), so this reads the anchor (`bounds.x + width/2`,
 * `bounds.y + height`), never the box's geometric middle. */
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

/**
 * Holds `codes` (one direction, or two for a diagonal) until the
 * player's own world position has moved more than half the viewport's
 * own world-pixel extent from where it started, or a real collider stops
 * it (no position change for several consecutive animation frames) --
 * whichever comes first. Sampled every animation frame, from inside the
 * page (no round trip to miss a frame across). Reports the maximum
 * deviation of the player sprite's own real, drawn centre
 * (`playerScreenBounds`, never `viewTransform`) from the canvas's own
 * centre, over every sampled frame, and whether the world position ever
 * actually changed -- so a direction that is blocked from the very first
 * frame cannot pass this vacuously.
 */
async function holdAndSampleFollow(
  page: Page,
  codes: readonly string[],
  tileSizePx: number,
): Promise<{ maxDeviationPx: number; travelled: boolean; samples: number }> {
  return page.evaluate(
    ({ codes, tileSizePx }) => {
      return new Promise<{ maxDeviationPx: number; travelled: boolean; samples: number }>(
        (resolve, reject) => {
          const canvas = document.querySelector("#test-street canvas");
          if (!(canvas instanceof HTMLCanvasElement)) {
            reject(new Error("holdAndSampleFollow: no street canvas"));
            return;
          }
          const startPos = window.__bc?.playerPosition;
          const zoom = window.__bc?.viewTransform?.zoom;
          if (!startPos || !zoom) {
            reject(new Error("holdAndSampleFollow: scene not ready"));
            return;
          }
          const rect = canvas.getBoundingClientRect();
          const halfViewportCellsX = rect.width / zoom / tileSizePx / 2;
          const halfViewportCellsY = rect.height / zoom / tileSizePx / 2;
          const startX = startPos.x;
          const startY = startPos.y;

          for (const code of codes) {
            window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
          }

          let maxDeviationPx = 0;
          let travelled = false;
          let restFrames = 0;
          let samples = 0;
          let lastPos = { x: startPos.x, y: startPos.y };
          // A hard safety cap (60s of frames): every real termination path
          // is travel or a collider rest, this only guards against a
          // genuine bug hanging the test instead of failing it.
          const MAX_SAMPLES = 3_600;

          function finish(): void {
            for (const code of codes) {
              window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
            }
            resolve({ maxDeviationPx, travelled, samples });
          }

          function tick(): void {
            const bounds = window.__bc?.playerScreenBounds?.();
            const pos = window.__bc?.playerPosition;
            if (bounds && pos) {
              // The bottom-centre anchor (`test-street/scene.ts`'s own
              // `anchor.set(0.5, 1)`), never the bounding box's own
              // vertical centre -- see `assertPlayerCentred`'s own doc
              // comment for why.
              const centreX = bounds.x + bounds.width / 2;
              const centreY = bounds.y + bounds.height;
              maxDeviationPx = Math.max(
                maxDeviationPx,
                Math.abs(centreX - rect.width / 2),
                Math.abs(centreY - rect.height / 2),
              );

              const moved = pos.x !== lastPos.x || pos.y !== lastPos.y;
              if (moved) travelled = true;
              restFrames = moved ? 0 : restFrames + 1;
              lastPos = { x: pos.x, y: pos.y };

              const travelledCellsX = Math.abs(pos.x - startX);
              const travelledCellsY = Math.abs(pos.y - startY);
              const doneByTravel =
                travelledCellsX > halfViewportCellsX || travelledCellsY > halfViewportCellsY;
              const doneByRest = restFrames >= 6;

              samples += 1;
              if (doneByTravel || doneByRest || samples >= MAX_SAMPLES) {
                finish();
                return;
              }
            }
            requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        },
      );
    },
    { codes, tileSizePx },
  );
}

test.describe("camera/viewport (NFR48)", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("the camera stays centred on the player through continuous movement in every direction", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await waitForSceneReady(page);
    await assertPlayerCentred(page);

    // Open pavement, not the shop interior: room enough in most
    // directions for a real, sustained hold, and the same rest
    // `enclosure.spec.ts` already proves is reachable this way.
    await walkTo(page, "ArrowDown", { x: PLAYER_START.x, y: lamppostRestY() });
    await assertPlayerCentred(page);

    for (const codes of [
      ["ArrowRight"],
      ["ArrowLeft"],
      ["ArrowUp"],
      ["ArrowDown"],
      ["ArrowUp", "ArrowRight"], // the diagonal
    ]) {
      const result = await holdAndSampleFollow(page, codes, TILE_SIZE_PX);
      expect(
        result.travelled,
        `holding ${codes.join("+")} must actually move the player, or this proves nothing`,
      ).toBe(true);
      expect(
        result.samples,
        `at least one frame must have been sampled for ${codes.join("+")}`,
      ).toBeGreaterThan(0);
      expect(
        result.maxDeviationPx,
        `camera must keep the player within 1px of centre while holding ${codes.join("+")}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test("the camera stays centred immediately after a real floor transition", async ({ page }) => {
    await page.goto("/");
    await waitForSceneReady(page);

    await walkTo(page, "ArrowDown", { x: PLAYER_START.x, y: lamppostRestY() });
    // The stairwell shares the lamppost's own row (`enclosure.spec.ts`'s
    // own idiom) -- a pure east walk reaches its anchor cell with no
    // direction change, and the transition fires the instant the
    // player's own cell matches it.
    await walkTo(page, "ArrowRight", { x: PLATFORM_LANDING_X + 0.5, y: PLATFORM_LANDING_Y + 0.5 });
    expect(await page.evaluate(() => window.__bc?.playerFloor)).toBe(-1);

    await assertPlayerCentred(page);
  });

  test("the page has no browser scroll chrome at any supported viewport size", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await waitForSceneReady(page);

    for (const size of SUPPORTED_VIEWPORTS) {
      await page.setViewportSize(size);
      // Pixi's own `ResizePlugin` reacts to the real `resize` event
      // through a `requestAnimationFrame`-debounced call to
      // `renderer.resize` (`main.ts`'s `resizeTo: window`) -- never
      // synchronous with `setViewportSize` itself, so this waits for the
      // canvas to actually have caught up before asserting anything about
      // it, the same way a real user's next paint would.
      await page.waitForFunction(
        (expected) => {
          const canvas = document.querySelector("#test-street canvas");
          if (!(canvas instanceof HTMLCanvasElement)) return false;
          const rect = canvas.getBoundingClientRect();
          return (
            Math.round(rect.width) === expected.width && Math.round(rect.height) === expected.height
          );
        },
        size,
        { timeout: 5_000 },
      );
      await assertNoScrollChrome(page, size);
      await assertPlayerCentred(page);
    }
  });

  test("no scroll chrome with the options menu open", async ({ page }) => {
    await page.goto("/");
    await waitForSceneReady(page);
    await page.setViewportSize({ width: 1366, height: 768 });

    await page.keyboard.press("Escape"); // opens the options menu
    await expect(page.locator('[data-bc-surface="options-menu"]')).toBeVisible();
    await assertNoScrollChrome(page, { width: 1366, height: 768 });
    await page.keyboard.press("Escape");
  });

  test("no scroll chrome with the connection notice shown", async ({ page }) => {
    // Forces the connection notice up without touching the shared local
    // SpacetimeDB instance every other spec in this run depends on
    // (`connection-notice.spec.ts`'s own idiom): close the intercepted
    // server-side socket, which the page observes as a real disconnect.
    const { readSpacetimeHandle } = await import("./spacetime-harness.mjs");
    const handle = readSpacetimeHandle();
    const wsPattern = `${handle.serverUrl.replace(/^http/, "ws")}/**`;
    let serverRoute: ReturnType<WebSocketRoute["connectToServer"]> | undefined;
    await page.routeWebSocket(wsPattern, (ws) => {
      serverRoute = ws.connectToServer();
    });

    await page.goto("/");
    await waitForSceneReady(page);
    await page.setViewportSize({ width: 1366, height: 768 });

    expect(serverRoute).toBeDefined();
    await serverRoute?.close();
    await expect(page.locator("[data-bc-notice]")).toBeVisible({ timeout: 5_000 });

    await assertNoScrollChrome(page, { width: 1366, height: 768 });
  });

  test("the scene loads at its final zoom throughout, once content begins drawing", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // Delays every atlas/asset image response so loading provably spans
    // several animation frames -- otherwise this could pass on a fast
    // machine without ever sampling more than one frame.
    await page.route("**/*.png", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      await route.continue();
    });

    await page.addInitScript(() => {
      const samples: {
        w: number;
        h: number;
        rectW: number;
        rectH: number;
        zoom: number | null;
      }[] = [];
      (window as unknown as { __bcLoadSamples: typeof samples }).__bcLoadSamples = samples;
      function tick(): void {
        const canvas = document.querySelector("#test-street canvas");
        const done = performance.getEntriesByName("bc-boot:player-controllable").length > 0;
        if (canvas instanceof HTMLCanvasElement) {
          const rect = canvas.getBoundingClientRect();
          samples.push({
            w: canvas.width,
            h: canvas.height,
            rectW: Math.round(rect.width),
            rectH: Math.round(rect.height),
            zoom: window.__bc?.viewTransform?.zoom ?? null,
          });
        }
        if (!done) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });

    await page.goto("/");
    await waitForPlayerControllable(page, 45_000);

    const samples = await page.evaluate(
      () =>
        (
          window as unknown as {
            __bcLoadSamples?: {
              w: number;
              h: number;
              rectW: number;
              rectH: number;
              zoom: number | null;
            }[];
          }
        ).__bcLoadSamples ?? [],
    );
    expect(
      samples.length,
      "the delayed atlas responses must make loading span at least two sampled frames",
    ).toBeGreaterThanOrEqual(2);

    // The canvas's own size and client rect never move, from the very
    // first sampled frame (which can predate the scene mount, while the
    // canvas shows only its background colour) through player-controllable
    // -- there is no reflow (`main.ts`'s `resizeTo: window`, set once).
    const sizes = new Set(samples.map((s) => `${s.w}x${s.h}@${s.rectW}x${s.rectH}`));
    expect(
      [...sizes],
      "the canvas's own size/client rect must never change while loading",
    ).toHaveLength(1);

    // The camera's own zoom, once it exists (content is being
    // positioned), never changes either -- there is no zoom jump. Frames
    // sampled before the scene has mounted report `zoom: null`, which is
    // "nothing is drawn yet", not a second zoom value.
    const zooms = new Set(samples.map((s) => s.zoom).filter((z): z is number => z !== null));
    expect([...zooms], "camera zoom must never change once the scene starts drawing").toHaveLength(
      1,
    );
  });
});

/** No axis overflows on either `documentElement` or `body`, the viewport
 * consumes no gutter, and the canvas's own client rect is exactly the
 * viewport -- FR151/NFR48's whole "reads as a full-viewport app, never a
 * document" claim, checked directly rather than by eye. */
async function assertNoScrollChrome(
  page: Page,
  size: { width: number; height: number },
): Promise<void> {
  const state = await page.evaluate(() => {
    const canvas = document.querySelector("#test-street canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no street canvas");
    const rect = canvas.getBoundingClientRect();
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      docScrollHeight: document.documentElement.scrollHeight,
      docClientHeight: document.documentElement.clientHeight,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      bodyScrollHeight: document.body.scrollHeight,
      bodyClientHeight: document.body.clientHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      canvasRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });

  expect(
    state.docScrollWidth,
    `documentElement overflows horizontally at ${size.width}x${size.height}`,
  ).toBeLessThanOrEqual(state.docClientWidth);
  expect(
    state.docScrollHeight,
    `documentElement overflows vertically at ${size.width}x${size.height}`,
  ).toBeLessThanOrEqual(state.docClientHeight);
  expect(
    state.bodyScrollWidth,
    `body overflows horizontally at ${size.width}x${size.height}`,
  ).toBeLessThanOrEqual(state.bodyClientWidth);
  expect(
    state.bodyScrollHeight,
    `body overflows vertically at ${size.width}x${size.height}`,
  ).toBeLessThanOrEqual(state.bodyClientHeight);
  expect(state.innerWidth, "no scrollbar gutter consumed").toBe(state.docClientWidth);
  expect(state.canvasRect.x).toBe(0);
  expect(state.canvasRect.y).toBe(0);
  expect(Math.round(state.canvasRect.width)).toBe(size.width);
  expect(Math.round(state.canvasRect.height)).toBe(size.height);
}

test.describe("camera/viewport (NFR48): cold load at deviceScaleFactor 2", () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });

  test("a HiDPI cold load still renders at exactly the viewport, no doubled CSS size", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForSceneReady(page);
    await assertNoScrollChrome(page, { width: 1280, height: 720 });
    await assertPlayerCentred(page);
  });
});
