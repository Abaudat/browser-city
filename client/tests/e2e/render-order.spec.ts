// Quentin's direction: one e2e is acceptable and enough for story 1.6 --
// mounting the committed demo fixture through the real adapter
// (`src/render/pixi-scene.ts`) and reading the resulting ordered id list
// back through the existing DEV-only `window.__bc` hook proves the
// adapter is actually wired to the real display list. The comparator
// itself is proven by `client/tests/unit/render/demo-scene.test.ts`
// against the identical, shared golden -- this spec never re-derives the
// order, it only checks the real page produced it.
import { expect, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import { DEMO_SCENE_GOLDEN_ORDER } from "../unit/render/demo-scene-golden";

test("the demo scene's real, mounted display list produces the committed depth order", async ({ page }) => {
  await page.goto("/");

  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, { timeout: 10_000 });

  const order = await page.evaluate(() => window.__bc?.renderOrder ?? []);
  expect(order).toEqual(DEMO_SCENE_GOLDEN_ORDER);
});
