// Story 1.12's functional e2e (FR165/FR168): the overlays, on the real
// street, through the real DEV gate.
//
// Every assertion here is against elements and attributes -- never a
// pixel diff and never a scrape of the canvas. That is what the SVG
// surface buys (Tim's direction): `[data-bc-collider="none"]` is a fact a
// spec can state, whereas "is that dashed cyan outline in the right
// place?" is not.
//
// The one screenshot is a supplement, not the proof: it catches a drawing
// regression the attribute assertions cannot see, and it is deliberately
// the last thing here.
import { expect, type Page, test } from "@playwright/test";
import { DEBUG_OVERLAYS } from "../../src/debug/overlays";
import type {} from "../../src/net/e2e-hooks";
import {
  STAIRWELL_X0,
  type StreetWalkSegment,
  streetSubwayApproachRoute,
} from "../../src/test-street/fixture";
import {
  streetMovementConfig,
  streetWalkInputs,
  topRailingFoot,
} from "../unit/test-street/street-world";
import { canvasOf } from "./camera-test-support";
import { SCREENSHOT_OPTIONS } from "./screenshot-support";

const OVERLAY_IDS = DEBUG_OVERLAYS.map((o) => o.id);

// The fixed viewport the one `toHaveScreenshot` check needs, and the
// same budget idiom `test-street.spec.ts` uses: an absolute pixel count
// (never a ratio of the whole canvas) plus Playwright's own per-pixel
// colour tolerance for anti-aliasing noise. Nothing here moves -- the
// player never takes a step and the crowd is frozen -- so what this
// budget absorbs is rendering noise alone.
test.use({ viewport: { width: 1920, height: 1080 } });

const OVERLAY_SCREENSHOT_OPTIONS = { ...SCREENSHOT_OPTIONS, maxDiffPixels: 150 } as const;

async function waitForSceneReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, {
    timeout: 15_000,
  });
  await page.waitForFunction(() => window.__bcDebug !== undefined, undefined, { timeout: 15_000 });
}

test("nothing is drawn until an overlay is asked for, and ?debug= is what asks", async ({
  page,
}) => {
  await page.goto("/");
  await waitForSceneReady(page);

  // The surface exists (it is a DEV build) but has drawn nothing.
  await expect(page.locator('[data-bc-debug="overlays"]')).toHaveCount(1);
  await expect(page.locator("[data-bc-collider]")).toHaveCount(0);
  await expect(page.locator("[data-bc-sort-label]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__bcDebug?.list().every((e) => !e.enabled))).toBe(true);

  // ...and the registry's own table is what the page exposes, so a later
  // overlay is reachable the day it is registered (AC5).
  expect(await page.evaluate(() => window.__bcDebug?.list().map((e) => e.id))).toEqual(OVERLAY_IDS);
});

test("the collision overlay draws every collider state over the real street (AC2)", async ({
  page,
}) => {
  await page.goto("/?debug=collision");
  await waitForSceneReady(page);

  const overlay = page.locator('[data-bc-debug="collision"]');
  await expect(overlay).toHaveCount(1);

  // The street is hand-laid with walls and a lamppost (real colliders)
  // and with posters and windows (no collider at all) -- so all three
  // states are on screen at once, which is exactly the AC.
  await expect(overlay.locator('[data-bc-collider="collider"]').first()).toBeVisible();
  expect(await overlay.locator('[data-bc-collider="collider"]').count()).toBeGreaterThan(0);
  expect(await overlay.locator('[data-bc-collider="none"]').count()).toBeGreaterThan(0);

  // Every rect drawn as a real collider has real extent -- and only
  // that. This deliberately does *not* check where a collider landed:
  // that claim is `inv_collision_overlay_shows_exactly_the_colliders`
  // (the rects are exactly what the live grid reports) and
  // `inv_overlay_projection_matches_renderer` (the projection is the
  // renderer's own), both at unit level against the same builder this
  // page runs. What this adds is that the real, mounted page reaches
  // that builder at all and draws something with size.
  const withoutExtent = await page.evaluate(() => {
    const out: string[] = [];
    for (const element of document.querySelectorAll('[data-bc-collider="collider"]')) {
      const width = Number(element.getAttribute("width"));
      const height = Number(element.getAttribute("height"));
      if (!(width > 0) || !(height > 0)) {
        out.push(`${element.getAttribute("data-bc-object")}: ${width}x${height}`);
      }
    }
    return out;
  });
  expect(withoutExtent, "every rect drawn as a real collider must have real extent").toEqual([]);

  // Nothing the overlay draws may take a click meant for the world.
  expect(
    await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('[data-bc-debug="overlays"]') as Element)
          .pointerEvents,
    ),
  ).toBe("none");
});

// Story 15.4 (AC3): the player's own collision box sits exactly on their
// drawn silhouette, not merely somewhere in the same collider list.
// `data-bc-collider="player"` is the overlay's fourth entry (Quentin/
// Tim's direction); its own drawn rect, mapped through the scene's real
// `viewTransform` into canvas pixels, must have its bottom-centre within
// 1px of `playerScreenBounds()` -- Pixi's own real, drawn sprite bounds.
// Red before this story's fix by `(tile/2, tile)` at the scene's own
// zoom, the same offset every other AC1/AC4 case in this PR names.
test("the collision overlay's player body sits on the player's real drawn sprite (AC3)", async ({
  page,
}) => {
  await page.goto("/?debug=collision&freezeCrowd");
  await waitForSceneReady(page);

  const player = page.locator('[data-bc-collider="player"]');
  await expect(player).toHaveCount(1);

  const overlayRect = await player.evaluate((el) => ({
    x: Number(el.getAttribute("x")),
    y: Number(el.getAttribute("y")),
    width: Number(el.getAttribute("width")),
    height: Number(el.getAttribute("height")),
  }));
  const viewTransform = await page.evaluate(() => window.__bc?.viewTransform);
  const bounds = await page.evaluate(() => window.__bc?.playerScreenBounds?.());
  if (!viewTransform || !bounds) throw new Error("no viewTransform/playerScreenBounds hook");

  // The overlay rect is in the same pre-zoom world-pixel space
  // `screen-position.ts` produces (`overlays.ts`'s own `viewGroup`
  // transform); `playerScreenBounds()` is Pixi's own real, drawn bounds,
  // already in canvas pixels. Both bottom-centres must agree.
  const overlayCanvasX = overlayRect.x * viewTransform.zoom + viewTransform.offsetX;
  const overlayCanvasY = overlayRect.y * viewTransform.zoom + viewTransform.offsetY;
  const overlayWidthCanvas = overlayRect.width * viewTransform.zoom;
  const overlayHeightCanvas = overlayRect.height * viewTransform.zoom;
  const overlayBottomCentre = {
    x: overlayCanvasX + overlayWidthCanvas / 2,
    y: overlayCanvasY + overlayHeightCanvas,
  };
  const spriteBottomCentre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height };

  expect(Math.abs(overlayBottomCentre.x - spriteBottomCentre.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(overlayBottomCentre.y - spriteBottomCentre.y)).toBeLessThanOrEqual(1);

  // Distinct from every object collider colour, so the two read apart at
  // a glance (Artie's direction).
  const stroke = await player.evaluate((el) => el.getAttribute("stroke"));
  const objectStroke = await page
    .locator('[data-bc-collider="collider"]')
    .first()
    .evaluate((el) => el.getAttribute("stroke"));
  expect(stroke).not.toBe(objectStroke);
});

test("the sort overlay prints the key the renderer actually ordered by (AC3)", async ({ page }) => {
  await page.goto("/?debug=sort");
  await waitForSceneReady(page);

  const labels = page.locator("[data-bc-sort-label]");
  expect(await labels.count()).toBeGreaterThan(0);

  // Every label's own order index must agree with `window.__bc.renderOrder`
  // -- the order the real `applyDepthOrder` wrote, read independently.
  const disagreements = await page.evaluate(() => {
    const order = window.__bc?.renderOrder ?? [];
    const out: string[] = [];
    for (const element of document.querySelectorAll("[data-bc-sort-label]")) {
      const id = element.getAttribute("data-bc-sort-label") ?? "";
      const text = element.textContent ?? "";
      const printed = /\[(\d+)\]/.exec(text)?.[1];
      const expected = order.indexOf(id);
      if (expected === -1) continue;
      if (printed !== String(expected)) {
        out.push(`${id}: label says ${printed ?? "[?]"}, renderOrder says ${expected}`);
      }
      if (!text.includes(`#${id}`)) out.push(`${id}: label does not carry its own stable id`);
    }
    return out;
  });
  expect(disagreements, "a sort readout that disagrees with the applied order").toEqual([]);
});

test("overlays toggle from the console, and leave nothing behind (AC5)", async ({ page }) => {
  await page.goto("/");
  await waitForSceneReady(page);

  for (const id of OVERLAY_IDS) {
    expect(await page.evaluate((overlayId) => window.__bcDebug?.enable(overlayId), id)).toBe(true);
    await expect(page.locator(`[data-bc-debug="${id}"]`)).toHaveCount(1);
    expect(await page.evaluate((overlayId) => window.__bcDebug?.toggle(overlayId), id)).toBe(true);
    await expect(page.locator(`[data-bc-debug="${id}"]`)).toHaveCount(0);
  }

  // An id nothing registered is refused, not activated.
  expect(await page.evaluate(() => window.__bcDebug?.enable("navmesh"))).toBe(false);
  await expect(page.locator('[data-bc-debug="navmesh"]')).toHaveCount(0);
});

test("an unknown ?debug= id warns and boots anyway, with no console error", async ({ page }) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
    if (message.type() === "warning") warnings.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("/?debug=collision,navmesh");
  await waitForSceneReady(page);

  await expect(page.locator('[data-bc-debug="collision"]')).toHaveCount(1);
  expect(warnings.join("\n")).toContain("navmesh");
  expect(errors, "a stale ?debug= must never break the boot").toEqual([]);
});

test("the overlay is deliberately non-diegetic", async ({ page }) => {
  await page.goto("/?debug=collision,sort&freezeCrowd");
  await waitForSceneReady(page);
  await page.waitForFunction(
    () => (document.querySelectorAll("[data-bc-collider]").length ?? 0) > 0,
    undefined,
    { timeout: 15_000 },
  );

  // FR151's DOM UI allowlist is checked against document.body's own
  // children; the overlay lives inside the canvas mount and must never
  // appear as a fourth surface.
  expect(
    await page.evaluate(() =>
      [...document.body.children].map((c) => c.getAttribute("data-bc-surface") ?? c.id),
    ),
  ).not.toContain("overlays");
  await expect(page.locator('#test-street > [data-bc-debug="overlays"]')).toHaveCount(1);

  // The supplement, never the proof: a drawing regression the attribute
  // assertions above cannot see. The crowd is frozen so the frame is
  // deterministic, exactly as test-street.spec.ts's own snapshots are.
  await expect(page.locator("#test-street")).toHaveScreenshot(
    "collision-overlay.png",
    OVERLAY_SCREENSHOT_OPTIONS,
  );
});

/** Holds `segment.key` through real keyboard input and releases it inside
 * the page on the frame its `until` is first met. */
async function holdUntil(page: Page, segment: StreetWalkSegment): Promise<void> {
  await page.keyboard.down(segment.key);
  try {
    await page.evaluate(
      ({ until, code }) =>
        new Promise<void>((resolve, reject) => {
          const deadline = performance.now() + 30_000;
          const tick = (): void => {
            const pos = window.__bc?.playerPosition;
            const met =
              pos !== undefined &&
              (until.kind === "x-at-least"
                ? pos.x >= until.value
                : until.kind === "x-at-most"
                  ? pos.x <= until.value
                  : until.kind === "y-at-least"
                    ? pos.y >= until.value
                    : until.kind === "y-at-most"
                      ? pos.y <= until.value
                      : false);
            if (met || performance.now() >= deadline) {
              window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
              if (met) resolve();
              else reject(new Error(`never met ${JSON.stringify(until)}`));
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      { until: segment.until, code: segment.key },
    );
  } finally {
    await page.keyboard.up(segment.key);
  }
}

// Story 15.12 (Artie, Quentin): the top railing collides at its foot, so a
// player walking south from the finial row rests with their feet on the
// base rail. The DOM facts are the proof -- the player's body sits exactly
// on the railing's collider rect -- and the picture is the supplement.
test("the player walking south rests on the top railing's foot (story 15.12)", async ({ page }) => {
  await page.goto("/?debug=collision&freezeCrowd");
  await waitForSceneReady(page);

  const foot = topRailingFoot();
  const route = streetSubwayApproachRoute(streetWalkInputs());
  const toEntrance = route.findIndex((segment) => segment.label === "east-to-the-subway-entrance");
  for (const segment of route.slice(0, toEntrance + 1)) await holdUntil(page, segment);
  // West along the pavement row to the railing's middle column, then south.
  await holdUntil(page, {
    label: "west-to-the-railing-middle",
    key: "ArrowLeft",
    until: { kind: "x-at-most", value: foot.rect.x0 + 1.5 },
  });
  await holdUntil(page, {
    label: "south-onto-the-railing-foot",
    key: "ArrowDown",
    until: { kind: "y-at-least", value: foot.rect.y0 - 0.001 },
  });
  // Slide west along the foot to the strip's end, where the body rests
  // against the ring: a position fixed by geometry, never by key timing,
  // so the picture is the same on every run.
  const config = streetMovementConfig();
  const westRestX = STAIRWELL_X0 + config.bodyWidthSubcells / 2 / config.subcellsPerCell;
  await page.keyboard.down("ArrowLeft");
  await page.waitForFunction(
    (x) => Math.abs((window.__bc?.playerPosition?.x ?? 0) - x) < 1e-6,
    westRestX,
    { timeout: 30_000 },
  );
  await page.keyboard.up("ArrowLeft");
  await page.waitForTimeout(300);

  const position = await page.evaluate(() => window.__bc?.playerPosition);
  expect(position?.y).toBeCloseTo(foot.rect.y0, 4);

  const edges = await page.evaluate((objectId) => {
    const player = document.querySelector('[data-bc-collider="player"]');
    const rail = document.querySelector(
      `[data-bc-collider="collider"][data-bc-object="${objectId}"]`,
    );
    if (!player || !rail) throw new Error("no player or railing collider rect in the overlay");
    return {
      playerBottom: Number(player.getAttribute("y")) + Number(player.getAttribute("height")),
      railTop: Number(rail.getAttribute("y")),
    };
  }, foot.prop.id.toString());
  expect(edges.playerBottom).toBeCloseTo(edges.railTop, 4);

  // The stairwell plus one cell each side, from the real view transform.
  const clip = await page.evaluate(
    ({ x0, y0, x1, y1 }) => {
      const view = window.__bc?.viewTransform;
      const canvas = document.querySelector("#test-street canvas");
      if (!view || !canvas) throw new Error("no view transform or canvas");
      const box = canvas.getBoundingClientRect();
      const px = (cell: number, offset: number) => cell * 16 * view.zoom + offset;
      return {
        x: box.x + px(x0, view.offsetX),
        y: box.y + px(y0, view.offsetY),
        width: px(x1, view.offsetX) - px(x0, view.offsetX),
        height: px(y1, view.offsetY) - px(y0, view.offsetY),
      };
    },
    {
      x0: STAIRWELL_X0 - 1,
      y0: foot.prop.y - 2,
      x1: STAIRWELL_X0 + 4,
      y1: foot.prop.y + 3,
    },
  );
  await expect(canvasOf(page)).toBeVisible();
  await expect(page).toHaveScreenshot("top-railing-foot.png", {
    ...OVERLAY_SCREENSHOT_OPTIONS,
    clip,
  });
});
