// The one place that converts a continuous, half-open sub-cell interval
// into the (inclusive) range of whole cells it touches -- shared by
// `collision-grid.ts` (rasterising a collider into every cell it
// overlaps, FR126) and `movement.ts` (finding every cell a swept body
// might touch). `[min, max)` is the convention throughout `world/`,
// matching the server's own `Rect` half-open convention: touching an
// edge exactly is never "inside".

/** The inclusive `[cellMin, cellMax]` range of whole-cell indices a
 * half-open sub-cell interval `[min, max)` touches. `max` must be
 * strictly greater than `min` -- every caller here only ever passes a
 * positive-area interval (a collider, or a body that actually moved). */
export function cellsForRange(
  min: number,
  max: number,
  subcellsPerCell: number,
): readonly [number, number] {
  const cellMin = Math.floor(min / subcellsPerCell);
  const cellMax = Math.ceil(max / subcellsPerCell) - 1;
  return [cellMin, cellMax];
}
