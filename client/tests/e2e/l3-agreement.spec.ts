// Story 5.2 (FR64, FR65, NFR26): two clients on the street with different
// views agree on everything docs/architecture.md lists under "L3 -- must
// agree": ledger position, activity, walk or idle frame, facing and sidestep.
// Each page computes the list at the same city milliminutes through the
// e2e hook (a pure function of the ledger, ids and time, never of what was
// drawn); no sleeps, nothing waits on a wall clock. The math lives in the
// unit properties; this guards the wiring.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
// Pulls in `declare global { interface Window { __bc } }` -- types only.
import type {} from "../../src/net/e2e-hooks";
import { AVOIDANCE_SPECS, AVOIDANCE_STANDERS, stagingBounds } from "../../src/test-street/citizens";

const defs = JSON.parse(readFileSync("public/defs/defs.json", "utf8")) as {
  balance: { key: string; value: number }[];
};
const TILE_SIZE_PX = defs.balance.find((b) => b.key === "render.tile_size_px")?.value ?? 0;

interface Sample {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly activity: string;
  readonly frameIndex: number;
  readonly facing: string;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** City milliminutes sampled: a fine sweep across the first legs (so a
 * head-on pass and a sidestep are caught mid-way) and a coarse one across
 * many flavour buckets. */
const INSTANTS: readonly number[] = [
  ...Array.from({ length: 240 }, (_, i) => i * 50),
  ...Array.from({ length: 100 }, (_, i) => 12_000 + i * 500),
];

async function ready(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__bc?.l3Agreement !== undefined, undefined, {
    timeout: 20_000,
  });
}

async function sampleAt(page: Page): Promise<Record<number, Sample[]>> {
  return page.evaluate((instants) => {
    const hook = window.__bc?.l3Agreement;
    if (!hook) throw new Error("no l3Agreement hook");
    const out: Record<number, Sample[]> = {};
    for (const t of instants) out[t] = hook(t).map((s) => ({ ...s }));
    return out;
  }, INSTANTS as number[]);
}

test("two clients with different views agree on every citizen's L3 state", async ({ browser }) => {
  test.setTimeout(60_000);
  const a = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const b = await browser.newContext({ viewport: { width: 900, height: 640 } });
  try {
    const pageA = await a.newPage();
    const pageB = await b.newPage();
    await ready(pageA);
    await ready(pageB);

    // Client B's camera follows its player somewhere else.
    const before = await pageB.evaluate(() => window.__bc?.viewTransform?.offsetX ?? 0);
    await pageB.keyboard.down("ArrowRight");
    await pageB.waitForFunction(
      (x0) => Math.abs((window.__bc?.viewTransform?.offsetX ?? x0) - x0) > 150,
      before,
      { timeout: 20_000 },
    );
    await pageB.keyboard.up("ArrowRight");

    const [fromA, fromB] = await Promise.all([sampleAt(pageA), sampleAt(pageB)]);
    expect(fromB).toEqual(fromA);

    // Not vacuous: the sample holds walkers, a sidestep and a glance.
    const all = Object.values(fromA).flat();
    expect(all.some((s) => s.activity === "walk")).toBe(true);
    expect(all.some((s) => s.offsetX !== 0 || s.offsetY !== 0)).toBe(true);
    expect(all.some((s) => s.activity === "glance")).toBe(true);
    expect(new Set(all.map((s) => s.frameIndex)).size).toBeGreaterThan(3);
  } finally {
    await a.close();
    await b.close();
  }
});

test("the whole staging is on screen at 1366x768 from the street's south edge", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await ready(page);
  // South to the street's edge.
  await page.keyboard.down("ArrowDown");
  await page.waitForFunction(() => (window.__bc?.playerPosition?.y ?? 0) > 7.3, undefined, {
    timeout: 20_000,
  });
  await page.keyboard.up("ArrowDown");

  // Every lane end and every standing citizen, with a cell of body above the
  // foot, and the corners of the box they span: read from the fixture.
  const feet: [number, number][] = [];
  for (const spec of Object.values(AVOIDANCE_SPECS)) {
    for (const c of [spec.out[0], spec.out[spec.out.length - 1]] as { x: number; y: number }[]) {
      feet.push([c.x + 0.5, c.y + 0.5]);
    }
  }
  for (const c of Object.values(AVOIDANCE_STANDERS)) feet.push([c.x + 0.5, c.y + 0.5]);
  const xs = feet.map(([x]) => x);
  const ys = feet.map(([, y]) => y);
  const corners: [number, number][] = [
    [Math.min(...xs) - 0.5, Math.min(...ys) - 1.5],
    [Math.max(...xs) + 0.5, Math.max(...ys)],
  ];
  const points = [...feet, ...corners];
  const bounds = stagingBounds();
  points.push([bounds.x0, bounds.y0], [bounds.x1 - 8, bounds.y1]);

  const outside = await page.evaluate(
    ({ points, tile }) => {
      const view = window.__bc?.viewTransform;
      const canvas = document.querySelector("#test-street canvas");
      if (!view || !(canvas instanceof HTMLCanvasElement)) throw new Error("no scene");
      const rect = canvas.getBoundingClientRect();
      return points.filter(([x, y]) => {
        const px = x * tile * view.zoom + view.offsetX;
        const py = y * tile * view.zoom + view.offsetY;
        return px < 0 || px > rect.width || py < 0 || py > rect.height;
      });
    },
    { points, tile: TILE_SIZE_PX },
  );
  expect(outside).toEqual([]);
});
