// Story 4.1 (FR1-FR3): the in-city clock over a real local SpacetimeDB and a
// real browser. A client whose wall clock is hours wrong still derives the
// server's in-city time (within one in-city minute, the precision floor),
// and the server never broadcasts the time: `world_clock` is inserted once
// and never updated.
import { expect, test } from "@playwright/test";
// Pulls in `declare global { interface Window { __bc } }` -- types only.
import type {} from "../../src/net/e2e-hooks";

const REAL_MS_PER_CITY_MINUTE = 2_500;
const CITY_MINUTES_PER_DAY = 1_440;
const THREE_CITY_MINUTES_MS = 3 * REAL_MS_PER_CITY_MINUTE;

/** The oracle: in-city minutes since the epoch, from the server's own
 * epoch row and this (unskewed) node process's clock. */
function serverCityMinutes(epochMicros: bigint): number {
  const elapsedMs = (BigInt(Date.now()) * 1000n - epochMicros) / 1000n;
  return Number(elapsedMs / BigInt(REAL_MS_PER_CITY_MINUTE));
}

test("a client with a wrong wall clock derives the server's in-city time", async ({ page }) => {
  // The browser's wall clock is a week and three hours in the future.
  await page.clock.setSystemTime(new Date(Date.now() + (7 * 24 + 3) * 3_600_000));
  await page.goto("/");

  await page.waitForFunction(() => window.__bc?.cityTime?.() !== undefined, undefined, {
    timeout: 10_000,
  });

  const { epochMicros, city } = await page.evaluate(() => ({
    epochMicros: window.__bc?.worldClock?.epochMicros ?? "",
    city: window.__bc?.cityTime?.(),
  }));
  expect(city).toBeDefined();
  if (!city) return;

  const derived = city.day * CITY_MINUTES_PER_DAY + city.hour * 60 + city.minute;
  const truth = serverCityMinutes(BigInt(epochMicros));
  expect(Math.abs(derived - truth)).toBeLessThanOrEqual(1);
});

test("the clock table is inserted once and never updated as in-city time passes", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__bc?.worldClock !== undefined, undefined, {
    timeout: 10_000,
  });

  await page.waitForTimeout(THREE_CITY_MINUTES_MS);

  const clock = await page.evaluate(() => window.__bc?.worldClock);
  expect(clock?.inserts).toBe(1);
  expect(clock?.updates).toBe(0);
});
