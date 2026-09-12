// Quentin's direction: one e2e is acceptable and enough for story 1.6 --
// mounting the committed demo fixture through the real adapter
// (`src/demo/scene.ts`) and reading the resulting ordered id list back
// through the existing DEV-only `window.__bc` hook proves the adapter is
// actually wired to the real display list, both at rest and after a real
// keyboard-driven move. The comparator itself is proven by
// `client/tests/unit/demo/drawables.test.ts` against the identical,
// shared goldens -- this spec never re-derives an order, it only checks
// the real page produced it.
import { expect, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import {
  DEMO_SCENE_GOLDEN_ORDER,
  DEMO_SCENE_GOLDEN_ORDER_AFTER_WALKING_SOUTH,
} from "../unit/demo/golden";

test("the demo scene's real, mounted display list produces the committed depth order, at rest and after moving", async ({
  page,
}) => {
  await page.goto("/");

  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, {
    timeout: 10_000,
  });

  const initialOrder = await page.evaluate(() => window.__bc?.renderOrder ?? []);
  expect(initialOrder).toEqual(DEMO_SCENE_GOLDEN_ORDER);

  // Walk south for long enough to reach PLAYER_BOUNDS's clamp -- a
  // deterministic endpoint regardless of exact key-hold timing, so this
  // assertion is never a race against the ticker's frame rate.
  await page.keyboard.down("ArrowDown");
  await page.waitForFunction(
    (expected) => JSON.stringify(window.__bc?.renderOrder) === JSON.stringify(expected),
    DEMO_SCENE_GOLDEN_ORDER_AFTER_WALKING_SOUTH,
    { timeout: 10_000 },
  );
  await page.keyboard.up("ArrowDown");

  const movedOrder = await page.evaluate(() => window.__bc?.renderOrder ?? []);
  expect(movedOrder).toEqual(DEMO_SCENE_GOLDEN_ORDER_AFTER_WALKING_SOUTH);
});
