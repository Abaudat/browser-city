// The demo player's movement, as a pure function (Quentin's direction):
// the dynamic half of the scene -- the bounds clamp, the sub-tile
// quantisation, and "only re-sort when the sort key moved" -- is
// exercised by property tests here, not left to the one e2e's initial
// static snapshot. `client/src/demo/scene.ts` is the only caller; this
// module knows nothing about PixiJS, the DOM or keyboard events.

import { toSortUnits } from "../render/sort-units";

export interface PlayerBounds {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

export interface StepResult {
  readonly x: number;
  readonly y: number;
  /** Whether the quantised (sort-unit) position differs from before the
   * step -- the caller's re-sort gate. `false` whenever the step is a
   * no-op (no input) or moves less than one sort unit. */
  readonly sortKeyChanged: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * One movement step: `(dx, dy)` is the input direction (not necessarily
 * unit length -- normalised here), `tilesPerSecond` and `deltaMs` give
 * the distance to travel, and `bounds` clamps the result inside the
 * walkable area. Total for any input, including `(0, 0)` (a true no-op)
 * and a diagonal direction (normalised so diagonal speed does not exceed
 * axis-aligned speed).
 */
export function stepPlayer(
  x: number,
  y: number,
  dx: number,
  dy: number,
  tilesPerSecond: number,
  deltaMs: number,
  bounds: PlayerBounds,
): StepResult {
  if (dx === 0 && dy === 0) {
    return { x, y, sortKeyChanged: false };
  }

  const distance = (tilesPerSecond * deltaMs) / 1000;
  const length = Math.hypot(dx, dy);
  const nextX = clamp(x + (dx / length) * distance, bounds.x0, bounds.x1);
  const nextY = clamp(y + (dy / length) * distance, bounds.y0, bounds.y1);

  const sortKeyChanged =
    toSortUnits(nextX) !== toSortUnits(x) || toSortUnits(nextY) !== toSortUnits(y);

  return { x: nextX, y: nextY, sortKeyChanged };
}
