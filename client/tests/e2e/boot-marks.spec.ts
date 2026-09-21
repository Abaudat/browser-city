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

// Cycle 2 (Quentin's/Tim's direction): the gzipped-bundle CI gate on its
// own does not guard the dominant term docs/spikes/1.14-boot-budget.md
// measured -- a change that made boot fetch 300 of the existing character
// sheets instead of 105 would pass a whole-catalogue byte-sum untouched.
// This is a deterministic, timing-free count/bytes assertion instead:
// runs on every client PR (the default `chromium` project), needs no
// browser-less proxy and no throttling to be reliable.
//
// Story 2.13, cycle 2 (Quentin's direction, finding 2): this measures the
// full, settled image set the mount actually fetches, never a window
// bounded by the mark's own timing. A `responseEnd <= playerControllable`
// filter is a race between the mark and whichever request happens to
// still be in flight -- pinned exactly it flakes the day a slower runner
// tips one request across that line, pinned loosely it stops guarding
// anything. "How much of that set lands before the mark" is
// `boot-budget.yml`'s own question, not this deterministic gate's --
// `page.waitForLoadState("networkidle")` after the mark is what settles
// the set before it is ever counted, so request count is asserted exactly,
// never merely bounded, and bytes still carries a 5% margin (headers only;
// PNGs are not re-compressed in transit).
//
// Both figures are set from a real CI run of this exact (post-networkidle)
// harness, never a local machine, on `ci.yml`'s own `e2e` job, run
// 35650638526: 10 requests, 1,347,996 bytes -- identical to the previous,
// timing-windowed measurement, confirming the old window was never
// actually racing anything on this deterministic fixture; the fix is
// still real (see above), it simply had nothing to catch here today.
// ATLAS_BYTES_BUDGET is that byte figure times 1.05, rounded up to the
// next 16 KiB. Both are far below the story 2.6 baseline (115 requests,
// 3.4 MiB) this replaces, which was never a measurement of this test's
// own dev-server harness at all -- it borrowed docs/spikes/
// 1.14-boot-budget.md's own "105 requests, ~3.0 MiB" figure, itself a
// measurement of a different harness entirely (a throttled, production
// build, not this spec's own `chromium` project against the Vite dev
// server). Re-measure this spike (this comment, not a separate file) the
// day the boot path's own image set changes again.
const ATLAS_REQUEST_COUNT = 10;
const ATLAS_BYTES_BUDGET = Math.ceil((1_347_996 * 1.05) / (16 * 1024)) * (16 * 1024);

test("the atlas request count and byte total the mount actually fetches, once settled, stay inside budget (NFR1)", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.waitForFunction(
    () => performance.getEntriesByName("bc-boot:player-controllable").length > 0,
    undefined,
    { timeout: 30_000 },
  );
  // The full, settled set: waited for after the mark, never a filter on
  // Resource Timing entries by the mark's own timestamp (see the comment
  // above this test).
  await page.waitForLoadState("networkidle");

  const { requestCount, bytes, urls } = await page.evaluate(() => {
    const images = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter(
      (e) => /\.(png|jpe?g|webp)$/i.test(e.name),
    );
    return {
      requestCount: images.length,
      bytes: images.reduce((sum, e) => sum + (e.transferSize ?? 0), 0),
      urls: images.map((e) => e.name),
    };
  });

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
