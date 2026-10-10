// Story 15.20: the subway flights are walkable pressed against their bottom
// wall, the demo's own posture: down the street flight flush against its
// south railing, then back up the platform flight the same way. Asserts the
// floor through `window.__bc`, never pixels; the video is the artefact.
// The unit sweep (`inv_transition_reachable_from_every_standable_approach`)
// pins the behaviour; this only proves the wiring.
import { expect, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import {
  STREET_FLOOR,
  SUBWAY_FLOOR,
  streetSubwayWallWalkRoute,
} from "../../src/test-street/fixture";
import { streetWalkInputs } from "../unit/test-street/street-world";
import { walkRealSegment } from "./walk-support";

test.use({ video: "on" });

test("walking the subway flights pressed against their bottom wall reaches the other floor, down and back up", async ({
  page,
}) => {
  await page.goto("/?freezeCrowd=1");
  await page.waitForFunction(() => window.__bc?.playerFloor !== undefined);

  for (const segment of streetSubwayWallWalkRoute(streetWalkInputs())) {
    await walkRealSegment(page, segment);
    if (segment.label === "down-the-street-flight-pressed-south") {
      await expect
        .poll(() => page.evaluate(() => window.__bc?.playerFloor), { timeout: 5_000 })
        .toBe(SUBWAY_FLOOR);
    }
  }
  await expect
    .poll(() => page.evaluate(() => window.__bc?.playerFloor), { timeout: 5_000 })
    .toBe(STREET_FLOOR);
});
