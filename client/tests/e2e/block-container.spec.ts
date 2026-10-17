// Story 6.10 (FR94): the container view, mounted. The fit rule is proven in
// `sim` and the view's geometry in unit tests; this only proves the real
// wiring -- a real click on the cupboard opens a view bound to it, fed by
// the rows the server holds for it (restored with the fixture block, in the
// one streamed world), drawn in world space; walking out of its reach closes
// it. The generator places no container yet, so the block carries one.
//
// The view is asserted through `window.__bc.containerView()` (the cell rects
// it draws, from its own view model), never through pixels. The two
// screenshots are left behind for Artie's review.
import { mkdirSync } from "node:fs";
import type {} from "../../src/net/e2e-hooks";
import { ZOOM } from "../../src/render/camera";
import { cellBottomCentre, worldPointPx } from "../../src/render/screen-position";
import { committedDefs } from "../unit/support/stairs-world";
import { BLOCK_CUPBOARD_ID, enterBlock } from "./block-support";
import { canvasOf, canvasOffsetForWorldPx } from "./camera-test-support";
import { expect, test } from "./fixtures";
import { E2E_CUPBOARD } from "./spacetime-harness.mjs";
import { walkRealCellsDir } from "./walk-support";

const SHOT_DIR = "test-results/review-shots/story-6.10";

function balance(key: string): number {
  const entry = committedDefs().balance.find((b) => b.key === key);
  if (!entry) throw new Error(`no balance key '${key}'`);
  return entry.value;
}
const TILE_SIZE_PX = balance("render.tile_size_px");
const STOREY_HEIGHT_PX = balance("render.storey_height_px");

type Item = { defId: number; slotX: number; slotY: number; orientation: number };

/** The rects the seeded rows must draw: each item's `bulk`, swapped on an
 * odd orientation, at its seeded slot -- read from `defs/`, never typed. */
function expectedRects() {
  const defs = committedDefs();
  return (E2E_CUPBOARD.items as Item[])
    .map((it, i) => {
      const item = defs.items.find((d) => d.id === it.defId);
      if (!item) throw new Error(`seeded item def ${it.defId} is gone`);
      const odd = it.orientation % 2 === 1;
      return {
        instanceId: String(i + 1),
        defId: it.defId,
        x: it.slotX,
        y: it.slotY,
        w: odd ? item.height : item.width,
        h: odd ? item.width : item.height,
        quarterTurns: it.orientation % 4,
      };
    })
    .sort((a, b) => Number(a.instanceId) - Number(b.instanceId));
}

test("clicking the cupboard from within reach opens its view; walking away closes it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  mkdirSync(SHOT_DIR, { recursive: true });
  // Standing south of the cupboard, inside its `interact_at` skirt.
  await enterBlock(page, E2E_CUPBOARD.x + 0.5, E2E_CUPBOARD.y + 1.3);
  expect(await page.evaluate(() => window.__bc?.containerView?.() ?? null)).toBeNull();

  // In reach, the cupboard is closed: nothing is drawn above it.
  await page.screenshot({ path: `${SHOT_DIR}/cupboard-closed.png` });

  // A real click on the drawn cupboard.
  const centre = cellBottomCentre(E2E_CUPBOARD.x, E2E_CUPBOARD.y);
  const anchor = worldPointPx(centre.x, centre.y, 0, TILE_SIZE_PX, STOREY_HEIGHT_PX, ZOOM, 0);
  const at = await canvasOffsetForWorldPx(page, { x: anchor.x, y: anchor.y - TILE_SIZE_PX / 2 });
  await canvasOf(page).click({ position: at });

  // The view opens bound to the cupboard and holds exactly what the server
  // holds for it, at its seeded slots and rotated footprints.
  await page.waitForFunction(() => window.__bc?.containerView?.() != null, undefined, {
    timeout: 10_000,
  });
  const open = await page.evaluate(() => window.__bc?.containerView?.() ?? null);
  expect(open?.objectId).toBe(BLOCK_CUPBOARD_ID);
  await expect
    .poll(
      async () => (await page.evaluate(() => window.__bc?.containerView?.()?.rects ?? [])).length,
    )
    .toBe(E2E_CUPBOARD.items.length);
  const rects = await page.evaluate(() => window.__bc?.containerView?.()?.rects ?? []);
  expect(rects).toEqual(expectedRects());
  // No screen-space layer: the stage holds the world root and nothing else.
  expect(await page.evaluate(() => window.__bc?.stageChildren?.() ?? -1)).toBe(1);
  await page.screenshot({ path: `${SHOT_DIR}/cupboard-open.png` });

  // Walking out of reach closes it, with the pointer left where it was.
  const here = await page.evaluate(() => window.__bc?.playerPosition);
  if (!here) throw new Error("no position");
  await walkRealCellsDir(page, "out-of-reach", E2E_CUPBOARD.x + 1.6 - here.x, "ArrowRight");
  await page.waitForFunction(() => window.__bc?.containerView?.() == null, undefined, {
    timeout: 10_000,
  });
  expect(await page.evaluate(() => window.__bc?.stageChildren?.() ?? -1)).toBe(1);
});
