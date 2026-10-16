// Story 3.16: the generated district, walked through the real client with
// real key presses. What this spec holds, and what it leaves to others:
//   - the player starts where the server says, inside the arrival dwelling,
//     and the scene draws the streamed world around it;
//   - its own building's front walls are retracted while it stands inside
//     and drawn again once it steps out -- on the mounted display list, for
//     a building the generator made (the count and the retraction of every
//     building are `tests/unit/district/district-enclosure.test.ts`);
//   - a walk on foot makes the settled walking speed, within a band (the
//     full 233 s crossing is `perf-soak.yml`'s, never PR CI's).

import { computeVisibility } from "../../src/render/visibility";
import { step } from "../../src/world/movement";
import { committedDefs, committedMovementConfig } from "../unit/support/committed-defs";
import {
  arrivalCell,
  awaitScene,
  buildingOf,
  district,
  fits,
  nearestCell,
  ownership,
  routeBetween,
  straightStreet,
  walkTo,
  world,
} from "./district-support";
import { expect, test } from "./fixtures";
import { segmentsOf, walkRealSegment } from "./walk-support";

test.use({ viewport: { width: 1920, height: 1080 } });

const STUB_ID_OFFSET = 500_000_000_000n;
const LAMPPOST_DEF_ID = 4;
const WALLS_LAYER = 4;

/** The near-side wall rows of the building around `cell`: walls it owns
 * whose south neighbour is not its own. Read from the dump, never typed. */
function frontWallIds(buildingId: bigint): bigint[] {
  return district.objects
    .filter((o) => o.layer === WALLS_LAYER)
    .filter((o) => ownership.ownershipAt(o.x, o.y, o.floor).buildingId === buildingId)
    .filter((o) => ownership.ownershipAt(o.x, o.y + 1, o.floor).buildingId !== buildingId)
    .map((o) => o.objectId);
}

async function visibility(page: import("@playwright/test").Page): Promise<Record<string, string>> {
  return page.evaluate(() => window.__bc?.visibility ?? {});
}

test("the player arrives in the generated dwelling and the world is drawn around it", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await awaitScene(page);
  const at = arrivalCell();
  const pos = await page.evaluate(() => window.__bc?.playerPosition);
  expect(pos).toEqual({ x: at.x + 0.5, y: at.y + 0.5 });
  expect(buildingOf(at)).not.toBe(0n);
  const world = await page.evaluate(() => window.__bc?.world?.());
  expect(world?.drawnChunks).toBeGreaterThan(0);
  expect(world?.liveSprites).toBeGreaterThan(0);
  expect(world?.buildingId).toBe(buildingOf(at).toString());
  expect(errors).toEqual([]);
});

test("a generated building's front walls retract when the player is inside and return outside", async ({
  page,
}) => {
  await page.goto("/");
  await awaitScene(page);
  const home = arrivalCell();
  const building = buildingOf(home);
  const fronts = frontWallIds(building);
  expect(fronts.length).toBeGreaterThan(0);
  await page.waitForFunction(() => Object.keys(window.__bc?.visibility ?? {}).length > 0);

  // Inside: every front wall is hidden and its stub stands in.
  const inside = await visibility(page);
  for (const id of fronts) {
    expect(inside[id.toString()], `wall ${id}`).toBe("hidden");
    expect(inside[(id + STUB_ID_OFFSET).toString()], `stub of ${id}`).toBe("normal");
  }
  // The pure rule agrees with the mounted sprites for this viewer.
  expect(
    computeVisibility(
      { floor: 0, buildingId: building },
      {
        floor: 0,
        layerCode: WALLS_LAYER,
        ownerBuildingId: building,
        isWindow: false,
        isNearSide: true,
        isStub: false,
      },
    ),
  ).toBe("hidden");

  // Out on the street: the front is drawn again.
  const street = nearestCell(home, false);
  await walkTo(page, street);
  const outsideWorld = await page.evaluate(() => window.__bc?.world?.());
  expect(outsideWorld?.buildingId).toBe("0");
  const outside = await visibility(page);
  for (const id of fronts) {
    expect(outside[id.toString()], `wall ${id}`).toBe("normal");
    expect(outside[(id + STUB_ID_OFFSET).toString()], `stub of ${id}`).toBe("hidden");
  }

  // And back in: retracted again.
  await walkTo(page, home);
  const again = await visibility(page);
  for (const id of fronts) expect(again[id.toString()], `wall ${id}`).toBe("hidden");
});

test("a walk on foot makes the settled walking speed, within a band", async ({ page }) => {
  await page.goto("/");
  await awaitScene(page);
  const config = committedMovementConfig();
  const speed = config.walkSpeedCellsPerMs * 1000;
  // A long, straight stretch of street near the arrival.
  const { start, end: far } = straightStreet(arrivalCell(), 20);
  const end = { x: Math.min(far.x, start.x + 30), y: far.y };
  await walkTo(page, start);
  const route = routeBetween(start, end);
  const t0 = await page.evaluate(() => performance.now());
  for (const segment of segmentsOf(route)) await walkRealSegment(page, segment);
  const t1 = await page.evaluate(() => performance.now());
  const cells = route.length - 1;
  const measured = cells / ((t1 - t0) / 1000);
  // Real keys, a real frame loop and a round trip per segment: a band, not
  // an equality. Never faster than the speed.
  expect(measured).toBeLessThanOrEqual(speed * 1.02);
  expect(measured).toBeGreaterThanOrEqual(speed * 0.6);
  const reached = await page.evaluate(() => window.__bc?.playerPosition);
  expect(reached?.x).toBeGreaterThanOrEqual(end.x + 0.5 - 0.05);
});

test("the lamppost stops the player where it is drawn, walking into it from open pavement (FR117, FR128)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await awaitScene(page);
  const config = committedMovementConfig();
  const arrival = arrivalCell();

  // The nearest lamppost with three free cells to its west on its own row.
  const lamps = district.objects
    .filter((o) => o.floor === 0 && o.defId === LAMPPOST_DEF_ID)
    .sort(
      (a, b) =>
        Math.abs(a.x - arrival.x) +
        Math.abs(a.y - arrival.y) -
        (Math.abs(b.x - arrival.x) + Math.abs(b.y - arrival.y)),
    );
  const lamp = lamps.find((o) => [1, 2, 3].every((d) => fits(o.x - d, o.y)));
  if (!lamp) throw new Error("no lamppost with open pavement to its west");
  const start = { x: lamp.x - 3, y: lamp.y };
  await walkTo(page, start);

  const from = await page.evaluate(() => window.__bc?.playerPosition);
  if (!from) throw new Error("no position");
  // What the resolver, alone, does with a body held east into the post from
  // where the walk left it.
  let simulated = { x: from.x, y: from.y };
  for (let i = 0; i < 400; i++) {
    simulated = step(simulated, { x: 1, y: 0 }, 16, world, 0, config, 1);
  }
  expect(simulated.x).toBeLessThan(lamp.x + 0.5);
  await walkRealSegment(page, {
    label: "into-the-lamppost",
    key: "ArrowRight",
    until: { kind: "x-at-least", value: simulated.x - 1e-6 },
  });
  // The real scene rests exactly where the resolver does ...
  await expect
    .poll(() => page.evaluate(() => window.__bc?.playerPosition?.x))
    .toBeCloseTo(simulated.x, 6);
  // ... and the drawn sprite is where that position projects to.
  const drawn = await page.evaluate(() => window.__bc?.playerDrawnPoint?.());
  expect(drawn).toBeTruthy();
  const tile = committedDefs().balance.find((b) => b.key === "render.tile_size_px")?.value ?? 16;
  expect(Math.abs((drawn?.x ?? 0) - simulated.x * tile)).toBeLessThanOrEqual(1);
});
