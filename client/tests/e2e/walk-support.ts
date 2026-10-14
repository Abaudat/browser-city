// The one implementation of the scripted e2e walk every spec shares.
import { appendFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type Page, test } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import { committedMovementConfig } from "../unit/support/committed-defs";
import {
  RELEASE_LAG,
  WALK_DIRECTIONS,
  type WalkKey,
  type WalkSegment,
  type WalkUntil,
} from "./walk-types";
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
const DEFAULT_TIMEOUT_MS = 40_000;

function writeRecord(segment: WalkSegment, mode: WalkMode, record: WalkRecord): void {
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
  segment: WalkSegment,
  mode: WalkMode,
  timeoutMs: number,
): Promise<void> {
  const args: WatcherArgs = {
    until: segment.until,
    code: segment.key,
    mode,
    timeoutMs,
    maxStepCells: committedMovementConfig().walkSpeedCellsPerMs * RELEASE_LAG.stepMs,
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
  segment: WalkSegment,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  return walkSegment(page, segment, "real", timeoutMs);
}

/** A synthetic `keydown` dispatched in the page, for specs whose own mouse
 * moves make a real key arrive late. */
export function walkSyntheticSegment(
  page: Page,
  segment: WalkSegment,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  return walkSegment(page, segment, "synthetic", timeoutMs);
}

/** Walks `cells` east or west of where the player stands now, with real
 * keyboard input. The one place a relative `until` is built for a spec. */
export async function walkRealCells(
  page: Page,
  label: string,
  cells: number,
  east: boolean,
): Promise<void> {
  const here = await page.evaluate(() => window.__bc?.playerPosition);
  if (!here) throw new Error("no player position");
  const segment: WalkSegment = east
    ? { label, key: "ArrowRight", until: { kind: "x-at-least", value: here.x + cells } }
    : { label, key: "ArrowLeft", until: { kind: "x-at-most", value: here.x - cells } };
  await walkRealSegment(page, segment);
}

/** A cell of the world, for a route. */
export interface RouteCell {
  readonly x: number;
  readonly y: number;
}

/** A route as held-key segments: one per straight run, released once the
 * body's centre has reached the run's last cell centre. */
export function segmentsOf(route: readonly RouteCell[], label = "route"): WalkSegment[] {
  const out: WalkSegment[] = [];
  let i = 0;
  while (i < route.length - 1) {
    const a = route[i] as RouteCell;
    const b = route[i + 1] as RouteCell;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let j = i + 1;
    while (j + 1 < route.length) {
      const n = route[j + 1] as RouteCell;
      const c = route[j] as RouteCell;
      if (n.x - c.x !== dx || n.y - c.y !== dy) break;
      j++;
    }
    const end = route[j] as RouteCell;
    const key = (Object.keys(WALK_DIRECTIONS) as WalkKey[]).find(
      (k) => WALK_DIRECTIONS[k].x === dx && WALK_DIRECTIONS[k].y === dy,
    ) as WalkKey;
    const until =
      dx > 0
        ? ({ kind: "x-at-least", value: end.x + 0.5 } as const)
        : dx < 0
          ? ({ kind: "x-at-most", value: end.x + 0.5 } as const)
          : dy > 0
            ? ({ kind: "y-at-least", value: end.y + 0.5 } as const)
            : ({ kind: "y-at-most", value: end.y + 0.5 } as const);
    out.push({ label: `${label}-${out.length}-to-${end.x},${end.y}`, key, until });
    i = j;
  }
  return out;
}

/** Walks, along each axis in turn, from where the player stands to the exact
 * position `to`: one held key per axis, released the frame it is reached. */
export async function walkRealAxes(page: Page, to: { x: number; y: number }): Promise<void> {
  for (const axis of ["x", "y"] as const) {
    const here = await page.evaluate(() => window.__bc?.playerPosition);
    if (!here) throw new Error("no player position");
    const delta = to[axis] - here[axis];
    if (Math.abs(delta) < 0.02) continue;
    const key: WalkKey =
      axis === "x" ? (delta > 0 ? "ArrowRight" : "ArrowLeft") : delta > 0 ? "ArrowDown" : "ArrowUp";
    const until: WalkUntil =
      axis === "x"
        ? delta > 0
          ? { kind: "x-at-least", value: to.x }
          : { kind: "x-at-most", value: to.x }
        : delta > 0
          ? { kind: "y-at-least", value: to.y }
          : { kind: "y-at-most", value: to.y };
    const segment: WalkSegment = { label: `nudge-${axis}`, key, until };
    await walkRealSegment(page, segment);
  }
}

/** Walks `cells` from where the player stands in the direction of `key`,
 * with real keyboard input. */
export async function walkRealCellsDir(
  page: Page,
  label: string,
  cells: number,
  key: WalkKey,
): Promise<void> {
  const here = await page.evaluate(() => window.__bc?.playerPosition);
  if (!here) throw new Error("no player position");
  const until: WalkUntil =
    key === "ArrowRight"
      ? { kind: "x-at-least", value: here.x + cells }
      : key === "ArrowLeft"
        ? { kind: "x-at-most", value: here.x - cells }
        : key === "ArrowDown"
          ? { kind: "y-at-least", value: here.y + cells }
          : { kind: "y-at-most", value: here.y - cells };
  const segment: WalkSegment = { label, key, until };
  await walkRealSegment(page, segment);
}
