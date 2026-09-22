// `world/floor-walk.ts`'s own unit tests (Quentin/Tim's direction, story
// 1.7): a transition is edge-triggered (entered by walking), never
// level-triggered by a key still held -- the class of bug that let two
// mutually-targeting transitions bounce a player between floors forever.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CollisionGridQuery, GridEntry } from "../../../src/world/collision-grid";
import {
  type FloorWalkState,
  initialFloorWalkState,
  stepAndTransition,
} from "../../../src/world/floor-walk";
import type { MovementConfig } from "../../../src/world/movement";
import { TransitionIndex } from "../../../src/world/transitions";

/** Open space, no colliders -- this module's own logic is what is under
 * test, not `movement.ts`'s collision resolution (already covered by
 * `movement.test.ts`). */
const OPEN_GRID: CollisionGridQuery = {
  entriesInCell(): readonly GridEntry[] {
    return [];
  },
};

const CONFIG: MovementConfig = {
  walkSpeedCellsPerMs: 2.2 / 1000,
  bodyWidthSubcells: 8,
  bodyHeightSubcells: 4,
  subcellsPerCell: 16,
};

/** A speed and delta generous enough that a single call reliably crosses
 * at least one whole cell, but not so generous it overshoots straight
 * past the one-cell-wide anchor it is meant to land on (`movement.ts`
 * clamps any single step's own delta to 100ms, so at this speed the
 * farthest one call ever travels is exactly one cell). */
const FAST_CONFIG: MovementConfig = { ...CONFIG, walkSpeedCellsPerMs: 0.01 };
const BIG_DELTA_MS = 100;

describe("initialFloorWalkState", () => {
  it("derives cellX/cellY with Math.floor, matching a negative position correctly", () => {
    expect(initialFloorWalkState(-0.5, 3.2, 0)).toEqual({
      x: -0.5,
      y: 3.2,
      floor: 0,
      cellX: -1,
      cellY: 3,
    });
  });
});

describe("stepAndTransition", () => {
  // `skipPairSymmetry`: this suite is testing `stepAndTransition`'s own
  // edge-triggered gating, never `TransitionIndex`'s own pair-symmetry
  // rule (story 15.2) -- a single, deliberately one-way transition (and,
  // below, a same-cell mutual pair) would otherwise fail construction
  // before any of these tests got to run at all.
  const transitions = new TransitionIndex(
    [{ x: 5, y: 0, floor: 0, targetX: 5, targetY: 0, targetFloor: -1 }],
    { skipPairSymmetry: true },
  );

  it("does not consult the transition index at all while the step stays inside the same cell", () => {
    const state: FloorWalkState = { x: 4.5, y: 0.5, floor: 0, cellX: 4, cellY: 0 };
    const result = stepAndTransition(state, { x: 1, y: 0 }, 1, OPEN_GRID, CONFIG, transitions);
    expect(result.transitioned).toBe(false);
    expect(result.floor).toBe(0);
  });

  it("fires the moment a step walks into a real anchor cell", () => {
    const state: FloorWalkState = { x: 4.9, y: 0.5, floor: 0, cellX: 4, cellY: 0 };
    const result = stepAndTransition(
      state,
      { x: 1, y: 0 },
      BIG_DELTA_MS,
      OPEN_GRID,
      FAST_CONFIG,
      transitions,
    );
    expect(result.transitioned).toBe(true);
    expect(result).toMatchObject({ x: 5.5, y: 0.5, floor: -1, cellX: 5, cellY: 0 });
  });

  it("never re-fires on the very next call after landing, even holding the identical input", () => {
    const walkingIn: FloorWalkState = { x: 4.9, y: 0.5, floor: 0, cellX: 4, cellY: 0 };
    const landed = stepAndTransition(
      walkingIn,
      { x: 1, y: 0 },
      BIG_DELTA_MS,
      OPEN_GRID,
      FAST_CONFIG,
      transitions,
    );
    expect(landed.transitioned).toBe(true);

    // Still holding "right", still on the landing cell: the transition
    // that produced this state must not immediately fire again.
    const again = stepAndTransition(landed, { x: 1, y: 0 }, 1, OPEN_GRID, CONFIG, transitions);
    expect(again.transitioned).toBe(false);
    expect(again.floor).toBe(-1);
  });

  it("the mutually-targeting pair a real bug reached never bounces, for any input sequence, holding one direction the whole way", () => {
    // The exact shape of the bug this module exists to make impossible by
    // construction: two transitions whose targets are each other's own
    // anchor. Landing on either, and continuing to hold the same
    // direction, must settle on the far side, never oscillate.
    // skipPairSymmetry: this is the exact same-cell mutual shape story
    // 15.2's own pair-symmetry rule refuses by construction -- this
    // suite's whole point is that stepAndTransition's own edge-triggered
    // gating alone never bounces on it, so it must still be constructible.
    const mutual = new TransitionIndex(
      [
        { x: 5, y: 0, floor: 0, targetX: 5, targetY: 0, targetFloor: -1 },
        { x: 5, y: 0, floor: -1, targetX: 5, targetY: 0, targetFloor: 0 },
      ],
      { skipPairSymmetry: true },
    );

    fc.assert(
      fc.property(
        fc.constantFrom({ x: 1, y: 0 } as const, { x: -1, y: 0 } as const),
        fc.array(fc.integer({ min: 1, max: BIG_DELTA_MS }), { minLength: 1, maxLength: 30 }),
        (direction, deltas) => {
          let state: FloorWalkState = { x: 4.5, y: 0.5, floor: 0, cellX: 4, cellY: 0 };
          let transitionCount = 0;
          for (const deltaMs of deltas) {
            const next = stepAndTransition(
              state,
              direction,
              deltaMs,
              OPEN_GRID,
              FAST_CONFIG,
              mutual,
            );
            if (next.transitioned) transitionCount++;
            state = next;
          }
          // Holding one direction for any sequence of steps crosses the
          // anchor at most once -- never bounces back and forth.
          expect(transitionCount).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  it("the mutually-targeting pair never fires on two consecutive steps, for any sequence of direction changes (Quentin's cycle-2 direction: a stronger property than holding one direction the whole way)", () => {
    // A player is free to walk back and forth across the anchor -- each
    // genuine crossing legitimately fires a transition, so "at most one
    // transition ever" does not hold here the way it does for a single
    // held direction. What must never happen, whatever the direction
    // sequence, is the exact bug shape this module exists to make
    // impossible: landing on one transition's anchor and having the very
    // next step immediately fire the other (a still-held or newly-issued
    // key re-checked against a cell that is itself an anchor).
    // skipPairSymmetry: this is the exact same-cell mutual shape story
    // 15.2's own pair-symmetry rule refuses by construction -- this
    // suite's whole point is that stepAndTransition's own edge-triggered
    // gating alone never bounces on it, so it must still be constructible.
    const mutual = new TransitionIndex(
      [
        { x: 5, y: 0, floor: 0, targetX: 5, targetY: 0, targetFloor: -1 },
        { x: 5, y: 0, floor: -1, targetX: 5, targetY: 0, targetFloor: 0 },
      ],
      { skipPairSymmetry: true },
    );
    const directions = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
    ] as const;

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            direction: fc.constantFrom(...directions),
            deltaMs: fc.integer({ min: 1, max: BIG_DELTA_MS }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        (steps) => {
          let state: FloorWalkState = { x: 4.5, y: 0.5, floor: 0, cellX: 4, cellY: 0 };
          let previousTransitioned = false;
          for (const { direction, deltaMs } of steps) {
            const next = stepAndTransition(
              state,
              direction,
              deltaMs,
              OPEN_GRID,
              FAST_CONFIG,
              mutual,
            );
            if (next.transitioned) {
              expect(previousTransitioned).toBe(false);
            }
            previousTransitioned = next.transitioned;
            state = next;
          }
        },
      ),
    );
  });
});
