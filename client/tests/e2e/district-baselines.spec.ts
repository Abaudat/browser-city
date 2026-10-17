// Committed pixel baselines (NFR48, FR120-FR124): what a player sees at four
// fixed points -- inside a dwelling no e2e character is let, on the first street screen,
// that street at NFR48's largest supported viewport, and the fixture block's
// subway platform with its stairwell above -- so a regression that every
// id-based assertion elsewhere still passes is caught as a picture.
// Generated on the CI image only (`update-visual-baselines.yml`, selected by
// the `@visual-baseline` tag), never on a contributor's machine.
//
// What is drawn is deterministic: the city is generated from `city.seed`,
// bodies are frozen (`?freezeBodies=1`), animations are disabled and the
// player stands on a cell centre the spec sets.
import type { Page } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import { chunkKey } from "../../src/world/chunk";
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
import { ownerSql, readSpacetimeHandle } from "./spacetime-harness.mjs";

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

/** The first street screen: walked to (so its chunks stream in), then the
 * player set on the cell's centre, wherever the walk's last frame left it. */
async function streetScreen(page: Page): Promise<void> {
  const cell = nearestCell(arrivalCell(), false);
  await walkTo(page, cell);
  await page.evaluate(
    ([x, y]) => window.__bc?.teleport?.(x as number, y as number, 0),
    [cell.x + 0.5, cell.y + 0.5],
  );
  await settle(page);
}

/** The dwelling let last (the highest `rank`): no character an e2e run
 * creates is let it, so no starting box ever stands in it. */
function lastLetDwelling(): { x: number; y: number } {
  let best: { rank: bigint; x: number; y: number } | undefined;
  for (const [rank, x, y] of ownerSql(
    readSpacetimeHandle(),
    "SELECT rank, spawn_x, spawn_y FROM dwelling",
  )) {
    const r = BigInt(rank as string);
    if (!best || r > best.rank) best = { rank: r, x: Number(x), y: Number(y) };
  }
  if (!best) throw new Error("the e2e world holds no dwelling");
  return best;
}

/** Sets the player on `(x, y)` of floor 0, then waits until the chunks
 * around it are streamed and drawn and nothing has been built for a while. */
async function teleportAndSettle(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(([px, py]) => window.__bc?.teleport?.(px as number, py as number, 0), [x, y]);
  const key = String(chunkKey(Math.floor(x), Math.floor(y), 0));
  await page.waitForFunction(
    (k) => window.__bc?.region?.cachedChunkKeys("groundArea").includes(k) ?? false,
    key,
    { timeout: 30_000 },
  );
  let last = -1;
  for (let stable = 0; stable < 20; ) {
    await settle(page);
    const drawn = await page.evaluate(() => window.__bc?.world?.().drawnChunks ?? 0);
    stable = drawn === last ? stable + 1 : 0;
    last = drawn;
  }
}

async function arrive(page: Page): Promise<void> {
  await page.goto("/?freezeBodies=1");
  await awaitScene(page);
  await page.waitForFunction(() => window.__bc?.playerAppearance !== undefined);
  await settle(page);
}

test.describe("@visual-baseline the generated city and the fixture block", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test("@visual-baseline inside a dwelling", async ({ page }) => {
    test.setTimeout(120_000);
    await arrive(page);
    const home = lastLetDwelling();
    await teleportAndSettle(page, home.x + 0.5, home.y + 0.5);
    await expect(canvasOf(page)).toHaveScreenshot("dwelling-interior.png", {
      ...SCREENSHOT_OPTIONS,
      maxDiffPixels: MAX_DIFF_PIXELS,
    });
  });

  test("@visual-baseline the first street screen", async ({ page }) => {
    test.setTimeout(180_000);
    await arrive(page);
    await streetScreen(page);
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
    await streetScreen(page);
    await expect(canvasOf(page)).toHaveScreenshot("first-street-2560.png", {
      ...SCREENSHOT_OPTIONS,
      maxDiffPixels: MAX_DIFF_PIXELS * 2,
    });
  });
});
