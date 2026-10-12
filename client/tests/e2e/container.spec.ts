// Story 6.10 (FR94): one e2e spec for the container view. The fit rule is
// proven in `sim` and the view's geometry in unit tests; this only proves
// the real wiring -- a real click on the street's cupboard opens a view
// bound to it, fed by the rows the server holds for it (seeded through the
// module's own restore path), drawn in world space; walking out of its
// reach closes it.
//
// The view is asserted through `window.__bc.containerView()` (the cell
// rects it draws, from its own view model), never through pixels. The one
// screenshot is left behind for Artie's review.
import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import { ZOOM } from "../../src/render/camera";
import { cellBottomCentre, worldPointPx } from "../../src/render/screen-position";
import {
  CUPBOARD_DEF_ID,
  CUPBOARD_PROP_ID,
  isDefStreetProp,
  STREET_PROPS,
  streetWalkRoute,
} from "../../src/test-street/fixture";
import { committedDefs, streetWalkInputs } from "../unit/test-street/street-world";
import { waitForPlayerControllable } from "./boot-test-support";
import { canvasOf, canvasOffsetForWorldPx } from "./camera-test-support";
import { E2E_CUPBOARD } from "./spacetime-harness.mjs";
import { walkRealSegment } from "./walk-support";

const SHOT_DIR = "test-results/review-shots/story-6.10";

function balance(key: string): number {
  const entry = committedDefs().balance.find((b) => b.key === key);
  if (!entry) throw new Error(`no balance key '${key}'`);
  return entry.value;
}
const TILE_SIZE_PX = balance("render.tile_size_px");
const STOREY_HEIGHT_PX = balance("render.storey_height_px");

function cupboardProp() {
  const prop = STREET_PROPS.find((p) => p.id === CUPBOARD_PROP_ID);
  if (!prop || !isDefStreetProp(prop) || prop.defId !== CUPBOARD_DEF_ID) {
    throw new Error("the street no longer places the cupboard");
  }
  return prop;
}

/** The rects the seeded rows must draw: each item's `bulk`, swapped on an
 * odd orientation, at its seeded slot -- read from `defs/`, never typed. */
function expectedRects() {
  const defs = committedDefs();
  return E2E_CUPBOARD.items
    .map((it: { defId: number; slotX: number; slotY: number; orientation: number }, i: number) => {
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
    .sort(
      (a: { instanceId: string }, b: { instanceId: string }) =>
        Number(a.instanceId) - Number(b.instanceId),
    );
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, {
    timeout: 10_000,
  });
  await waitForPlayerControllable(page, 10_000);
}

test("clicking the cupboard from within reach opens its view; walking away closes it", async ({
  page,
}) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.goto("/");
  await ready(page);
  expect(await page.evaluate(() => window.__bc?.containerView?.() ?? null)).toBeNull();

  // Out of shop A and along the pavement, past the lamppost, then east and
  // up into the cupboard's reach (its `interact_at`, from `defs/`).
  const prop = cupboardProp();
  const inputs = streetWalkInputs();
  for (const segment of streetWalkRoute(inputs).slice(0, 4)) {
    await walkRealSegment(page, segment);
  }
  await walkRealSegment(page, {
    label: "east-to-the-cupboard",
    key: "ArrowRight",
    until: { kind: "x-at-least", value: prop.x - 0.1 },
  });
  await walkRealSegment(page, {
    label: "up-into-reach",
    key: "ArrowUp",
    until: { kind: "y-at-most", value: prop.y + 1.1 },
  });

  // Standing in reach, the cupboard is closed: nothing is drawn above it.
  await page.screenshot({ path: `${SHOT_DIR}/cupboard-closed.png` });

  // A real click on the drawn cupboard.
  const centre = cellBottomCentre(prop.x, prop.y);
  const anchor = worldPointPx(
    centre.x,
    centre.y,
    prop.floor,
    TILE_SIZE_PX,
    STOREY_HEIGHT_PX,
    ZOOM,
    0,
  );
  const at = await canvasOffsetForWorldPx(page, { x: anchor.x, y: anchor.y - TILE_SIZE_PX / 2 });
  await canvasOf(page).click({ position: at });

  // The view opens bound to the cupboard and holds exactly what the server
  // holds for it, at its seeded slots and rotated footprints.
  await page.waitForFunction(() => window.__bc?.containerView?.() != null, undefined, {
    timeout: 10_000,
  });
  const open = await page.evaluate(() => window.__bc?.containerView?.() ?? null);
  expect(open?.objectId).toBe(String(CUPBOARD_PROP_ID));
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
  await walkRealSegment(page, {
    label: "west-out-of-reach",
    key: "ArrowLeft",
    until: { kind: "x-at-most", value: prop.x - 2 },
  });
  await page.waitForFunction(() => window.__bc?.containerView?.() == null, undefined, {
    timeout: 10_000,
  });
  expect(await page.evaluate(() => window.__bc?.stageChildren?.() ?? -1)).toBe(1);
});
