import { expect, test } from "./fixtures";

test("the generated district draws", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(() => window.__bc?.playerPosition ?? null), {
      timeout: 25_000,
    })
    .not.toBeNull();
  await page.waitForTimeout(2500);
  const pos = await page.evaluate(() => window.__bc?.playerPosition);
  console.log("position", JSON.stringify(pos), JSON.stringify(errors));
  await page.screenshot({ path: "../zz-smoke.png" });
});
