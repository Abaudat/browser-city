// Story 1.7's one e2e spec (Quentin's direction): mounting the committed
// street terrace through the real adapter (`src/test-street/scene.ts`) and reading
// FR120/FR121/FR122's visibility state back out of the existing DEV-only
// `window.__bc` hook proves the real, mounted `VisibilityApplier` reaches
// the same states `render/visibility.ts`'s pure `computeVisibility`
// predicts. It compares against the exact same goldens
// `tests/unit/test-street/drawables.test.ts` asserts from the pure functions
// directly (Quentin's direction, cycle 2) -- this spec never re-derives a
// state on its own, and `window.__bc.visibility`/`visibilityAlpha` are
// built in `scene.ts` from each pool member's own real, just-written
// `sprite.visible`/`sprite.alpha`, never a second recomputed
// `computeVisibility` call in the page itself.
//
// Every wait below is either `renderOrder`/`visibility` becoming
// non-empty (the scene has mounted and applied its first visibility pass)
// or `playerPosition` reaching an exact, real value -- never a fixed
// `waitForTimeout`. The two positions this spec walks to
// (`lamppostRestY()`, the subway's own landing/up-anchor cells) are real
// collider rests or real transition-anchor cells, not guessed distances;
// `movement.spec.ts` already proves the first of those is reached this
// way. No hook here ever sets the player's floor directly (Quentin's
// direction) -- the walk always goes through the real keyboard and the
// real `world/transitions.ts` port.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { PNG } from "pngjs";
import type {} from "../../src/net/e2e-hooks";
import { buildFlights, FlightIndex } from "../../src/render/flight-offset";
import { worldPointPx } from "../../src/render/screen-position";
import {
  isDefStreetProp,
  PLATFORM_LANDING_Y,
  PLATFORM_UP_ANCHOR_X,
  PLATFORM_UP_ANCHOR_Y,
  PLAYER_STABLE_ID,
  PLAYER_START,
  RELEASE_LAG,
  STAIRS_X,
  STAIRS_Y,
  STAIRWELL_BOTTOM_RAILING_DEF_ID,
  STAIRWELL_FOOTPRINT,
  STAIRWELL_TOP_RAILING_DEF_ID,
  STAIRWELL_X0,
  STAIRWELL_Y0,
  STREET_EXIT_X,
  STREET_EXIT_Y,
  STREET_PROPS,
  STREET_TRANSITIONS,
  type StreetWalkSegment,
  SUBWAY_ENTRANCE_X0,
  SUBWAY_FLOOR,
  streetNearRailingPressRoute,
  streetPlacedRows,
  streetSubwayApproachRoute,
} from "../../src/test-street/fixture";
import {
  STREET_VISIBILITY_AT_LAMPPOST_OUTSIDE,
  STREET_VISIBILITY_AT_REST_IN_SHOP_A,
  STREET_VISIBILITY_ON_SUBWAY_LANDING,
} from "../unit/test-street/golden";
import {
  committedDefs,
  platformWestRestX,
  propCells,
  shopfrontExitRestY,
  stairwellRowsAt,
  streetMovementConfig,
  streetObjectSources,
  streetWalkInputs,
} from "../unit/test-street/street-world";
import { canvasOf } from "./camera-test-support";
import { SCREENSHOT_OPTIONS } from "./screenshot-support";
import { walkRealSegment } from "./walk-support";

async function waitForSceneReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, {
    timeout: 15_000,
  });
  await page.waitForFunction(
    () => Object.keys(window.__bc?.visibility ?? {}).length > 0,
    undefined,
    { timeout: 15_000 },
  );
}

function currentVisibility(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => window.__bc?.visibility ?? {});
}

/** `render.window_alpha` as the same `(0, 1)` fraction `scene.ts` applies
 * as `sprite.alpha` -- read from the same fetched document the page
 * itself loads, never a literal restated in this spec. */
async function windowAlphaFraction(page: Page): Promise<number> {
  const percent = await page.evaluate(async () => {
    const defs = (await (await fetch("/defs/defs.json")).json()) as {
      balance: { key: string; value: number }[];
    };
    const entry = defs.balance.find((b) => b.key === "render.window_alpha");
    if (!entry) throw new Error("render.window_alpha missing from fetched defs.json");
    return entry.value;
  });
  return percent / 100;
}

async function walkTo(
  page: Page,
  key: "ArrowDown" | "ArrowRight" | "ArrowUp" | "ArrowLeft",
  target: { x: number; y: number },
): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForFunction(
    ({ x, y }) => {
      const pos = window.__bc?.playerPosition;
      return !!pos && Math.abs(pos.x - x) < 0.01 && Math.abs(pos.y - y) < 0.01;
    },
    target,
    { timeout: 15_000 },
  );
  await page.keyboard.up(key);
}

/** The platform stairwell's cells, found by the `stairs` tag from the anchor. */
function platformStairwellBox() {
  const cells = stairwellRowsAt({
    x: PLATFORM_UP_ANCHOR_X,
    y: PLATFORM_UP_ANCHOR_Y,
    floor: SUBWAY_FLOOR,
  }).flatMap(propCells);
  return {
    x0: Math.min(...cells.map((c) => c.x)),
    y0: Math.min(...cells.map((c) => c.y)),
    x1: Math.max(...cells.map((c) => c.x)) + 1,
    y1: Math.max(...cells.map((c) => c.y)) + 1,
  };
}

// Pinned like every other baseline spec, so the picture is the same size everywhere.
test.use({ viewport: { width: 1920, height: 1080 } });

// Well under the platform flight and its railing's own area (~20k device pixels at zoom).
const PLATFORM_MAX_DIFF_PIXELS = 200;
// The stairwell clip is small and nothing in it animates under `freezeCrowd`.
const PLATFORM_STAIRS_MAX_DIFF_PIXELS = 50;

test.describe("story 1.7: enclosure visibility", () => {
  test("at rest inside shop A matches the committed visibility golden, every mounted sprite's mask is null, and a translucent sprite's alpha is render.window_alpha", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForSceneReady(page);

    expect(await currentVisibility(page)).toEqual(STREET_VISIBILITY_AT_REST_IN_SHOP_A);

    // FR121's "no masking or aperture system" acceptance criterion,
    // proven against the real, mounted display list (Tim's direction) --
    // never only by `scripts/ci/check-no-masks.sh`'s source-level grep.
    await page.waitForFunction(() => window.__bc?.masksAllNull !== undefined, undefined, {
      timeout: 15_000,
    });
    expect(await page.evaluate(() => window.__bc?.masksAllNull)).toBe(true);

    // Shop B's window (id 32) is translucent from shop A -- its real,
    // just-written sprite alpha must equal the resolved balance value,
    // not merely be "some value less than 1".
    const windowAlpha = await windowAlphaFraction(page);
    const alpha = await page.evaluate(() => window.__bc?.visibilityAlpha?.["32"]);
    expect(alpha).toBeCloseTo(windowAlpha, 5);

    // FR122's flat-pass culling (Tim's cycle-2 direction): the street's
    // own ground pass must be visible from the street, and the subway's
    // own ground pass must not -- proven against the real, mounted
    // ground-tile containers, not only the sorted pool.
    const groundVisibility = await currentVisibility(page);
    expect(groundVisibility["ground:0"]).toBe("normal");
    expect(groundVisibility["ground:-1"]).toBe("hidden");
    // Story 15.8: the street crowd is a floor-0 container like any other
    // -- visible from the street, the same rule as `ground:0`.
    expect(groundVisibility["crowd:0"]).toBe("normal");

    // The FR120 wall-stub companion's own inverse rule (Artie's cycle-2
    // finding): while shop A's own near-side wall/window/pier (2, 6, 40)
    // are retracted (drawn `hidden`), their stub companions must be the
    // ones left on screen -- and shop B's own front, still fully drawn,
    // must keep its stubs hidden behind it.
    expect(groundVisibility["500002"]).toBe("normal"); // parent 2 retracted
    expect(groundVisibility["500006"]).toBe("normal"); // parent 6 retracted
    expect(groundVisibility["500040"]).toBe("normal"); // parent 40 retracted
    expect(groundVisibility["500032"]).toBe("hidden"); // parent 32 (shop B) not retracted
    expect(groundVisibility["500041"]).toBe("hidden"); // parent 41 (shop B) not retracted
  });

  test("walking out of shop A onto the pavement matches the committed outside golden", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForSceneReady(page);

    // `computeVisibility` only ever reads the viewer's own `(floor,
    // buildingId)`, never its exact position (the subway test below's own
    // comment says so too), so any real position outside the shop gives
    // the same golden -- `shopfrontExitRestY()`, the real trash-bin rest a
    // straight south walk out of the door reaches (story 15.2, cycle 2,
    // Quentin's finding 3, `shopfrontExitRestY`'s own doc comment says
    // why).
    await walkTo(page, "ArrowDown", { x: PLAYER_START.x, y: shopfrontExitRestY() });
    // The visibility hook only fires when the player's own cell changes
    // (Tim's direction) -- wait for the real, event-driven update rather
    // than a fixed delay.
    await page.waitForFunction(() => window.__bc?.visibility?.["2"] !== "hidden", undefined, {
      timeout: 15_000,
    });

    const outsideVisibility = await currentVisibility(page);
    // Story 15.8: the crowd is a floor-0 container -- visible on the
    // street, same as every other floor-0 flat pass.
    expect(outsideVisibility["crowd:0"]).toBe("normal");
    expect(outsideVisibility).toEqual(STREET_VISIBILITY_AT_LAMPPOST_OUTSIDE);
  });

  test("entering the subway culls the street and reveals the platform; leaving it reverses that", async ({
    page,
  }) => {
    // `freezeCrowd` so no citizen's walk frame can leak into the platform picture.
    await page.goto("/?freezeCrowd=1");
    await waitForSceneReady(page);

    // From the shop to the stairwell's own opening and down it the demo's
    // own way (issue #310: walking left), through real OS-level keyboard
    // input driving the release conditions `street-conformance.test.ts`
    // proves at `RELEASE_LAG`. The transition fires the moment the
    // player's own cell matches `(STAIRS_X, STAIRS_Y)`.
    for (const segment of streetSubwayApproachRoute(streetWalkInputs())) {
      await walkRealSegment(page, segment);
    }
    const landed = await page.evaluate(() => window.__bc?.playerPosition);
    expect(landed && Math.floor(landed.y)).toBe(PLATFORM_LANDING_Y);
    await page.waitForFunction(() => window.__bc?.visibility?.["60"] !== "hidden", undefined, {
      timeout: 15_000,
    });

    const platformVisibility = await currentVisibility(page);
    expect(platformVisibility).toEqual(STREET_VISIBILITY_ON_SUBWAY_LANDING);
    // FR122's flat-pass culling, the reverse of the street shot above:
    // the subway's own ground pass is now visible, the street's is not.
    expect(platformVisibility["ground:-1"]).toBe("normal");
    expect(platformVisibility["ground:0"]).toBe("hidden");
    // Story 15.8: the street crowd and its pavement strip are a floor-0
    // container -- culled with the rest of the street, the whole reason
    // this story exists (nothing from the street draws on the platform).
    expect(platformVisibility["crowd:0"]).toBe("hidden");

    // Story 15.11: the platform baseline -- the player rests on the landing,
    // on the flight that steps up to the east wall under the green
    // up-arrow, its railing south of it and the entry cell open.
    await expect(canvasOf(page)).toHaveScreenshot("platform.png", {
      ...SCREENSHOT_OPTIONS,
      maxDiffPixels: PLATFORM_MAX_DIFF_PIXELS,
    });

    // Story 15.14: the whole stairwell group, flight and railing, with the
    // player walked west until clear of it. The clip is the group's cells
    // plus one row north and one cell south and east (never the player), from
    // the real view transform.
    const box = platformStairwellBox();
    // Held, the body rests clear of the group: its east edge is west of the group's box.
    const config = streetMovementConfig();
    const bodyHalf = config.bodyWidthSubcells / 2 / config.subcellsPerCell;
    expect(platformWestRestX() + bodyHalf).toBeLessThanOrEqual(box.x0);
    await page.keyboard.down("ArrowLeft");
    // Held until the body is at the rest the movement code computes from the
    // fixture (the blocker's face plus half the body): the same pixel every run.
    const restX = platformWestRestX();
    await page.waitForFunction(
      (x) => Math.abs((window.__bc?.playerPosition?.x ?? Infinity) - x) < 1e-6,
      restX,
      { timeout: 15_000 },
    );
    await page.keyboard.up("ArrowLeft");
    // The platform is a storey down: its screen rows sit one storey lower.
    const storeyPx = committedDefs().balance.find(
      (b) => b.key === "render.storey_height_px",
    )?.value;
    if (storeyPx === undefined) throw new Error("no render.storey_height_px balance");
    const floorShift = -SUBWAY_FLOOR * storeyPx;
    const stairsClip = await page.evaluate(
      ({ x0, y0, x1, y1, floorShift }) => {
        const view = window.__bc?.viewTransform;
        const canvas = document.querySelector("#test-street canvas");
        if (!view || !canvas) throw new Error("no view transform or canvas");
        const rect = canvas.getBoundingClientRect();
        const px = (cell: number, offset: number, shift = 0) =>
          (cell * 16 + shift) * view.zoom + offset;
        return {
          x: rect.x + px(x0, view.offsetX),
          y: rect.y + px(y0, view.offsetY, floorShift),
          width: px(x1, view.offsetX) - px(x0, view.offsetX),
          height: px(y1, view.offsetY) - px(y0, view.offsetY),
        };
      },
      { x0: box.x0, y0: box.y0 - 1, x1: box.x1 + 1, y1: box.y1 + 1, floorShift },
    );
    await expect(page).toHaveScreenshot("platform-stairs.png", {
      ...SCREENSHOT_OPTIONS,
      maxDiffPixels: PLATFORM_STAIRS_MAX_DIFF_PIXELS,
      clip: stairsClip,
    });

    // Story 15.2: the reverse input (`ArrowRight`, the mirror of the
    // `ArrowLeft` that walked down) climbs straight back up -- no detour
    // through an unrelated direction. Walking east from the landing
    // reaches the up-stairs' own anchor, one cell further in (`fixture.ts`'s
    // `PLATFORM_UP_ANCHOR_X/Y`, the landing's own mirror per
    // `world/transitions.ts`'s `checkTransitionPairSymmetry`), and lands
    // one cell beside the stairwell (`STREET_EXIT_X/Y`) -- never the down
    // anchor's own cell, which would re-trigger the descent the instant a
    // still-held key is checked against it again.
    await walkTo(page, "ArrowRight", { x: STREET_EXIT_X + 0.5, y: STREET_EXIT_Y + 0.5 });
    await page.waitForFunction(() => window.__bc?.visibility?.["60"] === "hidden", undefined, {
      timeout: 15_000,
    });

    // Back on the street, outside any building (`STREET_EXIT_X/Y` is
    // plain pavement) -- `computeVisibility` only ever reads the viewer's
    // own `(floor, buildingId)`, never its exact position, so this is the
    // identical state the "walked out onto the pavement" golden above is.
    const backOnStreetVisibility = await currentVisibility(page);
    // Story 15.8 (Artie's direction): the crowd and its pavement
    // reappear exactly as before -- same container, same rule, no re-seed.
    expect(backOnStreetVisibility["crowd:0"]).toBe("normal");
    expect(backOnStreetVisibility).toEqual(STREET_VISIBILITY_AT_LAMPPOST_OUTSIDE);
  });
});

// Story 15.13 (FR123): the street stairwell's near railing draws over a
// player standing on the treads, on every pixel it owns (the unit sweep
// covers every position along the row; this is the mounted picture at the
// demo's posture). Probed analytically: the railing-only art (the stairwell with
// the treads removed) is placed from the stairwell's own art origin through
// the live view transform; every opaque pixel of it from the tread row down
// that falls under the player's body must be the canvas's colour, never the
// player's. Clips of the stairwell at both rests go to a directory CI
// uploads straight after this job's e2e step, for review.
const STAIRWELL_SHOT_DIR = "test-results/review-shots/story-15.13";

function balanceValue(key: string): number {
  const entry = committedDefs().balance.find((b) => b.key === key);
  if (!entry) throw new Error(`no balance key '${key}'`);
  return entry.value;
}

test.describe("story 15.13: the street stairwell's draw order, mounted", () => {
  test("pressed south along the near railing, the player is under its pixels and over the far railing's", async ({
    page,
  }) => {
    // A long real-keyboard walk and three canvas captures; a CI software
    // rasteriser captures slowly.
    test.setTimeout(60_000);
    const defs = committedDefs();
    const tile = balanceValue("render.tile_size_px");
    const storey = balanceValue("render.storey_height_px");
    const config = streetMovementConfig();
    const inputs = streetWalkInputs();
    const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const nearRailing = defs.objects.find((o) => o.id === STAIRWELL_BOTTOM_RAILING_DEF_ID);
    if (!nearRailing) throw new Error("no near railing def");
    // The railing-only art: the near railing's own sheet (the unit tests
    // assert it is not the treads' sheet), placed from the stairwell's art
    // origin rather than from the def's rect.
    const railing = PNG.sync.read(readFileSync(join(repoRoot, nearRailing.sprite.sheet)));
    const treadTopArtY = (STAIRS_Y - STAIRWELL_Y0) * tile;

    await page.goto("/?freezeCrowd=1");
    await waitForSceneReady(page);
    mkdirSync(STAIRWELL_SHOT_DIR, { recursive: true });

    for (const segment of streetNearRailingPressRoute(inputs)) {
      await walkRealSegment(page, segment);
      // The rest: pressed south along the near railing's face, after the
      // west walk. (A north rest against the far railing is not walked here:
      // where a walk ends in x depends on the overshoot, and the far
      // railing's foot only holds the body over its own columns. The sort
      // there is x-independent and the unit sweep holds it.)
      if (segment.label !== "west-along-the-near-railing") continue;
      const rest = "press-south";
      await expect
        .poll(() => page.evaluate(() => window.__bc?.playerPosition), {
          message: `${rest}: the body rests where the resolver puts it`,
          timeout: 5_000,
        })
        .toMatchObject({ y: expect.closeTo(inputs.nearRailingRestY, 6) });
      const feet = await page.evaluate(() => window.__bc?.playerPosition);
      const view = await page.evaluate(() => window.__bc?.viewTransform);
      const bounds = await page.evaluate(() => window.__bc?.playerScreenBounds?.());
      const order = await page.evaluate(() => window.__bc?.renderOrder ?? []);
      if (!feet || !view || !bounds) throw new Error("no feet / view / bounds hook");

      // Render order: the near railing after the player, the far one before.
      const at = order.indexOf(PLAYER_STABLE_ID.toString());
      expect(at).toBeGreaterThanOrEqual(0);
      const indexOfDef = (defId: number) =>
        STREET_PROPS.filter((p) => isDefStreetProp(p) && p.defId === defId).map((p) =>
          order.indexOf(p.id.toString()),
        );
      for (const i of indexOfDef(STAIRWELL_BOTTOM_RAILING_DEF_ID)) expect(i).toBeGreaterThan(at);
      for (const i of indexOfDef(STAIRWELL_TOP_RAILING_DEF_ID)) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(at);
      }

      // The clip: the stairwell and its entrance, cropped, at the game's zoom.
      const canvasBox = await canvasOf(page).boundingBox();
      if (!canvasBox) throw new Error("no canvas box");
      const nw = worldPointPx(STAIRWELL_X0, STAIRWELL_Y0, 0, tile, storey, view.zoom, 0);
      const shot = await page.screenshot({
        clip: {
          x: canvasBox.x + nw.x * view.zoom + view.offsetX - tile * view.zoom,
          y: canvasBox.y + nw.y * view.zoom + view.offsetY,
          width: (STAIRWELL_FOOTPRINT.width + 2) * tile * view.zoom,
          height: (STAIRWELL_FOOTPRINT.height + 1) * tile * view.zoom,
        },
      });
      writeFileSync(join(STAIRWELL_SHOT_DIR, `${rest}.png`), shot);

      // The pixels: the whole canvas, probed only where the art is.
      const seen = PNG.sync.read(await canvasOf(page).screenshot());
      const scale = seen.width / canvasBox.width;
      const halfBodyPx = (config.bodyWidthSubcells / 2 / config.subcellsPerCell) * tile;
      const bodyHeightPx = (config.bodyHeightSubcells / config.subcellsPerCell) * tile;
      let probed = 0;
      let expected = 0;
      const wrong: string[] = [];
      for (let ay = treadTopArtY; ay < railing.height; ay++) {
        for (let ax = 0; ax < railing.width; ax++) {
          const a = (ay * railing.width + ax) * 4;
          if ((railing.data[a + 3] ?? 0) < 255) continue;
          const wx = STAIRWELL_X0 * tile + ax;
          const wy = STAIRWELL_Y0 * tile + ay;
          // Under the player's body: its width at the feet, and its height.
          if (
            Math.abs(wx + 0.5 - feet.x * tile) <= halfBodyPx &&
            wy >= feet.y * tile - bodyHeightPx &&
            wy < feet.y * tile
          ) {
            expected++;
          }
          const p = worldPointPx(wx / tile, wy / tile, 0, tile, storey, view.zoom, 0);
          const cx = p.x * view.zoom + view.offsetX + view.zoom / 2;
          const cy = p.y * view.zoom + view.offsetY + view.zoom / 2;
          if (cx < bounds.x || cx >= bounds.x + bounds.width) continue;
          if (cy < bounds.y || cy >= bounds.y + bounds.height) continue;
          const c = (Math.floor(cy * scale) * seen.width + Math.floor(cx * scale)) * 4;
          probed++;
          const diff = [0, 1, 2].reduce(
            (m, k) => Math.max(m, Math.abs((seen.data[c + k] ?? 0) - (railing.data[a + k] ?? 0))),
            0,
          );
          if (diff > 8) wrong.push(`(${ax},${ay}) differs by ${diff}`);
        }
      }
      expect(expected, "the body overlaps railing art").toBeGreaterThan(0);
      expect(probed, "every railing pixel under the body was probed").toBeGreaterThanOrEqual(
        expected,
      );
      expect(wrong, `railing pixels the player is drawn over at ${rest}`).toEqual([]);
    }
  });
});

// Story 15.15 (FR182): the flight offset, mounted. The maths is proved in
// `tests/unit/render/flight-offset*.test.ts`; this proves the wiring -- the
// mounted sprite sits at the pure function's own value, and the camera stays
// on it, on every frame of a real walk down and back up the subway stairs.
// The recording (at the page's own size) and the stills go to a directory CI
// uploads straight after the e2e step, for review.
const FLIGHT_SHOT_DIR = "test-results/review-shots/story-15.15";

interface FlightSample {
  x: number;
  y: number;
  floor: number;
  bounds: { x: number; y: number; width: number; height: number };
  view: { zoom: number; offsetX: number; offsetY: number };
  streetCulled: boolean;
}

type ArrowKey = "ArrowDown" | "ArrowRight" | "ArrowUp" | "ArrowLeft";

/** Holds `key` until the player's position meets `until`, through the one
 * walk helper: the key is released inside the page on the frame the
 * condition is first seen, so a hold never overshoots by a Node round trip. */
async function holdUntil(
  page: Page,
  key: ArrowKey,
  until: { axis: "x" | "y"; atLeast?: number; atMost?: number },
): Promise<void> {
  const segment: StreetWalkSegment =
    until.atLeast !== undefined
      ? {
          label: `hold-${key}`,
          key,
          until: { kind: `${until.axis}-at-least`, value: until.atLeast },
        }
      : {
          label: `hold-${key}`,
          key,
          until: { kind: `${until.axis}-at-most`, value: until.atMost ?? 0 },
        };
  await walkRealSegment(page, segment);
}

/** The canvas's top-left pixel: the world's background, outside any drawable. */
async function backgroundPixel(page: Page): Promise<number[]> {
  const png = PNG.sync.read(await canvasOf(page).screenshot());
  return [0, 1, 2].map((k) => png.data[(2 * png.width + 2) * 4 + k] ?? 0);
}

test.describe("story 15.15: the flight offset, mounted", () => {
  test("down and back up the subway stairs, the sprite sits at the pure offset on every frame", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const tile = balanceValue("render.tile_size_px");
    const storey = balanceValue("render.storey_height_px");
    const config = streetMovementConfig();
    const flights = buildFlights(
      STREET_TRANSITIONS,
      streetPlacedRows(),
      streetObjectSources(),
      storey,
      tile,
    );
    const index = new FlightIndex(flights, config);
    const inputs = streetWalkInputs();
    mkdirSync(FLIGHT_SHOT_DIR, { recursive: true });
    // Video is recorded for this one test only (a describe cannot switch it
    // on: it costs every other spec), by its own context, at the page's own
    // size -- never scaled.
    const size = { width: 1920, height: 1080 };
    const context = await browser.newContext({
      baseURL,
      viewport: size,
      recordVideo: { dir: FLIGHT_SHOT_DIR, size },
    });
    const page = await context.newPage();
    const video = page.video();
    try {
      await page.goto("/?freezeCrowd=1");
      await waitForSceneReady(page);
      await page.evaluate(() => {
        const w = window as unknown as { __flightSamples: unknown[]; __flightStop: boolean };
        w.__flightSamples = [];
        w.__flightStop = false;
        const sample = () => {
          const bc = window.__bc;
          const pos = bc?.playerPosition;
          const bounds = bc?.playerScreenBounds?.();
          const view = bc?.viewTransform;
          if (pos && bounds && view) {
            w.__flightSamples.push({
              x: pos.x,
              y: pos.y,
              floor: bc?.playerFloor ?? 0,
              bounds,
              view,
              streetCulled: bc?.visibility?.["ground:0"] === "hidden",
            });
          }
          if (!w.__flightStop) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      const still = async (name: string) => {
        await canvasOf(page).screenshot({ path: join(FLIGHT_SHOT_DIR, `${name}.png`) });
      };
      const settle = () => page.waitForTimeout(150);
      // Stops short of the anchor cell, whose entry is the cut.
      const lastWalkableStreetX = STAIRS_X + 1.9;

      const backgroundBefore = await backgroundPixel(page);
      await still("01-pavement-start");
      for (const segment of streetSubwayApproachRoute(inputs)) {
        if (segment.label === "down-the-subway-stairs") {
          // The south edge of the tread path (the near railing's face), down
          // the flight and back; then the north edge likewise. Sunk feet must
          // never show over the pavement south of the well.
          await holdUntil(page, "ArrowDown", { axis: "y", atLeast: inputs.nearRailingRestY });
          await holdUntil(page, "ArrowLeft", { axis: "x", atMost: STAIRS_X + 2.4 });
          await settle();
          await still("02-south-edge-mid-flight");
          // A reversal mid-flight.
          await holdUntil(page, "ArrowRight", { axis: "x", atLeast: STAIRS_X + 3.3 });
          await holdUntil(page, "ArrowLeft", { axis: "x", atMost: lastWalkableStreetX });
          await settle();
          await still("03-south-edge-last-walkable");
          await holdUntil(page, "ArrowRight", { axis: "x", atLeast: STAIRS_X + 3.3 });
          // The path's north edge: the first row the route walks the treads on.
          await holdUntil(page, "ArrowUp", { axis: "y", atMost: inputs.subwayTreadRowY + 0.15 });
          await holdUntil(page, "ArrowLeft", { axis: "x", atMost: lastWalkableStreetX });
          await settle();
          await still("04-north-edge-last-walkable");
        }
        await walkRealSegment(page, segment);
      }
      await settle();
      await still("05-platform-landing-after-descent");
      const restX = platformWestRestX();
      await page.keyboard.down("ArrowLeft");
      await page.waitForFunction(
        (x) => Math.abs((window.__bc?.playerPosition?.x ?? Infinity) - x) < 1e-6,
        restX,
        { timeout: 15_000 },
      );
      await page.keyboard.up("ArrowLeft");
      await still("06-platform-floor-at-rest");
      // The highest walkable point before the platform's cut.
      await holdUntil(page, "ArrowRight", { axis: "x", atLeast: PLATFORM_UP_ANCHOR_X - 0.6 });
      await settle();
      await still("07-platform-last-walkable");
      await holdUntil(page, "ArrowLeft", { axis: "x", atMost: PLATFORM_UP_ANCHOR_X - 1.4 });
      await walkTo(page, "ArrowRight", { x: STREET_EXIT_X + 0.5, y: STREET_EXIT_Y + 0.5 });
      await settle();
      await still("08-street-tread-after-ascent");
      // The ascent continues out onto the pavement.
      await holdUntil(page, "ArrowRight", { axis: "x", atLeast: SUBWAY_ENTRANCE_X0 + 0.5 });
      await holdUntil(page, "ArrowUp", { axis: "y", atMost: STAIRS_Y - 1.5 });
      await settle();
      await still("09-pavement-after-ascent");
      const backgroundAfter = await backgroundPixel(page);
      expect(backgroundAfter, "the street's surround is restored after the climb").toEqual(
        backgroundBefore,
      );

      await page.evaluate(() => {
        (window as unknown as { __flightStop: boolean }).__flightStop = true;
      });
      const samples = await page.evaluate(
        () => (window as unknown as { __flightSamples: FlightSample[] }).__flightSamples,
      );
      expect(samples.length).toBeGreaterThan(100);

      const drawnOffsetPx = (s: FlightSample): number => {
        const feetWorldY = (s.bounds.y + s.bounds.height - s.view.offsetY) / s.view.zoom;
        const logicalWorldY = s.y * tile - s.floor * storey;
        return feetWorldY - logicalWorldY;
      };
      const zoom = samples.at(0)?.view.zoom ?? 1;
      // The steepest the offset may move in one frame: the clamp's own step
      // along the steepest flight, plus the whole-screen-pixel snap.
      const slopePxPerCell = Math.max(
        ...flights.map((f) => Math.abs(f.dropPx) / (f.fullS - f.startS)),
      );
      const maxStepPx = slopePxPerCell * config.walkSpeedCellsPerMs * RELEASE_LAG.stepMs + 1 / zoom;
      const viewport = page.viewportSize() ?? size;

      let sawOffset = false;
      samples.forEach((s, i) => {
        // (1) The wiring: the mounted sprite's feet are the pure function's value.
        const expected = index.offsetPx(s.x, s.y, s.floor);
        expect(Math.abs(drawnOffsetPx(s) - expected), `frame ${i}`).toBeLessThanOrEqual(
          1 / s.view.zoom + 1e-6,
        );
        if (expected !== 0) sawOffset = true;
        // The camera half: the sprite's bottom-centre stays on the canvas
        // centre on every frame, flight or not.
        const cx = s.bounds.x + s.bounds.width / 2;
        const cy = s.bounds.y + s.bounds.height;
        expect(Math.abs(cx - viewport.width / 2), `frame ${i} camera x`).toBeLessThanOrEqual(1);
        expect(Math.abs(cy - viewport.height / 2), `frame ${i} camera y`).toBeLessThanOrEqual(1);
        // (4) The floor and the street's culling flip on the same frame.
        expect(s.streetCulled, `frame ${i}`).toBe(s.floor === SUBWAY_FLOOR);
        const prev = samples[i - 1];
        if (!prev || prev.floor !== s.floor) return; // the floor change is the cut
        // (2) No pop between frames on one floor.
        expect(Math.abs(drawnOffsetPx(s) - drawnOffsetPx(prev)), `frame ${i}`).toBeLessThanOrEqual(
          maxStepPx,
        );
        // A rest holds its height.
        if (prev.x === s.x && prev.y === s.y) {
          expect(drawnOffsetPx(s), `frame ${i} at rest`).toBeCloseTo(drawnOffsetPx(prev), 6);
        }
      });
      expect(sawOffset, "the walk crossed both flights").toBe(true);

      // (3) Zero at rest on the pavement and on the platform floor.
      const first = samples.at(0);
      if (!first) throw new Error("no samples");
      expect(index.offsetPx(first.x, first.y, first.floor)).toBe(0);
      expect(Math.abs(drawnOffsetPx(first))).toBeLessThanOrEqual(1 / first.view.zoom + 1e-6);
      const onPlatform = samples.filter(
        (s) => s.floor === SUBWAY_FLOOR && Math.abs(s.x - restX) < 1e-6,
      );
      expect(onPlatform.length).toBeGreaterThan(0);
      for (const s of onPlatform) {
        expect(index.offsetPx(s.x, s.y, s.floor)).toBe(0);
        expect(Math.abs(drawnOffsetPx(s))).toBeLessThanOrEqual(1 / s.view.zoom + 1e-6);
      }
    } finally {
      // Saved whether or not the walk finished: the failing run is the one
      // whose recording matters.
      await context.close();
      await video?.saveAs(join(FLIGHT_SHOT_DIR, "walk-down-and-up.webm"));
      await video?.delete();
    }
  });
});
