// `world/transitions.ts`'s own unit tests (Tim's direction, story 1.7;
// pair symmetry story 15.2, Quentin's direction).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CollisionGridQuery, GridEntry } from "../../../src/world/collision-grid";
import {
  type FloorWalkResult,
  initialFloorWalkState,
  stepAndTransition,
} from "../../../src/world/floor-walk";
import type { MovementConfig } from "../../../src/world/movement";
import {
  blockedNeighborsOf,
  checkTransitionPairSymmetry,
  TransitionIndex,
  type TransitionSpec,
} from "../../../src/world/transitions";

describe("TransitionIndex", () => {
  // skipPairSymmetry: these specs are deliberately one-way test data
  // (this suite is about anchor lookup, never story 15.2's own pair-
  // symmetry rule, which has its own describe blocks below).
  const specs: TransitionSpec[] = [
    { x: 18, y: 0, floor: 0, targetX: 18, targetY: 0, targetFloor: -1 },
    { x: 23, y: 0, floor: 0, targetX: 23, targetY: 0, targetFloor: 1 },
  ];

  it("returns undefined for a cell that is not a transition anchor", () => {
    const index = new TransitionIndex(specs, { skipPairSymmetry: true });
    expect(index.transitionAt(0, 0, 0)).toBeUndefined();
    // A door is never a transition (FR118): an ordinary walkable cell.
    expect(index.transitionAt(5, 1, 0)).toBeUndefined();
  });

  it("resolves the anchor's own target floor and position", () => {
    const index = new TransitionIndex(specs, { skipPairSymmetry: true });
    expect(index.transitionAt(18, 0, 0)).toEqual({ x: 18, y: 0, floor: -1 });
    expect(index.transitionAt(23, 0, 0)).toEqual({ x: 23, y: 0, floor: 1 });
  });

  it("never matches the same (x, y) on a different floor", () => {
    const index = new TransitionIndex(specs, { skipPairSymmetry: true });
    expect(index.transitionAt(18, 0, -1)).toBeUndefined();
  });

  it("throws on two specs sharing the same anchor cell, rather than silently keeping only the last", () => {
    const duplicated: TransitionSpec[] = [
      { x: 5, y: 0, floor: 0, targetX: 5, targetY: 0, targetFloor: -1 },
      { x: 5, y: 0, floor: 0, targetX: 9, targetY: 9, targetFloor: 1 },
    ];
    expect(() => new TransitionIndex(duplicated, { skipPairSymmetry: true })).toThrow(
      /duplicate transition anchor/,
    );
  });

  it("the same anchor cell on two different floors is not a duplicate", () => {
    const specs2: TransitionSpec[] = [
      { x: 5, y: 0, floor: 0, targetX: 5, targetY: 0, targetFloor: -1 },
      { x: 5, y: 0, floor: -1, targetX: 5, targetY: 0, targetFloor: 0 },
    ];
    expect(() => new TransitionIndex(specs2, { skipPairSymmetry: true })).not.toThrow();
  });

  it("pair symmetry is on by default: an unpaired transition throws with no options at all", () => {
    expect(() => new TransitionIndex(specs)).toThrow(/transition pair symmetry violated/);
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

describe("TransitionIndex's own pair-symmetry rule (story 15.2, Quentin's finding 5: on by default, never an opt-in)", () => {
  it("throws naming the problem with no options at all when the pair does not mirror", () => {
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
    expect(() => new TransitionIndex([down, upNorthOfLanding])).toThrow(
      /transition pair symmetry violated/,
    );
  });

  it("does not throw when every transition mirrors a real reverse, with no options at all", () => {
    const down: TransitionSpec = {
      x: 16,
      y: 8,
      floor: 0,
      targetX: 16,
      targetY: 3,
      targetFloor: -1,
    };
    const up: TransitionSpec = { x: 15, y: 3, floor: -1, targetX: 15, targetY: 8, targetFloor: 0 };
    expect(() => new TransitionIndex([down, up])).not.toThrow();
  });

  it("also checks standability when isStandable is supplied, on top of the always-on pairing half", () => {
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
    expect(
      () =>
        new TransitionIndex([down, up], {
          isStandable: (x, y, floor) => !(x === 15 && y === 3 && floor === -1),
        }),
    ).toThrow(/transition pair symmetry violated/);
  });

  it("skipPairSymmetry is the named, visible escape hatch a test double uses -- the same mutually-targeting-identical-cell shape world/floor-walk.test.ts relies on", () => {
    const mutual: TransitionSpec[] = [
      { x: 5, y: 0, floor: 0, targetX: 5, targetY: 0, targetFloor: -1 },
      { x: 5, y: 0, floor: -1, targetX: 5, targetY: 0, targetFloor: 0 },
    ];
    expect(() => new TransitionIndex(mutual)).toThrow(/transition pair symmetry violated/);
    expect(() => new TransitionIndex(mutual, { skipPairSymmetry: true })).not.toThrow();
  });
});

const SUBCELLS_PER_CELL = 16;

/** A grid built from the pair itself: every non-entry neighbour of each
 * anchor (`blockedNeighborsOf`) is one whole solid cell on its own floor,
 * everything else open -- the one-entrance shape a real stairwell has. */
function gridForPair(
  forward: TransitionSpec,
  reverse: TransitionSpec,
  d: { readonly x: number; readonly y: number },
): CollisionGridQuery {
  const blocked = new Set<string>();
  for (const { x, y } of blockedNeighborsOf(forward, d)) blocked.add(`${forward.floor}|${x}|${y}`);
  for (const { x, y } of blockedNeighborsOf(reverse, { x: -d.x, y: -d.y })) {
    blocked.add(`${reverse.floor}|${x}|${y}`);
  }
  return {
    entriesInCell(floor, cellX, cellY): readonly GridEntry[] {
      if (!blocked.has(`${floor}|${cellX}|${cellY}`)) return [];
      const x0 = cellX * SUBCELLS_PER_CELL;
      const y0 = cellY * SUBCELLS_PER_CELL;
      return [
        {
          objectId: 1n,
          rect: { x0, y0, x1: x0 + SUBCELLS_PER_CELL, y1: y0 + SUBCELLS_PER_CELL },
        },
      ];
    },
  };
}

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
        // walking speed (0.0022 cells/ms * 100ms = 0.22 cells), so it is a
        // precondition here, not a finding.
        fc.double({ min: 0.0001, max: 0.009, noNaN: true }),
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 20 }),
        (d, ax, ay, lx, ly, walkSpeedCellsPerMs, deltaMsSequence) => {
          // A mirrored pair, built exactly the way `checkTransitionPairSymmetry`
          // requires: the reverse anchor is the landing's own neighbour
          // against `d`, and the reverse landing is the forward anchor's own
          // neighbour against `d` -- the same `d` in both.
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

          const grid = gridForPair(forward, reverse, d);
          const transitions = new TransitionIndex([forward, reverse], {
            isStandable: ALWAYS_STANDABLE,
          });
          const config: MovementConfig = {
            walkSpeedCellsPerMs,
            bodyWidthSubcells: 8,
            bodyHeightSubcells: 4,
            subcellsPerCell: SUBCELLS_PER_CELL,
          };
          const deltaAt = (step: number) => deltaMsSequence[step % deltaMsSequence.length] ?? 1;
          const walkUntilTransition = (start: FloorWalkResult, dir: { x: number; y: number }) => {
            let state: FloorWalkResult = { ...start, transitioned: false };
            for (let step = 0; !state.transitioned && step < 10_000; step++) {
              state = stepAndTransition(state, dir, deltaAt(step), grid, config, transitions);
            }
            return state;
          };

          // (i) Down the entry direction, then straight back up.
          const start: FloorWalkResult = {
            ...initialFloorWalkState(ax - d.x + 0.5, ay - d.y + 0.5, 0),
            transitioned: false,
          };
          const landed = walkUntilTransition(start, d);
          expect(landed.transitioned).toBe(true);
          expect(landed.floor).toBe(-1);
          expect(landed.cellX).toBe(lx);
          expect(landed.cellY).toBe(ly);
          const back = walkUntilTransition(landed, { x: -d.x, y: -d.y });
          expect(back.transitioned).toBe(true);
          expect(back.floor).toBe(0);
          expect(back.cellX).toBe(ax - d.x);
          expect(back.cellY).toBe(ay - d.y);

          // (ii) Holding the entry direction through the landing and onward
          // never returns the walker to the floor it came from.
          let onward: FloorWalkResult = { ...landed, transitioned: false };
          for (let step = 0; step < 200; step++) {
            onward = stepAndTransition(onward, d, deltaAt(step), grid, config, transitions);
            expect(onward.transitioned).toBe(false);
            expect(onward.floor).toBe(-1);
          }

          // (iii) A walker approaching either anchor through any of its
          // blocked neighbours never transitions. It starts on the far side
          // of that neighbour, not inside it: the resolver lets a body that
          // already overlaps a collider walk straight out of it.
          for (const [anchor, entry] of [
            [forward, d],
            [reverse, { x: -d.x, y: -d.y }],
          ] as const) {
            for (const blocked of blockedNeighborsOf(anchor, entry)) {
              const dir = { x: anchor.x - blocked.x, y: anchor.y - blocked.y };
              let state: FloorWalkResult = {
                ...initialFloorWalkState(
                  blocked.x - dir.x + 0.5,
                  blocked.y - dir.y + 0.5,
                  anchor.floor,
                ),
                transitioned: false,
              };
              for (let step = 0; step < 200; step++) {
                state = stepAndTransition(state, dir, deltaAt(step), grid, config, transitions);
                expect(state.transitioned).toBe(false);
                expect(state.floor).toBe(anchor.floor);
              }
            }
          }
        },
      ),
    );
  });
});
