// The one implementation of the scripted e2e walk every spec shares.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";
import type {} from "../../src/net/e2e-hooks";
import {
  RELEASE_LAG,
  type StreetWalkSegment,
  type StreetWalkUntil,
} from "../../src/test-street/fixture";
import { streetMovementConfig } from "../unit/test-street/street-world";

export type WalkMode = "real" | "synthetic";

export interface WatcherArgs {
  readonly until: StreetWalkUntil;
  readonly code: string;
  readonly mode: WalkMode;
  readonly timeoutMs: number;
  /** One clamped tick, in cells. */
  readonly maxStepCells: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/** What one walk saw, from the key going down to the body at rest. Frames
 * are the watcher's own animation frames (0 = before its first one). */
export interface WalkRecord {
  ok: boolean;
  error?: string;
  keydownMs: number | null;
  keydownFrame: number | null;
  firstFrameMs: number | null;
  metMs: number | null;
  metFrame: number | null;
  keyupMs: number | null;
  keyupFrame: number | null;
  restMs: number | null;
  restFrame: number | null;
  atKeydown: Point | null;
  atFirstFrame: Point | null;
  atMet: Point | null;
  atRest: Point | null;
  metOnFirstFrame: boolean;
  pastAtMetCells: number | null;
  pastAtMetSteps: number | null;
  pastAtRestCells: number | null;
  pastAtRestSteps: number | null;
  /** Events seen after the watcher's own `keyup`, until rest. */
  lateEvents: { type: string; code?: string; repeat?: boolean; isTrusted: boolean }[];
  /** The largest displacement between two watcher frames, in clamped steps. */
  maxFrameStepSteps: number;
  maxFrameIntervalMs: number;
  /** Scene ticks (`__bc.frameCount`) from the key going down to rest. */
  sceneTicks: number | null;
}

/** Arms the in-page watcher: it records the walk, releases the key inside
 * the page on the frame the condition is first seen true, and resolves
 * `window.__bcWalk` once the body is at rest. `real` mode waits for the
 * key the caller presses; `synthetic` presses it itself. Returns false when
 * the threshold already holds. Self-contained: it is serialised into the
 * page, so it may use nothing outside itself. */
export function armWalkWatcher(args: WatcherArgs): boolean {
  const { until, code, mode, timeoutMs, maxStepCells } = args;
  const w = window as unknown as {
    __bc?: { playerPosition?: Point; playerFloor?: number; frameCount?: number };
    __bcWalk?: Promise<WalkRecord>;
  };
  const position = (): Point | null => {
    const p = w.__bc?.playerPosition;
    return p ? { x: p.x, y: p.y } : null;
  };
  const met = (): boolean => {
    const pos = w.__bc?.playerPosition;
    const floor = w.__bc?.playerFloor;
    if (!pos || floor === undefined) return false;
    switch (until.kind) {
      case "x-at-least":
        return pos.x >= until.value;
      case "x-at-most":
        return pos.x <= until.value;
      case "y-at-least":
        return pos.y >= until.value;
      case "y-at-most":
        return pos.y <= until.value;
      case "floor":
        return floor === until.value;
      case "cell":
        return Math.floor(pos.x) === until.x && Math.floor(pos.y) === until.y;
    }
  };
  const past = (p: Point | null): number | null => {
    if (!p) return null;
    switch (until.kind) {
      case "x-at-least":
        return p.x - until.value;
      case "x-at-most":
        return until.value - p.x;
      case "y-at-least":
        return p.y - until.value;
      case "y-at-most":
        return until.value - p.y;
      default:
        return null;
    }
  };
  if (met()) return false;

  const rec: WalkRecord = {
    ok: false,
    keydownMs: null,
    keydownFrame: null,
    firstFrameMs: null,
    metMs: null,
    metFrame: null,
    keyupMs: null,
    keyupFrame: null,
    restMs: null,
    restFrame: null,
    atKeydown: null,
    atFirstFrame: null,
    atMet: null,
    atRest: null,
    metOnFirstFrame: false,
    pastAtMetCells: null,
    pastAtMetSteps: null,
    pastAtRestCells: null,
    pastAtRestSteps: null,
    lateEvents: [],
    maxFrameStepSteps: 0,
    maxFrameIntervalMs: 0,
    sceneTicks: null,
  };
  let frame = 0;
  let releasing = false;
  let ticksAtKeydown: number | null = null;
  const onKey = (e: Event): void => {
    const k = e as KeyboardEvent;
    if (releasing) return;
    if (rec.keyupFrame !== null) {
      rec.lateEvents.push({
        type: k.type,
        code: k.code,
        repeat: k.repeat,
        isTrusted: k.isTrusted,
      });
      return;
    }
    if (k.type === "keydown" && rec.keydownMs === null) {
      rec.keydownMs = performance.now();
      rec.keydownFrame = frame;
      rec.atKeydown = position();
      ticksAtKeydown = w.__bc?.frameCount ?? 0;
    }
  };
  const onOther = (e: Event): void => {
    if (rec.keyupFrame === null || releasing) return;
    rec.lateEvents.push({ type: e.type, isTrusted: e.isTrusted });
  };
  const release = (): void => {
    releasing = true;
    rec.keyupMs = performance.now();
    rec.keyupFrame = frame;
    window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
    releasing = false;
  };
  for (const type of ["keydown", "keyup"]) window.addEventListener(type, onKey, true);
  for (const type of ["blur", "visibilitychange"]) window.addEventListener(type, onOther, true);

  w.__bcWalk = new Promise<WalkRecord>((resolve) => {
    const deadline = performance.now() + timeoutMs;
    let prev: Point | null = null;
    let prevMs: number | null = null;
    const finish = (ok: boolean, error?: string): void => {
      for (const type of ["keydown", "keyup"]) window.removeEventListener(type, onKey, true);
      for (const type of ["blur", "visibilitychange"]) {
        window.removeEventListener(type, onOther, true);
      }
      rec.ok = ok;
      if (error) rec.error = error;
      rec.restMs = performance.now();
      rec.restFrame = frame;
      rec.atRest = position();
      rec.pastAtRestCells = past(rec.atRest);
      rec.pastAtRestSteps =
        rec.pastAtRestCells === null ? null : rec.pastAtRestCells / maxStepCells;
      if (ticksAtKeydown !== null) rec.sceneTicks = (w.__bc?.frameCount ?? 0) - ticksAtKeydown;
      resolve(rec);
    };
    const tick = (): void => {
      frame++;
      const now = performance.now();
      const pos = position();
      if (frame === 1) {
        rec.firstFrameMs = now;
        rec.atFirstFrame = pos;
      }
      if (prevMs !== null) rec.maxFrameIntervalMs = Math.max(rec.maxFrameIntervalMs, now - prevMs);
      if (prev && pos) {
        const d = Math.hypot(pos.x - prev.x, pos.y - prev.y) / maxStepCells;
        rec.maxFrameStepSteps = Math.max(rec.maxFrameStepSteps, d);
      }
      if (rec.keyupFrame === null) {
        if (met()) {
          rec.metMs = now;
          rec.metFrame = frame;
          rec.atMet = pos;
          rec.metOnFirstFrame = frame === 1;
          rec.pastAtMetCells = past(pos);
          rec.pastAtMetSteps =
            rec.pastAtMetCells === null ? null : rec.pastAtMetCells / maxStepCells;
          release();
        } else if (now >= deadline) {
          release();
          finish(false, `${JSON.stringify(until)} never met`);
          return;
        }
      } else if (prev && pos && prev.x === pos.x && prev.y === pos.y) {
        finish(true);
        return;
      }
      prev = pos;
      prevMs = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  if (mode === "synthetic") {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
  }
  return true;
}

/** How far past an axis threshold a walk may rest: the tick that crossed it
 * plus `RELEASE_LAG.releaseLagSteps` more, all at the resolver's clamp. */
export function releaseBoundCells(): number {
  return (
    (1 + RELEASE_LAG.releaseLagSteps) *
    streetMovementConfig().walkSpeedCellsPerMs *
    RELEASE_LAG.stepMs
  );
}

/** A message naming the segment, its threshold and the distance when the
 * walk rested further past its axis threshold than `boundCells`. */
export function overshootViolation(
  record: WalkRecord,
  segment: StreetWalkSegment,
  boundCells: number,
): string | null {
  const past = record.pastAtRestCells;
  if (past === null || past <= boundCells + 1e-9) return null;
  return (
    `walk '${segment.label}' ${JSON.stringify(segment.until)}: rested ${past.toFixed(4)} cells ` +
    `past the threshold, bound ${boundCells.toFixed(4)} (RELEASE_LAG); released at frame ` +
    `${record.keyupFrame}, at rest by frame ${record.restFrame}`
  );
}

const RECORD_FILE = join(process.cwd(), "walk-records", "walks.jsonl");

async function writeRecord(
  segment: StreetWalkSegment,
  mode: WalkMode,
  record: WalkRecord,
  readBack: Point | undefined,
): Promise<void> {
  const { test } = await import("@playwright/test");
  let spec = "";
  let title = "";
  try {
    const info = test.info();
    spec = info.file.split(/[\\/]/).pop() ?? "";
    title = info.title;
  } catch {
    // Not inside a test.
  }
  mkdirSync(dirname(RECORD_FILE), { recursive: true });
  appendFileSync(
    RECORD_FILE,
    `${JSON.stringify({
      spec,
      test: title,
      label: segment.label,
      until: segment.until,
      key: segment.key,
      mode,
      nodeReadsAfter: readBack ?? null,
      ...record,
    })}\n`,
  );
}

/** Walks one segment: the watcher is armed before the key goes down, the
 * key is released inside the page on the frame the condition is first seen
 * true, and the walk's record is written to `walk-records/` and checked
 * against `RELEASE_LAG`. */
export async function walkSegment(
  page: Page,
  segment: StreetWalkSegment,
  mode: WalkMode,
  timeoutMs = 30_000,
): Promise<WalkRecord | null> {
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
    if (segment.until.kind === "floor" || segment.until.kind === "cell") return null;
    throw new Error(
      `walk '${segment.label}' already met ${JSON.stringify(segment.until)} before the key went down -- a route bug`,
    );
  }
  let record: WalkRecord;
  if (mode === "real") await page.keyboard.down(segment.key);
  try {
    record = await page.evaluate(
      () => (window as unknown as { __bcWalk: Promise<WalkRecord> }).__bcWalk,
    );
  } finally {
    if (mode === "real") await page.keyboard.up(segment.key);
  }
  const readBack = await page.evaluate(() => window.__bc?.playerPosition);
  await writeRecord(segment, mode, record, readBack);
  if (!record.ok) throw new Error(`walk '${segment.label}': ${record.error}`);
  const violation = overshootViolation(record, segment, releaseBoundCells());
  if (violation) throw new Error(violation);
  return record;
}

/** Real, OS-level keyboard input. */
export async function walkRealSegment(page: Page, segment: StreetWalkSegment): Promise<void> {
  await walkSegment(page, segment, "real");
}

/** A synthetic `keydown` dispatched in the page, for specs whose own mouse
 * moves make a real key arrive late. */
export async function walkSyntheticSegment(
  page: Page,
  segment: StreetWalkSegment,
  timeoutMs?: number,
): Promise<void> {
  await walkSegment(page, segment, "synthetic", timeoutMs);
}
