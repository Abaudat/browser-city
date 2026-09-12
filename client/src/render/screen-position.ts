// FR124's floor offset, as a pure, tested function -- Quentin's direction:
// proving `render.storey_height_px` exists in `defs/` is not proving the
// renderer uses it correctly. This is the only place a drawable's world
// position becomes a screen position; nothing here ever feeds back into
// the FR123 sort key (`sort-key.ts`'s `Drawable.floor` is carried for
// this function alone).

/** The vertical screen offset for `floor` (FR124): zero at floor 0,
 * proportional to how many storeys away from 0 a floor is, and negative
 * (up the screen) for a positive/higher floor -- "up is a higher floor".
 * `storeyHeightPx` is always the caller-supplied `render.storey_height_px`
 * balance key, never a literal baked in here. */
export function floorOffsetPx(floor: number, storeyHeightPx: number): number {
  // `+ 0` normalises away a `-0` result at floor 0 (`-0 * x` is `-0` in
  // IEEE 754) -- floor 0 must compare equal to a plain `0` literal.
  return -floor * storeyHeightPx + 0;
}

/** A drawable's screen position from its world position (in tiles, not
 * sort units -- `sort-units.ts`'s `fromSortUnits` is the caller's job)
 * and its floor. Bottom-centre anchored on its own cell (Artie's
 * direction): `worldY`/`floor` place the *bottom* of the cell the
 * drawable's anchor sits in. Every input is rounded to an integer
 * world pixel before the caller applies the zoom scale (Artie's pixel
 * discipline) -- this function never returns a fractional pixel. */
export function screenPositionPx(
  worldX: number,
  worldY: number,
  floor: number,
  tileSizePx: number,
  storeyHeightPx: number,
): { readonly x: number; readonly y: number } {
  return {
    x: Math.round((worldX + 0.5) * tileSizePx),
    y: Math.round((worldY + 1) * tileSizePx + floorOffsetPx(floor, storeyHeightPx)),
  };
}
