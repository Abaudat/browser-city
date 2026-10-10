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

  const inputs = streetWalkInputs();
  // The posture is part of the claim: the body rests on the railing's face
  // before each walk along it.
  const restsAt: Readonly<Record<string, number>> = {
    "down-the-street-flight-pressed-south": inputs.nearRailingRestY,
    "up-the-platform-flight-pressed-south": inputs.platformWallRestY,
  };
  for (const segment of streetSubwayWallWalkRoute(inputs)) {
    const rest = restsAt[segment.label];
    if (rest !== undefined) {
      await expect
        .poll(() => page.evaluate(() => window.__bc?.playerPosition?.y), { timeout: 5_000 })
        .toBeCloseTo(rest, 6);
    }
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
