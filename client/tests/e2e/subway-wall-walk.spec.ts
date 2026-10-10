// Story 15.20: the subway flights are walkable pressed against their bottom
// wall, the demo's own posture. Down the street flight flush against its
// south railing, then back up the platform flight the same way. Asserts the
// floor through `window.__bc`, never pixels; the video is the artefact.
// The unit sweep (`inv_transition_reachable_from_every_standable_approach`)
// pins the behaviour; this only proves the wiring.
import { expect, type Page, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import {
  PLATFORM_LANDING_Y,
  STREET_FLOOR,
  type StreetWalkSegment,
  SUBWAY_FLOOR,
  streetSubwayApproachRoute,
} from "../../src/test-street/fixture";
import { streetWalkInputs } from "../unit/test-street/street-world";
import { walkRealSegment } from "./walk-support";

test.use({ video: "on" });

async function waitForFloor(page: Page, floor: number): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__bc?.playerFloor), { timeout: 5_000 })
    .toBe(floor);
}

test("walking the subway flights pressed against their bottom wall reaches the other floor, down and back up", async ({
  page,
}) => {
  await page.goto("/?freezeCrowd=1");
  await page.waitForFunction(() => window.__bc?.playerFloor !== undefined);

  const inputs = streetWalkInputs();
  const approach = streetSubwayApproachRoute(inputs);
  const onTreads = approach.findIndex((s) => s.label === "onto-the-subway-treads-row");
  const toTheTreads: readonly StreetWalkSegment[] = approach.slice(0, onTreads + 1);
  for (const segment of toTheTreads) await walkRealSegment(page, segment);

  // Press south onto the flight's bottom railing, then walk its length.
  await walkRealSegment(page, {
    label: "press-south",
    key: "ArrowDown",
    until: { kind: "y-at-least", value: inputs.nearRailingRestY },
  });
  expect(await page.evaluate(() => window.__bc?.playerFloor)).toBe(STREET_FLOOR);
  await walkRealSegment(page, {
    label: "down-the-street-flight-pressed-south",
    key: "ArrowLeft",
    until: { kind: "floor", value: SUBWAY_FLOOR },
  });
  await waitForFloor(page, SUBWAY_FLOOR);

  // Back up the platform flight, pressed against its bottom wall.
  await walkRealSegment(page, {
    label: "press-south-on-the-platform",
    key: "ArrowDown",
    until: { kind: "y-at-least", value: PLATFORM_LANDING_Y + 0.95 },
  });
  await walkRealSegment(page, {
    label: "up-the-platform-flight-pressed-south",
    key: "ArrowRight",
    until: { kind: "floor", value: STREET_FLOOR },
  });
  await waitForFloor(page, STREET_FLOOR);
});
