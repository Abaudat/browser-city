// The one place the anchor-cell-to-footprint-origin arithmetic lives
// (Tim's direction, this story's own review cycle): a placed row's `x`/`y` name its
// *anchor cell* -- the footprint's smallest x, largest y cell (its
// south-west corner, the AC's own convention) -- but every sub-cell rect
// a def declares (`collider`, `interact_at`) is relative to the
// footprint's own *north-west* sub-cell origin (its top-left, matching
// the sprite's own pixel space). The two corners coincide only for a
// one-cell-tall object, which is every object today -- exactly what hid
// this arithmetic being re-derived, slightly differently, in five
// separate places. Every module that needs to place a footprint-relative
// rect or cell from an anchor calls [`footprintOrigin`] or
// [`footprintCells`]; none may re-derive `height - 1` on its own.

/** The two numbers every caller here needs from a def -- `defs/`'s
 * `ObjectDef` and every module-local `*Source`/`*Def` shape satisfy it
 * structurally. */
export interface FootprintExtent {
  readonly width: number;
  readonly height: number;
}

export interface Cell {
  readonly x: number;
  readonly y: number;
}

/** The footprint's own north-west cell -- where a `collider`/
 * `interact_at` rect's local `(0, 0)` sub-cell sits in world cells --
 * from the anchor cell (the footprint's south-west corner) and its
 * extent. `x` is unchanged (the anchor is already the west edge); only
 * `y` moves, north by `height - 1` cells. Total for any extent, including
 * `height === 1` (returns the anchor cell itself, unchanged -- every real
 * def today). */
export function footprintOrigin(anchorX: number, anchorY: number, extent: FootprintExtent): Cell {
  return { x: anchorX, y: anchorY - (extent.height - 1) };
}

/** Every cell the footprint covers, row-major, north row first (matching
 * `render/decompose.ts`'s own per-cell walking order) -- built on
 * [`footprintOrigin`], never a second, independent derivation. */
export function footprintCells(anchorX: number, anchorY: number, extent: FootprintExtent): Cell[] {
  const origin = footprintOrigin(anchorX, anchorY, extent);
  const cells: Cell[] = [];
  for (let row = 0; row < extent.height; row++) {
    for (let col = 0; col < extent.width; col++) {
      cells.push({ x: origin.x + col, y: origin.y + row });
    }
  }
  return cells;
}
