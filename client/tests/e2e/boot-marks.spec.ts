// Story 1.14 (NFR1): proves `client/src/boot/boot-marks.ts`'s marks are
// honest, not merely present. Runs in the default `chromium` project
// (dev server, `window.__bc` available) -- unlike `boot-budget.spec.ts`,
// this is a correctness proof, not a timing measurement, so it never needs
// the production build or network/CPU throttling `boot-budget.spec.ts`
// uses for that.
//
// Quentin's rule: "a mark that fires before input actually moves the
// player is a lying mark and fails the spec." Cycle 2 (Quentin's
// direction): the honesty check must catch a mark that lies by even one
// frame, which a Node-side poll-then-evaluate round trip cannot -- there
// is slack between "Node observed the mark exists" and "the page actually
// receives the synthetic keydown" that a mark firing slightly early could
// hide inside. `page.addInitScript` installs a `PerformanceObserver`
// *before* any application code runs, and the keydown is dispatched
// synchronously inside that observer's own callback -- no round trip, no
// task-queue gap -- with the position-change check given exactly 3
// animation frames, per Quentin's direction.
import { expect, test } from "@playwright/test";
import { BOOT_MARK } from "../../src/boot/boot-marks";
import type {} from "../../src/net/e2e-hooks";

declare global {
  interface Window {
    __bootHonesty?: Promise<boolean>;
  }
}

test("every boot mark fires during a normal load, in a sane order", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => performance.getEntriesByName("bc-boot:player-controllable").length > 0,
    undefined,
    { timeout: 30_000 },
  );

  const marks = await page.evaluate(() =>
    performance
      .getEntriesByType("mark")
      .map((entry) => ({ name: entry.name, at: entry.startTime })),
  );
  const byName = new Map(marks.map((m) => [m.name, m.at]));

  for (const name of Object.values(BOOT_MARK)) {
    expect(byName.has(name), `missing boot mark '${name}'`).toBe(true);
  }

  // The handshake and the subscription it opens can never be out of
  // order; neither can the scene's own first render and the two
  // FR144/FR145 stand-ins that piggyback on it.
  expect(byName.get(BOOT_MARK.HANDSHAKE_OPEN)).toBeLessThanOrEqual(
    byName.get(BOOT_MARK.SUBSCRIPTION_APPLIED) as number,
  );
  expect(byName.get(BOOT_MARK.FIRST_FRAME_RENDERED)).toBeLessThanOrEqual(
    byName.get(BOOT_MARK.INTERACTIVE_PROMPT) as number,
  );
  expect(byName.get(BOOT_MARK.INTERACTIVE_PROMPT)).toBe(byName.get(BOOT_MARK.PLAYER_CONTROLLABLE));
});

test("PLAYER_CONTROLLABLE is honest: a key pressed the instant it fires actually moves the player within 3 frames", async ({
  page,
}) => {
  // Installed before navigation, so the observer exists before any
  // application code runs -- `buffered: true` also catches the mark if it
  // somehow fired before `observe()` itself ran.
  await page.addInitScript(() => {
    window.__bootHonesty = new Promise<boolean>((resolve) => {
      const observer = new PerformanceObserver((list) => {
        if (list.getEntriesByName("bc-boot:player-controllable").length === 0) return;
        observer.disconnect();

        // Synchronous, inside the observer's own callback: no round trip
        // to Node between "the mark exists" and "input is sent" for a
        // slightly-early mark to hide inside.
        const before = window.__bc?.playerPosition;
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", bubbles: true }));

        let framesLeft = 3;
        const tick = () => {
          const now = window.__bc?.playerPosition;
          if (before && now && (now.x !== before.x || now.y !== before.y)) {
            window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD", bubbles: true }));
            resolve(true);
            return;
          }
          framesLeft -= 1;
          if (framesLeft <= 0) {
            window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD", bubbles: true }));
            resolve(false);
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      observer.observe({ type: "mark", buffered: true });
    });
  });

  await page.goto("/");

  const moved = await page.evaluate(() => window.__bootHonesty);

  expect(moved).toBe(true);
});

// Cycle 3 (Quentin's/Tim's direction): counted at the network layer
// (`page.on("requestfinished")`), not `performance.getEntriesByType(
// "resource")` -- Pixi 8's texture loader fetches through a dedicated
// Worker by default (`preferWorkers: true`), and a Worker's own fetches
// never reach the page's own Resource Timing buffer, so the Resource-
// Timing version of this gate was blind to every `AtlasPageLoader`/
// `Assets.load` request (the packed `street` page, every raw
// `ModernTileset/` sheet `scene.ts` still loads) and passed on ten
// requests that were entirely the crowd's own main-thread-`fetch`
// character part pages. `page.on("requestfinished")` sees Worker-
// initiated requests too, so this is never turned off by disabling
// `preferWorkers` to suit the test. Bytes come from `request.sizes()`
// (`responseBodySize + responseHeadersSize`, real transfer bytes), never
// `transferSize`. The self-check below is what stops this gate going
// blind again unnoticed: it must see both the street page and a
// character page, or it fails outright rather than quietly passing a
// small number.
//
// Counted: every `.png`/`.jpg`/`.jpeg`/`.webp` request finished between
// `page.goto` and `player-controllable` + `networkidle`. Re-measured for
// story 15.2 (three new raw street-only textures -- a doormat, a bollard,
// a manhole cover -- replacing the six undrawn "rest collider" boundary
// rects the scripted walk used to lean on): 29 requests, 1,451,572 bytes
// -- ATLAS_BYTES_BUDGET is that byte figure times 1.05, rounded up to the
// next 16 KiB.
const ATLAS_REQUEST_COUNT = 29;
const ATLAS_BYTES_BUDGET = Math.ceil((1_451_572 * 1.05) / (16 * 1024)) * (16 * 1024);

test("the atlas request count and byte total the mount actually fetches, once settled, stay inside budget (NFR1)", async ({
  page,
}, testInfo) => {
  // Registered before `page.goto` so nothing fetched during the load is
  // missed -- includes Worker-initiated requests (Pixi's own texture
  // loader), unlike `performance.getEntriesByType("resource")`.
  const imageRequests: import("@playwright/test").Request[] = [];
  page.on("requestfinished", (request) => {
    if (/\.(png|jpe?g|webp)$/i.test(request.url())) imageRequests.push(request);
  });

  await page.goto("/");
  await page.waitForFunction(
    () => performance.getEntriesByName("bc-boot:player-controllable").length > 0,
    undefined,
    { timeout: 30_000 },
  );
  // The full, settled set: waited for after the mark, never a filter on
  // a timestamp (see the comment above this test).
  await page.waitForLoadState("networkidle");

  const urls = imageRequests.map((r) => r.url());
  const sizes = await Promise.all(imageRequests.map((r) => r.sizes()));
  const requestCount = imageRequests.length;
  const bytes = sizes.reduce((sum, s) => sum + s.responseBodySize + s.responseHeadersSize, 0);

  // The self-check (Quentin's direction, cycle 2): a budget gate that
  // cannot fail for the thing it budgets is the actual defect the
  // Resource-Timing version had -- these two assertions are what stop
  // that recurring unnoticed.
  //
  // The reconciliation against `allBoundTextureSources = 17`
  // (`test-street.spec.ts`), written down once because it is what would
  // have caught the Resource-Timing gate's own blindness: this gate's 26
  // requests are 15 raw `ModernTileset/` sheets (`scene.ts`'s own
  // `ASSET_URLS`) + 1 packed `street` atlas page + 10 character part-
  // sheet fetches (`character-part-pages.ts`'s own main-thread `fetch`,
  // never a Worker) -- only 6 distinct part-sheet files, each fetched
  // twice because the player's own `AppearanceTextureCache` and the
  // crowd's own are two separate loader instances with two separate
  // fetch-dedup caches (pre-existing, not this story's own concern).
  // `allBoundTextureSources`'s 17 is the same 15 raw sheets + 1 street
  // page + only 1 bound *composite* character page -- the CPU-drawn
  // canvas texture built from those 6 part sheets, never itself
  // requested over the network, and the second of the two
  // `CHARACTER_COMPOSITE_PAGES` this street's crowd never fills. Ten
  // network requests collapsing into one bound source is expected, not a
  // discrepancy -- a request count and a bound-source count are
  // different facts about the same mount and were never going to match
  // number for number; this gate's job is only ever "can it see the
  // things `allBoundTextureSources` also sees", never "does it equal it".
  expect(
    urls.some((u) => /\/atlas\/street-/.test(u)),
    `this gate never saw the packed street atlas page -- it cannot be measuring what it budgets. Fetched:\n${urls.join("\n")}`,
  ).toBe(true);
  expect(
    urls.some((u) => /\/atlas\/character_/.test(u)),
    `this gate never saw a character composite atlas page -- it cannot be measuring what it budgets. Fetched:\n${urls.join("\n")}`,
  ).toBe(true);

  // Quentin's direction: readable from any CI run without a debug push,
  // pass or fail, and an over-budget failure names the offending URLs
  // rather than only a number. Both a `test.info()` annotation (machine-
  // readable) and a plain `console.log` (visible straight in the `list`
  // reporter's own captured output, which `ci.yml`'s `e2e` job uses, no
  // extra tooling needed to view it).
  testInfo.annotations.push(
    { type: "atlas-request-count", description: String(requestCount) },
    { type: "atlas-bytes", description: String(bytes) },
  );
  console.log(`NFR1: atlas requestCount=${requestCount} bytes=${bytes}`);

  expect(
    requestCount,
    `atlas request count is ${requestCount}, not the ${ATLAS_REQUEST_COUNT} this deterministic set always settles to -- re-measure this spike (this file's own comment) if this is a deliberate change to the image set the mount fetches. Fetched:\n${urls.join("\n")}`,
  ).toBe(ATLAS_REQUEST_COUNT);
  expect(
    bytes,
    `atlas bytes grew to ${(bytes / 1024 / 1024).toFixed(2)} MiB, over the ${(ATLAS_BYTES_BUDGET / 1024 / 1024).toFixed(2)} MiB budget -- re-measure this spike (this file's own comment) if this is deliberate. Fetched:\n${urls.join("\n")}`,
  ).toBeLessThanOrEqual(ATLAS_BYTES_BUDGET);
});
