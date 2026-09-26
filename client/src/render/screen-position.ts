import { type CellBounds, emptyCellBounds } from "../world/world-index";

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
 * drawable's anchor sits in. The result is snapped to a whole *screen*
 * pixel (`Math.round(v * zoom) / zoom`, Artie's pixel discipline) -- the
 * only rounding in the world-to-screen path, so the camera offset is a
 * whole pixel and the world scrolls in whole screen pixels. */
export function screenPositionPx(
  worldX: number,
  worldY: number,
  floor: number,
  tileSizePx: number,
  storeyHeightPx: number,
  zoom: number,
): { readonly x: number; readonly y: number } {
  return {
    x: Math.round((worldX + 0.5) * tileSizePx * zoom) / zoom,
    y: Math.round(((worldY + 1) * tileSizePx + floorOffsetPx(floor, storeyHeightPx)) * zoom) / zoom,
  };
}

/**
 * The whole cells a renderer rect currently shows on `floor`, given the
 * camera the scene reports (story 1.12, cycle 2) -- the window a debug
 * overlay's cost is bounded by, and the same culling window Epic 3's
 * streamed pool will want.
 *
 * Lives here, beside [`worldCellFromScreenPx`] and built out of it,
 * rather than in whatever file happens to be wiring a camera: this is
 * inverse viewport projection, it has real decisions in it, and a cell
 * missing from what it returns is a collider silently not drawn
 * (`inv_visible_bounds_cover_every_drawn_cell`).
 *
 * `camera` is the world container's own transform as `onViewTransform`
 * reports it -- a screen pixel is `(pixel - offset) / zoom` in the scene's
 * own coordinate space. A camera that cannot describe a rectangle (a zero,
 * negative or non-finite zoom, a non-finite offset, a renderer with no
 * area yet) yields [`emptyCellBounds`] rather than an infinite or
 * NaN-bounded one: every consumer loops `cellY0..cellY1` without a guard
 * of its own, so a non-finite bound is a hung tab, not a wrong rectangle.
 */
export function visibleCellBounds(
  rendererWidth: number,
  rendererHeight: number,
  camera: { readonly zoom: number; readonly offsetX: number; readonly offsetY: number },
  floor: number,
  tileSizePx: number,
  storeyHeightPx: number,
): CellBounds {
  const { zoom, offsetX, offsetY } = camera;
  const describable =
    Number.isFinite(zoom) &&
    zoom > 0 &&
    Number.isFinite(offsetX) &&
    Number.isFinite(offsetY) &&
    Number.isFinite(rendererWidth) &&
    Number.isFinite(rendererHeight) &&
    rendererWidth > 0 &&
    rendererHeight > 0;
  if (!describable) return emptyCellBounds(floor);

  // The near edge is the camera origin undone; the far edge is the
  // renderer's own *exclusive* edge, so at an exact tile boundary this
  // includes one more cell than is strictly visible. Deliberate:
  // over-covering costs one loop iteration, under-covering is a collider
  // that is there and not drawn.
  const topLeft = worldCellFromScreenPx(
    -offsetX / zoom,
    -offsetY / zoom,
    floor,
    tileSizePx,
    storeyHeightPx,
  );
  const bottomRight = worldCellFromScreenPx(
    (rendererWidth - offsetX) / zoom,
    (rendererHeight - offsetY) / zoom,
    floor,
    tileSizePx,
    storeyHeightPx,
  );
  // `+ 0` normalises away a `-0` bound (`-0 / zoom` is `-0`, and
  // `Math.floor(-0)` keeps it) -- a bound that is not `===`-surprising is
  // worth the two characters, the same way [`floorOffsetPx`] does it.
  return {
    floor,
    cellX0: topLeft.cellX + 0,
    cellY0: topLeft.cellY + 0,
    cellX1: bottomRight.cellX + 0,
    cellY1: bottomRight.cellY + 0,
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
