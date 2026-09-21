// Shared by `appearance.spec.ts` -- the wait every appearance e2e test
// needs before touching the mounted scene: the crowd's own texture
// identities and the pixel-compare hook are recorded once, right after
// mount.
import type { Page } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import { waitForPlayerControllable } from "./boot-test-support";

export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Object.keys(window.__bc?.appearanceTextureIds ?? {}).length > 0,
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForFunction(() => window.__bc?.appearanceCompare !== undefined, undefined, {
    timeout: 20_000,
  });
  // The camera/viewport story (Quentin's direction): `viewTransform` is
  // live now -- it updates every frame the camera moves, from the first
  // frame on -- so its mere existence stopped being a one-shot readiness
  // signal. The boot mark is: it fires exactly once, after the scene has
  // genuinely mounted and the ticker is running.
  await waitForPlayerControllable(page);
}
