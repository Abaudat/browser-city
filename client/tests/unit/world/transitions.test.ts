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

  it("throws on two specs sharing the same anchor cell, rather than silently keeping only the last", () => {
    const duplicated: TransitionSpec[] = [
      { x: 5, y: 0, floor: 0, targetX: 5, targetY: 0, targetFloor: -1 },
      { x: 5, y: 0, floor: 0, targetX: 9, targetY: 9, targetFloor: 1 },
    ];
    expect(() => new TransitionIndex(duplicated)).toThrow(/duplicate transition anchor/);
  });

  it("the same anchor cell on two different floors is not a duplicate", () => {
    const specs2: TransitionSpec[] = [
      { x: 5, y: 0, floor: 0, targetX: 5, targetY: 0, targetFloor: -1 },
      { x: 5, y: 0, floor: -1, targetX: 5, targetY: 0, targetFloor: 0 },
    ];
    expect(() => new TransitionIndex(specs2)).not.toThrow();
  });
});
