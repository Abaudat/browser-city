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

/** A world-pixel coordinate snapped to a whole *screen* pixel at an
 * integer `zoom` (`Math.round(v * zoom) / zoom`, Artie's pixel
 * discipline) -- the one rounding every drawable's position goes
 * through. Throws on a non-integer or non-positive zoom: `(k / zoom) *
 * zoom === k` only holds for an integer one. */
export function snapToScreenPx(v: number, zoom: number): number {
  if (!Number.isInteger(zoom) || zoom <= 0) {
    throw new Error(`snapToScreenPx: zoom must be a positive integer, got ${zoom}`);
  }
  // `+ 0` normalises a `-0` (`Math.round(-0.3)`) to `+0`, so a snapped
  // coordinate never carries a sign on zero.
  return Math.round(v * zoom) / zoom + 0;
}

/**
 * A continuous world point (in tiles, not sort units -- `sort-units.ts`'s
 * `fromSortUnits` is the caller's job) to its screen position, for a
 * viewer on `floor`. This is the *only* world-to-screen projection (story
 * 15.4, Tim's direction): a plain scale-and-floor-offset, the exact
 * inverse of [`worldPointFromScreenPx`], snapped through
 * [`snapToScreenPx`]. It carries no anchor terms of its own -- a
 * bottom-centre-anchored sprite's own anchor point is a fact about
 * *where the point is*, decided before this function ever runs, by
 * [`cellBottomCentre`] for a cell or by a character's own continuous feet
 * position for an actor. Passing a cell index straight into this function
 * draws it half a cell and a whole cell away from where its collider
 * actually is -- the exact defect this story fixes (Adrian's Sprint 4
 * demo, #333): every actor and every debug overlay reads a world point
 * through this one function, never a second copy of the arithmetic.
 */
export function worldPointPx(
  worldX: number,
  worldY: number,
  floor: number,
  tileSizePx: number,
  storeyHeightPx: number,
  zoom: number,
): { readonly x: number; readonly y: number } {
  return {
    x: snapToScreenPx(worldX * tileSizePx, zoom),
    y: snapToScreenPx(worldY * tileSizePx + floorOffsetPx(floor, storeyHeightPx), zoom),
  };
}

/**
 * A cell's own bottom-centre point, in world tiles (story 15.4, Tim's
 * direction): `+0.5` in x, `+1` in y -- Artie's bottom-centre sprite
 * anchor, as a one-line pure function rather than folded into the
 * projection itself. Integer inputs only: a cell index is always a whole
 * number, and accepting a continuous one here would silently re-open the
 * exact confusion this story exists to close (a continuous feet point is
 * never passed through this function -- it already *is* the point
 * [`worldPointPx`] projects, with no anchor arithmetic of its own).
 * Throws on a non-integer the way [`snapToScreenPx`] throws on a
 * non-integer zoom.
 */
export function cellBottomCentre(
  cellX: number,
  cellY: number,
): { readonly x: number; readonly y: number } {
  if (!Number.isInteger(cellX) || !Number.isInteger(cellY)) {
    throw new Error(`cellBottomCentre: cellX/cellY must be integers, got (${cellX}, ${cellY})`);
  }
  return { x: cellX + 0.5, y: cellY + 1 };
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
 * shift by [`floorOffsetPx`] -- the exact same one [`worldPointPx`] is,
 * and the one [`worldPointFromScreenPx`] inverts. A drawable's own
 * bottom-centre anchor (`+0.5`/`+1`, [`cellBottomCentre`]) is never part
 * of this: that says where a *sprite's own point* sits within its cell,
 * not where the cell is.
 *
 * Deliberately unrounded, unlike [`worldPointPx`]: this measures
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
 * [`worldPointPx`]'s exact algebraic inverse for picking (story 1.9,
 * FR148; story 15.4): the continuous world point a screen pixel falls on,
 * for a viewer on `floor`. The same two projection constants, read the
 * same way -- the floor offset goes through [`floorOffsetPx`] itself,
 * never a second copy of that rule.
 *
 * A cell's own bottom-centre anchor ([`cellBottomCentre`]'s `+0.5`/`+1`)
 * is not part of this either direction: it places a *sprite* within the
 * cell it sits on, it is not part of the world-to-screen projection
 * itself. A cell `(cx, cy)` whose bottom-centre [`worldPointPx`] draws at
 * `(ax, ay)` covers `[ax - tile/2, ax + tile/2) x [ay - tile, ay)` on
 * screen -- so the pixel-to-cell map that agrees with what the renderer
 * actually drew is this plain scale-and-offset one
 * (`inv_pick_inverts_screen_position`). Undoing the anchor terms as well
 * would pick a cell half a tile west and one row north of the one under
 * the cursor.
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
