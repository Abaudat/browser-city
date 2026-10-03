// The one implementation of the scripted e2e walk every spec shares.
import { appendFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type Page, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import { RELEASE_LAG, type StreetWalkSegment } from "../../src/test-street/fixture";
import { streetMovementConfig } from "../unit/test-street/street-world";
import {
  armWalkWatcher,
  awaitWalk,
  overshootViolation,
  releaseBoundCells,
  type WalkMode,
  type WalkRecord,
  type WatcherArgs,
} from "./walk-watcher";

const RECORD_FILE = join(import.meta.dirname, "..", "..", "walk-records", "walks.jsonl");

/** A walk that never meets its condition fails by name before the test's
 * own 30 s timeout can kill it unrecorded. */
const DEFAULT_TIMEOUT_MS = 15_000;

function writeRecord(segment: StreetWalkSegment, mode: WalkMode, record: WalkRecord): void {
  const info = test.info();
  mkdirSync(dirname(RECORD_FILE), { recursive: true });
  appendFileSync(
    RECORD_FILE,
    `${JSON.stringify({
      spec: basename(info.file),
      test: info.title,
      label: segment.label,
      until: segment.until,
      key: segment.key,
      mode,
      boundSteps: 1 + RELEASE_LAG.releaseLagSteps,
      ...record,
    })}\n`,
  );
}

/** Walks one segment. The watcher is armed before the key goes down, the
 * key is released inside the page on the frame the condition is first seen
 * true, and the walk is recorded to `walk-records/` and checked: it fails
 * naming the segment when the body rests past its threshold by more than
 * `RELEASE_LAG` allows, moves on a frame after its own release, or steps
 * more than one clamp in a frame.
 *
 * Why the watcher is armed first: the release is exact (run 37139923845,
 * attempts 1 to 3, 424 walks: never a frame of movement after it, never a
 * key event after it). A watcher armed only after the key would leave the
 * body unwatched for the Node round trip, measured as 3 frames in 412 of
 * those walks and never more: 0.66 cell at most at fully clamped frames
 * (`gap*` in each record). The 1.7-cell overshoot seen once before was not
 * reproduced. */
async function walkSegment(
  page: Page,
  segment: StreetWalkSegment,
  mode: WalkMode,
  timeoutMs: number,
): Promise<void> {
  const args: WatcherArgs = {
    until: segment.until,
    code: segment.key,
    mode,
    timeoutMs,
    maxStepCells: streetMovementConfig().walkSpeedCellsPerMs * RELEASE_LAG.stepMs,
  };
  const armed = await page.evaluate(armWalkWatcher, args);
  if (!armed) {
    // A floor or cell target can already hold (the stairs already fired);
    // an axis threshold already met is a route bug.
    if (segment.until.kind === "floor" || segment.until.kind === "cell") return;
    throw new Error(
      `walk '${segment.label}' already met ${JSON.stringify(segment.until)} before the key went down -- a route bug`,
    );
  }
  let record: WalkRecord;
  if (mode === "real") await page.keyboard.down(segment.key);
  try {
    record = await page.evaluate(awaitWalk);
  } finally {
    if (mode === "real") await page.keyboard.up(segment.key);
  }
  writeRecord(segment, mode, record);
  if (!record.ok) throw new Error(`walk '${segment.label}': ${record.error}`);
  const violation = overshootViolation(record, segment, releaseBoundCells());
  if (violation) throw new Error(violation);
}

/** Walks one segment with real, OS-level keyboard input: the watcher is
 * armed before `keyboard.down`, so no frame of the walk goes unwatched
 * (see `walkSegment` for what was measured). */
export function walkRealSegment(
  page: Page,
  segment: StreetWalkSegment,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  return walkSegment(page, segment, "real", timeoutMs);
}

/** A synthetic `keydown` dispatched in the page, for specs whose own mouse
 * moves make a real key arrive late. */
export function walkSyntheticSegment(
  page: Page,
  segment: StreetWalkSegment,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  return walkSegment(page, segment, "synthetic", timeoutMs);
}
