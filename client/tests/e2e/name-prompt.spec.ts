// Story 4.6 (FR144, FR145, FR177): the name prompt is the page. These specs
// drive it the way a player does and hold three standing claims: it is
// usable before any game asset arrives (proven by starvation, not timing),
// nothing new is fetched between submit and controllable, and the player
// arrives in the flat with no ceremony. Deterministic -- no wall-clock
// bound here; the timing gate is `boot-budget/boot-budget.spec.ts`'s.
import { BOOT_MARK } from "../../src/boot/boot-marks";
import type {} from "../../src/net/e2e-hooks";
import { HOME_FLAT_SPAWN } from "../../src/test-street/fixture";
import { waitForPlayerControllable } from "./boot-test-support";
import { expect, test } from "./fixtures";
import { ownerSql, readSpacetimeHandle } from "./spacetime-harness.mjs";

// The prompt is driven by hand, and the player arrives where a new character
// really does: the home flat.
test.use({ arrive: false, startAt: "home" });

const PROMPT = '[data-bc-surface="name-prompt"]';

test("zero game assets at first paint: the prompt is visible, focused, takes typing and accepts Enter while every other request is held", async ({
  page,
}) => {
  const held: (() => Promise<void>)[] = [];
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "document") {
      await route.continue();
      return;
    }
    held.push(() => route.continue());
  });

  await page.goto("/", { waitUntil: "commit" });
  const input = page.locator(`${PROMPT} input`);
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  // The browser's own paint entry: first contentful paint exists with
  // every game asset still held.
  await page.waitForFunction(
    () => performance.getEntriesByType("paint").some((e) => e.name === "first-contentful-paint"),
    undefined,
    { timeout: 10_000 },
  );

  await page.keyboard.type("Wasd");
  await expect(input).toHaveValue("Wasd");
  await page.keyboard.press("Enter");
  // The submit was held, not lost and not a navigation: still this page,
  // still showing what was typed.
  await expect(input).toHaveValue("Wasd");
  expect(page.url()).toMatch(/\/$/);

  // Release everything: the held submit goes through with no retyping.
  for (const release of held.splice(0)) await release();
  await page.unroute("**/*");
  await waitForPlayerControllable(page);
  await expect(page.locator(PROMPT)).toHaveCount(0);

  await expect
    .poll(() => page.evaluate(() => window.__bc?.character?.characterId), { timeout: 10_000 })
    .toBeTruthy();
});

test("typing wasd into the name never walks the body", async ({ page }) => {
  await page.goto("/");
  const input = page.locator(`${PROMPT} input`);
  await expect(input).toBeFocused();
  await page.waitForFunction(() => window.__bc?.playerPosition !== undefined);
  const before = await page.evaluate(() => window.__bc?.playerPosition);
  await page.keyboard.type("wasdwasd");
  await expect(input).toHaveValue("wasdwasd");
  const after = await page.evaluate(() => window.__bc?.playerPosition);
  expect(after).toEqual(before);
});

test("an empty submit does nothing: no message, the field stays", async ({ page }) => {
  await page.goto("/");
  const input = page.locator(`${PROMPT} input`);
  await expect(input).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.type("   ");
  await page.keyboard.press("Enter");
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  expect(await page.locator(PROMPT).innerText()).toBe("");
  const marks = await page.evaluate(
    () => performance.getEntriesByName("bc-boot:name-submitted").length,
  );
  expect(marks).toBe(0);
});

test("after submit nothing new is fetched before the player is controllable, and the player stands in the flat", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.locator(`${PROMPT} input`);
  await expect(input).toBeFocused();
  // The world streams while the player types: let it all settle first.
  await page.waitForFunction(
    (name) => performance.getEntriesByName(name).length > 0,
    BOOT_MARK.FIRST_FRAME_RENDERED,
    { timeout: 30_000 },
  );
  await page.waitForLoadState("networkidle");

  const started: string[] = [];
  page.on("request", (request) => {
    const type = request.resourceType();
    if (["image", "script", "fetch", "xhr", "stylesheet", "font"].includes(type)) {
      started.push(`${type} ${request.url()}`);
    }
  });

  await page.keyboard.type("Sam");
  await page.keyboard.press("Enter");
  await waitForPlayerControllable(page);
  expect(started, `fetched after submit:\n${started.join("\n")}`).toEqual([]);

  // The first position is the flat's, not a street spawn.
  const position = await page.evaluate(() => window.__bc?.playerPosition);
  expect(position?.x).toBeCloseTo(HOME_FLAT_SPAWN.x, 1);
  expect(position?.y).toBeCloseTo(HOME_FLAT_SPAWN.y, 1);

  // ...and the authority agrees: once the sender has sent, the server's own
  // row for this character is in the flat (not the client's belief).
  const characterId = await page.evaluate(() => window.__bc?.character?.characterId);
  await expect
    .poll(
      () =>
        ownerSql(
          readSpacetimeHandle(),
          `SELECT * FROM player_position WHERE character_id = ${characterId}`,
        )[0],
      { timeout: 10_000 },
    )
    .toBeDefined();
  const row = ownerSql(
    readSpacetimeHandle(),
    `SELECT * FROM player_position WHERE character_id = ${characterId}`,
  )[0] as string[];
  // Columns: character_id, chunk_key, x, y, floor, frac_x, frac_y, updated_at.
  const [x, y, fl, fx, fy] = [row[2], row[3], row[4], row[5], row[6]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  expect(x + (fx as number) / 256).toBeCloseTo(HOME_FLAT_SPAWN.x, 1);
  expect(y + (fy as number) / 256).toBeCloseTo(HOME_FLAT_SPAWN.y, 1);
  expect(fl).toBe(HOME_FLAT_SPAWN.floor);

  // No ceremony: the prompt is gone from the DOM and a key moves the body.
  await expect(page.locator(PROMPT)).toHaveCount(0);
  const before = await page.evaluate(() => window.__bc?.playerPosition);
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(200);
  await page.keyboard.up("KeyD");
  const after = await page.evaluate(() => window.__bc?.playerPosition);
  expect(after?.x).toBeGreaterThan(before?.x ?? Number.POSITIVE_INFINITY);
});

test("the character is created with the submitted name, trimmed", async ({ page }) => {
  await page.goto("/");
  await page.locator(`${PROMPT} input`).fill("  Zoë  ");
  await page.keyboard.press("Enter");
  await waitForPlayerControllable(page);
  await expect
    .poll(() => page.evaluate(() => window.__bc?.character?.name), { timeout: 10_000 })
    .toBe("Zoë");
});

test("a return visit is never asked again: the prompt is never displayed, and the player is controllable", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(`${PROMPT} input`).fill("Sam");
  await page.keyboard.press("Enter");
  await waitForPlayerControllable(page);
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("bc.arrived.v1")))
    .not.toBeNull();

  // Watched from before the document exists, every frame.
  await page.addInitScript(() => {
    (window as unknown as { __promptShown: boolean }).__promptShown = false;
    const look = () => {
      const form = document.querySelector('[data-bc-surface="name-prompt"]');
      if (form && getComputedStyle(form).display !== "none") {
        (window as unknown as { __promptShown: boolean }).__promptShown = true;
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await page.reload();
  await waitForPlayerControllable(page);
  expect(
    await page.evaluate(() => (window as unknown as { __promptShown: boolean }).__promptShown),
  ).toBe(false);
});
