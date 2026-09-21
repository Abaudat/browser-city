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
import { BOOT_MARK } from "../../src/boot/boot-marks";
import type {} from "../../src/net/e2e-hooks";
import {
  LAMPPOST_CELL,
  PLATFORM_LANDING_X,
  PLATFORM_LANDING_Y,
  PLAYER_START,
} from "../../src/test-street/fixture";
import {
  committedDefs,
  lamppostApproachRestX,
  lamppostRestY,
  shopfrontExitRestY,
} from "../unit/test-street/street-world";
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
 * Starts an in-page sampler (without blocking on it) that runs until the
 * player's own world position has moved more than half the viewport's
 * own world-pixel extent from where it started, or a real collider stops
 * it (no position change for several consecutive animation frames) --
 * whichever comes first. Sampled every animation frame, from inside the
 * page (no round trip to miss a frame across). Returns a function that
 * awaits the sampler's own result: the maximum deviation of the player
 * sprite's own real, drawn centre (`playerScreenBounds`, never
 * `viewTransform`) from the canvas's own centre, over every sampled
 * frame, and how far the player actually travelled on each axis -- so a
 * direction blocked after one step cannot pass a minimum-distance check
 * vacuously.
 *
 * Deliberately split from the real key hold itself (cycle 2, Quentin's
 * direction, finding 8): the caller drives movement with real
 * `page.keyboard.down`/`up`, dispatched from Node, never a synthetic
 * `window.dispatchEvent` inside the page -- the same real-input idiom
 * `test-street.spec.ts`/`enclosure.spec.ts` already use elsewhere in
 * this suite.
 */
async function startFollowSample(
  page: Page,
  tileSizePx: number,
): Promise<
  () => Promise<{
    maxDeviationPx: number;
    travelledCellsX: number;
    travelledCellsY: number;
    samples: number;
  }>
> {
  await page.evaluate((tileSizePx: number) => {
    const canvas = document.querySelector("#test-street canvas");
    if (!(canvas instanceof HTMLCanvasElement))
      throw new Error("startFollowSample: no street canvas");
    const startPos = window.__bc?.playerPosition;
    const zoom = window.__bc?.viewTransform?.zoom;
    if (!startPos || !zoom) throw new Error("startFollowSample: scene not ready");
    const rect = canvas.getBoundingClientRect();
    const halfViewportCellsX = rect.width / zoom / tileSizePx / 2;
    const halfViewportCellsY = rect.height / zoom / tileSizePx / 2;
    const startX = startPos.x;
    const startY = startPos.y;

    const sample = new Promise<{
      maxDeviationPx: number;
      travelledCellsX: number;
      travelledCellsY: number;
      samples: number;
    }>((resolve) => {
      let maxDeviationPx = 0;
      let restFrames = 0;
      let samples = 0;
      let lastPos = { x: startX, y: startY };
      // A hard safety cap (60s of frames): every real termination path is
      // travel or a collider rest, this only guards against a genuine bug
      // hanging the test instead of failing it.
      const MAX_SAMPLES = 3_600;

      function tick(): void {
        const bounds = window.__bc?.playerScreenBounds?.();
        const pos = window.__bc?.playerPosition;
        if (bounds && pos) {
          // The bottom-centre anchor (`test-street/scene.ts`'s own
          // `anchor.set(0.5, 1)`), never the bounding box's own vertical
          // centre -- see `assertPlayerCentred`'s own doc comment for why.
          const centreX = bounds.x + bounds.width / 2;
          const centreY = bounds.y + bounds.height;
          maxDeviationPx = Math.max(
            maxDeviationPx,
            Math.abs(centreX - rect.width / 2),
            Math.abs(centreY - rect.height / 2),
          );

          const moved = pos.x !== lastPos.x || pos.y !== lastPos.y;
          restFrames = moved ? 0 : restFrames + 1;
          lastPos = { x: pos.x, y: pos.y };

          const travelledCellsX = Math.abs(pos.x - startX);
          const travelledCellsY = Math.abs(pos.y - startY);
          const doneByTravel =
            travelledCellsX > halfViewportCellsX || travelledCellsY > halfViewportCellsY;
          const doneByRest = restFrames >= 6;

          samples += 1;
          if (doneByTravel || doneByRest || samples >= MAX_SAMPLES) {
            resolve({ maxDeviationPx, travelledCellsX, travelledCellsY, samples });
            return;
          }
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    (window as unknown as { __bcFollowSample: typeof sample }).__bcFollowSample = sample;
  }, tileSizePx);

  return () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __bcFollowSample: {
              maxDeviationPx: number;
              travelledCellsX: number;
              travelledCellsY: number;
              samples: number;
            };
          }
        ).__bcFollowSample,
    );
}

/** Holds `codes` (one direction, or two for a diagonal) with real,
 * OS-level key events, waits for `startFollowSample`'s own sampler to
 * finish, then releases them. */
async function holdAndSampleFollow(
  page: Page,
  codes: readonly string[],
  tileSizePx: number,
): Promise<{
  maxDeviationPx: number;
  travelledCellsX: number;
  travelledCellsY: number;
  samples: number;
}> {
  const awaitSample = await startFollowSample(page, tileSizePx);
  for (const code of codes) await page.keyboard.down(code);
  const result = await awaitSample();
  for (const code of codes) await page.keyboard.up(code);
  return result;
}

/** The minimum real travel a held direction must demonstrate for the
 * follow proof to mean anything (cycle 2, Quentin's direction, finding
 * 8) -- a direction blocked after one step must fail this, not "prove"
 * following. Every setup route in the `followCase` list below was
 * verified empirically, before this file was committed, by driving the
 * real, mounted scene through this exact same `walkToOpenSpot` (a real
 * `ArrowDown` rest is `(4.5, 7.25)` -- `SHOPFRONT_EXIT_REST_COLLIDER`'s
 * own doc comment says why the lamppost no longer sits on this column;
 * from there, east to the lamppost's own approach rest, south into its
 * own base collider, east past it and on to `x >= 10`, then resting west
 * lands back around `(1.25, 8.625)`, ~9.3 cells; crossing `x >= 7.3` then
 * resting north lands around `(7.5, 2.25)`, ~6.4 cells; the same plus a
 * further rest south returns to `(7.5, 9)`, ~6.75 cells -- the pavement
 * itself is too shallow north-south for 3 cells anywhere, which is why
 * the south case detours through the interior instead) -- never guessed,
 * and never trusted from arithmetic alone. A
 * fixed real-time hold (`cells / movement.walk_speed_millicells_per_s`)
 * was tried first and measured fine locally, but failed on CI: a stalled
 * frame's own `deltaMs` is clamped to 100ms (`docs/architecture.md`'s
 * own movement rule), so on a loaded runner simulated time can fall well
 * behind wall-clock time and a timed hold quietly covers far fewer
 * cells. Every setup step below waits on the real, authoritative game
 * state itself instead, never an assumed elapsed-time-to-distance
 * conversion. */
const MIN_TRAVELLED_CELLS = 3;

type ArrowKey = "ArrowDown" | "ArrowRight" | "ArrowUp" | "ArrowLeft";

type SetupStep =
  /** Holds `key` until a real collider stops the player (no position
   * change for several consecutive animation frames) or a generous
   * safety timeout. Requires movement to have actually started before a
   * lack of further movement counts as a rest, so a step that starts
   * already resting (a bad setup sequence) times out loudly instead of
   * returning immediately having moved nowhere. */
  | { readonly kind: "rest"; readonly key: ArrowKey }
  /** Holds `key` until the player's own real `x` crosses `value`, then
   * releases immediately -- for a mid-corridor point a continuous walk
   * only ever passes through (`kind: "rest"` cannot land there -- there
   * is nothing to rest against). Waits on the real game state, never a
   * calculated real-time duration (see `MIN_TRAVELLED_CELLS`'s own doc
   * comment for why that failed on CI). */
  | { readonly kind: "x-at-least"; readonly key: ArrowKey; readonly value: number };

/** Real, held keyboard input, one `SetupStep` at a time -- the setup leg
 * for each follow case below, never measured itself. */
async function walkToOpenSpot(page: Page, steps: readonly SetupStep[]): Promise<void> {
  for (const step of steps) {
    if (step.kind === "rest") {
      await walkUntilRest(page, step.key);
    } else {
      await walkUntilXAtLeast(page, step.key, step.value);
    }
  }
}

async function walkUntilRest(page: Page, key: ArrowKey): Promise<void> {
  await page.keyboard.down(key);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const start = window.__bc?.playerPosition;
        if (!start) {
          reject(new Error("walkUntilRest: no starting player position"));
          return;
        }
        let last = { x: start.x, y: start.y };
        let hasMoved = false;
        let restFrames = 0;
        let frames = 0;
        const MAX_FRAMES = 600; // 10s of frames, a safety cap
        function tick(): void {
          const pos = window.__bc?.playerPosition;
          if (pos) {
            const moved = pos.x !== last.x || pos.y !== last.y;
            if (moved) hasMoved = true;
            restFrames = moved ? 0 : restFrames + 1;
            last = { x: pos.x, y: pos.y };
            if (hasMoved && restFrames >= 10) {
              resolve();
              return;
            }
          }
          frames += 1;
          if (frames >= MAX_FRAMES) {
            reject(new Error(`walkUntilRest: never came to rest within ${MAX_FRAMES} frames`));
            return;
          }
          requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }),
  );
  await page.keyboard.up(key);
}

async function walkUntilXAtLeast(page: Page, key: ArrowKey, value: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForFunction(
    (value: number) => (window.__bc?.playerPosition?.x ?? Number.NEGATIVE_INFINITY) >= value,
    value,
    { timeout: 15_000 },
  );
  await page.keyboard.up(key);
}

test.describe("camera/viewport (NFR48)", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  // One case per direction, each its own `page.goto` (cycle 2, Quentin's
  // direction, finding 8): every setup route below is real, empirically
  // verified fixture geometry (`MIN_TRAVELLED_CELLS`'s own doc comment),
  // reached by its own real-keyboard setup walk from `PLAYER_START` --
  // never a teleport hook. A fresh load per case means one direction's
  // own release lag can never carry into another's start point.
  const REST_DOWN_TO_PAVEMENT: SetupStep = { kind: "rest", key: "ArrowDown" };
  for (const followCase of [
    {
      name: "east",
      codes: ["ArrowRight"] as const,
      setup: [REST_DOWN_TO_PAVEMENT] as const,
    },
    {
      name: "west",
      codes: ["ArrowLeft"] as const,
      // `LAMPPOST_APPROACH_REST_COLLIDER` now walls off row 7 at the
      // lamppost's own column (`LAMPPOST_CELL`'s own doc comment says
      // why the lamppost moved there), so a plain east crossing on this
      // row no longer reaches `x >= 10` -- the same three-rest detour the
      // scripted walk (`fixture.ts`'s `streetWalkRoute`) uses gets past
      // it: east to the wall, south into the lamppost's own base
      // collider, then on east, clear of it.
      setup: [
        REST_DOWN_TO_PAVEMENT,
        { kind: "x-at-least", key: "ArrowRight", value: lamppostApproachRestX() },
        { kind: "rest", key: "ArrowDown" },
        { kind: "x-at-least", key: "ArrowRight", value: LAMPPOST_CELL.x + 1 },
        { kind: "x-at-least", key: "ArrowRight", value: 10 },
      ] as const,
    },
    {
      name: "north",
      codes: ["ArrowUp"] as const,
      setup: [
        REST_DOWN_TO_PAVEMENT,
        { kind: "x-at-least", key: "ArrowRight", value: 7.3 },
      ] as const,
    },
    {
      name: "south",
      codes: ["ArrowDown"] as const,
      // Detours through shop A's own interior (never crossing back out
      // the door): the pavement itself is too shallow north-south for
      // `MIN_TRAVELLED_CELLS` anywhere, but this same column, walked
      // north first, reaches the interior's own north wall with real
      // room to spare south of it.
      setup: [
        REST_DOWN_TO_PAVEMENT,
        { kind: "x-at-least", key: "ArrowRight", value: 7.3 },
        { kind: "rest", key: "ArrowUp" },
      ] as const,
    },
    {
      name: "north-east (diagonal)",
      codes: ["ArrowUp", "ArrowRight"] as const,
      setup: [REST_DOWN_TO_PAVEMENT] as const,
    },
  ] satisfies { name: string; codes: readonly ArrowKey[]; setup: readonly SetupStep[] }[]) {
    test(`the camera stays centred while holding ${followCase.name}, and travels at least ${MIN_TRAVELLED_CELLS} cells`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await page.goto("/");
      await waitForSceneReady(page);
      await assertPlayerCentred(page);

      await walkToOpenSpot(page, followCase.setup);
      await assertPlayerCentred(page);

      const result = await holdAndSampleFollow(page, followCase.codes, TILE_SIZE_PX);
      const travelled = Math.max(result.travelledCellsX, result.travelledCellsY);
      expect(
        travelled,
        `holding ${followCase.codes.join("+")} only travelled ${travelled.toFixed(2)} cells ` +
          `(x: ${result.travelledCellsX.toFixed(2)}, y: ${result.travelledCellsY.toFixed(2)}) in ` +
          `${result.samples} sampled frames -- must be at least ${MIN_TRAVELLED_CELLS}, or this proves ` +
          "nothing about a sustained follow",
      ).toBeGreaterThanOrEqual(MIN_TRAVELLED_CELLS);
      expect(
        result.maxDeviationPx,
        `camera must keep the player within 1px of centre while holding ${followCase.codes.join("+")} ` +
          `(travelled x: ${result.travelledCellsX.toFixed(2)}, y: ${result.travelledCellsY.toFixed(2)} cells)`,
      ).toBeLessThanOrEqual(1);
    });
  }

  test("the camera stays centred immediately after a real floor transition", async ({ page }) => {
    await page.goto("/");
    await waitForSceneReady(page);

    // Onto the pavement, then east to the lamppost's own column, then south
    // into its own base collider -- the same three real rests the scripted
    // walk (`fixture.ts`'s `streetWalkRoute`) uses (`enclosure.spec.ts`'s
    // own idiom).
    await walkTo(page, "ArrowDown", { x: PLAYER_START.x, y: shopfrontExitRestY() });
    await walkTo(page, "ArrowRight", { x: lamppostApproachRestX(), y: shopfrontExitRestY() });
    await walkTo(page, "ArrowDown", { x: lamppostApproachRestX(), y: lamppostRestY() });
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
      // synchronous with `setViewportSize` itself. This scene's own
      // camera (`applyCamera`, in the ticker) can legitimately still be
      // one frame behind that resize under real scheduling pressure (its
      // own `requestAnimationFrame` chain, separate from Pixi's), so this
      // waits for the canvas to have caught up *and* the player to have
      // re-centred inside it -- never asserts the instant the canvas
      // alone matches, which is a real race, not only a test one.
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
          return (
            Math.abs(centreX - rect.width / 2) <= 1 && Math.abs(centreY - rect.height / 2) <= 1
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

    // Cycle 2 (Quentin's direction, finding 2): samples the real, live
    // `window.__bc.worldTransform` -- `world`'s own `scale`/`position`,
    // read straight off the mounted `Container` -- never
    // `viewTransform.zoom`, which only ever echoes the `ZOOM` constant
    // `computeCamera` was called with and would report the same single
    // value on a build that still had the mount-time jump. Sampling
    // starts the instant `worldTransform` exists -- `main.ts`'s
    // `onWorldReady` exposes it the moment `world` itself does, before
    // this scene's own asset-loading awaits let the ticker render a
    // frame with it -- so a jump between "world exists but at its own
    // default (0, 0)" and "world at its final, camera-applied position"
    // has nowhere left to hide.
    await page.addInitScript((atlasReadyMark: string) => {
      const samples: {
        w: number;
        h: number;
        rectW: number;
        rectH: number;
        scaleX: number;
        scaleY: number;
        x: number;
        y: number;
      }[] = [];
      let samplesBeforeAtlasReady = 0;
      Object.assign(window as unknown as Record<string, unknown>, {
        __bcLoadSamples: samples,
        __bcSamplesBeforeAtlasReady: () => samplesBeforeAtlasReady,
      });
      function tick(): void {
        const canvas = document.querySelector("#test-street canvas");
        const worldTransform = window.__bc?.worldTransform;
        const done = performance.getEntriesByName("bc-boot:player-controllable").length > 0;
        if (canvas instanceof HTMLCanvasElement && worldTransform) {
          const t = worldTransform();
          const rect = canvas.getBoundingClientRect();
          samples.push({
            w: canvas.width,
            h: canvas.height,
            rectW: Math.round(rect.width),
            rectH: Math.round(rect.height),
            scaleX: t.scaleX,
            scaleY: t.scaleY,
            x: t.x,
            y: t.y,
          });
          if (performance.getEntriesByName(atlasReadyMark).length === 0) {
            samplesBeforeAtlasReady += 1;
          }
        }
        if (!done) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }, BOOT_MARK.ATLAS_READY);

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
              scaleX: number;
              scaleY: number;
              x: number;
              y: number;
            }[];
          }
        ).__bcLoadSamples ?? [],
    );
    const samplesBeforeAtlasReady = await page.evaluate(
      () =>
        (
          window as unknown as { __bcSamplesBeforeAtlasReady?: () => number }
        ).__bcSamplesBeforeAtlasReady?.() ?? 0,
    );

    // Non-vacuity (cycle 2): at least two frames must have been sampled
    // while `world` already had content on it *and* the atlas was still
    // loading -- otherwise this could pass on a fast machine, or one
    // where the delayed responses happened to land after mount, having
    // never actually observed the load in progress.
    expect(
      samplesBeforeAtlasReady,
      "at least two frames with real content on `world` must be sampled before ATLAS_READY",
    ).toBeGreaterThanOrEqual(2);

    // Exactly one distinct (canvas size, client rect, scale, position)
    // tuple, from the first frame `world` had a child through
    // player-controllable: no resize, no reflow, no zoom jump and no
    // position jump.
    const tuples = new Set(samples.map((s) => JSON.stringify(s)));
    expect(
      [...tuples],
      "canvas size/rect and the world container's own scale/position must never change while loading",
    ).toHaveLength(1);
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
