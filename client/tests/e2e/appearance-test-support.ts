// Shared by `appearance.spec.ts` -- the wait every appearance e2e test
// needs before touching the mounted scene: the crowd's own texture
// identities, the pixel-compare hook, and the camera transform are all
// recorded once, right after mount.
import type { Page } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";

export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Object.keys(window.__bc?.appearanceTextureIds ?? {}).length > 0,
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForFunction(() => window.__bc?.appearanceCompare !== undefined, undefined, {
    timeout: 20_000,
  });
  await page.waitForFunction(() => window.__bc?.viewTransform !== undefined, undefined, {
    timeout: 20_000,
  });
}
