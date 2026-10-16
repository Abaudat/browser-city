// Committed pixel baselines (NFR48, FR120-FR124): what a player sees at four
// fixed points -- inside the arrival dwelling, on the first street screen,
// that street at NFR48's largest supported viewport, and the fixture block's
// subway platform with its stairwell above -- so a regression that every
// id-based assertion elsewhere still passes is caught as a picture.
// Generated on the CI image only (`update-visual-baselines.yml`, selected by
// the `@visual-baseline` tag), never on a contributor's machine.
//
// What is drawn is deterministic: the city is generated from `city.seed`,
// bodies are frozen (`?freezeBodies=1`), animations are disabled and the
// player stands where a collider or a cell fixes it.
import type { Page } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import {
  PLATFORM_LANDING_X,
  STAIRS_Y,
  STAIRWELL_X0,
  SUBWAY_FLOOR,
} from "../unit/support/stairs-world";
import { enterBlock } from "./block-support";
import { canvasOf } from "./camera-test-support";
import { arrivalCell, awaitScene, nearestCell, walkTo } from "./district-support";
import { expect, test } from "./fixtures";
import { SCREENSHOT_OPTIONS } from "./screenshot-support";

/** The pixels a baseline may differ by: font and compositor noise on a
 * 1920x1080 canvas, never a sprite out of place. */
const MAX_DIFF_PIXELS = 400;

async function settle(page: Page): Promise<void> {
  // Two frames after the last change: chunks drawn, order applied.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function arrive(page: Page): Promise<void> {
  await page.goto("/?freezeBodies=1");
  await awaitScene(page);
  await page.waitForFunction(() => window.__bc?.playerAppearance !== undefined);
  await settle(page);
}

test.describe("@visual-baseline the generated city and the fixture block", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test("@visual-baseline inside the arrival dwelling", async ({ page }) => {
    test.setTimeout(120_000);
    await arrive(page);
    await expect(canvasOf(page)).toHaveScreenshot("arrival-interior.png", {
      ...SCREENSHOT_OPTIONS,
      maxDiffPixels: MAX_DIFF_PIXELS,
    });
  });

  test("@visual-baseline the first street screen", async ({ page }) => {
    test.setTimeout(180_000);
    await arrive(page);
    await walkTo(page, nearestCell(arrivalCell(), false));
    await settle(page);
    await expect(canvasOf(page)).toHaveScreenshot("first-street.png", {
      ...SCREENSHOT_OPTIONS,
      maxDiffPixels: MAX_DIFF_PIXELS,
    });
  });

  test("@visual-baseline the subway platform below the street stairwell", async ({ page }) => {
    test.setTimeout(120_000);
    await enterBlock(page, PLATFORM_LANDING_X + 0.5, 3.5, SUBWAY_FLOOR);
    await settle(page);
    await expect(canvasOf(page)).toHaveScreenshot("platform.png", {
      ...SCREENSHOT_OPTIONS,
      maxDiffPixels: MAX_DIFF_PIXELS,
    });
    // The stairwell from the street, the player walked clear of it.
    await page.evaluate(
      ([x, y]) => window.__bc?.teleport?.(x as number, y as number, 0),
      [STAIRWELL_X0 + 1.5, STAIRS_Y - 1.6],
    );
    await settle(page);
    await expect(canvasOf(page)).toHaveScreenshot("stairwell.png", {
      ...SCREENSHOT_OPTIONS,
      maxDiffPixels: MAX_DIFF_PIXELS,
    });
  });
});

test.describe("@visual-baseline at NFR48's largest viewport", () => {
  test.use({ viewport: { width: 2560, height: 1440 } });

  test("@visual-baseline the first street screen at 2560x1440", async ({ page }) => {
    test.setTimeout(180_000);
    await arrive(page);
    await walkTo(page, nearestCell(arrivalCell(), false));
    await settle(page);
    await expect(canvasOf(page)).toHaveScreenshot("first-street-2560.png", {
      ...SCREENSHOT_OPTIONS,
      maxDiffPixels: MAX_DIFF_PIXELS * 2,
    });
  });
});
