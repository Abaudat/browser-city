// Story 1.13's one integration spec (Quentin's direction): one scripted
// walk down the real, mounted street, driven by real `page.keyboard`
// input only -- no teleport hook, nothing writing the player's position
// or floor through `window.__bc`.
//
// It adds almost no new facts. Every geometric and ordering fact is
// already proven at unit level (`tests/unit/render/**`,
// `tests/unit/world/**`, `tests/unit/test-street/**`), and this spec never
// re-proves one. It asserts only what no single-module test can see: that
// collision, depth order, wall retraction, floor culling and appearance
// behave correctly *together*, on one real mounted scene, after a real
// walk.
//
// Every expected value is computed here from the same pure functions the
// page runs (the comparator through `sortAcrossFloors`, `computeVisibility`
// through the committed goldens) or read from the street module -- never a
// literal order, position or id typed into this file. Every wait is a
// `waitForFunction` on real page state; there is no `waitForTimeout` on
// the walk, and `retries` stays 0.
//
// It replaces `movement.spec.ts` and `render-order.spec.ts`: both walked
// the same page to prove a subset of what the walk below proves, and a
// third boot of the same scene costs the slowest job in the repo real
// wall time.
//
// Two `toHaveScreenshot` checks (Quentin's direction, cycle 1) catch what
// no id-based assertion can: "every check passes and it looks wrong". A
// fixed 1920x1080 viewport (`test.use` below), `animations: "disabled"`
// and a tight `maxDiffPixelRatio` keep them meaningful rather than
// perpetually flaky. `?freezeCrowd=1` (a DEV-only query flag,
// `main.ts`) starts the street crowd's own walk-cycle ticker paused, so
// every citizen stays at its initial, fixed-fixture pose -- otherwise
// which frame of which citizen's walk cycle happens to be on screen at
// screenshot time would depend on real wall-clock timing, and no baseline
// could ever be stable. Nothing else this spec asserts depends on the
// crowd's own animation being live.
//
// Baselines are committed PNGs, generated on the CI image (linux
// chromium) -- never on a contributor's own machine, whose font hinting
// and GPU rasteriser render different pixels than CI's. Regenerate them
// by running `.github/workflows/update-visual-baselines.yml` against
// this branch (`gh workflow run update-visual-baselines.yml --ref
// <branch>`, or the Actions tab's "Run workflow" button) -- it runs this
// spec with `--update-snapshots` on `ubuntu-latest` and pushes the
// changed `*-snapshots/*.png` files back to the branch it was run on.
import { expect, type Page, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import { sortAcrossFloors } from "../../src/render/floor-stacks";
import { buildLayerRankTable, resolveRank } from "../../src/render/layer-ranks";
import { LAYER_TABLE } from "../../src/render/layer-table";
import { buildPlayerDrawable, buildPropDrawables } from "../../src/test-street/drawables";
import {
  BRIDGE_DECK_Y,
  BRIDGE_FLOOR,
  BRIDGE_X0,
  BRIDGE_X1,
  furnitureBehindWindows,
  LAMPPOST_CELL,
  LAMPPOST_DEF_ID,
  PLAYER_STABLE_ID,
  PLAYER_START,
  SHOP_A_BUILDING_ID,
  SHOP_B_BUILDING_ID,
  STREET_PROPS,
  type StreetWalkSegment,
  type StreetWalkUntil,
  streetWalkRoute,
  WINDOW_DEF_ID,
} from "../../src/test-street/fixture";
import {
  committedDefs,
  lamppostRestY,
  streetOwnershipIndex,
  streetWindowDefIds,
} from "../unit/test-street/street-world";

// The whole walk is one test on purpose: it is one continuous journey,
// and splitting it would re-boot and re-walk the scene per assertion.
test.describe.configure({ mode: "serial" });

// The fixed viewport the two `toHaveScreenshot` checks need -- applies to
// the whole test, not only those two moments, which is fine: nothing else
// this spec asserts depends on the window size (the canvas itself is
// sized to the world's own bounds, never to the viewport).
test.use({ viewport: { width: 1920, height: 1080 } });

const SCREENSHOT_OPTIONS = {
  animations: "disabled",
  maxDiffPixelRatio: 0.01,
  // Playwright's own "wait for a stable screenshot" pre-check needs more
  // than its 5s default the first time it runs on a CI image: nothing
  // here is still animating (the crowd is frozen), but a cold headless
  // Chromium settling its own compositor/font state on an unfamiliar
  // runner has taken longer than that in practice.
  timeout: 30_000,
} as const;

const RANK_TABLE = buildLayerRankTable(LAYER_TABLE.map(({ code, rank }) => ({ code, rank })));
const CODE_BY_NAME = Object.fromEntries(LAYER_TABLE.map((row) => [row.name, row.code]));

function rankOf(layer: string): number {
  const code = CODE_BY_NAME[layer];
  if (code === undefined) throw new Error(`unknown street layer ${layer}`);
  return resolveRank(RANK_TABLE, code);
}

const ownership = streetOwnershipIndex();

/** The order the comparator demands for a player standing exactly here --
 * computed by calling the real comparator, never a literal. */
function expectedOrderFor(x: number, y: number, floor: number): string[] {
  const props = buildPropDrawables({
    rankOf,
    ownership,
    windowDefIds: streetWindowDefIds(),
  });
  const player = buildPlayerDrawable(rankOf("characters"), x, y, floor);
  return sortAcrossFloors([...props, player], (d) => d).map((d) => d.stableId.toString());
}

interface PlayerState {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}

async function playerState(page: Page): Promise<PlayerState> {
  const state = await page.evaluate(() => ({
    x: window.__bc?.playerPosition?.x,
    y: window.__bc?.playerPosition?.y,
    floor: window.__bc?.playerFloor,
  }));
  if (state.x === undefined || state.y === undefined || state.floor === undefined) {
    throw new Error("the page reported no player position");
  }
  return { x: state.x, y: state.y, floor: state.floor };
}

async function waitForSceneReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__bc?.renderOrder?.length ?? 0) > 0, undefined, {
    timeout: 20_000,
  });
  await page.waitForFunction(
    () => Object.keys(window.__bc?.visibility ?? {}).length > 0,
    undefined,
    { timeout: 20_000 },
  );
  // The street crowd's own composites finish loading after the first
  // visibility pass (`scene.ts` mounts it last, deliberately), and this
  // spec asserts on them -- so "ready" includes them.
  await page.waitForFunction(() => window.__bc?.playerAppearance !== undefined, undefined, {
    timeout: 30_000,
  });
}

/** Holds one key until the page itself reports the segment's own release
 * condition -- never a fixed wait. The condition is the street module's
 * own data; only the switch over its shape lives here, because it has to
 * run inside the page. */
async function walkSegment(page: Page, segment: StreetWalkSegment): Promise<void> {
  await page.keyboard.down(segment.key);
  try {
    await page.waitForFunction(
      (until: StreetWalkUntil) => {
        const position = window.__bc?.playerPosition;
        const floor = window.__bc?.playerFloor;
        if (!position || floor === undefined) return false;
        switch (until.kind) {
          case "x-at-least":
            return position.x >= until.value;
          case "x-at-most":
            return position.x <= until.value;
          case "y-at-least":
            return position.y >= until.value;
          case "y-at-most":
            return position.y <= until.value;
          case "floor":
            return floor === until.value;
        }
      },
      segment.until,
      { timeout: 30_000 },
    );
  } finally {
    await page.keyboard.up(segment.key);
  }
}

/** FR137's latency guard, ported from the deleted `movement.spec.ts` onto
 * the walk's own first segment rather than run a second time (Quentin's
 * direction, cycle 1: it costs nothing extra -- the key is being pressed
 * either way). Holds `segment.key` exactly like [`walkSegment`], but
 * first installs an in-page `requestAnimationFrame` probe that counts
 * real animation frames from the browser's own `keydown` event (anchored
 * inside the page, on the event itself -- never on the `page.evaluate`
 * call that installs the probe, which is a separate CDP round trip) to
 * the first frame `window.__bc.playerPosition.y` reads past `startY`.
 * Returns that frame count. */
async function walkSegmentMeasuringLatency(
  page: Page,
  segment: StreetWalkSegment,
  startY: number,
): Promise<number> {
  await page.evaluate((y) => {
    const probe = { framesSinceKeydown: null as number | null, movedAt: null as number | null };
    (window as unknown as { __bcFrames: typeof probe }).__bcFrames = probe;
    window.addEventListener("keydown", () => {
      probe.framesSinceKeydown ??= 0;
    });
    const tick = (): void => {
      if (probe.framesSinceKeydown !== null && probe.movedAt === null) {
        probe.framesSinceKeydown++;
        if ((window.__bc?.playerPosition?.y ?? y) > y) {
          probe.movedAt = probe.framesSinceKeydown;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, startY);

  await walkSegment(page, segment);

  return page.evaluate(
    () =>
      (window as unknown as { __bcFrames?: { movedAt: number | null } }).__bcFrames?.movedAt ??
      Number.NaN,
  );
}

/** Every visibility state the real, mounted adapter just wrote, read back
 * off each sprite's own `visible`/`alpha` (never recomputed in the page). */
function currentVisibility(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => window.__bc?.visibility ?? {});
}

function currentAlpha(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => window.__bc?.visibilityAlpha ?? {});
}

function currentOrder(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__bc?.renderOrder ?? []);
}

/** The ids of every wall drawable a building owns, from the street module
 * -- so "its near-side walls" is never a hand-typed id list. */
function wallIdsOwnedBy(buildingId: bigint): string[] {
  return STREET_PROPS.filter(
    (prop) =>
      prop.layer === "walls" &&
      ownership.ownershipAt(prop.x, prop.y, prop.floor).buildingId === buildingId,
  ).map((prop) => prop.id.toString());
}

function windowIds(): string[] {
  return STREET_PROPS.filter((prop) => prop.defId === WINDOW_DEF_ID).map((prop) =>
    prop.id.toString(),
  );
}

/** Every drawable id on a given floor -- used to prove the mounted order
 * really is grouped by floor, ascending. */
function idsOnFloor(floor: number): Set<string> {
  return new Set(
    STREET_PROPS.filter((prop) => prop.floor === floor).map((prop) => prop.id.toString()),
  );
}

test("one walk down the test street: collision, depth order, retraction, floors and appearance together", async ({
  page,
}) => {
  // The walk crosses the whole street at the committed walking speed.
  test.setTimeout(180_000);

  const wsPromise = page.waitForEvent("websocket");
  await page.goto("/?freezeCrowd=1");
  const ws = await wsPromise;
  await waitForSceneReady(page);
  const canvas = page.locator("#test-street canvas");

  let framesSentWhileWalking = 0;
  const onFrameSent = (): void => {
    framesSentWhileWalking++;
  };
  ws.on("framesent", onFrameSent);

  /** A `toHaveScreenshot` check holds the player still for as long as its
   * own stability wait takes (cold-CI-runner minutes on the first run,
   * `SCREENSHOT_OPTIONS.timeout` above) -- long enough, in practice, to
   * cross a websocket keepalive interval that has nothing to do with
   * movement. The FR137 claim below is specifically about movement, so a
   * screenshot's own dwell time is excluded from what it measures, the
   * same way the scene's own player is not moving while one is taken. */
  async function screenshot(name: string): Promise<void> {
    ws.off("framesent", onFrameSent);
    try {
      await expect(canvas).toHaveScreenshot(name, SCREENSHOT_OPTIONS);
    } finally {
      ws.on("framesent", onFrameSent);
    }
  }

  // --- inside shop A -----------------------------------------------------
  const start = await playerState(page);
  expect(start).toEqual({ x: PLAYER_START.x, y: PLAYER_START.y, floor: PLAYER_START.floor });

  const appearanceAtStart = await page.evaluate(() => window.__bc?.playerAppearance);
  expect(appearanceAtStart).toBeDefined();
  // FR61: five stored part indices, three of which are never absent.
  expect(appearanceAtStart?.body).toBeGreaterThan(0);
  expect(appearanceAtStart?.eyes).toBeGreaterThan(0);
  expect(appearanceAtStart?.outfit).toBeGreaterThan(0);

  // FR120, from inside: this building's own near-side walls are gone, and
  // the neighbour's are not -- keyed on the enclosure id, never proximity.
  const insideVisibility = await currentVisibility(page);
  const shopAWalls = wallIdsOwnedBy(SHOP_A_BUILDING_ID);
  const shopBWalls = wallIdsOwnedBy(SHOP_B_BUILDING_ID);
  expect(shopAWalls.some((id) => insideVisibility[id] === "hidden")).toBe(true);
  expect(shopBWalls.every((id) => insideVisibility[id] !== "hidden")).toBe(true);
  expect(await page.evaluate(() => window.__bc?.masksAllNull)).toBe(true);

  // The mounted display list is in the order the comparator demands for
  // the player's real position -- not a literal, and not a rule this spec
  // re-derives.
  expect(await currentOrder(page)).toEqual(expectedOrderFor(start.x, start.y, start.floor));

  // The interior checkpoint (Quentin's direction, cycle 1): every id-based
  // check above passes, and this is what catches it if it still looks
  // wrong.
  await screenshot("interior.png");

  const route = streetWalkRoute({ lamppostRestY: lamppostRestY() });
  const segment = (label: string): StreetWalkSegment => {
    const found = route.find((s) => s.label === label);
    if (!found) throw new Error(`no route segment '${label}'`);
    return found;
  };

  // --- out onto the pavement --------------------------------------------
  // FR137: holding the key moves the avatar within a few real animation
  // frames of the browser's own keydown, with no round trip -- proven on
  // this segment because it is the walk's own first held key, so nothing
  // else is added by measuring it here.
  const movedAtFrame = await walkSegmentMeasuringLatency(
    page,
    segment("outside-the-shopfront"),
    start.y,
  );
  // One frame for the scene's own ticker to run after the keydown, plus
  // one for the probe's callback possibly running ahead of it on that
  // same frame. Anything beyond that is a round trip, not a frame.
  expect(movedAtFrame).toBeLessThanOrEqual(2);
  const outside = await playerState(page);
  expect(outside.floor).toBe(PLAYER_START.floor);

  const outsideVisibility = await currentVisibility(page);
  // The walls are back the moment the player is outside the enclosure.
  expect(shopAWalls.every((id) => outsideVisibility[id] !== "hidden")).toBe(true);
  // FR121: seen from the pavement, the window is translucent at exactly
  // `render.window_alpha`, and the furniture behind it is still drawn.
  const windowAlpha = committedDefs().balance.find((b) => b.key === "render.window_alpha");
  if (!windowAlpha) throw new Error("no render.window_alpha balance key");
  const alphas = await currentAlpha(page);
  for (const id of windowIds()) {
    expect(outsideVisibility[id]).toBe("translucent");
    expect(alphas[id]).toBeCloseTo(windowAlpha.value / 100, 5);
  }
  // The real "behind a window" set (Quentin's direction, cycle 1): same
  // floor, north of the window's own row, x-overlapping its footprint --
  // never every floor-0 furniture prop regardless of whether a window
  // actually sits in front of it, which would pass vacuously on a
  // re-laid street.
  const furnitureBehindTheWindow = furnitureBehindWindows().map((id) => id.toString());
  expect(furnitureBehindTheWindow.length).toBeGreaterThan(0);
  for (const id of furnitureBehindTheWindow) {
    expect(outsideVisibility[id]).not.toBe("hidden");
  }

  // --- part-way through the lamppost -------------------------------------
  await walkSegment(page, segment("part-way-through-the-lamppost"));
  const atLamppost = await playerState(page);
  // Collision and depth together: the avatar's feet are inside the prop's
  // own footprint cell, and outside its collider (the collider is smaller
  // than the cell, so part of the cell is walkable) ...
  expect(Math.floor(atLamppost.x)).toBe(LAMPPOST_CELL.x);
  expect(Math.floor(atLamppost.y)).toBe(LAMPPOST_CELL.y);
  const lamppost = committedDefs().objects.find((object) => object.id === LAMPPOST_DEF_ID);
  if (!lamppost?.collider) throw new Error("the lamppost has no collider in defs/");
  const colliderTopY =
    LAMPPOST_CELL.y + lamppost.collider.y0 / committedDefs().colliderSubcellsPerCell;
  expect(atLamppost.y).toBeLessThanOrEqual(colliderTopY + 1e-6);
  // ... and the mounted order for that exact position is the comparator's
  // own, which puts the avatar behind the prop while it is north of the
  // prop's own sort line.
  const orderAtLamppost = await currentOrder(page);
  expect(orderAtLamppost).toEqual(expectedOrderFor(atLamppost.x, atLamppost.y, atLamppost.floor));
  // The avatar's feet are south of the prop's own sort line here (it came
  // to rest part-way into the prop's cell), so the comparator draws it in
  // *front* of the prop, and the mounted list agrees -- it is the
  // comparator's own output. The mirror case (north of the line, drawn
  // behind) is a pure fact about the comparator, proven exhaustively by
  // `inv_depth_order_total_and_stable`; walking it again here would only
  // re-prove it slower.
  const lamppostProp = STREET_PROPS.find((prop) => prop.defId === LAMPPOST_DEF_ID);
  if (!lamppostProp) throw new Error("no lamppost in the street");
  expect(orderAtLamppost.indexOf(PLAYER_STABLE_ID.toString())).toBeGreaterThan(
    orderAtLamppost.indexOf(lamppostProp.id.toString()),
  );

  // --- under the bridge --------------------------------------------------
  await walkSegment(page, segment("east-along-the-pavement"));
  await walkSegment(page, segment("on-the-underpass-row"));
  await walkSegment(page, segment("under-the-bridge"));
  const underTheBridge = await playerState(page);
  expect(underTheBridge.floor).toBe(PLAYER_START.floor);
  expect(Math.floor(underTheBridge.y)).toBe(BRIDGE_DECK_Y);
  expect(underTheBridge.x).toBeGreaterThan(BRIDGE_X1);

  // The underpass checkpoint (Quentin's direction, cycle 1): both floors
  // are drawn here, and this is the one check that would have caught the
  // avatar reading as clipped at the canvas edge instead of visibly under
  // a deck.
  await screenshot("underpass.png");

  // Two floors at one (x, y), both drawn: the deck above is not culled
  // (FR122 culls by sign, and both floors are street-side), and the
  // mounted order puts every floor-1 drawable after every floor-0 one --
  // which is what makes the deck cover the pavement it spans.
  const underVisibility = await currentVisibility(page);
  const deckIds = idsOnFloor(BRIDGE_FLOOR);
  expect(deckIds.size).toBeGreaterThan(0);
  for (const id of deckIds) expect(underVisibility[id]).not.toBe("hidden");

  const orderUnderTheBridge = await currentOrder(page);
  expect(orderUnderTheBridge).toEqual(
    expectedOrderFor(underTheBridge.x, underTheBridge.y, underTheBridge.floor),
  );
  const streetIds = idsOnFloor(PLAYER_START.floor);
  const lastStreetIndex = Math.max(
    ...orderUnderTheBridge.map((id, index) => (streetIds.has(id) ? index : -1)),
  );
  const firstDeckIndex = orderUnderTheBridge.findIndex((id) => deckIds.has(id));
  expect(firstDeckIndex).toBeGreaterThan(lastStreetIndex);

  // --- up onto the deck --------------------------------------------------
  await walkSegment(page, segment("on-the-bridge-deck"));
  const onDeck = await playerState(page);
  expect(onDeck.floor).toBe(BRIDGE_FLOOR);
  expect(Math.floor(onDeck.x)).toBeGreaterThanOrEqual(BRIDGE_X0);
  expect(Math.floor(onDeck.x)).toBeLessThanOrEqual(BRIDGE_X1);
  // The player itself moved into the upper floor's own stack, so the
  // mounted order still matches the comparator for its new floor.
  expect(await currentOrder(page)).toEqual(expectedOrderFor(onDeck.x, onDeck.y, onDeck.floor));
  // The street below is still drawn: a floor above the viewer is only
  // culled where the viewer's own enclosure owns it, and the street is
  // nobody's storey.
  const deckVisibility = await currentVisibility(page);
  expect([...streetIds].some((id) => deckVisibility[id] !== "hidden")).toBe(true);

  // --- back down to the street -------------------------------------------
  await walkSegment(page, segment("back-on-the-street"));
  const backOnTheStreet = await playerState(page);
  expect(backOnTheStreet.floor).toBe(PLAYER_START.floor);
  expect(await currentOrder(page)).toEqual(
    expectedOrderFor(backOnTheStreet.x, backOnTheStreet.y, backOnTheStreet.floor),
  );

  ws.off("framesent", onFrameSent);
  // FR137: the whole walk was client-authoritative -- not one WebSocket
  // frame, and therefore not one reducer call, while moving.
  expect(framesSentWhileWalking).toBe(0);

  // Appearance is the same five parts it was before the walk (FR61): the
  // avatar never lost or re-rolled a part by walking, transitioning floor
  // or crossing an enclosure -- and the same again after a reload, which
  // is what makes it a property of the pipeline rather than of this
  // session. (`appearanceTextureIds` is deliberately *not* what is
  // compared: those are opaque per-session identity counters, assigned in
  // texture-load order, and carry no meaning across a reload.)
  expect(await page.evaluate(() => window.__bc?.playerAppearance)).toEqual(appearanceAtStart);
  await page.reload();
  await waitForSceneReady(page);
  expect(await page.evaluate(() => window.__bc?.playerAppearance)).toEqual(appearanceAtStart);
});
