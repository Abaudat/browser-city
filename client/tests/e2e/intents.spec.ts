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
import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { KEYBINDINGS_STORAGE_KEY } from "../../src/input/keybindings-storage";
import type {} from "../../src/net/e2e-hooks";
import { screenPositionPx } from "../../src/render/screen-position";
import {
  isDefStreetProp,
  PLAYER_START,
  SHOP_COUNTER_DEF_ID,
  STREET_PROPS,
  TRASH_BIN_DEF_ID,
} from "../../src/test-street/fixture";
import { committedDefs } from "../unit/test-street/street-world";
import { waitForPlayerControllable } from "./boot-test-support";
import { canvasOf, canvasOffsetForWorldPx } from "./camera-test-support";

const COUNTER_ID = 8n;
const BIN_ID = 15n;

/** Artie reviews the feel from images, not from a pixel-delta count, so
 * the spec leaves them behind as CI artifacts. */
const SHOT_DIR = "test-results/story-1.9-shots";

function balance(key: string): number {
  const entry = committedDefs().balance.find((b) => b.key === key);
  if (!entry) throw new Error(`no balance key '${key}'`);
  return entry.value;
}

const TILE_SIZE_PX = balance("render.tile_size_px");
const STOREY_HEIGHT_PX = balance("render.storey_height_px");
const SUBCELLS_PER_CELL = committedDefs().colliderSubcellsPerCell;

/** One of the fixture's own props, found by id, so a moved prop moves
 * this spec's clicks with it. */
function propById(id: bigint, expectedDefId: number) {
  const prop = STREET_PROPS.find((p) => p.id === id);
  if (!prop || !isDefStreetProp(prop) || prop.defId !== expectedDefId) {
    throw new Error(`fixture prop ${id} is no longer placed by defs id ${expectedDefId}`);
  }
  return prop;
}

/** The `interact_at` rect `defs/` declares for a definition -- the reach
 * row this spec waits for is read from that, never from a literal. */
function interactAtOf(defId: number) {
  const def = committedDefs().objects.find((o) => o.id === defId);
  if (!def?.interactAt) throw new Error(`defs object ${defId} declares no interact_at`);
  return def.interactAt;
}

/** A world pixel inside a cell's own drawn rect: every drawable is
 * bottom-centre anchored on its cell (`screenPositionPx`), so the anchor
 * is the bottom-centre of that rect and half a tile above it is inside. */
function worldPixelOfCell(cellX: number, cellY: number, floor: number) {
  const anchor = screenPositionPx(cellX, cellY, floor, TILE_SIZE_PX, STOREY_HEIGHT_PX, 1);
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
    const canvas = document.querySelector("#test-street canvas");
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

/** Walks the player north until their feet are inside `defId`'s own reach
 * row, read from `defs/` -- never a fixed "settle" sleep, which is what
 * flakes on a loaded runner. */
async function walkIntoReachOf(page: Page, anchorY: number, defId: number): Promise<void> {
  const reach = interactAtOf(defId);
  const reachTopCells = anchorY + reach.y0 / SUBCELLS_PER_CELL;
  const reachBottomCells = anchorY + reach.y1 / SUBCELLS_PER_CELL;
  await page.keyboard.down("ArrowUp");
  await page.waitForFunction(
    ({ top, bottom }) => {
      const y = window.__bc?.playerPosition?.y;
      return y !== undefined && y >= top && y < bottom;
    },
    { top: reachTopCells, bottom: reachBottomCells },
    { timeout: 10_000 },
  );
  await page.keyboard.up("ArrowUp");
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

  const counter = propById(COUNTER_ID, SHOP_COUNTER_DEF_ID);
  // The counter's reach rect is the customer side of it -- the row south
  // of its own footprint. The player starts one row further south than
  // that, so it begins out of reach and a short walk north crosses the
  // boundary, which is the whole point of the fixture placement.
  expect(
    PLAYER_START.y >= counter.y + 2,
    "the fixture must start the player out of the counter's reach",
  ).toBe(true);

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
  await expect.poll(() => ignoredIntents(page)).toEqual([COUNTER_ID.toString()]);
  expect(await intents(page)).toEqual([]);

  // The blip happened at all...
  await expect.poll(() => cursorChanges(page)).toContain("not-allowed");
  // ...and it ended by itself, without a second click or a mouse move.
  // The *settled* value is not a transient, so waiting for it is not a
  // race.
  await expect
    .poll(() => cursorChanges(page).then((seen) => seen[seen.length - 1]), {
      // A fixed, generous wait rather than a multiple of the dial: how
      // long this spec is willing to wait for a settled value is about
      // the harness, and tuning `IGNORED_CURSOR_MS` down must never
      // shorten it into a race.
      timeout: 5_000,
    })
    .toBe("pointer");
  // It never pulses: the refusal is shown exactly once per refused click.
  expect((await cursorChanges(page)).filter((c) => c === "not-allowed")).toHaveLength(1);

  // Walk into reach *without moving the mouse*: the affordance has to
  // follow the player, since movement is keyboard-only.
  await walkIntoReachOf(page, counter.y, SHOP_COUNTER_DEF_ID);
  await expect.poll(() => highlighted(page)).toBe(COUNTER_ID.toString());
  await canvasOf(page).screenshot({ path: `${SHOT_DIR}/hover-in-reach.png` });

  // AC1: in reach -- exactly one intent, carrying the instance clicked
  // and the definition it was placed from.
  await clickCell(page, counter.x, counter.y, counter.floor);
  await expect
    .poll(() => intents(page))
    .toEqual([{ objectId: COUNTER_ID.toString(), defId: SHOP_COUNTER_DEF_ID }]);
  // The refused click earlier is still the only one ever refused: a click
  // never both emits and ignores.
  expect(await ignoredIntents(page)).toEqual([COUNTER_ID.toString()]);

  // Walking back out clears the mark again, mouse still untouched.
  await page.keyboard.down("ArrowDown");
  await page.waitForFunction(() => (window.__bc?.highlightedObjectId ?? null) === null, undefined, {
    timeout: 10_000,
  });
  await page.keyboard.up("ArrowDown");
});

test("a click on the drawn part of a tall prop hits that prop, not the cell behind it", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);

  // The bin's art is 16x32 on a 1x1 footprint, so its lid is drawn a
  // whole cell above its own row -- over the pavement behind it. Clicking
  // the lid must hit the bin.
  const bin = propById(BIN_ID, TRASH_BIN_DEF_ID);
  const lid = worldPixelOfCell(bin.x, bin.y - 1, bin.floor);
  await canvasOf(page).hover({ position: await canvasOffsetForWorldPx(page, lid) });
  await canvasOf(page).screenshot({ path: `${SHOT_DIR}/hover-bin-lid.png` });
  await expect(canvasOf(page)).toHaveCSS("cursor", "pointer");

  await canvasOf(page).click({ position: await canvasOffsetForWorldPx(page, lid) });
  const seen = await Promise.all([intents(page), ignoredIntents(page)]);
  const touchedTheBin =
    seen[0].some((i) => i.objectId === BIN_ID.toString()) || seen[1].includes(BIN_ID.toString());
  expect(touchedTheBin, "clicking the drawn lid of the bin must resolve to the bin").toBe(true);
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
