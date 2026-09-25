// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exposeAppearanceCompareForE2e,
  exposeCityTimeForE2e,
  recordAppearanceTextureIdsForE2e,
  recordFrameWorkForE2e,
  recordMasksCheckedForE2e,
  recordPingForE2e,
  recordPlayerPositionForE2e,
  recordRenderOrderForE2e,
  recordVisibilityForE2e,
  recordWorldClockForE2e,
} from "../../src/net/e2e-hooks";

afterEach(() => {
  delete window.__bc;
  vi.unstubAllEnvs();
});

describe("recordPingForE2e", () => {
  it("appends to window.__bc.pings under DEV (Vitest runs non-production)", () => {
    recordPingForE2e({ id: 1n, message: "a", writtenAtMs: 1, observedAtMs: 1 });
    recordPingForE2e({ id: 2n, message: "b", writtenAtMs: 2, observedAtMs: 2 });

    expect(window.__bc?.pings).toEqual([
      { id: 1n, message: "a", writtenAtMs: 1, observedAtMs: 1 },
      { id: 2n, message: "b", writtenAtMs: 2, observedAtMs: 2 },
    ]);
  });

  it("creates the buffer lazily rather than requiring pre-existing state", () => {
    expect(window.__bc).toBeUndefined();
    recordPingForE2e({ id: 9n, message: "z", writtenAtMs: 9, observedAtMs: 9 });
    expect(window.__bc?.pings).toHaveLength(1);
  });

  it("does nothing when DEV is false -- the shape the production build ships as", () => {
    vi.stubEnv("DEV", false);

    recordPingForE2e({ id: 1n, message: "a", writtenAtMs: 1, observedAtMs: 1 });

    expect(window.__bc).toBeUndefined();
  });
});

describe("recordRenderOrderForE2e", () => {
  it("stores the order as decimal strings under window.__bc.renderOrder", () => {
    recordRenderOrderForE2e([3n, 1n, 2n]);
    expect(window.__bc?.renderOrder).toEqual(["3", "1", "2"]);
  });

  it("creates the buffer lazily rather than requiring pre-existing state", () => {
    expect(window.__bc).toBeUndefined();
    recordRenderOrderForE2e([1n]);
    expect(window.__bc?.renderOrder).toEqual(["1"]);
  });

  it("does nothing when DEV is false", () => {
    vi.stubEnv("DEV", false);

    recordRenderOrderForE2e([1n]);

    expect(window.__bc).toBeUndefined();
  });
});

describe("recordPlayerPositionForE2e", () => {
  it("stores the current position under window.__bc.playerPosition", () => {
    recordPlayerPositionForE2e(5, 4, 0);
    expect(window.__bc?.playerPosition).toEqual({ x: 5, y: 4 });
    expect(window.__bc?.playerFloor).toBe(0);
  });

  it("overwrites the previous position rather than accumulating a history", () => {
    recordPlayerPositionForE2e(5, 4, 0);
    recordPlayerPositionForE2e(5.1, 4.2, -1);
    expect(window.__bc?.playerPosition).toEqual({ x: 5.1, y: 4.2 });
    expect(window.__bc?.playerFloor).toBe(-1);
  });

  it("creates the buffer lazily rather than requiring pre-existing state", () => {
    expect(window.__bc).toBeUndefined();
    recordPlayerPositionForE2e(1, 1, 0);
    expect(window.__bc?.playerPosition).toEqual({ x: 1, y: 1 });
  });

  it("does nothing when DEV is false", () => {
    vi.stubEnv("DEV", false);

    recordPlayerPositionForE2e(1, 1, 0);

    expect(window.__bc).toBeUndefined();
  });
});

describe("recordFrameWorkForE2e", () => {
  it("records nothing until a caller starts a perf run, then collects every sample", () => {
    recordFrameWorkForE2e(1.5);
    expect(window.__bc?.frameTimings).toBeUndefined();

    window.__bc?.startFrameTimings?.();
    recordFrameWorkForE2e(2.5);
    recordFrameWorkForE2e(3.5);

    expect(window.__bc?.stopFrameTimings?.()).toEqual([2.5, 3.5]);
    // Stopping it puts the hook back to recording nothing.
    recordFrameWorkForE2e(4.5);
    expect(window.__bc?.frameTimings).toBeUndefined();
  });

  it("does nothing when DEV is false", () => {
    vi.stubEnv("DEV", false);

    recordFrameWorkForE2e(1);

    expect(window.__bc).toBeUndefined();
  });

  it("story 2.8: frameCount increments on every call regardless of the timings toggle -- 'zero frames drawn' is provable before mount, unconditionally", () => {
    expect(window.__bc?.frameCount).toBeUndefined();
    recordFrameWorkForE2e(1);
    expect(window.__bc?.frameCount).toBe(1);
    recordFrameWorkForE2e(2);
    recordFrameWorkForE2e(3);
    expect(window.__bc?.frameCount).toBe(3);
  });
});

describe("recordVisibilityForE2e", () => {
  it("stores a copy of the state and alpha maps under window.__bc.visibility/visibilityAlpha", () => {
    const state = { "1": "hidden", "2": "translucent" };
    const alpha = { "1": 1, "2": 0.42 };
    recordVisibilityForE2e(state, alpha);
    expect(window.__bc?.visibility).toEqual(state);
    expect(window.__bc?.visibility).not.toBe(state); // a copy, never the same reference
    expect(window.__bc?.visibilityAlpha).toEqual(alpha);
    expect(window.__bc?.visibilityAlpha).not.toBe(alpha);
  });

  it("creates the buffer lazily rather than requiring pre-existing state", () => {
    expect(window.__bc).toBeUndefined();
    recordVisibilityForE2e({ "1": "normal" }, { "1": 1 });
    expect(window.__bc?.visibility).toEqual({ "1": "normal" });
    expect(window.__bc?.visibilityAlpha).toEqual({ "1": 1 });
  });

  it("overwrites the previous maps rather than accumulating a history", () => {
    recordVisibilityForE2e({ "1": "hidden" }, { "1": 1 });
    recordVisibilityForE2e({ "2": "normal" }, { "2": 1 });
    expect(window.__bc?.visibility).toEqual({ "2": "normal" });
    expect(window.__bc?.visibilityAlpha).toEqual({ "2": 1 });
  });

  it("does nothing when DEV is false", () => {
    vi.stubEnv("DEV", false);

    recordVisibilityForE2e({ "1": "hidden" }, { "1": 1 });

    expect(window.__bc).toBeUndefined();
  });
});

describe("recordMasksCheckedForE2e", () => {
  it("stores the result under window.__bc.masksAllNull", () => {
    recordMasksCheckedForE2e(true);
    expect(window.__bc?.masksAllNull).toBe(true);
  });

  it("creates the buffer lazily rather than requiring pre-existing state", () => {
    expect(window.__bc).toBeUndefined();
    recordMasksCheckedForE2e(false);
    expect(window.__bc?.masksAllNull).toBe(false);
  });

  it("does nothing when DEV is false", () => {
    vi.stubEnv("DEV", false);

    recordMasksCheckedForE2e(true);

    expect(window.__bc).toBeUndefined();
  });
});

describe("recordAppearanceTextureIdsForE2e", () => {
  it("stores a copy of the ids map and the distinct count", () => {
    const ids = { "adult-0": 0, "adult-1": 0, "adult-2": 1 };
    recordAppearanceTextureIdsForE2e(ids, 2);
    expect(window.__bc?.appearanceTextureIds).toEqual(ids);
    expect(window.__bc?.appearanceTextureIds).not.toBe(ids);
    expect(window.__bc?.appearanceDistinctTextureCount).toBe(2);
  });

  it("creates the buffer lazily rather than requiring pre-existing state", () => {
    expect(window.__bc).toBeUndefined();
    recordAppearanceTextureIdsForE2e({ a: 0 }, 1);
    expect(window.__bc?.appearanceTextureIds).toEqual({ a: 0 });
  });

  it("does nothing when DEV is false", () => {
    vi.stubEnv("DEV", false);

    recordAppearanceTextureIdsForE2e({ a: 0 }, 1);

    expect(window.__bc).toBeUndefined();
  });
});

describe("exposeAppearanceCompareForE2e", () => {
  it("stores the callable under window.__bc.appearanceCompare", () => {
    const compare = vi.fn();
    exposeAppearanceCompareForE2e(compare);
    expect(window.__bc?.appearanceCompare).toBe(compare);
  });

  it("creates the buffer lazily rather than requiring pre-existing state", () => {
    expect(window.__bc).toBeUndefined();
    const compare = vi.fn();
    exposeAppearanceCompareForE2e(compare);
    expect(window.__bc?.appearanceCompare).toBe(compare);
  });

  it("does nothing when DEV is false", () => {
    vi.stubEnv("DEV", false);

    exposeAppearanceCompareForE2e(vi.fn());

    expect(window.__bc).toBeUndefined();
  });
});

describe("in-city clock hooks (story 4.1)", () => {
  it("counts world_clock inserts and updates separately, keeping the latest epoch", () => {
    recordWorldClockForE2e(5n, "insert");
    recordWorldClockForE2e(6n, "update");
    recordWorldClockForE2e(7n, "update");
    expect(window.__bc?.worldClock).toEqual({ epochMicros: "7", inserts: 1, updates: 2 });
  });

  it("exposes the derived city time as a callable", () => {
    const getter = vi.fn();
    exposeCityTimeForE2e(getter);
    expect(window.__bc?.cityTime).toBe(getter);
  });

  it("do nothing when DEV is false", () => {
    vi.stubEnv("DEV", false);
    recordWorldClockForE2e(5n, "insert");
    exposeCityTimeForE2e(vi.fn());
    expect(window.__bc).toBeUndefined();
  });
});
