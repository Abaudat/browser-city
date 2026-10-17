// Story 5.3 (NFR24): the local player is a body like any other. Walking the
// square (up, left, down, right), the player's drawn (animation, facing,
// frame) is read from the page's own per-frame record
// (`window.__bc.playerBody`), never from pixels: facing follows each leg, the
// walk cycle advances while moving, and the body is idle at rest on the last
// facing. The walk goes through `walk-support.ts`.
import type { Page } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import { arrivalCell, openSquareNear, walkTo } from "./district-support";
import { expect, test } from "./fixtures";
import { walkRealCellsDir } from "./walk-support";

interface Seen {
  animation: string;
  direction: string;
  frameIndex: number;
}

async function ready(page: Page): Promise<void> {
  await page.goto("/?freezeBodies=1");
  await page.waitForFunction(() => window.__bc?.playerBody !== undefined, undefined, {
    timeout: 60_000,
  });
}

/** Records the player's drawn frame on every animation frame, in the page. */
async function startRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __bodySeen: Seen[]; __bodyStop: boolean };
    w.__bodySeen = [];
    w.__bodyStop = false;
    const tick = () => {
      const b = window.__bc?.playerBody;
      if (b) w.__bodySeen.push({ ...b });
      if (!w.__bodyStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopRecording(page: Page): Promise<Seen[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __bodySeen: Seen[]; __bodyStop: boolean };
    w.__bodyStop = true;
    return w.__bodySeen;
  });
}

const LEGS: [string, string, "ArrowUp" | "ArrowLeft" | "ArrowDown" | "ArrowRight"][] = [
  ["square-up", "up", "ArrowUp"],
  ["square-left", "left", "ArrowLeft"],
  ["square-down", "down", "ArrowDown"],
  ["square-right", "right", "ArrowRight"],
];

/** How far each leg of the square walks, in cells. */
const LEG_CELLS = 1.5;

test.describe("the player's body", () => {
  test("faces each leg, walks while moving, and rests idle on the last facing", async ({
    page,
  }) => {
    await ready(page);
    // Out into the open, to the middle of a clear block of street.
    const block = openSquareNear(arrivalCell(), 4);
    await walkTo(page, { x: block.x + 2, y: block.y + 2 });

    for (const [label, facing, key] of LEGS) {
      await startRecording(page);
      await walkRealCellsDir(page, label, LEG_CELLS, key);
      // At rest: the body returns to the idle row on the same facing.
      await page.waitForFunction(() => window.__bc?.playerBody?.animation === "idle", undefined, {
        timeout: 5000,
      });
      const seen = await stopRecording(page);

      const walking = seen.filter((s) => s.animation === "walk");
      expect(walking.length, `${label}: walk frames drawn`).toBeGreaterThan(0);
      expect(
        walking.every((s) => s.direction === facing),
        `${label}: every walk frame faces ${facing}`,
      ).toBe(true);
      if (label === "square-left" || label === "square-right") {
        expect(
          new Set(walking.map((s) => s.frameIndex)).size,
          `${label}: the walk cycle advances`,
        ).toBeGreaterThan(1);
      }
      const rest = await page.evaluate(() => window.__bc?.playerBody);
      expect(rest).toMatchObject({ animation: "idle", direction: facing });
    }
  });
});
