// Story 1.11: FR150/FR151's DOM-surface allowlist, and the connection
// notice's own real proof (Quentin's direction) -- that a drop, and a
// boot-time connect failure, both show the notice while the world keeps
// rendering its last known state rather than blanking.
//
// Uses `page.routeWebSocket` on the SpacetimeDB socket rather than
// killing the shared local SpacetimeDB instance
// (`spacetime-harness.mjs`'s own process): every other spec in the `e2e`
// job (`workers: 1`, one shared `webServer`) depends on that instance
// staying up, and stopping it here would break every later spec in the
// run. No `waitForTimeout` anywhere -- only `waitForFunction`/
// `expect.poll`, and `retries` stays the run's own default of 0.

import { expect, type Page, test } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type {} from "../../src/net/e2e-hooks";
import { readSpacetimeHandle } from "./spacetime-harness.mjs";

async function waitForSceneReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, {
    timeout: 20_000,
  });
  await page.waitForFunction(() => window.__bc?.playerAppearance !== undefined, undefined, {
    timeout: 30_000,
  });
}

/** A real Playwright screenshot of the live, mounted canvas -- CDP-
 * captured compositor output, never a `drawImage` read of the
 * WebGPU/WebGL canvas's own backbuffer (unreliable once the buffer is
 * not `preserveDrawingBuffer`). An element screenshot is the real
 * composited page clipped to the canvas's own rect, and the connection
 * notice is a `position: fixed` banner that deliberately sits on top of
 * the canvas (Artie's direction -- above the options menu in z-order, so
 * it is visible over the world) -- so its own appearance is blanked out
 * of the returned buffer by the caller (`blankNoticeRect` below), which
 * is what isolates "did the *world* change" from "did the notice
 * appear", a separate, already-asserted fact (`toBeVisible`/`toHaveText`
 * elsewhere in each test). Playwright's own `mask` option is not used
 * here: it computes the masked rect from the locator's current bounding
 * box, which is zero-sized while the notice is still `hidden` -- so a
 * "before" capture goes unmasked while an "after" one is, and the two
 * become incomparable for exactly the region under test. */
function canvasScreenshot(page: Page): Promise<Buffer> {
  return page.locator("#test-street canvas").screenshot();
}

/** The notice's own rect, relative to the canvas's top-left -- read once
 * while the notice is visible (so it has real geometry) and reused to
 * blank the same pixels out of every screenshot compared against, since
 * the same fixed-position banner always lands in the same place. Padded
 * well beyond the element's own border box: `box-shadow` paints outside
 * it, and `getBoundingClientRect` does not include that. */
async function noticeRectRelativeToCanvas(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const rect = await page.evaluate(() => {
    const canvas = document.querySelector("#test-street canvas");
    const el = document.querySelector("[data-bc-notice]");
    if (!canvas || !el) throw new Error("canvas or notice element missing");
    const c = canvas.getBoundingClientRect();
    const n = el.getBoundingClientRect();
    return { x: n.left - c.left, y: n.top - c.top, width: n.width, height: n.height };
  });
  const pad = 40;
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

/** Overwrites `rect` with opaque black, in place, on a decoded PNG. */
function blankRect(png: PNG, rect: { x: number; y: number; width: number; height: number }): void {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(png.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(png.height, Math.ceil(rect.y + rect.height));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (png.width * y + x) << 2;
      png.data[i] = 0;
      png.data[i + 1] = 0;
      png.data[i + 2] = 0;
      png.data[i + 3] = 0xff;
    }
  }
}

/** How many pixels differ between two PNG buffers of the same
 * dimensions -- `pixelmatch`/`pngjs`, never a committed baseline file
 * (Quentin's direction, cycle 2): this asserts a runtime-captured
 * before/after relationship, not a visual-regression check against a
 * fixed picture, so there is nothing to commit or regenerate. `excludeRect`,
 * when given, is blanked out of both images identically before comparing. */
function diffPixelCount(
  a: Buffer,
  b: Buffer,
  excludeRect?: { x: number; y: number; width: number; height: number },
): number {
  const pngA = PNG.sync.read(a);
  const pngB = PNG.sync.read(b);
  expect(pngA.width).toBe(pngB.width);
  expect(pngA.height).toBe(pngB.height);
  if (excludeRect) {
    blankRect(pngA, excludeRect);
    blankRect(pngB, excludeRect);
  }
  return pixelmatch(pngA.data, pngB.data, undefined, pngA.width, pngA.height, { threshold: 0.1 });
}

function notice(page: Page) {
  return page.locator("[data-bc-notice]");
}

/** `WebSocketRoute` is not re-exported by name from `@playwright/test` --
 * pulled off `Page["routeWebSocket"]`'s own handler parameter instead of
 * a second, hand-typed duplicate. */
type WebSocketRoute = Parameters<Parameters<Page["routeWebSocket"]>[1]>[0];

test.describe.configure({ mode: "serial" });

test("the DOM UI surface is an exact allowlist: every top-level surface but the canvas mount carries an allowed data-bc-surface (FR151)", async ({
  page,
}) => {
  await page.goto("/");
  await waitForSceneReady(page);

  const surfaces = await page.evaluate(() => {
    const canvasMount = document.getElementById("test-street");
    return (
      [...document.body.children]
        // The canvas mount and the entry-point `<script type="module">` tag
        // (`index.html`'s own bootstrapping, not a UI surface) are the only
        // two non-surface children this page ever has.
        .filter((el) => el !== canvasMount && el.tagName !== "SCRIPT")
        .map((el) => el.getAttribute("data-bc-surface"))
    );
  });

  const ALLOWED = new Set(["options-menu", "connection-notice", "name-prompt"]);
  expect(surfaces.length).toBeGreaterThan(0);
  for (const value of surfaces) {
    expect(value).not.toBeNull();
    expect(ALLOWED.has(value ?? "")).toBe(true);
  }
  // Exact, not merely a subset: story 1.11 ships exactly two of the three
  // (the boot name prompt is story 4.6's).
  expect([...surfaces].sort()).toEqual(["connection-notice", "options-menu"]);
});

test("a drop after a successful connect shows 'Connection lost' within 2s, and the world keeps rendering its last known state rather than blanking", async ({
  page,
}) => {
  const handle = readSpacetimeHandle();
  const wsPattern = `${handle.serverUrl.replace(/^http/, "ws")}/**`;

  let serverRoute: ReturnType<WebSocketRoute["connectToServer"]> | undefined;
  await page.routeWebSocket(wsPattern, (ws) => {
    serverRoute = ws.connectToServer();
  });

  // `?freezeCrowd=1` holds the street crowd's own walk-cycle ticker
  // paused, so the two screenshots below differ only by whatever the
  // drop itself changed on screen -- never by which frame of which
  // citizen's animation happened to be current at each capture.
  await page.goto("/?freezeCrowd=1");
  await waitForSceneReady(page);

  // Healthy: the notice is not up before the drop.
  await expect(notice(page)).toBeHidden();

  await page.evaluate(() => window.__bc?.startFrameTimings?.());
  const framesBeforeDrop = await page.evaluate(() => window.__bc?.frameTimings?.length ?? 0);
  const beforeDrop = await canvasScreenshot(page);

  // Closing the intercepted server-side socket is what the page observes
  // as a real disconnect (Playwright's own default close-cascade) --
  // never the shared local SpacetimeDB instance itself.
  expect(serverRoute).toBeDefined();
  await serverRoute?.close();

  await expect(notice(page)).toBeVisible({ timeout: 2_000 });
  await expect(notice(page)).toHaveText("Connection lost");
  const noticeRect = await noticeRectRelativeToCanvas(page);

  // NFR42/Tim's direction: the world keeps rendering its *last known
  // state* -- not merely "something", which a byte-size heuristic could
  // never tell apart from "some other state". The canvas stays attached,
  // the frame-work hook keeps advancing across the drop (the ticker is
  // still running), and -- with the crowd frozen and the player
  // untouched -- a screenshot taken now must match the one taken right
  // before the drop pixel-for-pixel outside the notice's own rect
  // (modulo rendering noise).
  await expect(page.locator("#test-street canvas")).toBeAttached();
  await expect
    .poll(() => page.evaluate(() => window.__bc?.frameTimings?.length ?? 0), { timeout: 5_000 })
    .toBeGreaterThan(framesBeforeDrop);
  const afterDrop = await canvasScreenshot(page);
  expect(diffPixelCount(beforeDrop, afterDrop, noticeRect)).toBeLessThanOrEqual(50);
});

test("a route that aborts at boot shows 'Connecting…', then 'Connection lost' once the error is real, and the street still renders (NFR42)", async ({
  page,
}) => {
  const handle = readSpacetimeHandle();
  const wsPattern = `${handle.serverUrl.replace(/^http/, "ws")}/**`;

  // Never actually reaches the real server -- the connection fails before
  // any handshake completes, exactly like a server that is unreachable at
  // boot.
  await page.routeWebSocket(wsPattern, (ws) => {
    ws.close();
  });

  await page.goto("/");

  await expect(notice(page)).toBeVisible({ timeout: 2_000 });
  // "Connection lost", never "Connecting…": this is what actually proves
  // `onConnectError` fired (Quentin's direction, cycle 2) -- before the
  // wording split, this case would have passed even if the connect-error
  // path were never wired at all, because a plain "connecting" status
  // sitting past the debounce showed a notice on its own either way.
  await expect(notice(page)).toHaveText("Connection lost");
  await expect(page.locator("#test-street canvas")).toBeAttached({ timeout: 20_000 });
  // The street scene mounts from local defs (`fetchDefs`), independently
  // of the SpacetimeDB socket above -- so it still renders even though
  // the connection never came up at all (NFR42).
  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, {
    timeout: 20_000,
  });

  // A non-blank check, calibrated against a real reference rather than a
  // guessed byte threshold (Quentin's direction, cycle 2): a canvas
  // filled with only the background colour, same dimensions, built from
  // the real screenshot so there is no hand-typed width/height to drift.
  const rendered = await canvasScreenshot(page);
  const renderedPng = PNG.sync.read(rendered);
  const blankPng = new PNG({ width: renderedPng.width, height: renderedPng.height });
  const [r, g, b] = [0x28, 0x40, 0x28]; // test-street/scene.ts's own `app.init({ background: "#284028" })`.
  for (let i = 0; i < blankPng.data.length; i += 4) {
    blankPng.data[i] = r;
    blankPng.data[i + 1] = g;
    blankPng.data[i + 2] = b;
    blankPng.data[i + 3] = 0xff;
  }
  const blank = PNG.sync.write(blankPng);
  expect(diffPixelCount(rendered, blank)).toBeGreaterThan(1000);
});
