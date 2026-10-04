// Gait: motion in, facing and walk frame out. Knows nothing of routes, so
// the player's body can adopt it unchanged (NFR24).

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

/** A stable value in [0, 1) from a citizen id (FNV-1a), never `Math.random`. */
export function phaseOffsetFor(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x1_0000_0000;
}

/** The facing for a heading: the dominant axis, `current` on a perfect
 * diagonal or when not moving. */
export function facingOfHeading(headingX: number, headingY: number, current: Facing): Facing {
  const ax = Math.abs(headingX);
  const ay = Math.abs(headingY);
  if (ax === ay) return current;
  if (ax > ay) return headingX > 0 ? "right" : "left";
  return headingY > 0 ? "down" : "up";
}

/** Holds a facing for at least `holdMs` before it may change. */
export class FacingHold {
  #facing: Facing;
  #since = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly holdMs: number,
    initial: Facing,
  ) {
    this.#facing = initial;
  }

  update(desired: Facing, nowMs: number): Facing {
    if (desired !== this.#facing && nowMs - this.#since >= this.holdMs) {
      this.#facing = desired;
      this.#since = nowMs;
    }
    return this.#facing;
  }
}
