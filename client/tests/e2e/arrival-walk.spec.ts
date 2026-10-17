// Story 4.26 (FR117, FR128): a character walks from the fixture block's flat
// to every place the block has. The harness stands them in the flat once
// (`enterBlock`: the block is a test fixture beside the generated city, not an
// arrival); from there only real key presses move them, out of the door, under the footbridge, along the shop fronts and down the
// street stairwell. Each leg is its own step, named for where it ends, so a
// blocked leg fails under its own name. Positions and the server's stored
// row are asserted, never pixels. The same legs are proven feasible in unit
// CI first (`walked-routes.test.ts`, "arrival-walk").
import type {} from "../../src/net/e2e-hooks";
import {
  arrivalWalkLegs,
  HOME_FLAT_SPAWN,
  STAIRWELL_FOOTPRINT,
  type StreetWalkSegment,
  SUBWAY_FLOOR,
} from "../fixture-block/fixture";
import { streetMovementConfig, streetWalkInputs } from "../unit/fixture-block/street-world";
import { enterBlock } from "./block-support";
import { expect, test } from "./fixtures";
import { ownerSql, readSpacetimeHandle } from "./spacetime-harness.mjs";
import { walkRealSegment } from "./walk-support";

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
      // Across the stairwell's footprint from the entrance, down its treads.
      return STAIRWELL_FOOTPRINT.width + 1;
  }
}

test("a character walks from the block's flat to both shop fronts and down the subway stairs", async ({
  page,
}) => {
  // The walk is ~45 cells at real speed plus the boot; each segment has its own
  // distance-based timeout, so a blocked leg still fails in seconds.
  test.setTimeout(90_000);
  const { walkSpeedCellsPerMs } = streetMovementConfig();
  await enterBlock(page, HOME_FLAT_SPAWN.x, HOME_FLAT_SPAWN.y, HOME_FLAT_SPAWN.floor);
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
      const { destination } = leg;
      if (destination?.arrive === "stand") {
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
              `SELECT "floor" FROM player_position WHERE character_id = ${characterId}`,
            )[0] as string[] | undefined
          )?.[0],
        ),
      { timeout: 10_000 },
    )
    .toBe(SUBWAY_FLOOR);
});
