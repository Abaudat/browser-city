// Story 5.3 (FR58): citizens walk into view with their bodies already
// there. The page records, every drawn frame, where each citizen body is on
// the canvas (`window.__bc.bodyWatch`); a body whose first drawn frame
// intersects the canvas is a pop. The player walks along the street with
// real keyboard input (`walk-support.ts`) in a small window, so the body
// zone culls part of the crowd and the walk crosses its edges.

import type {} from "../../src/net/e2e-hooks";
import { railingFootRoute } from "../unit/test-street/street-world";
import { expect, test } from "./fixtures";
import { walkRealCells, walkRealSegment } from "./walk-support";

test.describe("the body zone in a real browser", () => {
  test("no body first draws inside the canvas, the zone culls, and a wobble respawns nothing", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 800 });
    await page.goto("/?watchBodies");
    await page.waitForFunction(() => window.__bc?.bodyWatch !== undefined, undefined, {
      timeout: 60_000,
    });
    await page.evaluate(() => window.__bc?.bodyWatch?.reset());

    // Out of the shopfront and east along the pavement to the subway
    // entrance: bodies are left behind to the west and arrive ahead.
    const toEntrance = railingFootRoute().findIndex(
      (s) => s.label === "east-to-the-subway-entrance",
    );
    for (const segment of railingFootRoute().slice(0, toEntrance + 1)) {
      await walkRealSegment(page, segment);
    }
    const watch = await page.evaluate(() => ({
      popped: window.__bc?.bodyWatch?.poppedIn() ?? ["no watch"],
      min: window.__bc?.bodyWatch?.minBodies() ?? -1,
      max: window.__bc?.bodyWatch?.maxBodies() ?? -1,
      spawns: window.__bc?.bodyWatch?.spawns() ?? -1,
      citizens: window.__bc?.bodyWatch?.citizens() ?? -1,
    }));
    // The walk must have bodies arriving, or the check below is vacuous.
    expect(watch.spawns, "bodies that arrived during the walk").toBeGreaterThan(0);
    expect(watch.popped, "ids that went from not drawn to drawn inside the canvas").toEqual([]);
    expect(watch.citizens).toBeGreaterThan(0);
    expect(watch.min, "the zone culls somebody").toBeLessThan(watch.citizens);
    expect(watch.max).toBeLessThanOrEqual(watch.citizens);

    // A step back and forth, well inside the hysteresis band, respawns nobody.
    await page.evaluate(() => window.__bc?.bodyWatch?.reset());
    for (let i = 0; i < 3; i++) {
      await walkRealCells(page, `body-zone-wobble-back-${i}`, 1, false);
      await walkRealCells(page, `body-zone-wobble-fwd-${i}`, 1, true);
    }
    expect(await page.evaluate(() => window.__bc?.bodyWatch?.respawns() ?? -1)).toBe(0);
  });
});
