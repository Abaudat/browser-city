// Composes `movement.ts`'s `step` with `transitions.ts`'s `TransitionIndex`
// (Quentin/Tim's direction, story 1.7): the one pure function that decides
// whether a step also crosses a floor transition, so the rule lives in
// `world/` (held to the coverage bar, unit-tested directly) rather than in
// `test-street/scene.ts` (throwaway harness code, only reachable through a real
// keyboard-driven e2e walk).
//
// A transition is edge-triggered, entered by walking, never level-
// triggered by a key still held: it is only ever checked against the cell
// a step just *walked into* -- the cell the position's `Math.floor`
// resolves to changing from the previous tick's is what "walked into"
// means here. Landing on a cell via a transition never itself counts as
// walking into it: the check that produced the landing is not re-run
// against its own result, and the very next call only re-checks once the
// position leaves that landing cell. That is what makes two transitions
// that happen to target each other's own anchor impossible to bounce
// between forever just because a direction key is still held (`sim::
// world::WorldSpec::build` does not reject that shape of data itself, so
// this is a real, generator-reachable case, not a fixture curiosity).

import type { CollisionGridQuery } from "./collision-grid";
import type { MovementConfig, Vec2 } from "./movement";
import { step } from "./movement";
import { cellOf } from "./ownership";
import type { TransitionIndex } from "./transitions";

/** The walker's own state between steps: continuous position, floor, and
 * the cell that position was last known to occupy -- carried explicitly
 * (never re-derived from a stale position) so a caller can tell "still in
 * the same cell" from "just walked into a new one" without keeping a
 * second, separate piece of state itself. */
export interface FloorWalkState {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly cellX: number;
  readonly cellY: number;
}

export interface FloorWalkResult extends FloorWalkState {
  /** Whether this call actually crossed a floor transition -- a caller
   * that needs to know a floor/enclosure change may have happened (to
   * re-apply visibility, for instance) reads this instead of comparing
   * `floor` itself, which stays correct even for a transition whose
   * target floor happens to equal its anchor floor. */
  readonly transitioned: boolean;
}

/** The initial `FloorWalkState` for a fixed starting position -- computes
 * `cellX`/`cellY` once so a caller never has to import `cellOf` itself
 * just to construct the first state. */
export function initialFloorWalkState(x: number, y: number, floor: number): FloorWalkState {
  return { x, y, floor, cellX: cellOf(x), cellY: cellOf(y) };
}

/**
 * One movement step, plus the one floor transition it may cross (FR117):
 * `movement.ts`'s `step` resolves the new continuous position against
 * `state.floor`'s own collision set first; only if that step actually
 * changed which cell the position occupies is `transitions.transitionAt`
 * consulted at all, and only against the newly walked-into cell -- never
 * against the cell a previous call's own transition just landed on. When
 * a transition fires, the returned position and floor come from that one
 * `TransitionIndex` lookup together, so there is no intermediate state
 * where one changed and the other has not (Tim's direction).
 */
export function stepAndTransition(
  state: FloorWalkState,
  inputDir: Vec2,
  deltaMs: number,
  grid: CollisionGridQuery,
  config: MovementConfig,
  transitions: TransitionIndex,
): FloorWalkResult {
  const next = step({ x: state.x, y: state.y }, inputDir, deltaMs, grid, state.floor, config);
  const cellX = cellOf(next.x);
  const cellY = cellOf(next.y);

  if (cellX === state.cellX && cellY === state.cellY) {
    return { x: next.x, y: next.y, floor: state.floor, cellX, cellY, transitioned: false };
  }

  const landing = transitions.transitionAt(cellX, cellY, state.floor);
  if (!landing) {
    return { x: next.x, y: next.y, floor: state.floor, cellX, cellY, transitioned: false };
  }

  return {
    x: landing.x + 0.5,
    y: landing.y + 0.5,
    floor: landing.floor,
    cellX: landing.x,
    cellY: landing.y,
    transitioned: true,
  };
}
