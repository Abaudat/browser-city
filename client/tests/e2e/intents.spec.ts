// Exactly one e2e spec for story 1.9. Every rule about *what* a click
// resolves to is proven exhaustively by `tests/unit/input/**`'s property
// tests; this spec only proves the real wiring works -- a real pointer
// event on a real canvas, against the real fixture, reaching the real
// pick and coming back out as an intent.
//
// Click points are computed from the real `worldPointPx`/`cellBottomCentre`
// and the real fixture cells, turned into canvas offsets by the scene's own
// recorded camera transform. No literal pixel appears anywhere below: a
// scene that moved its camera would otherwise start clicking empty
// pavement while still passing.
import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { KEYBINDINGS_STORAGE_KEY } from "../../src/input/keybindings-storage";
import type {} from "../../src/net/e2e-hooks";
import { ZOOM } from "../../src/render/camera";
import { cellBottomCentre, worldPointPx } from "../../src/render/screen-position";
import { committedDefs } from "../unit/support/committed-defs";
import { waitForPlayerControllable } from "./boot-test-support";
import { canvasOf, canvasOffsetForWorldPx } from "./camera-test-support";
import { arrivalCell, type Interactable, nearestInteractable, walkTo } from "./district-support";
import { expect, test } from "./fixtures";

/** Artie reviews the feel from images, not from a pixel-delta count, so
 * the spec leaves them behind as CI artifacts. */
const SHOT_DIR = "test-results/review-shots/story-1.9";

function balance(key: string): number {
  const entry = committedDefs().balance.find((b) => b.key === key);
  if (!entry) throw new Error(`no balance key '${key}'`);
  return entry.value;
}

const TILE_SIZE_PX = balance("render.tile_size_px");
const STOREY_HEIGHT_PX = balance("render.storey_height_px");
const _SUBCELLS_PER_CELL = committedDefs().colliderSubcellsPerCell;

/** A world pixel inside a cell's own drawn rect: every drawable is
 * bottom-centre anchored on its cell (`cellBottomCentre`, projected
 * through `worldPointPx`), so the anchor is the bottom-centre of that
 * rect and half a tile above it is inside. */
function worldPixelOfCell(cellX: number, cellY: number, floor: number) {
  const centre = cellBottomCentre(cellX, cellY);
  const anchor = worldPointPx(centre.x, centre.y, floor, TILE_SIZE_PX, STOREY_HEIGHT_PX, ZOOM, 0);
  return { x: anchor.x, y: anchor.y - TILE_SIZE_PX / 2 };
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, {
    timeout: 10_000,
  });
  // The camera/viewport story (Quentin's direction): `viewTransform` is
  // live now, updated every frame the camera moves, so its mere
  // existence stopped being a one-shot readiness signal -- the boot mark
  // is what actually promises the scene has mounted and is accepting
  // input.
  await waitForPlayerControllable(page, 10_000);
}

async function clickCell(page: Page, cellX: number, cellY: number, floor: number): Promise<void> {
  const position = await canvasOffsetForWorldPx(page, worldPixelOfCell(cellX, cellY, floor));
  await canvasOf(page).click({ position });
}

async function hoverCell(page: Page, cellX: number, cellY: number, floor: number): Promise<void> {
  const position = await canvasOffsetForWorldPx(page, worldPixelOfCell(cellX, cellY, floor));
  await canvasOf(page).hover({ position });
}

function intents(page: Page) {
  return page.evaluate(() => window.__bc?.intents ?? []);
}

function ignoredIntents(page: Page) {
  return page.evaluate(() => window.__bc?.ignoredIntents ?? []);
}

function highlighted(page: Page) {
  return page.evaluate(() => window.__bc?.highlightedObjectId ?? null);
}

function playerY(page: Page) {
  return page.evaluate(() => window.__bc?.playerPosition?.y ?? Number.NaN);
}

/**
 * Records every value the canvas's own `cursor` ever takes, from inside
 * the page.
 *
 * The refused-click cursor is a ~250 ms transient (`IGNORED_CURSOR_MS`),
 * and sampling for it with `toHaveCSS` is a race that this spec loses the
 * moment the runner is loaded: the first poll crosses a CDP round trip,
 * and if it lands after the blip expired, every later poll sees only the
 * settled value. A `MutationObserver` inside the page cannot miss it --
 * it observes the real element's real style writes, in order, however
 * slow the harness is.
 */
async function recordCursorChanges(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector("#world canvas");
    if (!(canvas instanceof HTMLElement)) throw new Error("no street canvas to observe");
    const seen: string[] = [canvas.style.cursor];
    (window as unknown as { __bcCursors: string[] }).__bcCursors = seen;
    new MutationObserver(() => {
      const current = canvas.style.cursor;
      if (seen[seen.length - 1] !== current) seen.push(current);
    }).observe(canvas, { attributes: true, attributeFilter: ["style"] });
  });
}

function cursorChanges(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __bcCursors?: string[] }).__bcCursors ?? []);
}

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
});

test("a click resolves to an object instance, checks reach, and emits an intent only when in range", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await recordCursorChanges(page);

  // The nearest counter the generator placed, and the cells either side of
  // its reach rect: found in the district, never typed.
  const counter: Interactable = nearestInteractable(arrivalCell());
  const objectId = counter.objectId.toString();
  await walkTo(page, counter.outOfReachCell);

  // Hovering it from out of reach: the cursor says "this is a thing", and
  // withholding the highlight is what says "not from here".
  await hoverCell(page, counter.x, counter.y, counter.floor);
  await expect(canvasOf(page)).toHaveCSS("cursor", "pointer");
  expect(await highlighted(page)).toBeNull();
  await canvasOf(page).screenshot({ path: `${SHOT_DIR}/hover-out-of-reach.png` });

  // AC2: out of reach -- no intent, the click is recorded as ignored, and
  // it is *visibly* ignored: the real canvas element's cursor blips to
  // `not-allowed` and then returns to the hover cursor on its own.
  await clickCell(page, counter.x, counter.y, counter.floor);
  await canvasOf(page).screenshot({ path: `${SHOT_DIR}/refused-click.png` });
  await expect.poll(() => ignoredIntents(page)).toEqual([objectId]);
  expect(await intents(page)).toEqual([]);
  await expect.poll(() => cursorChanges(page)).toContain("not-allowed");
  await expect
    .poll(() => cursorChanges(page).then((seen) => seen[seen.length - 1]), { timeout: 5_000 })
    .toBe("pointer");
  expect((await cursorChanges(page)).filter((c) => c === "not-allowed")).toHaveLength(1);

  // Walk into reach and point at it again (the camera moved with the
  // player, so the same pixel is no longer the counter): the mark appears.
  // That a mark follows a player who walks while the mouse is still is
  // `tests/unit/input/pointer.test.ts`'s `refresh`.
  await walkTo(page, counter.reachCell);
  await hoverCell(page, counter.x, counter.y, counter.floor);
  await expect.poll(() => highlighted(page)).toBe(objectId);
  await canvasOf(page).screenshot({ path: `${SHOT_DIR}/hover-in-reach.png` });

  // AC1: in reach -- exactly one intent, carrying the instance clicked and
  // the definition it was placed from.
  await clickCell(page, counter.x, counter.y, counter.floor);
  await expect.poll(() => intents(page)).toEqual([{ objectId, defId: counter.defId }]);
  // The refused click earlier is still the only one ever refused: a click
  // never both emits and ignores.
  expect(await ignoredIntents(page)).toEqual([objectId]);

  // Walking back out clears the mark again, mouse still untouched: the
  // pointer is left over the counter, and the player is no longer in reach.
  await walkTo(page, counter.outOfReachCell);
  await hoverCell(page, counter.x, counter.y, counter.floor);
  await page.waitForFunction(() => (window.__bc?.highlightedObjectId ?? null) === null, undefined, {
    timeout: 10_000,
  });
});

test("a click on the drawn part of a tall prop hits that prop, not the cell behind it", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);

  // A counter's art is taller than its 1x1 footprint, so its top is drawn a
  // whole cell above its own row -- over the cell behind it. Clicking that
  // part must hit the counter.
  const tall = nearestInteractable(arrivalCell());
  const def = committedDefs().objects.find((o) => o.id === tall.defId);
  expect((def?.sprite?.h ?? 0) > TILE_SIZE_PX * (def?.height ?? 1)).toBe(true);
  await walkTo(page, tall.outOfReachCell);
  const top = worldPixelOfCell(tall.x, tall.y - 1, tall.floor);
  await canvasOf(page).hover({ position: await canvasOffsetForWorldPx(page, top) });
  await canvasOf(page).screenshot({ path: `${SHOT_DIR}/hover-tall-prop.png` });
  await expect(canvasOf(page)).toHaveCSS("cursor", "pointer");

  await canvasOf(page).click({ position: await canvasOffsetForWorldPx(page, top) });
  const seen = await Promise.all([intents(page), ignoredIntents(page)]);
  const id = tall.objectId.toString();
  const touched = seen[0].some((i) => i.objectId === id) || seen[1].includes(id);
  expect(touched, "clicking the drawn top of the counter must resolve to the counter").toBe(true);
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
  await page.screenshot({ path: `${SHOT_DIR}/options-menu-capturing.png` });
  await page.keyboard.press("KeyI");
  await expect(page.locator('[data-bc-action="move_up"] [data-bc-keycap]').first()).toHaveText("I");
  await page.screenshot({ path: `${SHOT_DIR}/options-menu.png` });
  await page.keyboard.press("Escape");

  await page.reload();
  await ready(page);

  // The new key walks the avatar...
  const startY = await playerY(page);
  await page.keyboard.down("KeyI");
  await page.waitForFunction((y) => (window.__bc?.playerPosition?.y ?? y) < y - 0.1, startY, {
    timeout: 10_000,
  });
  await page.keyboard.up("KeyI");

  // ...and the key it replaced does nothing at all. Checked from a
  // position the player can actually walk *south* from, and paired with a
  // positive control: an unchanged binding must still move them, or
  // "nothing happened" would prove nothing (a player pressed against a
  // collider also moves nowhere).
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowDown");

  const beforeOldKey = await playerY(page);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(500);
  await page.keyboard.up("KeyW");
  expect(await playerY(page)).toBeCloseTo(beforeOldKey, 5);

  // Positive control on the same spot: ArrowUp is still bound to
  // move_up, so the avatar does move.
  await page.keyboard.down("ArrowUp");
  await page.waitForFunction((y) => (window.__bc?.playerPosition?.y ?? y) < y - 0.1, beforeOldKey, {
    timeout: 10_000,
  });
  await page.keyboard.up("ArrowUp");
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

    await page.addInitScript(
      ({ key, value }) => {
        try {
          if (value === null) window.localStorage.clear();
          else window.localStorage.setItem(key, value);
        } catch {
          // A context that denies storage is exactly one of the cases
          // this test is about: carry on and let the page prove it still
          // boots.
        }
      },
      // The real key, imported -- seeding a stale one would leave this
      // test passing while testing nothing the moment the key is bumped.
      { key: KEYBINDINGS_STORAGE_KEY, value: seed },
    );

    await page.goto("/");
    await ready(page);

    // The defaults move the avatar.
    const startY = await playerY(page);
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
