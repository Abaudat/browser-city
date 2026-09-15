// Story 1.14 (NFR1): proves `client/src/boot/boot-marks.ts`'s marks are
// honest, not merely present. Runs in the default `chromium` project
// (dev server, `window.__bc` available) -- unlike `boot-budget.spec.ts`,
// this is a correctness proof, not a timing measurement, so it never needs
// the production build or network/CPU throttling `boot-budget.spec.ts`
// uses for that.
//
// Quentin's rule: "a mark that fires before input actually moves the
// player is a lying mark and fails the spec." Proven here by pressing a
// movement key the instant `PLAYER_CONTROLLABLE`'s own mark appears and
// asserting the real, mounted scene's position actually changes on a
// following frame -- never by trusting the mark's own existence.
import { expect, test } from "@playwright/test";
import { BOOT_MARK } from "../../src/boot/boot-marks";
import type {} from "../../src/net/e2e-hooks";

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

test("PLAYER_CONTROLLABLE is honest: a key pressed the instant it fires actually moves the player", async ({
  page,
}) => {
  await page.goto("/");

  // Poll for the mark itself -- never a fixed timeout -- then press the
  // movement key in the very next task, before yielding to anything else.
  await page.waitForFunction(
    () => performance.getEntriesByName("bc-boot:player-controllable").length > 0,
    undefined,
    { timeout: 30_000 },
  );

  const moved = await page.evaluate(() => {
    return new Promise<boolean>((resolve) => {
      const before = window.__bc?.playerPosition;
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", bubbles: true }));
      const deadline = performance.now() + 2_000;
      const tick = () => {
        const now = window.__bc?.playerPosition;
        if (before && now && (now.x !== before.x || now.y !== before.y)) {
          window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD", bubbles: true }));
          resolve(true);
          return;
        }
        if (performance.now() >= deadline) {
          window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD", bubbles: true }));
          resolve(false);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });

  expect(moved).toBe(true);
});
