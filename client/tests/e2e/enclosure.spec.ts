// Story 1.7's one e2e spec (Quentin's direction): mounting the committed
// demo terrace through the real adapter (`src/demo/scene.ts`) and reading
// FR120/FR121/FR122's visibility state back out of the existing DEV-only
// `window.__bc` hook proves the real, mounted `VisibilityApplier` reaches
// the same states `render/visibility.ts`'s pure `computeVisibility`
// predicts -- this spec never re-derives those states, it only checks the
// real page produced them.
//
// Every wait below is either `renderOrder`/`visibility` becoming
// non-empty (the scene has mounted and applied its first visibility pass)
// or `playerPosition` reaching an exact, real value -- never a fixed
// `waitForTimeout`. The two positions this spec walks to
// (`lamppostRestY()`, the subway's own landing/up-anchor cells) are real
// collider rests or real transition-anchor cells, not guessed distances;
// `movement.spec.ts` already proves the first of those is reached this
// way. No hook here ever sets the player's floor directly (Quentin's
// direction) -- the walk always goes through the real keyboard and the
// real `world/transitions.ts` port.
import { expect, type Page, test } from "@playwright/test";
import { PLATFORM_LANDING_X, PLATFORM_LANDING_Y, STAIRS_X, STAIRS_Y } from "../../src/demo/fixture";
import type {} from "../../src/net/e2e-hooks";
import { lamppostRestY } from "../unit/demo/demo-world";

async function waitForSceneReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, {
    timeout: 15_000,
  });
  await page.waitForFunction(
    () => Object.keys(window.__bc?.visibility ?? {}).length > 0,
    undefined,
    { timeout: 15_000 },
  );
}

function visibilityOf(page: Page, stableId: string): Promise<string | undefined> {
  return page.evaluate((id) => window.__bc?.visibility?.[id], stableId);
}

test.describe("story 1.7: enclosure visibility", () => {
  test("at rest inside shop A: its own near walls and window are hidden, shop B is untouched, and the subway is culled", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForSceneReady(page);

    // Shop A's front wall segments (ids 2/3) and its window (id 6) --
    // near-side, owned by the building the player starts inside.
    expect(await visibilityOf(page, "2")).toBe("hidden");
    expect(await visibilityOf(page, "3")).toBe("hidden");
    expect(await visibilityOf(page, "6")).toBe("hidden"); // retraction wins over the window rule

    // Shop B's own front wall (ids 31/33) and window (id 32) stay exactly
    // as they are -- per-enclosure, not per-terrace (AC4).
    expect(await visibilityOf(page, "31")).toBe("normal");
    expect(await visibilityOf(page, "33")).toBe("normal");
    expect(await visibilityOf(page, "32")).toBe("translucent");

    // The subway platform (floor -1) is culled entirely from the street.
    expect(await visibilityOf(page, "60")).toBe("hidden"); // platform north wall
    expect(await visibilityOf(page, "61")).toBe("hidden"); // platform south wall
    expect(await visibilityOf(page, "64")).toBe("hidden"); // platform bench

    // The street-level stairwell prop itself is a plain, visible object.
    expect(await visibilityOf(page, "50")).toBe("normal");
  });

  test("walking out of shop A reopens it: the window reads translucent and the furniture behind it is visible", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForSceneReady(page);

    const restY = lamppostRestY();
    await page.keyboard.down("ArrowDown");
    await page.waitForFunction(
      (expected) => (window.__bc?.playerPosition?.y ?? 0) >= expected - 0.01,
      restY,
      { timeout: 15_000 },
    );
    await page.keyboard.up("ArrowDown");
    // The visibility hook only fires when the player's own cell changes
    // (Tim's direction) -- wait for the real, event-driven update rather
    // than a fixed delay.
    await page.waitForFunction(() => window.__bc?.visibility?.["2"] !== "hidden", undefined, {
      timeout: 15_000,
    });

    expect(await visibilityOf(page, "2")).toBe("normal");
    expect(await visibilityOf(page, "3")).toBe("normal");
    expect(await visibilityOf(page, "6")).toBe("translucent"); // the window, from outside
    expect(await visibilityOf(page, "9")).toBe("normal"); // the table behind it, visible through the glass

    // Shop B was never entered -- unaffected throughout.
    expect(await visibilityOf(page, "31")).toBe("normal");
    expect(await visibilityOf(page, "32")).toBe("translucent");
  });

  test("entering the subway culls the street and reveals the platform; leaving it reverses that", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForSceneReady(page);

    const restY = lamppostRestY();
    await page.keyboard.down("ArrowDown");
    await page.waitForFunction(
      (expected) => (window.__bc?.playerPosition?.y ?? 0) >= expected - 0.01,
      restY,
      { timeout: 15_000 },
    );
    await page.keyboard.up("ArrowDown");

    // The stairwell shares the lamppost's own row (`STAIRS_Y`, `fixture.ts`'s
    // own doc comment) -- a pure east walk reaches its anchor cell with no
    // direction change. It has no collider (never a teleport tile): the
    // transition fires the moment the player's own cell matches
    // `(STAIRS_X, STAIRS_Y)`, landing at a real, predictable position.
    const landingX = PLATFORM_LANDING_X + 0.5;
    const landingY = PLATFORM_LANDING_Y + 0.5;
    await page.keyboard.down("ArrowRight");
    await page.waitForFunction(
      ({ x, y }) => {
        const pos = window.__bc?.playerPosition;
        return !!pos && Math.abs(pos.x - x) < 0.01 && Math.abs(pos.y - y) < 0.01;
      },
      { x: landingX, y: landingY },
      { timeout: 15_000 },
    );
    await page.keyboard.up("ArrowRight");
    await page.waitForFunction(() => window.__bc?.visibility?.["60"] !== "hidden", undefined, {
      timeout: 15_000,
    });

    // The street floor, including its own stairwell prop, is culled
    // entirely (FR122).
    expect(await visibilityOf(page, "1")).toBe("hidden"); // shop A's own north wall
    expect(await visibilityOf(page, "11")).toBe("hidden"); // the awning
    expect(await visibilityOf(page, "50")).toBe("hidden"); // the street-level stairwell prop
    // The platform itself is now revealed.
    expect(await visibilityOf(page, "60")).toBe("normal");
    expect(await visibilityOf(page, "61")).toBe("normal");
    expect(await visibilityOf(page, "64")).toBe("normal"); // the bench

    // Walking north from the landing reaches the up-stairs' own anchor,
    // one cell further in (`fixture.ts`'s `PLATFORM_UP_ANCHOR_X/Y`) --
    // landing back exactly where the player went down.
    const streetX = STAIRS_X + 0.5;
    const streetY = STAIRS_Y + 0.5;
    await page.keyboard.down("ArrowUp");
    await page.waitForFunction(
      ({ x, y }) => {
        const pos = window.__bc?.playerPosition;
        return !!pos && Math.abs(pos.x - x) < 0.01 && Math.abs(pos.y - y) < 0.01;
      },
      { x: streetX, y: streetY },
      { timeout: 15_000 },
    );
    await page.keyboard.up("ArrowUp");
    await page.waitForFunction(() => window.__bc?.visibility?.["60"] === "hidden", undefined, {
      timeout: 15_000,
    });

    expect(await visibilityOf(page, "1")).toBe("normal");
    expect(await visibilityOf(page, "50")).toBe("normal");
    expect(await visibilityOf(page, "60")).toBe("hidden");
    expect(await visibilityOf(page, "64")).toBe("hidden");
  });
});
