// Shared between `appearance.spec.ts` and `appearance-screenshots.spec.ts`
// -- the wait every appearance e2e test needs before touching the mounted
// scene: the crowd's own texture identities, the pixel-compare hook, and
// the camera transform are all recorded once, right after mount.
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

export function canvasOf(page: Page) {
  return page.locator("#demo-scene canvas");
}

/** Converts a world pixel (`screenPositionPx`'s own output) to the canvas
 * offset to screenshot or click at, through the scene's own recorded
 * camera transform -- the same conversion `intents.spec.ts` uses, so a
 * crop never drifts out of step with a moved camera. */
export async function canvasOffset(
  page: Page,
  worldPx: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const view = await page.evaluate(() => window.__bc?.viewTransform);
  if (!view) throw new Error("the demo scene never recorded its view transform");
  return { x: worldPx.x * view.zoom + view.offsetX, y: worldPx.y * view.zoom + view.offsetY };
}

/** A `width`x`height` clip centred on `(centreX, centreY)` within
 * `canvasBox`, biased so a bottom-anchored sprite's own body sits mostly
 * in frame rather than split at the edge, then clamped to stay entirely
 * inside `canvasBox` -- a subject standing close to the world's own edge
 * (the crowd's own pavement strip starts at `x = 0`) would otherwise
 * request a clip that starts off-canvas, which Playwright silently
 * renders wrong rather than erroring on. */
export function centredClip(
  canvasBox: { x: number; y: number; width: number; height: number },
  centreX: number,
  centreY: number,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const rawX = canvasBox.x + centreX - width / 2;
  const rawY = canvasBox.y + centreY - height * 0.75;
  const minX = canvasBox.x;
  const maxX = canvasBox.x + canvasBox.width - width;
  const minY = canvasBox.y;
  const maxY = canvasBox.y + canvasBox.height - height;
  return {
    x: Math.min(Math.max(rawX, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(rawY, minY), Math.max(minY, maxY)),
    width,
    height,
  };
}
