// Story 1.10's appearance-pipeline e2e spec: the runtime half of the
// appearance pipeline unit tests cannot reach -- a real browser, a real
// `fetch` against the real `ModernTileset/` part sheets, a real
// `OffscreenCanvas`, a real Pixi `Texture` -- proving three things the
// pure unit tests only assume:
//   1. the real, mounted composite reads back byte-for-byte identical to
//      an independent five/six-sprite stack drawn straight from the same
//      vendor sheets (`window.__bc.appearanceCompare`, wired to
//      `compare-pipeline-vs-stack.ts` through the real, mounted cache);
//   2. citizens sharing a tuple+override share one real `Texture`
//      instance, never one each (`window.__bc.appearanceTextureIds`);
//   3. the real page fetches only the part sheets the crowd actually
//      references, never the wider catalogue eagerly.
// `appearance-screenshots.spec.ts` is the sibling spec that leaves review
// screenshots behind as a CI artifact instead of asserting anything --
// kept in its own file so this one stays fast.
import { expect, test } from "@playwright/test";
import type { Defs } from "../../src/defs/types";
import {
  buildCitizenFixtures,
  buildPlayerAppearanceTuple,
  buildUniformedWalkerFixture,
  buildWalkerFixture,
} from "../../src/demo/citizens";
import type {} from "../../src/net/e2e-hooks";
import { resolveUniform } from "../../src/render/appearance/composite";
import { resolveLayers } from "../../src/render/appearance/resolve-layers";
import { committedDefs } from "../unit/demo/demo-world";
import { ready } from "./appearance-test-support";

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
    const fixtures = [
      ...buildCitizenFixtures(defs),
      buildWalkerFixture(defs),
      buildUniformedWalkerFixture(defs),
    ];
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
      tuple: buildPlayerAppearanceTuple(defs),
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
    // and time out on CI at 90s. Runtime is now a consistent ~6-9s, on CI
    // included now that `playwright.config.ts` runs CI serially (its own
    // comment explains why) rather than sharing a CPU-bound runner across
    // workers -- this budget is a margin over that real time, not a cover
    // for redundant work.
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
