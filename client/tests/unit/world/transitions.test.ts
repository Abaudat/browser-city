// `world/transitions.ts`'s own unit tests (Tim's direction, story 1.7).
import { describe, expect, it } from "vitest";
import { TransitionIndex, type TransitionSpec } from "../../../src/world/transitions";

describe("TransitionIndex", () => {
  const specs: TransitionSpec[] = [
    { x: 18, y: 0, floor: 0, targetX: 18, targetY: 0, targetFloor: -1 },
    { x: 23, y: 0, floor: 0, targetX: 23, targetY: 0, targetFloor: 1 },
  ];

  it("returns undefined for a cell that is not a transition anchor", () => {
    const index = new TransitionIndex(specs);
    expect(index.transitionAt(0, 0, 0)).toBeUndefined();
    // A door is never a transition (FR118): an ordinary walkable cell.
    expect(index.transitionAt(5, 1, 0)).toBeUndefined();
  });

  it("resolves the anchor's own target floor and position", () => {
    const index = new TransitionIndex(specs);
    expect(index.transitionAt(18, 0, 0)).toEqual({ x: 18, y: 0, floor: -1 });
    expect(index.transitionAt(23, 0, 0)).toEqual({ x: 23, y: 0, floor: 1 });
  });

  it("never matches the same (x, y) on a different floor", () => {
    const index = new TransitionIndex(specs);
    expect(index.transitionAt(18, 0, -1)).toBeUndefined();
  });

  it("enter() returns floor and position together, from one call, so a caller can apply both in a single assignment", () => {
    const index = new TransitionIndex(specs);
    const target = index.enter(18, 0, 0);
    expect(target).toEqual({ x: 18, y: 0, floor: -1 });
    // The same object identity work either way; the point is there is no
    // intermediate state a caller could observe between reading the new
    // floor and reading the new position -- both come from this one call.
    expect(index.enter(0, 0, 0)).toBeUndefined();
  });
});
