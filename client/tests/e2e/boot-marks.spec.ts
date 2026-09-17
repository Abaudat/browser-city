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
// browser-less proxy and no throttling to be reliable. Budgets are set
// from docs/spikes/1.14-boot-budget.md's own measured baseline (105
// requests, ~3.0 MiB) with margin.
//
// Story 2.6 (Tim's direction, cycle 1): the shop counter now loads one
// shared atlas page instead of its own individual image -- net zero
// change in request count, and the page (11.4 KB for today's one-object
// "street" group) is smaller than the individual PNG it replaced, so
// this budget is left unchanged rather than tightened from an unverified
// number: a local run measured far below both the old baseline and this
// budget, but on different hardware/timing than the CI image the
// baseline itself was measured on, and a budget tightened from that
// alone risks flaking CI rather than actually guarding anything tighter.
const ATLAS_REQUEST_BUDGET = 115;
const ATLAS_BYTES_BUDGET = 3.4 * 1024 * 1024;

test("the atlas request count and byte total before player-controllable stay inside budget (NFR1)", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(
    () => performance.getEntriesByName("bc-boot:player-controllable").length > 0,
    undefined,
    { timeout: 30_000 },
  );

  const { requestCount, bytes } = await page.evaluate(() => {
    const playerControllable = performance.getEntriesByName("bc-boot:player-controllable")[0]
      ?.startTime as number;
    const images = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter(
      (e) => /\.(png|jpe?g|webp)$/i.test(e.name) && e.responseEnd <= playerControllable,
    );
    return {
      requestCount: images.length,
      bytes: images.reduce((sum, e) => sum + (e.transferSize ?? 0), 0),
    };
  });

  expect(
    requestCount,
    `atlas request count grew to ${requestCount}, over the ${ATLAS_REQUEST_BUDGET}-request budget (docs/spikes/1.14-boot-budget.md) -- re-measure the spike if this is deliberate`,
  ).toBeLessThanOrEqual(ATLAS_REQUEST_BUDGET);
  expect(
    bytes,
    `atlas bytes grew to ${(bytes / 1024 / 1024).toFixed(2)} MiB, over the ${(ATLAS_BYTES_BUDGET / 1024 / 1024).toFixed(1)} MiB budget (docs/spikes/1.14-boot-budget.md) -- re-measure the spike if this is deliberate`,
  ).toBeLessThanOrEqual(ATLAS_BYTES_BUDGET);
});
