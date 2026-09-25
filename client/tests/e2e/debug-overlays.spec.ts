// Story 1.12's functional e2e (FR165/FR168): the overlays, on the real
// street, through the real DEV gate.
//
// Every assertion here is against elements and attributes -- never a
// pixel diff and never a scrape of the canvas. That is what the SVG
// surface buys (Tim's direction): `[data-bc-collider="none"]` is a fact a
// spec can state, whereas "is that dashed cyan outline in the right
// place?" is not.
//
// The one screenshot is a supplement, not the proof: it catches a drawing
// regression the attribute assertions cannot see, and it is deliberately
// the last thing here.
import { expect, type Page, test } from "@playwright/test";
import { DEBUG_OVERLAYS } from "../../src/debug/overlays";
import type {} from "../../src/net/e2e-hooks";
import { SCREENSHOT_OPTIONS } from "./screenshot-support";

const OVERLAY_IDS = DEBUG_OVERLAYS.map((o) => o.id);

// The fixed viewport the one `toHaveScreenshot` check needs, and the
// same budget idiom `test-street.spec.ts` uses: an absolute pixel count
// (never a ratio of the whole canvas) plus Playwright's own per-pixel
// colour tolerance for anti-aliasing noise. Nothing here moves -- the
// player never takes a step and the crowd is frozen -- so what this
// budget absorbs is rendering noise alone.
test.use({ viewport: { width: 1920, height: 1080 } });

const OVERLAY_SCREENSHOT_OPTIONS = { ...SCREENSHOT_OPTIONS, maxDiffPixels: 150 } as const;

async function waitForSceneReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, {
    timeout: 15_000,
  });
  await page.waitForFunction(() => window.__bcDebug !== undefined, undefined, { timeout: 15_000 });
}

test("nothing is drawn until an overlay is asked for, and ?debug= is what asks", async ({
  page,
}) => {
  await page.goto("/");
  await waitForSceneReady(page);

  // The surface exists (it is a DEV build) but has drawn nothing.
  await expect(page.locator('[data-bc-debug="overlays"]')).toHaveCount(1);
  await expect(page.locator("[data-bc-collider]")).toHaveCount(0);
  await expect(page.locator("[data-bc-sort-label]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__bcDebug?.list().every((e) => !e.enabled))).toBe(true);

  // ...and the registry's own table is what the page exposes, so a later
  // overlay is reachable the day it is registered (AC5).
  expect(await page.evaluate(() => window.__bcDebug?.list().map((e) => e.id))).toEqual(OVERLAY_IDS);
});

test("the collision overlay draws every collider state over the real street (AC2)", async ({
  page,
}) => {
  await page.goto("/?debug=collision");
  await waitForSceneReady(page);

  const overlay = page.locator('[data-bc-debug="collision"]');
  await expect(overlay).toHaveCount(1);

  // The street is hand-laid with walls and a lamppost (real colliders)
  // and with posters and windows (no collider at all) -- so all three
  // states are on screen at once, which is exactly the AC.
  await expect(overlay.locator('[data-bc-collider="collider"]').first()).toBeVisible();
  expect(await overlay.locator('[data-bc-collider="collider"]').count()).toBeGreaterThan(0);
  expect(await overlay.locator('[data-bc-collider="none"]').count()).toBeGreaterThan(0);

  // Every rect drawn as a real collider has real extent -- and only
  // that. This deliberately does *not* check where a collider landed:
  // that claim is `inv_collision_overlay_shows_exactly_the_colliders`
  // (the rects are exactly what the live grid reports) and
  // `inv_overlay_projection_matches_renderer` (the projection is the
  // renderer's own), both at unit level against the same builder this
  // page runs. What this adds is that the real, mounted page reaches
  // that builder at all and draws something with size.
  const withoutExtent = await page.evaluate(() => {
    const out: string[] = [];
    for (const element of document.querySelectorAll('[data-bc-collider="collider"]')) {
      const width = Number(element.getAttribute("width"));
      const height = Number(element.getAttribute("height"));
      if (!(width > 0) || !(height > 0)) {
        out.push(`${element.getAttribute("data-bc-object")}: ${width}x${height}`);
      }
    }
    return out;
  });
  expect(withoutExtent, "every rect drawn as a real collider must have real extent").toEqual([]);

  // Nothing the overlay draws may take a click meant for the world.
  expect(
    await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('[data-bc-debug="overlays"]') as Element)
          .pointerEvents,
    ),
  ).toBe("none");
});

test("the sort overlay prints the key the renderer actually ordered by (AC3)", async ({ page }) => {
  await page.goto("/?debug=sort");
  await waitForSceneReady(page);

  const labels = page.locator("[data-bc-sort-label]");
  expect(await labels.count()).toBeGreaterThan(0);

  // Every label's own order index must agree with `window.__bc.renderOrder`
  // -- the order the real `applyDepthOrder` wrote, read independently.
  const disagreements = await page.evaluate(() => {
    const order = window.__bc?.renderOrder ?? [];
    const out: string[] = [];
    for (const element of document.querySelectorAll("[data-bc-sort-label]")) {
      const id = element.getAttribute("data-bc-sort-label") ?? "";
      const text = element.textContent ?? "";
      const printed = /\[(\d+)\]/.exec(text)?.[1];
      const expected = order.indexOf(id);
      if (expected === -1) continue;
      if (printed !== String(expected)) {
        out.push(`${id}: label says ${printed ?? "[?]"}, renderOrder says ${expected}`);
      }
      if (!text.includes(`#${id}`)) out.push(`${id}: label does not carry its own stable id`);
    }
    return out;
  });
  expect(disagreements, "a sort readout that disagrees with the applied order").toEqual([]);
});

test("overlays toggle from the console, and leave nothing behind (AC5)", async ({ page }) => {
  await page.goto("/");
  await waitForSceneReady(page);

  for (const id of OVERLAY_IDS) {
    expect(await page.evaluate((overlayId) => window.__bcDebug?.enable(overlayId), id)).toBe(true);
    await expect(page.locator(`[data-bc-debug="${id}"]`)).toHaveCount(1);
    expect(await page.evaluate((overlayId) => window.__bcDebug?.toggle(overlayId), id)).toBe(true);
    await expect(page.locator(`[data-bc-debug="${id}"]`)).toHaveCount(0);
  }

  // An id nothing registered is refused, not activated.
  expect(await page.evaluate(() => window.__bcDebug?.enable("navmesh"))).toBe(false);
  await expect(page.locator('[data-bc-debug="navmesh"]')).toHaveCount(0);
});

test("an unknown ?debug= id warns and boots anyway, with no console error", async ({ page }) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
    if (message.type() === "warning") warnings.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("/?debug=collision,navmesh");
  await waitForSceneReady(page);

  await expect(page.locator('[data-bc-debug="collision"]')).toHaveCount(1);
  expect(warnings.join("\n")).toContain("navmesh");
  expect(errors, "a stale ?debug= must never break the boot").toEqual([]);
});

test("the overlay is deliberately non-diegetic", async ({ page }) => {
  await page.goto("/?debug=collision,sort&freezeCrowd");
  await waitForSceneReady(page);
  await page.waitForFunction(
    () => (document.querySelectorAll("[data-bc-collider]").length ?? 0) > 0,
    undefined,
    { timeout: 15_000 },
  );

  // FR151's DOM UI allowlist is checked against document.body's own
  // children; the overlay lives inside the canvas mount and must never
  // appear as a fourth surface.
  expect(
    await page.evaluate(() =>
      [...document.body.children].map((c) => c.getAttribute("data-bc-surface") ?? c.id),
    ),
  ).not.toContain("overlays");
  await expect(page.locator('#test-street > [data-bc-debug="overlays"]')).toHaveCount(1);

  // The supplement, never the proof: a drawing regression the attribute
  // assertions above cannot see. The crowd is frozen so the frame is
  // deterministic, exactly as test-street.spec.ts's own snapshots are.
  await expect(page.locator("#test-street")).toHaveScreenshot(
    "collision-overlay.png",
    OVERLAY_SCREENSHOT_OPTIONS,
  );
});
