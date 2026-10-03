// The scripted walk's release, measured on the shortest hops the helper
// takes: 0.2 cells, east and west, in open street. Every hop is checked
// against `RELEASE_LAG` by `walk-support.ts`; the records it writes carry
// the figures for each one.
import { expect, type Page, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import type { StreetWalkSegment } from "../../src/test-street/fixture";
import { walkRealSegment } from "./walk-support";

const HOPS = 20;
const HOP_CELLS = 0.2;

async function ready(page: Page): Promise<void> {
  await page.goto("/?freezeCrowd=1");
  await page.waitForFunction(() => window.__bc?.playerAppearance !== undefined, undefined, {
    timeout: 60_000,
  });
}

async function hops(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const east = i % 2 === 0;
    const here = await page.evaluate(() => window.__bc?.playerPosition);
    if (!here) throw new Error("no player position");
    const segment: StreetWalkSegment = east
      ? {
          label: `hop-east-${i}`,
          key: "ArrowRight",
          until: { kind: "x-at-least", value: here.x + HOP_CELLS },
        }
      : {
          label: `hop-west-${i}`,
          key: "ArrowLeft",
          until: { kind: "x-at-most", value: here.x - HOP_CELLS },
        };
    await walkRealSegment(page, segment);
  }
}

test("every 0.2-cell hop rests inside the release bound", async ({ page }) => {
  await ready(page);
  await hops(page, HOPS);
  expect(await page.evaluate(() => window.__bc?.playerFloor)).toBe(0);
});

test("every 0.2-cell hop rests inside the release bound under a 6x CPU throttle", async ({
  page,
}) => {
  await ready(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await hops(page, HOPS / 2);
});
