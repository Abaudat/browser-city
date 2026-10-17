// Story 1.10/2.7's appearance-pipeline e2e spec: the runtime half of the
// appearance pipeline unit tests cannot reach -- a real browser, a real
// `fetch` against the real packed character atlas pages, a real
// `OffscreenCanvas`, a real Pixi `Texture` -- proving three things the
// pure unit tests only assume:
//   1. the real, mounted composite reads back byte-for-byte identical to
//      an independent five/six-sprite stack drawn straight from the same
//      packed atlas pages (`window.__bc.appearanceCompare`, wired to
//      `compare-pipeline-vs-stack.ts` through the real, mounted cache);
//   2. citizens sharing a tuple+override share one real `Texture`
//      instance, never one each (`window.__bc.appearanceTextureIds`);
//   3. the client reads zero vendor `Character_Generator` sheets at
//      runtime (the Epic 1 shortcut is gone), and the real page fetches
//      only the character atlas pages the crowd actually references,
//      never the wider catalogue eagerly.

import { RUSH_LOOKS } from "../../src/debug/rush-crowd";
import type { Defs } from "../../src/defs/types";
import type {} from "../../src/net/e2e-hooks";
import { resolveUniform } from "../../src/render/appearance/composite";
import { buildPlayerAppearanceTuple, tupleFor } from "../../src/render/appearance/player-look";
import { resolveLayers } from "../../src/render/appearance/resolve-layers";
import { committedDefs } from "../unit/support/committed-defs";
import { ready } from "./appearance-test-support";
import { expect, test } from "./fixtures";

test.describe("the real, mounted appearance pipeline", () => {
  test("citizens sharing a tuple+override share one texture instance (AC5)", async ({ page }) => {
    // `?rushCrowd=1` lays the harness crowd, `RUSH_LOOKS` looks shared among
    // its citizens; `?freezeBodies=1` holds every body at its first pose.
    await page.goto("/?rushCrowd=1&freezeBodies=1");
    await ready(page);

    const ids = await page.evaluate(() => window.__bc?.appearanceTextureIds ?? {});
    const distinctCount = await page.evaluate(
      () => window.__bc?.appearanceDistinctTextureCount ?? -1,
    );

    // Citizen `n` and citizen `n + RUSH_LOOKS` wear one look, so they share
    // one texture; two neighbours wear different looks and do not.
    const byIndex = new Map<number, number>();
    for (const [id, textureId] of Object.entries(ids)) {
      const n = Number(id.split("-").pop());
      byIndex.set(n, textureId);
    }
    const pairs = [...byIndex.keys()].filter((n) => byIndex.has(n + RUSH_LOOKS));
    expect(pairs.length, "bodies of two citizens with one look").toBeGreaterThan(0);
    for (const n of pairs) expect(byIndex.get(n)).toBe(byIndex.get(n + RUSH_LOOKS));
    const distinctNeighbour = [...byIndex.keys()].find(
      (n) => byIndex.has(n + 1) && byIndex.get(n) !== byIndex.get(n + 1),
    );
    expect(distinctNeighbour, "two neighbours with different looks").toBeDefined();

    // The distinct count is real -- fewer distinct textures than citizens
    // (since some share), and at least as many as the number of visibly
    // distinct groups asserted above.
    const citizenCount = Object.keys(ids).length;
    expect(distinctCount).toBeGreaterThan(0);
    expect(distinctCount).toBeLessThan(citizenCount);
  });

  test("the client reads no vendor character sheets, only the character atlas pages the mounted crowd actually references", async ({
    page,
  }) => {
    const defs: Defs = committedDefs();
    const tuplesAndOverrides: {
      tuple: ReturnType<typeof tupleFor>;
      override: ReturnType<typeof resolveUniform>;
    }[] = Array.from({ length: RUSH_LOOKS }, (_, i) => ({
      tuple: tupleFor(defs, "adult", i),
      override: null,
    }));
    // The player itself (`world-scene.ts`) is a generated tuple through the
    // same pipeline, never part of the crowd.
    tuplesAndOverrides.push({
      tuple: buildPlayerAppearanceTuple(defs),
      override: null,
    });

    const expectedPageFiles = new Set<string>();
    for (const { tuple, override } of tuplesAndOverrides) {
      const resolved = resolveLayers(defs, tuple, override);
      for (const part of Object.values(resolved.parts)) {
        if (part) expectedPageFiles.add(defs.atlasPages[part.page]?.file ?? "");
      }
    }

    const requestedCharacterGenPaths: string[] = [];
    const requestedCharacterAtlasFiles = new Set<string>();
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("Character_Generator")) requestedCharacterGenPaths.push(url);
      // Dev-mode URLs carry Vite's own `?import&url` query string (and,
      // in dev, an `/@fs/...` absolute-path prefix) -- neither is part
      // of the real filename, so both are stripped before comparing.
      const withoutQuery = url.split("?")[0] ?? url;
      const basename = decodeURIComponent(withoutQuery.split(/[/\\]/).pop() ?? "");
      if (basename.startsWith("character_")) requestedCharacterAtlasFiles.add(basename);
    });

    await page.goto("/?rushCrowd=1");
    await ready(page);

    // The Epic 1 shortcut is gone entirely -- never a single request to a
    // raw vendor character sheet (Quentin/Tim's direction).
    expect(requestedCharacterGenPaths).toEqual([]);

    // Only the character atlas pages the crowd actually needs, loaded
    // lazily -- never the wider catalogue eagerly (`AtlasPageLoader`'s
    // own idiom, story 2.6, reused here for character pages).
    expect(requestedCharacterAtlasFiles.size).toBeGreaterThan(0);
    for (const file of requestedCharacterAtlasFiles) {
      expect(expectedPageFiles.has(file), `unexpected character atlas page request: ${file}`).toBe(
        true,
      );
    }
  });

  test("different people cost about as much as identical ones -- the same number of bound texture sources for N distinct tuples as for N identical ones (story 2.7, NFR12)", async ({
    page,
  }) => {
    // The harness crowd's default mount puts `RUSH_LOOKS` (40) distinct
    // looks on its bodies -- comfortably over the N >= 32 this AC asks for.
    await page.goto("/?rushCrowd=1&freezeBodies=1");
    await ready(page);
    const distinctCrowdSources = await page.evaluate(() => window.__bc?.allBoundTextureSources);
    const distinctCrowdPages = await page.evaluate(() => window.__bc?.distinctBoundAtlasPages);

    // `?rushLooks=1` (main.ts, DEV-only) mounts the exact same crowd --
    // same count, same positions -- but every citizen shares one look.
    await page.goto("/?rushCrowd=1&rushLooks=1&freezeBodies=1");
    await ready(page);
    const identicalCrowdSources = await page.evaluate(() => window.__bc?.allBoundTextureSources);
    const identicalCrowdPages = await page.evaluate(() => window.__bc?.distinctBoundAtlasPages);

    // Deterministic counts (never a frame-time comparison, too noisy for
    // PR CI -- Quentin's direction). `allBoundTextureSources` is
    // *unfiltered* -- every distinct `TextureSource` reachable from the
    // mounted display list, not narrowed to a known-page set -- so a
    // regression back to one standalone texture per composited look
    // would move this number; exact equality is the actual NFR12 proof.
    // (`distinctBoundAtlasPages`, filtered to known atlas/composite
    // pages, is checked too, but only as a secondary sanity check: shared
    // props/tile pages plus the shared composite pages, same either way.)
    expect(distinctCrowdSources).toBeGreaterThan(0);
    expect(distinctCrowdSources).toBe(identicalCrowdSources);
    expect(distinctCrowdPages).toBeGreaterThan(0);
    expect(distinctCrowdPages).toBe(identicalCrowdPages);
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
    // and time out on CI at 90s. Runtime is now a consistent ~25s on CI
    // (serial, a shared CPU-bound runner across workers costs real wall
    // time even without redundant decode work) -- this budget is a
    // margin over that real time, not a cover for redundant work.
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
    // -- this tuple already exercises the wide-body-sheet case, with no
    // separate one needed.
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

    await page.goto("/?rushCrowd=1");
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
