// What a spec needs to stand in the fixture block: the one hand-laid block
// of stairs, a footbridge and a cupboard that the e2e harness restores into
// the world beside the generated city (`tests/fixture-block/block.ts`).
// A spec stands the player there with the DEV `window.__bc.teleport` hook
// and then walks with real key presses through `walk-support.ts`, as ever.

import type { Page } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import { E2E_BLOCK } from "./spacetime-harness.mjs";

/** The layer codes drawn in the y-sorted pool (furniture, objects, walls,
 * wall decals): the rows `window.__bc.renderOrder` lists. */
const POOL_LAYERS = [2, 3, 4, 5];

/** The block's cupboard object id, as the module holds it. */
export const BLOCK_CUPBOARD_ID = String(E2E_BLOCK.cupboard.objectId);

/** Stands the player of a loaded page at `(x, y, floor)` and waits for the
 * block's own rows to be drawn around it. */
export async function standInBlock(page: Page, x: number, y: number, floor = 0): Promise<void> {
  await page.waitForFunction(() => typeof window.__bc?.teleport === "function", undefined, {
    timeout: 60_000,
  });
  await page.evaluate(([px, py, pf]) => window.__bc?.teleport?.(px, py, pf), [x, y, floor] as [
    number,
    number,
    number,
  ]);
  // One of the block's own pool rows on that floor, drawn: its chunk has
  // streamed in and been built.
  const sentinel = E2E_BLOCK.placed.find(
    (row: number[]) => row[4] === floor && POOL_LAYERS.includes(row[5] as number),
  );
  const probe = String((sentinel ?? [E2E_BLOCK.cupboard.objectId])[0]);
  await page.waitForFunction((id) => window.__bc?.renderOrder?.includes(id) === true, probe, {
    timeout: 30_000,
  });
}

/** Loads the page, then [`standInBlock`]. */
export async function enterBlock(page: Page, x: number, y: number, floor = 0): Promise<void> {
  await page.goto("/?freezeBodies=1");
  await standInBlock(page, x, y, floor);
}
