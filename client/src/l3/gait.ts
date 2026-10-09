// Gait: motion in, facing and walk frame out. Knows nothing of routes, so
// the player's body can adopt it unchanged (NFR24).

import { unitOf } from "./seed";

export type Facing = "down" | "up" | "left" | "right";

/** The walk-cycle frame for `distance` cells walked: one cycle per
 * `strideCells`, shifted by a stable per-citizen `phaseOffset` in [0, 1). */
export function walkFrame(
  distance: number,
  strideCells: number,
  phaseOffset: number,
  framesPerCycle: number,
): number {
  const cycles = distance / strideCells + phaseOffset;
  const phase = cycles - Math.floor(cycles);
  return Math.min(framesPerCycle - 1, Math.floor(phase * framesPerCycle));
}

/** A stable value in [0, 1) from a citizen id, never `Math.random`. */
export function phaseOffsetFor(id: string): number {
  return unitOf(id);
}

/** The facing for a heading: the dominant axis, horizontal on a tie. A pure
 * function of the heading, so two clients agree and the path alone decides
 * when a facing changes. */
export function facingOfHeading(headingX: number, headingY: number): Facing {
  if (Math.abs(headingX) >= Math.abs(headingY)) return headingX >= 0 ? "right" : "left";
  return headingY > 0 ? "down" : "up";
}

/** What a body driven by its own movement (a remote player) carries between
 * frames: the facing it holds while still, and the distance walked. */
export interface GaitState {
  facing: Facing;
  /** Cells walked since it last stood still. */
  walked: number;
}

/** Advances `state` by one observed move of `(dx, dy)` cells and says whether
 * the body moved. Facing is `facingOfHeading`'s; it holds while still, and
 * the walked distance restarts. */
export function advanceGait(state: GaitState, dx: number, dy: number): boolean {
  if (dx === 0 && dy === 0) {
    state.walked = 0;
    return false;
  }
  state.facing = facingOfHeading(dx, dy);
  state.walked += Math.sqrt(dx * dx + dy * dy);
  return true;
}
