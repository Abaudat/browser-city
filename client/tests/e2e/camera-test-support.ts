// The one place a world pixel (`screen-position.ts`'s own space) becomes
// the canvas-relative offset to click or hover at (the camera/viewport
// story, Quentin's direction): every e2e spec that used to read
// `window.__bc.viewTransform` in one `page.evaluate` and do the
// arithmetic in Node now goes through this instead. With a player-centred
// camera that moves every frame, that two-step read-then-compute pattern
// has a real gap in it: the camera can move between "Node read the
// transform" and "the click is dispatched", which would silently click a
// stale point. Reading the transform and doing the projection inside the
// *same* `page.evaluate` closes that gap -- there is no round trip in the
// middle for the camera to move across. It also throws, rather than
// silently returning a point Playwright would then click outside the
// canvas: a fixed world point can be off-screen with this camera, and a
// click outside an element's own bounds is a silent no-op, never a
// helpful failure.
import type { Locator, Page } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";

export function canvasOf(page: Page): Locator {
  return page.locator("#test-street canvas");
}

export async function canvasOffsetForWorldPx(
  page: Page,
  worldPx: { readonly x: number; readonly y: number },
): Promise<{ readonly x: number; readonly y: number }> {
  return page.evaluate((worldPxArg) => {
    const view = window.__bc?.viewTransform;
    if (!view) {
      throw new Error("canvasOffsetForWorldPx: the scene has not recorded a view transform yet");
    }
    const canvas = document.querySelector("#test-street canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("canvasOffsetForWorldPx: no street canvas");
    }
    const rect = canvas.getBoundingClientRect();
    const x = worldPxArg.x * view.zoom + view.offsetX;
    const y = worldPxArg.y * view.zoom + view.offsetY;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      throw new Error(
        `canvasOffsetForWorldPx: world pixel (${worldPxArg.x}, ${worldPxArg.y}) projects to canvas ` +
          `offset (${x}, ${y}), outside the ${rect.width}x${rect.height} canvas -- a click or hover ` +
          "here would silently reach nothing",
      );
    }
    return { x, y };
  }, worldPx);
}
