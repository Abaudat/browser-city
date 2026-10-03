// The in-page walk watcher and the checks on what it records. No Node or
// Playwright import: the watcher is serialised into the page, and a unit
// test drives it directly.
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
  /** Watcher frames after the release on which the body still moved. */
  movedAfterKeyupFrames: number;
  /** The Node-side call that awaits the walk landed here: the stretch the
   * body is unwatched when a watcher is armed only after the key. */
  entryMs: number | null;
  entryFrame: number | null;
  gapMs: number | null;
  gapFrames: number | null;
  gapCells: number | null;
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
    __bcWalkStamp?: () => void;
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
    movedAfterKeyupFrames: 0,
    entryMs: null,
    entryFrame: null,
    gapMs: null,
    gapFrames: null,
    gapCells: null,
  };
  let frame = 0;
  let releasing = false;
  let ticksAtKeydown: number | null = null;
  w.__bcWalkStamp = (): void => {
    const here = position();
    rec.entryMs = performance.now();
    rec.entryFrame = frame;
    if (rec.keydownMs !== null && rec.keydownFrame !== null && rec.atKeydown && here) {
      rec.gapMs = rec.entryMs - rec.keydownMs;
      rec.gapFrames = frame - rec.keydownFrame;
      rec.gapCells = Math.hypot(here.x - rec.atKeydown.x, here.y - rec.atKeydown.y);
    }
  };
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
    let prevFloor: number | undefined;
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
      const floor = w.__bc?.playerFloor;
      // A floor transition moves the body in one frame; it is not a step.
      if (prev && pos && floor === prevFloor) {
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
      } else {
        rec.movedAfterKeyupFrames++;
      }
      prev = pos;
      prevFloor = floor;
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
  if (record.movedAfterKeyupFrames > 0) {
    return (
      `walk '${segment.label}' ${JSON.stringify(segment.until)}: the body moved on ` +
      `${record.movedAfterKeyupFrames} frame(s) after its own keyup (released at frame ` +
      `${record.keyupFrame}, at rest by frame ${record.restFrame})`
    );
  }
  if (record.maxFrameStepSteps > 1 + 1e-9) {
    return (
      `walk '${segment.label}' ${JSON.stringify(segment.until)}: the body moved ` +
      `${record.maxFrameStepSteps.toFixed(2)} clamped steps in one frame`
    );
  }
  const past = record.pastAtRestCells;
  if (past === null || past <= boundCells + 1e-9) return null;
  return (
    `walk '${segment.label}' ${JSON.stringify(segment.until)}: rested ${past.toFixed(4)} cells ` +
    `past the threshold, bound ${boundCells.toFixed(4)} (RELEASE_LAG); released at frame ` +
    `${record.keyupFrame}, at rest by frame ${record.restFrame}`
  );
}

/** Awaits the armed walk, stamping the moment the awaiting call lands.
 * Self-contained, like [`armWalkWatcher`]. */
export function awaitWalk(): Promise<WalkRecord> {
  const w = window as unknown as {
    __bcWalk: Promise<WalkRecord>;
    __bcWalkStamp?: () => void;
  };
  w.__bcWalkStamp?.();
  return w.__bcWalk;
}
