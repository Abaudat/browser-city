// `fixture.ts`'s own transition data, checked directly (story 1.7): a
// regression test for a real bug this fixture found -- the subway's
// up-transition originally targeted the exact same cell the down
// transition anchors on. Landing there meant a still-held direction key,
// re-checked on the very next tick against that identical cell, retriggered
// the descent immediately: holding a direction key through the whole
// round trip bounced the player between floors instead of leaving them on
// the street. `client/tests/e2e/enclosure.spec.ts`'s subway test is what
// caught this for real, on a real keyboard walk; this unit test pins the
// data-level fact directly, so a future transition can never reintroduce
// the same shape of bug without a fast, non-flaky test catching it first.
import { describe, expect, it } from "vitest";
import { DEMO_TRANSITIONS } from "../../../src/demo/fixture";

describe("DEMO_TRANSITIONS", () => {
  it("is non-empty", () => {
    expect(DEMO_TRANSITIONS.length).toBeGreaterThan(0);
  });

  it("no transition's target cell is itself a transition anchor", () => {
    // A player holding one direction key through a transition keeps
    // moving in that same direction afterwards; if the landing cell were
    // also an anchor, the very next tick (still holding the key) would
    // immediately re-trigger a transition from the cell the previous one
    // just landed on -- an infinite bounce for as long as the key stays
    // held, never a stable arrival.
    const anchors = new Set(DEMO_TRANSITIONS.map((t) => `${t.x}|${t.y}|${t.floor}`));
    for (const t of DEMO_TRANSITIONS) {
      const targetKey = `${t.targetX}|${t.targetY}|${t.targetFloor}`;
      expect(
        anchors.has(targetKey),
        `transition (${t.x}, ${t.y}, floor ${t.floor}) -> (${t.targetX}, ${t.targetY}, floor ${t.targetFloor}) lands exactly on a transition anchor`,
      ).toBe(false);
    }
  });
});
