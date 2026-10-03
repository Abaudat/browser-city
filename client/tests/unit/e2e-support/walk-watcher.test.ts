// The e2e walk helper's in-page watcher, driven by a fake frame loop and the
// real movement resolver: the stop is inside `RELEASE_LAG` whichever order
// the scene and the watcher run in and however late the key lands after
// the watcher is armed.
import { afterEach, describe, expect, it } from "vitest";
import {
  PLAYER_START,
  RELEASE_LAG,
  STREET_WALK_DIRECTIONS,
  type StreetWalkSegment,
} from "../../../src/test-street/fixture";
import { initialFloorWalkState, stepAndTransition } from "../../../src/world/floor-walk";
import {
  armWalkWatcher,
  overshootViolation,
  releaseBoundCells,
  type WalkRecord,
  type WatcherArgs,
} from "../../e2e/walk-support";
import {
  streetMovementConfig,
  streetTransitionIndex,
  streetWorldIndex,
} from "../test-street/street-world";

const FRAME_MS = 16;
type Order = "scene-first" | "watcher-first";

interface FakeKeyEvent {
  type: string;
  code: string;
  isTrusted: boolean;
  repeat: boolean;
}

/** Installs a fake page (window, rAF, performance, KeyboardEvent) whose
 * scene steps the real resolver while a key is held. */
function installPage(order: Order) {
  const world = streetWorldIndex();
  const config = streetMovementConfig();
  const transitions = streetTransitionIndex();
  let state = {
    ...initialFloorWalkState(PLAYER_START.x, PLAYER_START.y, PLAYER_START.floor),
    transitioned: false,
  };
  let held: string | null = null;
  let now = 0;
  let sceneTicks = 0;
  const listeners = new Map<string, ((e: FakeKeyEvent) => void)[]>();
  let queue: (() => void)[] = [];
  const bc = {
    playerPosition: { x: state.x, y: state.y },
    playerFloor: state.floor,
    frameCount: 0,
  };
  const win = {
    __bc: bc as typeof bc & Record<string, unknown>,
    __bcWalk: undefined as Promise<WalkRecord> | undefined,
    addEventListener: (type: string, fn: (e: FakeKeyEvent) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener: (type: string, fn: (e: FakeKeyEvent) => void) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((f) => f !== fn),
      );
    },
    dispatchEvent: (e: FakeKeyEvent) => {
      if (e.type === "keydown") held = e.code;
      if (e.type === "keyup" && held === e.code) held = null;
      for (const fn of listeners.get(e.type) ?? []) fn(e);
      return true;
    },
  };
  class FakeKeyboardEvent {
    isTrusted = false;
    repeat = false;
    code: string;
    constructor(
      public type: string,
      init: { code: string },
    ) {
      this.code = init.code;
    }
  }
  const g = globalThis as Record<string, unknown>;
  g.window = win;
  g.KeyboardEvent = FakeKeyboardEvent;
  g.requestAnimationFrame = (fn: () => void) => {
    queue.push(fn);
    return 0;
  };
  g.performance = { now: () => now };
  const scene = () => {
    if (held) {
      const dir = STREET_WALK_DIRECTIONS[held as keyof typeof STREET_WALK_DIRECTIONS];
      state = stepAndTransition(state, dir, FRAME_MS, world, config, transitions);
      bc.playerPosition = { x: state.x, y: state.y };
      bc.playerFloor = state.floor;
    }
    bc.frameCount++;
    sceneTicks++;
  };
  return {
    win,
    ticks: () => sceneTicks,
    position: () => ({ x: state.x, y: state.y }),
    press: (code: string) =>
      win.dispatchEvent(new FakeKeyboardEvent("keydown", { code }) as unknown as FakeKeyEvent),
    frame: () => {
      now += FRAME_MS;
      const watchers = queue;
      queue = [];
      if (order === "scene-first") scene();
      for (const fn of watchers) fn();
      if (order === "watcher-first") scene();
    },
  };
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  for (const k of ["window", "KeyboardEvent", "requestAnimationFrame", "performance"]) delete g[k];
});

const HOP = 0.2;
const hop = (): StreetWalkSegment => ({
  label: "hop",
  key: "ArrowRight",
  until: { kind: "x-at-least", value: PLAYER_START.x + HOP },
});
const argsFor = (segment: StreetWalkSegment, mode: WatcherArgs["mode"]): WatcherArgs => ({
  until: segment.until,
  code: segment.key,
  mode,
  timeoutMs: 5_000,
  maxStepCells: streetMovementConfig().walkSpeedCellsPerMs * RELEASE_LAG.stepMs,
});

describe("the in-page walk watcher", () => {
  for (const order of ["scene-first", "watcher-first"] as const) {
    for (const keyLandsAfter of [0, 1, 2, 5]) {
      it(`real mode, ${order}, key lands ${keyLandsAfter} frames after arming: stops inside the model`, async () => {
        const page = installPage(order);
        const segment = hop();
        expect(armWalkWatcher(argsFor(segment, "real"))).toBe(true);
        for (let i = 0; i < keyLandsAfter; i++) page.frame();
        page.press(segment.key);
        for (let i = 0; i < 60; i++) page.frame();
        const record = await page.win.__bcWalk;
        expect(record?.ok).toBe(true);
        const past = page.position().x - (PLAYER_START.x + HOP);
        const bound = releaseBoundCells();
        expect(past).toBeGreaterThanOrEqual(0);
        expect(past).toBeLessThanOrEqual(bound);
        expect(record?.pastAtRestCells).toBeCloseTo(past, 9);
        expect(record && overshootViolation(record, segment, bound)).toBeNull();
      });
    }
  }

  it("synthetic mode presses the key itself and records the same fields", async () => {
    const page = installPage("scene-first");
    expect(armWalkWatcher(argsFor(hop(), "synthetic"))).toBe(true);
    for (let i = 0; i < 60; i++) page.frame();
    const record = await page.win.__bcWalk;
    expect(record?.ok).toBe(true);
    expect(record?.keydownFrame).not.toBeNull();
    expect(record?.keyupFrame).not.toBeNull();
  });

  it("an axis threshold already met at arming is refused", () => {
    installPage("scene-first");
    const segment: StreetWalkSegment = {
      label: "already",
      key: "ArrowRight",
      until: { kind: "x-at-least", value: PLAYER_START.x - 1 },
    };
    expect(armWalkWatcher(argsFor(segment, "real"))).toBe(false);
  });

  it("a key seen after the release is recorded", async () => {
    const page = installPage("scene-first");
    const segment = hop();
    let released = false;
    page.win.addEventListener("keyup", () => {
      released = true;
    });
    armWalkWatcher(argsFor(segment, "real"));
    page.press(segment.key);
    for (let i = 0; i < 60 && !released; i++) page.frame();
    page.press(segment.key);
    for (let i = 0; i < 400; i++) page.frame();
    const record = await page.win.__bcWalk;
    expect(record?.lateEvents.some((e) => e.type === "keydown")).toBe(true);
  });

  it("overshootViolation names the segment, the threshold and the distance", () => {
    const segment = hop();
    const record = { pastAtRestCells: 0.5, restFrame: 9, metFrame: 3 } as WalkRecord;
    const message = overshootViolation(record, segment, 0.1);
    expect(message).toContain("hop");
    expect(message).toContain("x-at-least");
    expect(message).toContain("0.5");
  });

  it("a floor or cell threshold has no distance to bound", () => {
    const record = { pastAtRestCells: null } as WalkRecord;
    expect(
      overshootViolation(
        record,
        { label: "f", key: "ArrowUp", until: { kind: "floor", value: 1 } },
        0.1,
      ),
    ).toBeNull();
  });
});
