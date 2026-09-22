// `world/transitions.ts`'s own unit tests (Tim's direction, story 1.7;
// pair symmetry story 15.2, Quentin's direction).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CollisionGridQuery, GridEntry } from "../../../src/world/collision-grid";
import { initialFloorWalkState, stepAndTransition } from "../../../src/world/floor-walk";
import type { MovementConfig } from "../../../src/world/movement";
import {
  checkTransitionPairSymmetry,
  TransitionIndex,
  type TransitionSpec,
} from "../../../src/world/transitions";

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

const ALWAYS_STANDABLE = () => true;

describe("checkTransitionPairSymmetry (story 15.2, Quentin's direction)", () => {
  it("a mirrored pair (the footbridge's own real shape) passes with no problems", () => {
    // The exact shape `STREET_TRANSITIONS`'s own footbridge pair already
    // has: the up-anchor's own landing and the down-anchor's own anchor
    // share a column, one cell apart along the axis of approach.
    const bridgeUp: TransitionSpec = {
      x: 20,
      y: 8,
      floor: 0,
      targetX: 20,
      targetY: 7,
      targetFloor: 1,
    };
    const bridgeDown: TransitionSpec = {
      x: 19,
      y: 7,
      floor: 1,
      targetX: 19,
      targetY: 8,
      targetFloor: 0,
    };
    expect(checkTransitionPairSymmetry([bridgeUp, bridgeDown], ALWAYS_STANDABLE)).toEqual([]);
  });

  it("the subway's own pre-story-15.2 shape (the up-anchor north of the landing, not mirrored) is refused by name", () => {
    // The real bug this story fixes: the up-anchor shared the landing's
    // own column instead of being its neighbour along the down anchor's
    // own axis of approach.
    const down: TransitionSpec = {
      x: 16,
      y: 8,
      floor: 0,
      targetX: 16,
      targetY: 3,
      targetFloor: -1,
    };
    const upNorthOfLanding: TransitionSpec = {
      x: 16,
      y: 2,
      floor: -1,
      targetX: 17,
      targetY: 8,
      targetFloor: 0,
    };
    const problems = checkTransitionPairSymmetry([down, upNorthOfLanding], ALWAYS_STANDABLE);
    expect(problems).toHaveLength(2); // neither direction finds the other as its own mirror
    expect(problems[0]).toMatch(/no mirrored reverse transition/);
  });

  it("a pair whose reverse anchor is not standable is refused by name", () => {
    const down: TransitionSpec = {
      x: 16,
      y: 8,
      floor: 0,
      targetX: 16,
      targetY: 3,
      targetFloor: -1,
    };
    const up: TransitionSpec = { x: 15, y: 3, floor: -1, targetX: 15, targetY: 8, targetFloor: 0 };
    const problems = checkTransitionPairSymmetry(
      [down, up],
      (x, y, floor) => !(x === 15 && y === 3 && floor === -1),
    );
    expect(problems.some((p) => p.includes("reverse anchor") && p.includes("not standable"))).toBe(
      true,
    );
  });

  it("a pair whose reverse landing is not standable is refused by name", () => {
    const down: TransitionSpec = {
      x: 16,
      y: 8,
      floor: 0,
      targetX: 16,
      targetY: 3,
      targetFloor: -1,
    };
    const up: TransitionSpec = { x: 15, y: 3, floor: -1, targetX: 15, targetY: 8, targetFloor: 0 };
    const problems = checkTransitionPairSymmetry(
      [down, up],
      (x, y, floor) => !(x === 15 && y === 8 && floor === 0),
    );
    expect(problems.some((p) => p.includes("reverse landing") && p.includes("not standable"))).toBe(
      true,
    );
  });
});

describe("TransitionIndex's own pairSymmetry option (story 15.2)", () => {
  it("throws naming the problem when opted in and the pair does not mirror", () => {
    const down: TransitionSpec = {
      x: 16,
      y: 8,
      floor: 0,
      targetX: 16,
      targetY: 3,
      targetFloor: -1,
    };
    const upNorthOfLanding: TransitionSpec = {
      x: 16,
      y: 2,
      floor: -1,
      targetX: 17,
      targetY: 8,
      targetFloor: 0,
    };
    expect(
      () => new TransitionIndex([down, upNorthOfLanding], { isStandable: ALWAYS_STANDABLE }),
    ).toThrow(/transition pair symmetry violated/);
  });

  it("does not throw when opted in and every transition mirrors a real reverse", () => {
    const down: TransitionSpec = {
      x: 16,
      y: 8,
      floor: 0,
      targetX: 16,
      targetY: 3,
      targetFloor: -1,
    };
    const up: TransitionSpec = { x: 15, y: 3, floor: -1, targetX: 15, targetY: 8, targetFloor: 0 };
    expect(() => new TransitionIndex([down, up], { isStandable: ALWAYS_STANDABLE })).not.toThrow();
  });

  it("stays lenient by default (not opted in), the same mutually-targeting-identical-cell shape world/floor-walk.test.ts relies on", () => {
    const mutual: TransitionSpec[] = [
      { x: 5, y: 0, floor: 0, targetX: 5, targetY: 0, targetFloor: -1 },
      { x: 5, y: 0, floor: -1, targetX: 5, targetY: 0, targetFloor: 0 },
    ];
    expect(() => new TransitionIndex(mutual)).not.toThrow();
  });
});

const OPEN_GRID: CollisionGridQuery = {
  entriesInCell(): readonly GridEntry[] {
    return [];
  },
};

describe("story 15.2, Quentin's direction: for any mirrored pair, any speed and any deltaMs in range, walking the entry direction then the reverse direction lands back on the original cell, with no bounce", () => {
  it("inv_transition_pairs_round_trip", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          { x: 1, y: 0 } as const,
          { x: -1, y: 0 } as const,
          { x: 0, y: 1 } as const,
          {
            x: 0,
            y: -1,
          } as const,
        ),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        // A single step's own farthest possible travel (speed * the 100ms
        // clamp `movement.ts` applies) must stay under one whole cell, or
        // a step can tunnel clean over a one-cell-wide anchor without its
        // destination cell ever being the anchor -- a real limitation of
        // "check only the cell landed on", already true of the committed
        // walking speed (0.0022 cells/ms * 100ms = 0.22 cells) and nothing
        // this property is about, so it is a precondition here, not a
        // finding.
        fc.double({ min: 0.0001, max: 0.009, noNaN: true }),
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 20 }),
        (d, ax, ay, lx, ly, walkSpeedCellsPerMs, deltaMsSequence) => {
          // A mirrored pair, built exactly the way `checkTransitionPairSymmetry`
          // requires: the reverse anchor is the landing's own neighbour
          // along `d`, and the reverse landing is the forward anchor's own
          // neighbour along `d` -- the same `d` in both.
          const forward: TransitionSpec = {
            x: ax,
            y: ay,
            floor: 0,
            targetX: lx,
            targetY: ly,
            targetFloor: -1,
          };
          const reverse: TransitionSpec = {
            x: lx - d.x,
            y: ly - d.y,
            floor: -1,
            targetX: ax - d.x,
            targetY: ay - d.y,
            targetFloor: 0,
          };
          expect(checkTransitionPairSymmetry([forward, reverse], ALWAYS_STANDABLE)).toEqual([]);

          const transitions = new TransitionIndex([forward, reverse], {
            isStandable: ALWAYS_STANDABLE,
          });
          const config: MovementConfig = {
            walkSpeedCellsPerMs,
            bodyWidthSubcells: 8,
            bodyHeightSubcells: 4,
            subcellsPerCell: 16,
          };
          const startX = ax - d.x + 0.5;
          const startY = ay - d.y + 0.5;

          let state = {
            ...initialFloorWalkState(startX, startY, 0),
            transitioned: false,
          };
          let transitionCount = 0;
          const maxSteps = 10_000;
          let steps = 0;
          // Walk the entry direction until it transitions down.
          while (!state.transitioned && steps++ < maxSteps) {
            const deltaMs = deltaMsSequence[steps % deltaMsSequence.length] ?? 1;
            state = stepAndTransition(state, d, deltaMs, OPEN_GRID, config, transitions);
          }
          if (state.transitioned) transitionCount++;
          expect(state.floor).toBe(-1);
          expect(state.cellX).toBe(lx);
          expect(state.cellY).toBe(ly);

          // Walk the reverse direction until it transitions back up.
          state = { ...state, transitioned: false };
          steps = 0;
          while (!state.transitioned && steps++ < maxSteps) {
            const deltaMs = deltaMsSequence[steps % deltaMsSequence.length] ?? 1;
            state = stepAndTransition(
              state,
              { x: -d.x, y: -d.y },
              deltaMs,
              OPEN_GRID,
              config,
              transitions,
            );
          }
          if (state.transitioned) transitionCount++;

          // Lands back on the exact cell the walk started from, and never
          // bounced (transitioned exactly the two times a real down-then-
          // up round trip requires, never more).
          expect(state.floor).toBe(0);
          expect(state.cellX).toBe(ax - d.x);
          expect(state.cellY).toBe(ay - d.y);
          expect(transitionCount).toBe(2);
        },
      ),
    );
  });
});
