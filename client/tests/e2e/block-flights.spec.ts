// Stairs, mounted (stories 15.15, 15.19, 15.20, 15.21; FR117, FR124, FR182,
// FR183): the generator places no flight yet, so the fixture block carries
// the subway stairwell, its platform and the footbridge's flight as rows of
// the one streamed world. These specs walk them with real key presses and
// assert through `window.__bc`, never pixels: the floors reached, the
// sprite at the pure flight offset on every frame, the camera centred.
// The maths is proved in `tests/unit/world/flights.test.ts` and
// `flight-pace.test.ts`; this guards the wiring.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import { buildFlights, FlightIndex } from "../../src/world/flights";
import {
  BRIDGE_DECK_Y,
  BRIDGE_FLIGHT_X0,
  BRIDGE_FLOOR,
  BRIDGE_FOOT_Y,
  BRIDGE_X0,
  committedDefs,
  PLATFORM_LANDING_X,
  STAIRS_Y,
  STAIRWELL_X0,
  STREET_FLOOR,
  STREET_TRANSITIONS,
  SUBWAY_ENTRANCE_X0,
  SUBWAY_FLOOR,
  streetMovementConfig,
  streetObjectSources,
  streetPlacedRows,
  streetStandable,
} from "../unit/support/stairs-world";
import { enterBlock, standInBlock } from "./block-support";
import { expect, test } from "./fixtures";
import { walkRealSegment } from "./walk-support";
import type { WalkSegment } from "./walk-types";

const SHOT_DIR = "test-results/review-shots/story-15.21";

function balance(key: string): number {
  const entry = committedDefs().balance.find((b) => b.key === key);
  if (!entry) throw new Error(`no balance key '${key}'`);
  return entry.value;
}
const TILE = balance("render.tile_size_px");
const STOREY = balance("render.storey_height_px");

const flights = new FlightIndex(
  buildFlights(
    STREET_TRANSITIONS,
    streetPlacedRows(),
    streetObjectSources(),
    TILE,
    streetStandable,
  ),
  streetMovementConfig(),
);

interface Sample {
  x: number;
  y: number;
  floor: number;
  bounds: { x: number; y: number; width: number; height: number };
  view: { zoom: number; offsetX: number; offsetY: number };
  streetCulled: boolean;
}

/** Records the player's position, floor, drawn bounds and camera on every
 * animation frame until [`stopSampling`]. */
async function startSampling(page: Page): Promise<void> {
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
}

async function stopSampling(page: Page): Promise<Sample[]> {
  await page.evaluate(() => {
    (window as unknown as { __flightStop: boolean }).__flightStop = true;
  });
  return page.evaluate(() => (window as unknown as { __flightSamples: Sample[] }).__flightSamples);
}

/** The sprite's feet against the floor-stacked logical point: how far the
 * drawn body is lifted by a flight, in world pixels. */
function drawnOffsetPx(s: Sample): number {
  const feetWorldY = (s.bounds.y + s.bounds.height - s.view.offsetY) / s.view.zoom;
  const logicalWorldY = s.y * TILE - s.floor * STOREY;
  return feetWorldY - logicalWorldY;
}

/** Holds `key` until the player stands on `floor`. */
const toFloor = (label: string, key: WalkSegment["key"], floor: number): WalkSegment => ({
  label,
  key,
  until: { kind: "floor", value: floor },
});

/** The wiring claims of a mounted flight walk, over every frame sampled. */
function assertFlightFrames(
  samples: readonly Sample[],
  viewport: { width: number; height: number },
) {
  expect(samples.length).toBeGreaterThan(30);
  const zoom = samples[0]?.view.zoom ?? 1;
  const config = streetMovementConfig();
  const slopePxPerCell = Math.max(
    ...buildFlights(
      STREET_TRANSITIONS,
      streetPlacedRows(),
      streetObjectSources(),
      TILE,
      streetStandable,
    ).map((f) => Math.abs(f.dropPx) / (f.fullS - f.startS)),
  );
  // The steepest the offset may move in one frame: the clamp's own step along
  // the steepest flight, plus the whole-screen-pixel snap.
  const maxStepPx = slopePxPerCell * config.walkSpeedCellsPerMs * 100 + 1 / zoom;
  let sawOffset = false;
  samples.forEach((s, i) => {
    // The wiring: the mounted sprite's feet are the pure function's value.
    const expected = flights.offsetPx(s.x, s.y, s.floor);
    // Within two screen pixels: the sprite and the camera each snap to a
    // whole one, so the drawn feet sit within 2 / zoom of the pure value.
    expect(Math.abs(drawnOffsetPx(s) - expected), `frame ${i}`).toBeLessThanOrEqual(
      2 / s.view.zoom + 1e-6,
    );
    if (expected !== 0) sawOffset = true;
    // The camera half: the sprite's bottom-centre stays on the canvas
    // centre on every frame, flight or not.
    const cx = s.bounds.x + s.bounds.width / 2;
    const cy = s.bounds.y + s.bounds.height;
    expect(Math.abs(cx - viewport.width / 2), `frame ${i} camera x`).toBeLessThanOrEqual(1);
    expect(Math.abs(cy - viewport.height / 2), `frame ${i} camera y`).toBeLessThanOrEqual(1);
    // The floor and the street's culling flip on the same frame: below
    // ground the street is culled, above it is drawn.
    expect(s.streetCulled, `frame ${i} culling`).toBe(s.floor < STREET_FLOOR);
    const prev = samples[i - 1];
    if (!prev || prev.floor !== s.floor) return; // the floor change is the cut
    // No pop between frames on one floor.
    expect(Math.abs(drawnOffsetPx(s) - drawnOffsetPx(prev)), `frame ${i}`).toBeLessThanOrEqual(
      maxStepPx,
    );
    // A rest holds its height.
    if (prev.x === s.x && prev.y === s.y) {
      expect(drawnOffsetPx(s), `frame ${i} at rest`).toBeCloseTo(drawnOffsetPx(prev), 6);
    }
  });
  expect(sawOffset, "the walk crossed a flight").toBe(true);
}

test.use({ viewport: { width: 1920, height: 1080 }, video: "on" });

test("down the subway stairs pressed against the bottom wall and back up, the sprite sits at the pure offset on every frame", async ({
  page,
}) => {
  test.setTimeout(120_000);
  mkdirSync(SHOT_DIR, { recursive: true });
  // A flight's offset needs both halves of its pair, and a pair spans two
  // bands: the platform's rows are held before the walk, as they would be
  // for a player who has been below. (Until they are, a descent from the
  // street shows no offset -- recorded in docs/generation.md.)
  await enterBlock(page, PLATFORM_LANDING_X + 0.5, 3.5, SUBWAY_FLOOR);
  // The posture of story 15.20: flush against the stairwell's bottom
  // railing, one cell east of the opening, holding the flight's direction.
  await standInBlock(page, SUBWAY_ENTRANCE_X0 + 0.5, STAIRS_Y + 1, STREET_FLOOR);
  await startSampling(page);
  await page.screenshot({ path: join(SHOT_DIR, "subway-01-street.png") });

  await walkRealSegment(page, toFloor("down-the-stairs", "ArrowLeft", SUBWAY_FLOOR));
  expect(await page.evaluate(() => window.__bc?.playerFloor)).toBe(SUBWAY_FLOOR);
  await page.screenshot({ path: join(SHOT_DIR, "subway-02-platform.png") });

  // Back up the platform's flight, east then up its own anchor.
  await walkRealSegment(page, toFloor("up-the-stairs", "ArrowRight", STREET_FLOOR));
  expect(await page.evaluate(() => window.__bc?.playerFloor)).toBe(STREET_FLOOR);
  await page.screenshot({ path: join(SHOT_DIR, "subway-03-street-again.png") });

  const samples = await stopSampling(page);
  assertFlightFrames(samples, page.viewportSize() ?? { width: 1920, height: 1080 });
  // The platform's own floor is flat: off the flight there is no offset.
  const onPlatform = samples.filter(
    (s) => s.floor === SUBWAY_FLOOR && Math.abs(s.x - PLATFORM_LANDING_X) < 1e-6,
  );
  for (const s of onPlatform) expect(flights.offsetPx(s.x, s.y, s.floor)).toBe(0);
});

test("up the footbridge's flight to the deck and back down, the sprite sits at the pure offset on every frame and the deck is a floor of its own", async ({
  page,
}) => {
  test.setTimeout(120_000);
  mkdirSync(SHOT_DIR, { recursive: true });
  const column = BRIDGE_FLIGHT_X0 + 0.5;
  await enterBlock(page, column, BRIDGE_FOOT_Y + 0.5, STREET_FLOOR);
  await startSampling(page);
  await page.screenshot({ path: join(SHOT_DIR, "bridge-01-foot.png") });

  await walkRealSegment(page, toFloor("up-the-flight", "ArrowUp", BRIDGE_FLOOR));
  expect(await page.evaluate(() => window.__bc?.playerFloor)).toBe(BRIDGE_FLOOR);
  // Off the flight onto the deck's own row, then west along it: still on
  // the deck's floor.
  await walkRealSegment(page, {
    label: "onto-the-deck",
    key: "ArrowUp",
    until: { kind: "y-at-most", value: BRIDGE_DECK_Y + 0.5 },
  });
  await walkRealSegment(page, {
    label: "along-the-deck",
    key: "ArrowLeft",
    until: { kind: "x-at-most", value: BRIDGE_X0 + 0.5 },
  });
  expect(await page.evaluate(() => window.__bc?.playerFloor)).toBe(BRIDGE_FLOOR);
  await page.screenshot({ path: join(SHOT_DIR, "bridge-02-deck.png") });

  // Back along the deck to the flight's own column and down it.
  await walkRealSegment(page, {
    label: "back-along-the-deck",
    key: "ArrowRight",
    until: { kind: "x-at-least", value: column },
  });
  await walkRealSegment(page, toFloor("down-the-flight", "ArrowDown", STREET_FLOOR));
  expect(await page.evaluate(() => window.__bc?.playerFloor)).toBe(STREET_FLOOR);

  const samples = await stopSampling(page);
  assertFlightFrames(samples, page.viewportSize() ?? { width: 1920, height: 1080 });
  expect(samples.some((s) => s.floor === BRIDGE_FLOOR)).toBe(true);
});

test("pressed south along the near railing, the player draws after the top railing and before the bottom one (FR123)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // The stairwell's own rows in the block: top railing, treads, well, bottom
  // railing (ids 1..4); the player's stable id is 1000.
  const [topRailing, , , bottomRailing] = ["1", "2", "3", "4"];
  const player = "1000";
  await enterBlock(page, STAIRWELL_X0 + 1.5, STAIRS_Y + 0.2, STREET_FLOOR);
  await walkRealSegment(page, {
    label: "pressed-south-on-the-treads",
    key: "ArrowDown",
    until: { kind: "y-at-least", value: STAIRS_Y + 0.6 },
  });
  const order = await page.evaluate(() => window.__bc?.renderOrder ?? []);
  const at = (id: string) => order.indexOf(id);
  expect(at(topRailing as string), "top railing drawn").toBeGreaterThanOrEqual(0);
  expect(at(bottomRailing as string), "bottom railing drawn").toBeGreaterThanOrEqual(0);
  expect(at(player), "player drawn").toBeGreaterThanOrEqual(0);
  expect(at(topRailing as string)).toBeLessThan(at(player));
  expect(at(player)).toBeLessThan(at(bottomRailing as string));
});
