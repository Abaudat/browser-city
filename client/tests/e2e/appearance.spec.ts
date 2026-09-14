// Story 1.10's one e2e spec (AC5, FR61/FR62, Quentin/Tim's direction):
// the runtime half of the appearance pipeline unit tests cannot reach --
// a real browser, a real `fetch` against the real `ModernTileset/` part
// sheets, a real `OffscreenCanvas`, a real Pixi `Texture` -- proving
// three things the pure unit tests only assume:
//   1. the real, mounted composite reads back byte-for-byte identical to
//      an independent five/six-sprite stack drawn straight from the same
//      vendor sheets (`window.__bc.appearanceCompare`, wired to
//      `compare-pipeline-vs-stack.ts` through the real, mounted cache);
//   2. citizens sharing a tuple+override share one real `Texture`
//      instance, never one each (`window.__bc.appearanceTextureIds`);
//   3. the real page fetches only the part sheets the crowd actually
//      references, never the wider catalogue eagerly.
// Screenshots are left behind as a CI artifact (Artie's direction, the
// same idiom as `story-1.9-shots`) for visual review -- crowd, a kid
// beside an adult, one frame per walk direction, and the crowd again
// after a full reload (the reload is the caching story's whole point:
// nothing about the crowd should look different, or take visibly longer
// to settle, the second time).
import { expect, type Page, test } from "@playwright/test";
import type { Defs } from "../../src/defs/types";
import {
  buildCitizenFixtures,
  buildPlayerAppearanceTuple,
  buildWalkerFixture,
} from "../../src/demo/citizens";
import type {} from "../../src/net/e2e-hooks";
import { resolveUniform } from "../../src/render/appearance/composite";
import { resolveLayers } from "../../src/render/appearance/resolve-layers";
import { screenPositionPx } from "../../src/render/screen-position";
import { committedDefs, committedDemoCitizens } from "../unit/demo/demo-world";

const SHOT_DIR = "test-results/story-1.10-shots";

function balance(key: string): number {
  const entry = committedDefs().balance.find((b) => b.key === key);
  if (!entry) throw new Error(`no balance key '${key}'`);
  return entry.value;
}

const TILE_SIZE_PX = balance("render.tile_size_px");
const STOREY_HEIGHT_PX = balance("render.storey_height_px");
const GROUND_FLOOR = 0;

async function ready(page: Page): Promise<void> {
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

function canvasOf(page: Page) {
  return page.locator("#demo-scene canvas");
}

/** Converts a world pixel (`screenPositionPx`'s own output) to the canvas
 * offset to screenshot at, through the scene's own recorded camera
 * transform -- the same conversion `intents.spec.ts` uses for clicks, so
 * a crop never drifts out of step with a moved camera. */
async function canvasOffset(page: Page, worldPx: { x: number; y: number }) {
  const view = await page.evaluate(() => window.__bc?.viewTransform);
  if (!view) throw new Error("the demo scene never recorded its view transform");
  return { x: worldPx.x * view.zoom + view.offsetX, y: worldPx.y * view.zoom + view.offsetY };
}

test.describe("the real, mounted appearance pipeline", () => {
  test("citizens sharing a tuple+override share one texture instance (AC5)", async ({ page }) => {
    await page.goto("/");
    await ready(page);

    const ids = await page.evaluate(() => window.__bc?.appearanceTextureIds ?? {});
    const distinctCount = await page.evaluate(
      () => window.__bc?.appearanceDistinctTextureCount ?? -1,
    );

    // `citizens.ts` puts three adults (`adult-0`, `adult-1`, `adult-2`) on
    // one shared tuple.
    expect(ids["adult-0"]).toBeDefined();
    expect(ids["adult-0"]).toBe(ids["adult-1"]);
    expect(ids["adult-0"]).toBe(ids["adult-2"]);

    // And two kids (`kid-0`, `kid-1`) on another.
    expect(ids["kid-0"]).toBeDefined();
    expect(ids["kid-0"]).toBe(ids["kid-1"]);
    expect(ids["kid-0"]).not.toBe(ids["adult-0"]);

    // The distinct count is real -- fewer distinct textures than citizens
    // (since some share), and at least as many as the number of visibly
    // distinct groups asserted above.
    const citizenCount = Object.keys(ids).length;
    expect(distinctCount).toBeGreaterThan(0);
    expect(distinctCount).toBeLessThan(citizenCount);
  });

  test("the page fetches only part sheets the mounted crowd actually references", async ({
    page,
  }) => {
    const defs: Defs = committedDefs();
    const demoCitizens = committedDemoCitizens();
    const fixtures = [...buildCitizenFixtures(demoCitizens), buildWalkerFixture(demoCitizens)];
    const tuplesAndOverrides: {
      tuple: (typeof fixtures)[number]["tuple"];
      override: ReturnType<typeof resolveUniform>;
    }[] = fixtures.map((fixture) => ({
      tuple: fixture.tuple,
      override: fixture.professionKey ? resolveUniform(defs, fixture.professionKey) : null,
    }));
    // The player itself (`scene.ts`) is a generated tuple through the
    // same pipeline, never part of `citizens.ts`'s own fixture list.
    tuplesAndOverrides.push({
      tuple: buildPlayerAppearanceTuple(demoCitizens),
      override: null,
    });

    const expectedBasenames = new Set<string>();
    for (const { tuple, override } of tuplesAndOverrides) {
      const resolved = resolveLayers(defs, tuple, override);
      for (const sheet of Object.values(resolved.sheets)) {
        if (sheet) expectedBasenames.add(sheet.split("/").pop() as string);
      }
    }

    const requestedCharacterGenPaths: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("Character_Generator")) requestedCharacterGenPaths.push(url);
    });

    await page.goto("/");
    await ready(page);

    expect(requestedCharacterGenPaths.length).toBeGreaterThan(0);
    for (const url of requestedCharacterGenPaths) {
      // Dev-mode URLs carry Vite's own `?import&url` query string (and, in
      // dev, an `/@fs/...` absolute-path prefix) -- neither is part of the
      // real filename, so both are stripped before comparing.
      const withoutQuery = url.split("?")[0] ?? url;
      const basename = decodeURIComponent(withoutQuery.split(/[/\\]/).pop() ?? "");
      expect(expectedBasenames.has(basename), `unexpected part-sheet request: ${url}`).toBe(true);
    }
  });

  test("the composite reads back byte-for-byte identical to an independent sprite stack, for fixed tuples", async ({
    page,
  }) => {
    // The full `(animation, direction, frame)` grid below is 48 real
    // comparisons, each its own pipeline build and independent Canvas2D
    // stack draw. `compare-pipeline-vs-stack.ts` decodes each of the
    // handful of sheets this fixed tuple references exactly once and
    // holds it for its own module lifetime (never paired with a
    // `releasePartImage`) -- without that, every one of the 48 stack
    // rebuilds below re-fetches and re-decodes the same PNGs from
    // scratch, which is what previously made this test take 26s+ locally
    // and time out on CI under worker contention. A generous margin over
    // the real ~6-8s local runtime, not a budget for redundant work.
    test.setTimeout(45_000);
    const defs: Defs = committedDefs();
    const adultBody = defs.bodies.find((b) => b.family === "adult");
    const adultEyes = defs.eyes.find((e) => e.family === "adult");
    const adultOutfit = defs.outfits.find((o) => o.family === "adult" && o.pool === "civilian");
    const adultHairstyle = defs.hairstyles.find((h) => h.family === "adult");
    const adultAccessory = defs.accessories.find(
      (a) => a.family === "adult" && a.pool === "civilian",
    );
    if (!adultBody || !adultEyes || !adultOutfit || !adultHairstyle || !adultAccessory) {
      throw new Error("appearance.spec: committed defs.json is missing an expected adult part");
    }
    // Every adult body sheet is 927px wide in the real committed catalogue
    // -- this tuple already exercises Quentin's "a 927px body sheet" case,
    // with no separate one needed.
    const adultTuple = {
      body: adultBody.id,
      eyes: adultEyes.id,
      outfit: adultOutfit.id,
      hairstyle: adultHairstyle.id,
      accessory: adultAccessory.id,
    };

    const kidBody = defs.bodies.find((b) => b.family === "kid");
    const kidEyes = defs.eyes.find((e) => e.family === "kid");
    const kidOutfit = defs.outfits.find((o) => o.family === "kid" && o.pool === "civilian");
    const kidHairstyle = defs.hairstyles.find((h) => h.family === "kid");
    if (!kidBody || !kidEyes || !kidOutfit || !kidHairstyle) {
      throw new Error("appearance.spec: committed defs.json is missing an expected kid part");
    }
    const kidTuple = {
      body: kidBody.id,
      eyes: kidEyes.id,
      outfit: kidOutfit.id,
      hairstyle: kidHairstyle.id,
      accessory: 0,
    };

    const hoodOutfit = defs.outfits.find(
      (o) => o.family === "kid" && o.hidesHairstyle && o.pool === "costume",
    );
    if (!hoodOutfit)
      throw new Error("appearance.spec: no kid hidesHairstyle outfit in committed defs");
    const hoodTuple = { ...kidTuple, outfit: hoodOutfit.id };

    const sanitationOverride = resolveUniform(defs, "sanitation_worker");
    if (!sanitationOverride) {
      throw new Error("appearance.spec: no sanitation_worker uniform in committed defs");
    }

    await page.goto("/");
    await ready(page);

    // The full `(animation, direction, frame)` grid for the plain adult
    // tuple -- every cell this game actually composites, at least once.
    const animations = ["idle", "walk"];
    const directions = ["right", "up", "left", "down"];
    for (const animation of animations) {
      for (const direction of directions) {
        for (let frame = 0; frame < 6; frame++) {
          const result = await page.evaluate(
            ([tuple, override, animation, direction, frame]) =>
              window.__bc?.appearanceCompare?.(
                tuple as never,
                override as never,
                animation as string,
                direction as string,
                frame as number,
              ),
            [adultTuple, null, animation, direction, frame] as const,
          );
          expect(result).toBeDefined();
          expect(result?.pipeline.width).toBe(result?.stack.width);
          expect(result?.pipeline.height).toBe(result?.stack.height);
          expect(result?.pipeline.data).toEqual(result?.stack.data);
        }
      }
    }

    // A lighter spot-check (one cell) for every other fixed case: the
    // kid, the hood outfit (hidesHairstyle in play), and the
    // sanitation-worker override (FR62, an additional layer never a
    // replacement).
    for (const [tuple, override] of [
      [kidTuple, null],
      [hoodTuple, null],
      [adultTuple, sanitationOverride],
    ] as const) {
      const result = await page.evaluate(
        ([tuple, override]) =>
          window.__bc?.appearanceCompare?.(tuple as never, override as never, "idle", "down", 0),
        [tuple, override] as const,
      );
      expect(result).toBeDefined();
      expect(result?.pipeline.data).toEqual(result?.stack.data);
    }
  });
});

test.describe("story 1.10 review screenshots", () => {
  test("crowd, twin kids, walk directions, and after a full reload", async ({ page }) => {
    // This is the one spec in the suite that pays for the full street
    // crowd's own network-bound texture build *twice* (once at mount,
    // once after `page.reload()`) plus four real-time waits for the
    // walker to cross its own loop -- comfortably under the suite's
    // default 30s budget locally, but tight enough on a slower CI runner
    // to time out on real, necessary work rather than a stuck test (a
    // real run there took 31.3s). Budgeted for the work, not loosened
    // because a run happened to miss the default by a second.
    test.setTimeout(90_000);
    await page.goto("/");
    await ready(page);

    await canvasOf(page).screenshot({ path: `${SHOT_DIR}/crowd.png` });

    // `kid-0` and the adult standing right beside it, on the identical
    // `gridY` (`citizens.ts` extends the last adult row rightward for the
    // kid row rather than starting a new one below it) -- the crop is
    // centred on the real fixture positions, computed the same way
    // `intents.spec.ts` turns a world cell into a canvas offset, so it
    // never drifts out of step with a camera move or a fixture reshuffle.
    const demoCitizens = committedDemoCitizens();
    const fixtures = buildCitizenFixtures(demoCitizens);
    const kid0 = fixtures.find((f) => f.id === "kid-0");
    if (!kid0) throw new Error("appearance.spec: no kid-0 fixture");
    const neighbourAdult = fixtures
      .filter((f) => f.id.startsWith("adult-") && f.gridY === kid0.gridY)
      .sort((a, b) => b.gridX - a.gridX)[0];
    if (!neighbourAdult) {
      throw new Error("appearance.spec: no adult shares kid-0's own gridY");
    }
    const midCellX = (kid0.gridX + neighbourAdult.gridX) / 2;
    const midWorldPx = screenPositionPx(
      midCellX,
      kid0.gridY,
      GROUND_FLOOR,
      TILE_SIZE_PX,
      STOREY_HEIGHT_PX,
    );
    const view = await page.evaluate(() => window.__bc?.viewTransform);
    if (!view) throw new Error("the demo scene never recorded its view transform");
    const centre = await canvasOffset(page, midWorldPx);
    // `fullPage` screenshots and `boundingBox()` must agree on the same
    // (unscrolled) coordinate origin -- pinned to the top so a prior
    // scroll position can never shift the two out of step.
    await page.evaluate(() => window.scrollTo(0, 0));
    const canvasBox = await canvasOf(page).boundingBox();
    if (!canvasBox) throw new Error("appearance.spec: the demo canvas has no bounding box");
    const cropWidth = TILE_SIZE_PX * 8 * view.zoom;
    const cropHeight = TILE_SIZE_PX * 6 * view.zoom;
    await page.screenshot({
      path: `${SHOT_DIR}/kid-beside-adult.png`,
      fullPage: true,
      clip: {
        x: canvasBox.x + centre.x - cropWidth / 2,
        y: canvasBox.y + centre.y - cropHeight * 0.75,
        width: cropWidth,
        height: cropHeight,
      },
    });

    // The walker loops through right -> up -> left -> down forever
    // (`citizens.ts`'s own `WALKER_LOOP`) at `WALK_CELLS_PER_SECOND` --
    // four waits spaced comfortably past one full leg each are enough to
    // have crossed every direction at least once.
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(1200);
      await canvasOf(page).screenshot({ path: `${SHOT_DIR}/walk-direction-${i}.png` });
    }

    await page.reload();
    await ready(page);
    await canvasOf(page).screenshot({ path: `${SHOT_DIR}/crowd-after-reload.png` });
  });
});
