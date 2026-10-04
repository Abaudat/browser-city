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
  // Avalanche, so ids that differ in one character land far apart.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x1_0000_0000;
}

/** The facing for a heading: the dominant axis, horizontal on a tie. A pure
 * function of the heading, so two clients agree and the path alone decides
 * when a facing changes. */
export function facingOfHeading(headingX: number, headingY: number): Facing {
  if (Math.abs(headingX) >= Math.abs(headingY)) return headingX >= 0 ? "right" : "left";
  return headingY > 0 ? "down" : "up";
}
