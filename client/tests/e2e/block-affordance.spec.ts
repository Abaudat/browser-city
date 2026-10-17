// FR173 (story 1.9): the affordance mark is a real pixel change, confined to
// the hovered object's own drawn rect, shown only once the object is in
// reach (reachability is taught by the highlight, never told), scaled by the
// U1 dial and gone when the pointer moves on. The generator places no
// interactable beside the arrival yet, so the fixture block's cupboard
// carries it. Measured on screenshots of one session, never against a
// committed picture: what is under test is a before/after relationship.
import type { Page } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type {} from "../../src/net/e2e-hooks";
import { ZOOM } from "../../src/render/camera";
import { cellBottomCentre, worldPointPx } from "../../src/render/screen-position";
import { committedDefs } from "../unit/support/stairs-world";
import { BLOCK_CUPBOARD_ID, enterBlock } from "./block-support";
import { canvasOf, canvasOffsetForWorldPx } from "./camera-test-support";
import { expect, test } from "./fixtures";
import { E2E_CUPBOARD } from "./spacetime-harness.mjs";

test.use({ viewport: { width: 1920, height: 1080 } });

function balance(key: string): number {
  const entry = committedDefs().balance.find((b) => b.key === key);
  if (!entry) throw new Error(`no balance key '${key}'`);
  return entry.value;
}
const TILE = balance("render.tile_size_px");
const STOREY = balance("render.storey_height_px");

/** The point a hover on cell `(x, y)` lands on: the middle of the cell's
 * bottom row of pixels, in world pixels. */
function worldPixelOfCell(x: number, y: number): { x: number; y: number } {
  const centre = cellBottomCentre(x, y);
  const anchor = worldPointPx(centre.x, centre.y, 0, TILE, STOREY, ZOOM, 0);
  return { x: anchor.x, y: anchor.y - TILE / 2 };
}

async function hoverCell(page: Page, x: number, y: number): Promise<void> {
  const position = await canvasOffsetForWorldPx(page, worldPixelOfCell(x, y));
  await canvasOf(page).hover({ position });
}

/** Drives the real U1 dial through the real options menu. */
async function setHighlightStrength(page: Page, value: number): Promise<void> {
  await page.keyboard.press("Escape");
  const slider = page.locator("[data-bc-highlight-slider]");
  await slider.fill(String(value));
  await slider.dispatchEvent("change");
  await page.keyboard.press("Escape");
}

/** The cupboard's drawn rect in canvas pixels, padded a few pixels for
 * rounding: one tile square, bottom-centre anchored on its cell. */
async function cupboardRect(page: Page) {
  const centre = cellBottomCentre(E2E_CUPBOARD.x, E2E_CUPBOARD.y);
  const anchor = worldPointPx(centre.x, centre.y, 0, TILE, STOREY, ZOOM, 0);
  const topLeft = await canvasOffsetForWorldPx(page, {
    x: anchor.x - TILE / 2,
    y: anchor.y - TILE,
  });
  const bottomRight = await canvasOffsetForWorldPx(page, { x: anchor.x + TILE / 2, y: anchor.y });
  const pad = 3;
  return {
    x0: topLeft.x - pad,
    y0: topLeft.y - pad,
    x1: bottomRight.x + pad,
    y1: bottomRight.y + pad,
  };
}

/** Every pixel that differs between two same-size PNGs, as coordinates. The
 * threshold is far below pixelmatch's default: the mark is a subtle colour
 * shift at the dial's default, and the canvas is deterministic and
 * unantialiased, so there is no noise for a low threshold to pick up. */
function pixelDiff(a: Buffer, b: Buffer): { x: number; y: number }[] {
  const pngA = PNG.sync.read(a);
  const pngB = PNG.sync.read(b);
  expect(pngA.width).toBe(pngB.width);
  expect(pngA.height).toBe(pngB.height);
  const diff = new PNG({ width: pngA.width, height: pngA.height });
  const count = pixelmatch(pngA.data, pngB.data, diff.data, pngA.width, pngA.height, {
    threshold: 0.02,
    diffMask: true,
  });
  const coords: { x: number; y: number }[] = [];
  if (count > 0) {
    for (let y = 0; y < diff.height; y++) {
      for (let x = 0; x < diff.width; x++) {
        if (diff.data[((diff.width * y + x) << 2) + 3] !== 0) coords.push({ x, y });
      }
    }
  }
  return coords;
}

const highlighted = (page: Page) => page.evaluate(() => window.__bc?.highlightedObjectId ?? null);

test("the affordance mark is a real pixel change, confined to the hovered object's own drawn rect, shown only in reach", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Out of reach: two tiles east of the cupboard's `interact_at` skirt.
  const away = { x: E2E_CUPBOARD.x - 4, y: E2E_CUPBOARD.y + 1 };
  await enterBlock(page, E2E_CUPBOARD.x - 2.5, E2E_CUPBOARD.y + 1.5);

  // Pair A: the cupboard is out of reach, so hovering it marks nothing.
  await hoverCell(page, away.x, away.y);
  const baselineOutOfReach = await canvasOf(page).screenshot({ animations: "disabled" });
  await hoverCell(page, E2E_CUPBOARD.x, E2E_CUPBOARD.y);
  expect(await highlighted(page)).toBeNull();
  const hoveredOutOfReach = await canvasOf(page).screenshot({ animations: "disabled" });
  expect(pixelDiff(baselineOutOfReach, hoveredOutOfReach)).toEqual([]);

  // Into reach: stand south of it, as a player walking up would.
  await page.evaluate(
    ([x, y]) => window.__bc?.teleport?.(x as number, y as number, 0),
    [E2E_CUPBOARD.x + 0.5, E2E_CUPBOARD.y + 1.3],
  );
  await page.waitForFunction((at) => {
    const p = window.__bc?.playerPosition;
    return p !== undefined && Math.abs(p.y - at) < 0.01;
  }, E2E_CUPBOARD.y + 1.3);
  const rect = await cupboardRect(page);

  // Pair B: in reach, the hovered cupboard is marked, inside its own rect.
  await hoverCell(page, away.x, away.y);
  const baseline = await canvasOf(page).screenshot({ animations: "disabled" });
  await hoverCell(page, E2E_CUPBOARD.x, E2E_CUPBOARD.y);
  await expect.poll(() => highlighted(page)).toBe(BLOCK_CUPBOARD_ID);
  const hovered = await canvasOf(page).screenshot({ animations: "disabled" });
  const diff = pixelDiff(baseline, hovered);
  expect(diff.length).toBeGreaterThan(0);
  for (const { x, y } of diff) {
    expect(x).toBeGreaterThanOrEqual(rect.x0);
    expect(x).toBeLessThanOrEqual(rect.x1);
    expect(y).toBeGreaterThanOrEqual(rect.y0);
    expect(y).toBeLessThanOrEqual(rect.y1);
  }

  // The mark at the default dial covers a real share of what the dial's own
  // maximum marks -- derived from the object's behaviour, never a count.
  await hoverCell(page, away.x, away.y);
  await setHighlightStrength(page, 100);
  await hoverCell(page, E2E_CUPBOARD.x, E2E_CUPBOARD.y);
  await expect.poll(() => highlighted(page)).toBe(BLOCK_CUPBOARD_ID);
  const atMax = pixelDiff(baseline, await canvasOf(page).screenshot({ animations: "disabled" }));
  expect(atMax.length).toBeGreaterThan(0);
  expect(diff.length).toBeGreaterThanOrEqual(atMax.length * 0.5);

  // The pointer moving on leaves nothing behind.
  await hoverCell(page, away.x, away.y);
  await expect.poll(() => highlighted(page)).toBeNull();
  const after = await canvasOf(page).screenshot({ animations: "disabled" });
  expect(pixelDiff(baseline, after)).toEqual([]);
});
