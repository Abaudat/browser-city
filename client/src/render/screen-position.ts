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

/**
 * A half-open sub-cell rect in absolute world sub-cells, as the screen
 * rect it covers on `floor` (story 1.12, FR165) -- the one place a
 * sub-cell coordinate becomes a pixel, so a debug overlay drawn over the
 * world never acquires a projection constant of its own
 * (`inv_overlay_projection_matches_renderer`).
 *
 * This is the plain world-to-screen projection -- scale by the tile size,
 * shift by [`floorOffsetPx`] -- the same one [`worldPointFromScreenPx`]
 * inverts, never [`screenPositionPx`]'s bottom-centre anchor placement:
 * those `+0.5`/`+1` terms say where a *sprite* sits within its cell, not
 * where the cell is.
 *
 * Deliberately unrounded, unlike [`screenPositionPx`]: this measures
 * rather than draws art, and rounding a sub-cell face to a whole pixel
 * would put the drawn rect up to half a pixel away from where collision
 * actually resolves. A zero-area rect stays zero-area for the same
 * reason -- "declared with no area" is a state a reader has to be able to
 * tell apart from a real one, not a rect to widen into visibility.
 */
export function subcellRectPx(
  rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
  floor: number,
  subcellsPerCell: number,
  tileSizePx: number,
  storeyHeightPx: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const pxPerSubcell = tileSizePx / subcellsPerCell;
  return {
    x: rect.x0 * pxPerSubcell,
    y: rect.y0 * pxPerSubcell + floorOffsetPx(floor, storeyHeightPx),
    width: (rect.x1 - rect.x0) * pxPerSubcell,
    height: (rect.y1 - rect.y0) * pxPerSubcell,
  };
}

/**
 * [`screenPositionPx`]'s inverse for picking (story 1.9, FR148): the
 * continuous world point a screen pixel falls on, for a viewer on
 * `floor`. The same two projection constants, read the same way -- the
 * floor offset goes through [`floorOffsetPx`] itself, never a second copy
 * of that rule.
 *
 * Deliberately *not* the algebraic inverse of [`screenPositionPx`]'s
 * `+0.5`/`+1` terms: those place a *bottom-centre-anchored sprite* within
 * the cell it sits on, they are not part of the world-to-screen
 * projection itself. A cell `(cx, cy)` whose anchor
 * [`screenPositionPx`] puts at `(ax, ay)` is drawn over
 * `[ax - tile/2, ax + tile/2) x [ay - tile, ay)` -- so the pixel-to-cell
 * map that agrees with what the renderer actually drew is this plain
 * scale-and-offset one (`inv_pick_inverts_screen_position`). Inverting
 * the anchor terms instead would pick a cell half a tile west and one
 * row north of the one under the cursor.
 */
export function worldPointFromScreenPx(
  screenX: number,
  screenY: number,
  floor: number,
  tileSizePx: number,
  storeyHeightPx: number,
): { readonly x: number; readonly y: number } {
  return {
    x: screenX / tileSizePx,
    y: (screenY - floorOffsetPx(floor, storeyHeightPx)) / tileSizePx,
  };
}

/** The whole world cell a screen pixel falls in, for a viewer on `floor`
 * -- [`worldPointFromScreenPx`] floored toward negative infinity (never
 * truncated, so a negative coordinate lands in the cell west/north of the
 * origin rather than on it). This is the only place a pick turns a
 * continuous point into the integer cell coordinates a `placed_object`
 * row is indexed by. */
export function worldCellFromScreenPx(
  screenX: number,
  screenY: number,
  floor: number,
  tileSizePx: number,
  storeyHeightPx: number,
): { readonly cellX: number; readonly cellY: number } {
  const point = worldPointFromScreenPx(screenX, screenY, floor, tileSizePx, storeyHeightPx);
  return { cellX: Math.floor(point.x), cellY: Math.floor(point.y) };
}
