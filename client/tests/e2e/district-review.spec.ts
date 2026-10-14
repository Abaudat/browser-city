// Story 3.16 review capture (Artie's set, Derek's walk): the committed
// seed, walked on foot with real key presses at the shipped speed, in one
// uncut take. Run by `npm run test:e2e:review` (its own `review` project,
// never part of the functional run); writes the screenshot set and the
// recording under `docs/generation/walk/`. Nothing here asserts a verdict --
// the judgement is `docs/generation.md`'s A5 section, written from these.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canvasOf } from "./camera-test-support";
import {
  arrivalCell,
  awaitScene,
  type Cell,
  district,
  fits,
  nearestCell,
  walkTo,
} from "./district-support";
import { test } from "./fixtures";

test.use({
  viewport: { width: 1920, height: 1080 },
  video: { mode: "on", size: { width: 960, height: 540 } },
});

/** A crossing is one straight run of up to the site's width at the settled
 * speed: 512 cells / 2.2 cells per second, with room to spare. */
const LONG_SEGMENT_MS = 300_000;

const OUT = join(process.cwd(), "..", "docs", "generation", "walk");

// Crossings and landmarks of the committed seed, from
// `server/sim/tests/district_world.rs`'s printed measurements (the sharpest
// adjacent affluence and age steps; the density peak; the site's west edge).
const AFFLUENCE_STEP: Cell = { x: 329, y: 256 };
const AGE_STEP: Cell = { x: 158, y: 381 };
const CORE: Cell = { x: 168, y: 296 };

/** A dump object of one of `defIds` nearest `from`, or throws. */
function nearestObject(from: Cell, defIds: readonly number[]): Cell {
  let best: { c: Cell; d: number } | undefined;
  for (const o of district.objects) {
    if (o.floor !== 0 || !defIds.includes(o.defId)) continue;
    const d = Math.abs(o.x - from.x) + Math.abs(o.y - from.y);
    if (!best || d < best.d) best = { c: { x: o.x, y: o.y }, d };
  }
  if (!best) throw new Error(`no object of ${defIds.join(",")}`);
  return best.c;
}

/** A street cell nearest `from`: the free cell beside the nearest lamppost
 * (def 4), which stands on the pavement. */
function pavementNear(from: Cell): Cell {
  const lamp = nearestObject(from, [4]);
  const beside = [
    { x: lamp.x, y: lamp.y + 1 },
    { x: lamp.x + 1, y: lamp.y },
    { x: lamp.x - 1, y: lamp.y },
    { x: lamp.x, y: lamp.y - 1 },
  ].find((c) => fits(c.x, c.y));
  if (!beside) throw new Error("no free cell beside the lamppost");
  return beside;
}

test("the committed district, walked end to end", async ({ page }) => {
  test.setTimeout(30 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const log: string[] = [];
  const shot = async (name: string, at: Cell): Promise<void> => {
    await page.waitForTimeout(600);
    await canvasOf(page).screenshot({ path: join(OUT, `${name}.png`) });
    const pos = await page.evaluate(() => window.__bc?.playerPosition);
    log.push(`${name}: wanted ${at.x},${at.y}; player at ${JSON.stringify(pos)}`);
  };

  await page.goto("/");
  await awaitScene(page);
  const started = Date.now();
  const home = arrivalCell();
  await page.waitForTimeout(800);
  await shot("01-arrival-dwelling-interior", home);

  // Out of the front door onto the street.
  const street = pavementNear(home);
  await walkTo(page, street, LONG_SEGMENT_MS);
  await shot("02-first-street-screen", street);

  // Into a shop, then a workplace, nearest the way in.
  const inside = (c: Cell): Cell => nearestCell(c, true);
  const till = nearestObject(home, [48, 49, 50]);
  await walkTo(page, nearestCell(till, false), LONG_SEGMENT_MS);
  await walkTo(page, inside(till), LONG_SEGMENT_MS);
  await shot("03-shop-interior", till);
  await walkTo(page, nearestCell(till, false), LONG_SEGMENT_MS);

  const bench = nearestObject(CORE, [39, 40, 41, 42, 43, 44]);
  // The arterial where affluence steps, both sides in the one frame.
  const aff = nearestCell(AFFLUENCE_STEP, false);
  await walkTo(page, aff, LONG_SEGMENT_MS);
  await shot("04-affluence-step", aff);

  // The core, then the workplace beside it.
  const core = nearestCell(CORE, false);
  await walkTo(page, core, LONG_SEGMENT_MS);
  await shot("05-core", core);
  await walkTo(page, nearestCell(bench, false), LONG_SEGMENT_MS);
  await walkTo(page, inside(bench), LONG_SEGMENT_MS);
  await shot("06-workplace-interior", bench);
  await walkTo(page, nearestCell(bench, false), LONG_SEGMENT_MS);

  // The age step, then on to the site's west edge.
  const age = nearestCell(AGE_STEP, false);
  await walkTo(page, age, LONG_SEGMENT_MS);
  await shot("07-age-step", age);
  const edge = nearestCell({ x: district.site.x0 + 2, y: CORE.y }, false);
  await walkTo(page, edge, LONG_SEGMENT_MS);
  await shot("08-site-edge", edge);

  const seconds = Math.round((Date.now() - started) / 1000);
  log.push(`walked ${seconds} s of wall clock over ${log.length} stops`);
  writeFileSync(join(OUT, "walk-log.txt"), `${log.join("\n")}\n`);
});
