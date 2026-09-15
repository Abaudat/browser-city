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

/** A real Playwright screenshot of the live, mounted canvas (CDP-captured
 * compositor output -- never a `drawImage` read of the WebGPU/WebGL
 * canvas's own backbuffer, which is unreliable once the buffer is not
 * `preserveDrawingBuffer`), used only to tell "still drawing the street"
 * from "blanked to a flat colour" -- never a `toHaveScreenshot` baseline
 * diff. A uniform-colour PNG (the background alone) compresses to a few
 * hundred bytes; the real street scene, with its props, window alpha and
 * avatar, does not -- so the encoded byte size alone is the signal, with
 * no PNG decoding needed in Node. */
async function canvasLooksRendered(page: Page): Promise<boolean> {
  const buffer = await page.locator("#test-street canvas").screenshot();
  return buffer.length > 5_000;
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

test("a drop after a successful connect shows the notice within 2s, and the world keeps rendering rather than blanking", async ({
  page,
}) => {
  const handle = readSpacetimeHandle();
  const wsPattern = `${handle.serverUrl.replace(/^http/, "ws")}/**`;

  let serverRoute: ReturnType<WebSocketRoute["connectToServer"]> | undefined;
  await page.routeWebSocket(wsPattern, (ws) => {
    serverRoute = ws.connectToServer();
  });

  await page.goto("/");
  await waitForSceneReady(page);

  // Healthy: the notice is not up before the drop.
  await expect(notice(page)).toBeHidden();

  await page.evaluate(() => window.__bc?.startFrameTimings?.());
  const framesBeforeDrop = await page.evaluate(() => window.__bc?.frameTimings?.length ?? 0);

  // Closing the intercepted server-side socket is what the page observes
  // as a real disconnect (Playwright's own default close-cascade) --
  // never the shared local SpacetimeDB instance itself.
  await serverRoute?.close();

  await expect(notice(page)).toBeVisible({ timeout: 2_000 });
  await expect(notice(page)).toHaveText("Connection lost — reconnecting…");

  // NFR42/Tim's direction: the world keeps rendering its last known state
  // -- the canvas stays attached, the frame-work hook keeps advancing
  // across the drop, and the canvas is not blanked to a uniform colour.
  await expect(page.locator("#test-street canvas")).toBeAttached();
  await expect
    .poll(() => page.evaluate(() => window.__bc?.frameTimings?.length ?? 0), { timeout: 5_000 })
    .toBeGreaterThan(framesBeforeDrop);
  expect(await canvasLooksRendered(page)).toBe(true);
});

test("a route that aborts at boot shows the notice, and the street still renders (NFR42)", async ({
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
  await expect(page.locator("#test-street canvas")).toBeAttached({ timeout: 20_000 });
  // The street scene mounts from local defs (`fetchDefs`), independently
  // of the SpacetimeDB socket above -- so it still renders even though
  // the connection never came up at all (NFR42).
  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, {
    timeout: 20_000,
  });
  expect(await canvasLooksRendered(page)).toBe(true);
});
