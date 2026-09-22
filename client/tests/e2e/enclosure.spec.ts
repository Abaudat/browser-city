// Story 1.7's one e2e spec (Quentin's direction): mounting the committed
// street terrace through the real adapter (`src/test-street/scene.ts`) and reading
// FR120/FR121/FR122's visibility state back out of the existing DEV-only
// `window.__bc` hook proves the real, mounted `VisibilityApplier` reaches
// the same states `render/visibility.ts`'s pure `computeVisibility`
// predicts. It compares against the exact same goldens
// `tests/unit/test-street/drawables.test.ts` asserts from the pure functions
// directly (Quentin's direction, cycle 2) -- this spec never re-derives a
// state on its own, and `window.__bc.visibility`/`visibilityAlpha` are
// built in `scene.ts` from each pool member's own real, just-written
// `sprite.visible`/`sprite.alpha`, never a second recomputed
// `computeVisibility` call in the page itself.
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
import type {} from "../../src/net/e2e-hooks";
import {
  PLATFORM_LANDING_X,
  PLATFORM_LANDING_Y,
  PLAYER_START,
  STREET_EXIT_X,
  STREET_EXIT_Y,
  type StreetWalkSegment,
  streetWalkRoute,
} from "../../src/test-street/fixture";
import {
  STREET_VISIBILITY_AT_LAMPPOST_OUTSIDE,
  STREET_VISIBILITY_AT_REST_IN_SHOP_A,
  STREET_VISIBILITY_ON_SUBWAY_LANDING,
} from "../unit/test-street/golden";
import { shopfrontExitRestY, streetWalkInputs } from "../unit/test-street/street-world";

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

function currentVisibility(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => window.__bc?.visibility ?? {});
}

/** `render.window_alpha` as the same `(0, 1)` fraction `scene.ts` applies
 * as `sprite.alpha` -- read from the same fetched document the page
 * itself loads, never a literal restated in this spec. */
async function windowAlphaFraction(page: Page): Promise<number> {
  const percent = await page.evaluate(async () => {
    const defs = (await (await fetch("/defs/defs.json")).json()) as {
      balance: { key: string; value: number }[];
    };
    const entry = defs.balance.find((b) => b.key === "render.window_alpha");
    if (!entry) throw new Error("render.window_alpha missing from fetched defs.json");
    return entry.value;
  });
  return percent / 100;
}

async function walkTo(
  page: Page,
  key: "ArrowDown" | "ArrowRight" | "ArrowUp" | "ArrowLeft",
  target: { x: number; y: number },
): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForFunction(
    ({ x, y }) => {
      const pos = window.__bc?.playerPosition;
      return !!pos && Math.abs(pos.x - x) < 0.01 && Math.abs(pos.y - y) < 0.01;
    },
    target,
    { timeout: 15_000 },
  );
  await page.keyboard.up(key);
}

/** Holds a segment's own key through real, OS-level `page.keyboard` input
 * until its own `until` is met against the real, live `window.__bc`
 * state, then releases -- the exact same `StreetWalkSegment` shape and
 * release conditions `streetWalkRoute` declares once and
 * `street-conformance.test.ts` already proves collision-feasible under
 * real release lag, never a second, hand-rolled "east then south"
 * sequence of this spec's own that could quietly drift from it (story
 * 15.2, cycle 2, Quentin's finding 3: the lamppost's own approach is a
 * waypoint now, not a rest, so a shorter, two-step version of this same
 * walk risks missing the lamppost's own real collider on a slow round
 * trip -- `streetWalkRoute`'s own extra segments around it are exactly
 * what already survive that, proven at unit level). */
async function walkRealSegment(page: Page, segment: StreetWalkSegment): Promise<void> {
  await page.keyboard.down(segment.key);
  await page.waitForFunction(
    (until) => {
      const pos = window.__bc?.playerPosition;
      const floor = window.__bc?.playerFloor;
      if (!pos || floor === undefined) return false;
      switch (until.kind) {
        case "x-at-least":
          return pos.x >= until.value;
        case "x-at-most":
          return pos.x <= until.value;
        case "y-at-least":
          return pos.y >= until.value;
        case "y-at-most":
          return pos.y <= until.value;
        case "floor":
          return floor === until.value;
        case "cell":
          return Math.floor(pos.x) === until.x && Math.floor(pos.y) === until.y;
      }
    },
    segment.until,
    { timeout: 15_000 },
  );
  await page.keyboard.up(segment.key);
}

test.describe("story 1.7: enclosure visibility", () => {
  test("at rest inside shop A matches the committed visibility golden, every mounted sprite's mask is null, and a translucent sprite's alpha is render.window_alpha", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForSceneReady(page);

    expect(await currentVisibility(page)).toEqual(STREET_VISIBILITY_AT_REST_IN_SHOP_A);

    // FR121's "no masking or aperture system" acceptance criterion,
    // proven against the real, mounted display list (Tim's direction) --
    // never only by `scripts/ci/check-no-masks.sh`'s source-level grep.
    await page.waitForFunction(() => window.__bc?.masksAllNull !== undefined, undefined, {
      timeout: 15_000,
    });
    expect(await page.evaluate(() => window.__bc?.masksAllNull)).toBe(true);

    // Shop B's window (id 32) is translucent from shop A -- its real,
    // just-written sprite alpha must equal the resolved balance value,
    // not merely be "some value less than 1".
    const windowAlpha = await windowAlphaFraction(page);
    const alpha = await page.evaluate(() => window.__bc?.visibilityAlpha?.["32"]);
    expect(alpha).toBeCloseTo(windowAlpha, 5);

    // FR122's flat-pass culling (Tim's cycle-2 direction): the street's
    // own ground pass must be visible from the street, and the subway's
    // own ground pass must not -- proven against the real, mounted
    // ground-tile containers, not only the sorted pool.
    const groundVisibility = await currentVisibility(page);
    expect(groundVisibility["ground:0"]).toBe("normal");
    expect(groundVisibility["ground:-1"]).toBe("hidden");

    // The FR120 wall-stub companion's own inverse rule (Artie's cycle-2
    // finding): while shop A's own near-side wall/window/pier (2, 6, 40)
    // are retracted (drawn `hidden`), their stub companions must be the
    // ones left on screen -- and shop B's own front, still fully drawn,
    // must keep its stubs hidden behind it.
    expect(groundVisibility["500002"]).toBe("normal"); // parent 2 retracted
    expect(groundVisibility["500006"]).toBe("normal"); // parent 6 retracted
    expect(groundVisibility["500040"]).toBe("normal"); // parent 40 retracted
    expect(groundVisibility["500032"]).toBe("hidden"); // parent 32 (shop B) not retracted
    expect(groundVisibility["500041"]).toBe("hidden"); // parent 41 (shop B) not retracted
  });

  test("walking out of shop A onto the pavement matches the committed outside golden", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForSceneReady(page);

    // `computeVisibility` only ever reads the viewer's own `(floor,
    // buildingId)`, never its exact position (the subway test below's own
    // comment says so too), so any real position outside the shop gives
    // the same golden -- `shopfrontExitRestY()`, the real trash-bin rest a
    // straight south walk out of the door reaches (story 15.2, cycle 2,
    // Quentin's finding 3, `shopfrontExitRestY`'s own doc comment says
    // why).
    await walkTo(page, "ArrowDown", { x: PLAYER_START.x, y: shopfrontExitRestY() });
    // The visibility hook only fires when the player's own cell changes
    // (Tim's direction) -- wait for the real, event-driven update rather
    // than a fixed delay.
    await page.waitForFunction(() => window.__bc?.visibility?.["2"] !== "hidden", undefined, {
      timeout: 15_000,
    });

    expect(await currentVisibility(page)).toEqual(STREET_VISIBILITY_AT_LAMPPOST_OUTSIDE);
  });

  test("entering the subway culls the street and reveals the platform; leaving it reverses that", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForSceneReady(page);

    // Onto the pavement, all the way to the underpass checkpoint's own
    // south rest -- `streetWalkRoute`'s own first nine segments, real
    // OS-level keyboard input driving the exact same release conditions
    // `street-conformance.test.ts` already proves collision-feasible
    // under real release lag (`walkRealSegment`'s own doc comment says
    // why this spec reuses them rather than a shorter, hand-rolled
    // version). This lands east of the stairwell, on the subway's own
    // one open side (`STAIRS_ENTRY_DIRECTION`'s own doc comment: "a
    // stairwell has one top and one bottom" -- approaching from the west
    // instead, straight down the lamppost's own row, walks into the
    // stairwell's own real, blocked west face and never arrives at all).
    for (const segment of streetWalkRoute(streetWalkInputs()).slice(0, 9)) {
      await walkRealSegment(page, segment);
    }

    // The demo's own reported entry (issue #310): walking left (west)
    // into the stairs. It has no collider (never a teleport tile): the
    // transition fires the moment the player's own cell matches
    // `(STAIRS_X, STAIRS_Y)`, landing at a real, predictable position.
    await walkTo(page, "ArrowLeft", {
      x: PLATFORM_LANDING_X + 0.5,
      y: PLATFORM_LANDING_Y + 0.5,
    });
    await page.waitForFunction(() => window.__bc?.visibility?.["60"] !== "hidden", undefined, {
      timeout: 15_000,
    });

    const platformVisibility = await currentVisibility(page);
    expect(platformVisibility).toEqual(STREET_VISIBILITY_ON_SUBWAY_LANDING);
    // FR122's flat-pass culling, the reverse of the street shot above:
    // the subway's own ground pass is now visible, the street's is not.
    expect(platformVisibility["ground:-1"]).toBe("normal");
    expect(platformVisibility["ground:0"]).toBe("hidden");

    // Story 15.2: the reverse input (`ArrowRight`, the mirror of the
    // `ArrowLeft` that walked down) climbs straight back up -- no detour
    // through an unrelated direction. Walking east from the landing
    // reaches the up-stairs' own anchor, one cell further in (`fixture.ts`'s
    // `PLATFORM_UP_ANCHOR_X/Y`, the landing's own mirror per
    // `world/transitions.ts`'s `checkTransitionPairSymmetry`), and lands
    // one cell beside the stairwell (`STREET_EXIT_X/Y`) -- never the down
    // anchor's own cell, which would re-trigger the descent the instant a
    // still-held key is checked against it again.
    await walkTo(page, "ArrowRight", { x: STREET_EXIT_X + 0.5, y: STREET_EXIT_Y + 0.5 });
    await page.waitForFunction(() => window.__bc?.visibility?.["60"] === "hidden", undefined, {
      timeout: 15_000,
    });

    // Back on the street, outside any building (`STREET_EXIT_X/Y` is
    // plain pavement) -- `computeVisibility` only ever reads the viewer's
    // own `(floor, buildingId)`, never its exact position, so this is the
    // identical state the "walked out onto the pavement" golden above is.
    expect(await currentVisibility(page)).toEqual(STREET_VISIBILITY_AT_LAMPPOST_OUTSIDE);
  });
});
