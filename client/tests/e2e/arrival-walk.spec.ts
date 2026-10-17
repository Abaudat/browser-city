// Story 4.26 (FR117, FR128): a new character walks from the flat to every
// place the street has. The real name prompt places them in the flat; from
// there only real key presses move them -- no teleport, no position hook --
// out of the door, under the footbridge, along the shop fronts and down the
// street stairwell. Each leg is its own step, named for where it ends, so a
// blocked leg fails under its own name. Positions and the server's stored
// row are asserted, never pixels. The same legs are proven feasible in unit
// CI first (`walked-routes.test.ts`, "arrival-walk").
import type {} from "../../src/net/e2e-hooks";
import {
  ARRIVAL_DESTINATIONS,
  arrivalWalkLegs,
  HOME_FLAT_SPAWN,
  type StreetWalkSegment,
  SUBWAY_FLOOR,
} from "../../src/test-street/fixture";
import { streetMovementConfig, streetWalkInputs } from "../unit/test-street/street-world";
import { waitForPlayerControllable } from "./boot-test-support";
import { expect, test } from "./fixtures";
import { ownerSql, readSpacetimeHandle } from "./spacetime-harness.mjs";
import { walkRealSegment } from "./walk-support";

test.use({ startAt: "home" });

/** Cells a segment can have to walk, from where the body is now. */
function distanceCells(
  segment: StreetWalkSegment,
  from: { readonly x: number; readonly y: number },
): number {
  const { until } = segment;
  switch (until.kind) {
    case "x-at-least":
    case "x-at-most":
      return Math.abs(until.value - from.x);
    case "y-at-least":
    case "y-at-most":
      return Math.abs(until.value - from.y);
    case "cell":
      return Math.abs(until.x + 0.5 - from.x) + Math.abs(until.y + 0.5 - from.y);
    case "floor":
      return 8;
  }
}

test("a new character walks from the flat to both shop fronts and down the subway stairs", async ({
  page,
}) => {
  // The walk is ~45 cells at real speed plus the boot; each segment has its own
  // distance-based timeout, so a blocked leg still fails in seconds.
  test.setTimeout(90_000);
  const { walkSpeedCellsPerMs } = streetMovementConfig();
  await page.goto("/");
  await waitForPlayerControllable(page);
  const start = await page.evaluate(() => window.__bc?.playerPosition);
  expect(start?.x).toBeCloseTo(HOME_FLAT_SPAWN.x, 1);
  expect(start?.y).toBeCloseTo(HOME_FLAT_SPAWN.y, 1);

  const position = () =>
    page.evaluate(() => {
      const p = window.__bc?.playerPosition;
      return { x: p?.x ?? 0, y: p?.y ?? 0, floor: window.__bc?.playerFloor ?? 0 };
    });

  for (const leg of arrivalWalkLegs(streetWalkInputs())) {
    await test.step(`walk to ${leg.name}`, async () => {
      for (const segment of leg.segments) {
        const here = await position();
        // Distance over walk speed, with half again and a second for frames.
        const timeoutMs =
          Math.ceil((distanceCells(segment, here) / walkSpeedCellsPerMs) * 1.5) + 1_000;
        try {
          await walkRealSegment(page, segment, timeoutMs);
        } catch (error) {
          const stopped = await position();
          throw new Error(
            `${leg.name}: '${segment.label}' stopped at (${stopped.x.toFixed(2)}, ${stopped.y.toFixed(2)}) on floor ${stopped.floor}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }
      const where = await position();
      const destination = ARRIVAL_DESTINATIONS.find((d) => d.name === leg.name);
      if (destination && leg.name !== ARRIVAL_DESTINATIONS[2].name) {
        expect([Math.floor(where.x), Math.floor(where.y)], leg.name).toEqual([
          destination.x,
          destination.y,
        ]);
      }
    });
  }

  // The last leg went down the stairs: the client is on the platform...
  expect((await position()).floor).toBe(SUBWAY_FLOOR);
  // ...and the server's own stored row agrees.
  const characterId = await page.evaluate(() => window.__bc?.character?.characterId);
  await expect
    .poll(
      () =>
        Number(
          (
            ownerSql(
              readSpacetimeHandle(),
              `SELECT * FROM player_position WHERE character_id = ${characterId}`,
            )[0] as string[] | undefined
          )?.[4],
        ),
      { timeout: 10_000 },
    )
    .toBe(SUBWAY_FLOOR);
});
