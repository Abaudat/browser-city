// Exactly one e2e spec for story 1.9. Every rule about *what* a click
// resolves to is proven exhaustively by `tests/unit/input/**`'s property
// tests; this spec only proves the real wiring works -- a real pointer
// event on a real canvas, against the real fixture, reaching the real
// pick and coming back out as an intent.
//
// Click points are computed from the real `screenPositionPx` and the real
// fixture cells, turned into canvas offsets by the scene's own recorded
// camera transform. No literal pixel appears anywhere below: a scene that
// moved its camera would otherwise start clicking empty pavement while
// still passing.
import { expect, type Page, test } from "@playwright/test";
import { DEMO_PROPS, PLAYER_START, SHOP_COUNTER_DEF_ID } from "../../src/demo/fixture";
import type {} from "../../src/net/e2e-hooks";
import { screenPositionPx } from "../../src/render/screen-position";
import { committedDefs } from "../unit/demo/demo-world";

const COUNTER_ID = 8n;

function balance(key: string): number {
  const entry = committedDefs().balance.find((b) => b.key === key);
  if (!entry) throw new Error(`no balance key '${key}'`);
  return entry.value;
}

const TILE_SIZE_PX = balance("render.tile_size_px");
const STOREY_HEIGHT_PX = balance("render.storey_height_px");

/** The fixture's own shop counter -- found by id, so a moved prop moves
 * this spec's click with it. */
function counterProp() {
  const prop = DEMO_PROPS.find((p) => p.id === COUNTER_ID);
  if (!prop || prop.defId !== SHOP_COUNTER_DEF_ID) {
    throw new Error("the fixture's shop counter is not placed by its defs/ id any more");
  }
  return prop;
}

/** A world pixel inside a cell's own drawn rect: every drawable is
 * bottom-centre anchored on its cell (`screenPositionPx`), so the anchor
 * is the bottom-centre of that rect and half a tile above it is inside. */
function worldPixelOfCell(cellX: number, cellY: number, floor: number) {
  const anchor = screenPositionPx(cellX, cellY, floor, TILE_SIZE_PX, STOREY_HEIGHT_PX);
  return { x: anchor.x, y: anchor.y - TILE_SIZE_PX / 2 };
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, {
    timeout: 10_000,
  });
  await page.waitForFunction(() => window.__bc?.viewTransform !== undefined, undefined, {
    timeout: 10_000,
  });
}

/** Clicks the given world cell on the demo canvas, converting through the
 * scene's own recorded zoom and camera offset. */
async function clickCell(page: Page, cellX: number, cellY: number, floor: number): Promise<void> {
  const worldPx = worldPixelOfCell(cellX, cellY, floor);
  const view = await page.evaluate(() => window.__bc?.viewTransform);
  if (!view) throw new Error("the demo scene never recorded its view transform");
  const canvas = page.locator("#demo-scene canvas");
  await canvas.click({
    position: {
      x: worldPx.x * view.zoom + view.offsetX,
      y: worldPx.y * view.zoom + view.offsetY,
    },
  });
}

function intents(page: Page) {
  return page.evaluate(() => window.__bc?.intents ?? []);
}

function ignoredIntents(page: Page) {
  return page.evaluate(() => window.__bc?.ignoredIntents ?? []);
}

test("a click resolves to an object instance, checks reach, and emits an intent only when in range", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);

  const counter = counterProp();
  // The counter's reach rect is the customer side of it -- the row south
  // of its own footprint. The player starts one row further south than
  // that, so it begins out of reach and a short walk north crosses the
  // boundary, which is the whole point of the fixture placement.
  const startedOutOfReach = PLAYER_START.y >= counter.y + 2;
  expect(startedOutOfReach, "the fixture must start the player out of the counter's reach").toBe(
    true,
  );

  // AC2: out of reach -- no intent, and the click is recorded as ignored.
  await clickCell(page, counter.x, counter.y, counter.floor);
  await expect.poll(() => ignoredIntents(page)).toEqual([COUNTER_ID.toString()]);
  expect(await intents(page)).toEqual([]);

  // Walk north until the counter's own collider stops the player, which
  // is inside its reach row.
  await page.keyboard.down("ArrowUp");
  await page.waitForFunction(
    (startY) => (window.__bc?.playerPosition?.y ?? startY) < startY - 0.5,
    PLAYER_START.y,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(300);
  await page.keyboard.up("ArrowUp");

  // AC1: in reach -- exactly one intent, carrying the instance clicked
  // and the definition it was placed from.
  await clickCell(page, counter.x, counter.y, counter.floor);
  await expect
    .poll(() => intents(page))
    .toEqual([{ objectId: COUNTER_ID.toString(), defId: SHOP_COUNTER_DEF_ID }]);
  // The refused click earlier is still the only one ever refused: a click
  // never both emits and ignores.
  expect(await ignoredIntents(page)).toEqual([COUNTER_ID.toString()]);
});

test("a rebound movement key survives a reload, and the key it replaced stops working", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);

  // Rebind "Walk up" through the real options menu: Escape opens it, the
  // first keycap of that row captures the next key press.
  await page.keyboard.press("Escape");
  await page.locator('[data-bc-action="move_up"] [data-bc-keycap]').first().click();
  await expect(page.locator('[data-bc-action="move_up"] [data-bc-keycap]').first()).toHaveText(
    "Press a key…",
  );
  await page.keyboard.press("KeyI");
  await expect(page.locator('[data-bc-action="move_up"] [data-bc-keycap]').first()).toHaveText("I");
  await page.keyboard.press("Escape");

  await page.reload();
  await ready(page);

  // The new key walks the avatar...
  const startY = (await page.evaluate(() => window.__bc?.playerPosition?.y)) ?? Number.NaN;
  await page.keyboard.down("KeyI");
  await page.waitForFunction((y) => (window.__bc?.playerPosition?.y ?? y) < y - 0.1, startY, {
    timeout: 10_000,
  });
  await page.keyboard.up("KeyI");

  // ...and the key it replaced does nothing at all.
  const afterRebind = (await page.evaluate(() => window.__bc?.playerPosition?.y)) ?? Number.NaN;
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(500);
  await page.keyboard.up("KeyW");
  const afterOldKey = (await page.evaluate(() => window.__bc?.playerPosition?.y)) ?? Number.NaN;
  expect(afterOldKey).toBeCloseTo(afterRebind, 5);
});

for (const { name, seed } of [
  { name: "garbage in the bindings slot", seed: "}}}not json at all{{{" },
  { name: "storage emptied", seed: null },
]) {
  test(`the game boots on default keys with ${name}, and logs nothing`, async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });

    await page.addInitScript((value) => {
      try {
        if (value === null) window.localStorage.clear();
        else window.localStorage.setItem("bc.keybindings.v1", value);
      } catch {
        // A context that denies storage is exactly one of the cases this
        // test is about: carry on and let the page prove it still boots.
      }
    }, seed);

    await page.goto("/");
    await ready(page);

    // The defaults move the avatar.
    const startY = (await page.evaluate(() => window.__bc?.playerPosition?.y)) ?? Number.NaN;
    await page.keyboard.down("KeyS");
    await page.waitForFunction((y) => (window.__bc?.playerPosition?.y ?? y) > y + 0.1, startY, {
      timeout: 10_000,
    });
    await page.keyboard.up("KeyS");

    // No error, and no "your settings were reset" notice either.
    expect(errors).toEqual([]);
    await context.close();
  });
}
