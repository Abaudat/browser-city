// Story 5.2 (FR64, FR65, NFR26): two clients on the street with different
// views agree on everything docs/architecture.md lists under "L3 -- must
// agree": ledger position, activity, walk or idle frame, facing and sidestep.
// Each page computes the list at the same city milliminutes through the
// e2e hook (a pure function of the ledger, ids and time, never of what was
// drawn); no sleeps, nothing waits on a wall clock. The math lives in the
// unit properties; this guards the wiring.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
// Pulls in `declare global { interface Window { __bc } }` -- types only.
import type {} from "../../src/net/e2e-hooks";
import { ZOOM } from "../../src/render/camera";
import { AVOIDANCE_SPECS, AVOIDANCE_STANDERS, stagingBounds } from "../../src/test-street/citizens";
import { expect, test } from "./fixtures";

const defs = JSON.parse(readFileSync("public/defs/defs.json", "utf8")) as {
  balance: { key: string; value: number }[];
};
const tileSize = defs.balance.find((b) => b.key === "render.tile_size_px")?.value;
if (tileSize === undefined) throw new Error("no render.tile_size_px balance key");
const TILE_SIZE_PX = tileSize;
/** Walking south, the player is on the street pavement's south edge from here
 * (the lamppost row is 8; the body rests just short of it). */
const PAVEMENT_EDGE_PLAYER_Y = 7.3;

interface Sample {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly activity: string;
  readonly frameIndex: number;
  readonly facing: string;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly look: string;
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
    // The look is part of what the clients agree on, and none is empty.
    expect(all.every((s) => s.look !== "")).toBe(true);
  } finally {
    await a.close();
    await b.close();
  }
});

/** Bodies each client must hold before the divergence sweep: a small
 * viewport's bubble holds only part of the 200-body crowd. */
const DENSE_BODIES = 120;

/** The rush-hour crowd at density, two different bubbles (story 5.4, AC4):
 * the bodies both clients hold, with an offset both resolved on a wholly held
 * neighbourhood, must agree on every must-agree field across a sweep that
 * includes peak density. Compared on the live field each client solved from
 * the bodies it holds -- what a bubble can change -- not on the from-scratch
 * sample above. Disagreement is written to the report; any is a defect. */
test("two clients with different bubbles agree on every shared body of the 200-body crowd", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const a = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const b = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const pageA = await a.newPage();
    const pageB = await b.newPage();
    for (const page of [pageA, pageB]) {
      await page.goto("/?rushCrowd");
      await page.waitForFunction(() => window.__bc?.playerPosition !== undefined, undefined, {
        timeout: 60_000,
      });
      // To the street's south edge, where the crowd is in view and held.
      await page.keyboard.down("ArrowDown");
      await page.waitForFunction(
        (y) => (window.__bc?.playerPosition?.y ?? 0) > y,
        PAVEMENT_EDGE_PLAYER_Y,
        { timeout: 20_000 },
      );
      await page.keyboard.up("ArrowDown");
      await page.waitForFunction(
        (n) => (window.__bc?.bodyCount?.() ?? 0) >= n && window.__bc?.l3Live !== undefined,
        DENSE_BODIES,
        { timeout: 60_000 },
      );
    }
    // Client B's camera, and so its bubble, follows its player elsewhere.
    const before = await pageB.evaluate(() => window.__bc?.viewTransform?.offsetX ?? 0);
    await pageB.keyboard.down("ArrowRight");
    await pageB.waitForFunction(
      (x0) => Math.abs((window.__bc?.viewTransform?.offsetX ?? x0) - x0) > 250,
      before,
      { timeout: 30_000 },
    );
    await pageB.keyboard.up("ArrowRight");
    await pageB.waitForTimeout(1_000);

    const sweep = (page: Page) =>
      page.evaluate((instants) => {
        const hook = window.__bc?.l3Live;
        if (!hook) throw new Error("no l3Live hook");
        // One synchronous read, between frames: the hook puts the live poses
        // back to the last solved frame itself.
        return instants.map((t) => {
          const live = hook(t);
          return { t, viewport: live.viewport, bodies: live.bodies.map((s) => ({ ...s })) };
        });
      }, INSTANTS as number[]);
    const [fromA, fromB] = await Promise.all([sweep(pageA), sweep(pageB)]);

    type Body = (typeof fromA)[number]["bodies"][number];
    type View = (typeof fromA)[number]["viewport"];
    const onScreen = (view: View, s: Body): boolean =>
      view !== undefined && s.x >= view.x0 && s.x <= view.x1 && s.y >= view.y0 && s.y <= view.y1;
    const differs = (a: Body, b: Body): boolean =>
      a.x !== b.x ||
      a.y !== b.y ||
      a.activity !== b.activity ||
      a.frameIndex !== b.frameIndex ||
      a.facing !== b.facing ||
      a.offsetX !== b.offsetX ||
      a.offsetY !== b.offsetY;
    const px = (a: Body, b: Body): number =>
      Math.hypot(a.offsetX - b.offsetX, a.offsetY - b.offsetY) * TILE_SIZE_PX * ZOOM;
    const zero = () => ({ shared: 0, disagreements: 0, maxPx: 0 });
    // Every shared body, whether or not both resolved it, split by where it
    // is drawn: on both screens, on one only, on neither.
    const split = { onBothScreens: zero(), onOneScreen: zero(), offBothScreens: zero() };
    let compared = 0;
    let disagreements = 0;
    let maxOffsetDisagreementCells = 0;
    let onlyInOne = 0;
    let sidestepping = 0;
    let unresolvedOnScreen = 0;
    const examples: string[] = [];
    for (let k = 0; k < fromA.length; k++) {
      const a = fromA[k];
      const b = fromB[k];
      if (!a || !b) continue;
      const inB = new Map(b.bodies.map((s) => [s.id, s]));
      // The scoping claim, as a guard: a body drawn on a client's own screen
      // always has a resolved (agreed) offset there.
      for (const s of a.bodies) if (onScreen(a.viewport, s) && !s.agreed) unresolvedOnScreen++;
      for (const s of b.bodies) if (onScreen(b.viewport, s) && !s.agreed) unresolvedOnScreen++;
      onlyInOne += a.bodies.filter((s) => !inB.has(s.id)).length;
      for (const sa of a.bodies) {
        const sb = inB.get(sa.id);
        if (!sb) continue;
        const seenA = onScreen(a.viewport, sa);
        const seenB = onScreen(b.viewport, sb);
        const bucket =
          seenA && seenB
            ? split.onBothScreens
            : seenA || seenB
              ? split.onOneScreen
              : split.offBothScreens;
        bucket.shared++;
        if (differs(sa, sb)) {
          bucket.disagreements++;
          bucket.maxPx = Math.max(bucket.maxPx, px(sa, sb));
        }
        // Only an offset resolved on a wholly held neighbourhood is agreed on.
        if (!sa.agreed || !sb.agreed) continue;
        compared++;
        if (sa.offsetX !== 0 || sa.offsetY !== 0) sidestepping++;
        if (!differs(sa, sb)) continue;
        disagreements++;
        maxOffsetDisagreementCells = Math.max(
          maxOffsetDisagreementCells,
          Math.hypot(sa.offsetX - sb.offsetX, sa.offsetY - sb.offsetY),
        );
        if (examples.length < 5) examples.push(`${sa.id}@${a.t}`);
      }
    }
    const report = {
      instants: INSTANTS.length,
      compared,
      sidestepping,
      heldByOneOnly: onlyInOne,
      disagreements,
      maxOffsetDisagreementCells,
      maxOffsetDisagreementPx: maxOffsetDisagreementCells * TILE_SIZE_PX * ZOOM,
      unresolvedOnScreen,
      allSharedBodies: split,
      examples,
    };
    mkdirSync("test-results/story-5.4-l3-budget", { recursive: true });
    writeFileSync(
      "test-results/story-5.4-l3-budget/divergence.json",
      `${JSON.stringify(report, null, 2)}
`,
      "utf-8",
    );

    // Not vacuous: dense, sidestepping, and the two bubbles really differ.
    expect(compared).toBeGreaterThan(INSTANTS.length * 50);
    expect(sidestepping).toBeGreaterThan(INSTANTS.length * 10);
    expect(onlyInOne).toBeGreaterThan(0);
    expect(report.unresolvedOnScreen).toBe(0);
    expect(split.onBothScreens.shared).toBeGreaterThan(INSTANTS.length * 10);
    expect(split.onBothScreens.disagreements).toBe(0);
    expect(report).toMatchObject({ disagreements: 0, maxOffsetDisagreementPx: 0 });
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
  await page.waitForFunction(
    (y) => (window.__bc?.playerPosition?.y ?? 0) > y,
    PAVEMENT_EDGE_PLAYER_Y,
    {
      timeout: 20_000,
    },
  );
  await page.keyboard.up("ArrowDown");

  // Every lane end and every standing citizen, with a cell of body above the
  // foot, and the corners of the box they span: read from the fixture.
  // The foot of the lowest row is a hair below the viewport; its body is what is
  // checked, half a cell above the foot.
  const feet: [number, number][] = [];
  for (const spec of Object.values(AVOIDANCE_SPECS)) {
    for (const c of [spec.out[0], spec.out[spec.out.length - 1]] as { x: number; y: number }[]) {
      feet.push([c.x + 0.5, c.y]);
    }
  }
  for (const c of Object.values(AVOIDANCE_STANDERS)) feet.push([c.x + 0.5, c.y]);
  const xs = feet.map(([x]) => x);
  const ys = feet.map(([, y]) => y);
  const corners: [number, number][] = [
    [Math.min(...xs) - 0.5, Math.min(...ys) - 1.5],
    [Math.max(...xs) + 0.5, Math.max(...ys)],
  ];
  const points = [...feet, ...corners];
  const bounds = stagingBounds();
  points.push([bounds.x0, bounds.y0], [bounds.x1 - 1, bounds.y1 - 1]);

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
