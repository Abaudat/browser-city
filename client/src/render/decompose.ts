// FR125/FR126: a multi-cell prop is one `placed_object` row, anchored at
// one cell, whose extent comes from its `object_def`'s `width`/`height`
// (`client/src/defs`, never a hardcoded extent) -- this module turns that
// one row into N per-cell drawables, each with its own anchor and its own
// source sub-rect, so nothing downstream ever draws or sorts a multi-cell
// prop as a single unit ("never sliced" cuts the other way: the source
// art is what gets cut, per-cell, never the object's rendering or sort
// position). Pure, zero PixiJS, zero `net/bindings` -- runs once per
// placed chunk, not per frame (Tim's direction).

import { footprintOrigin } from "../world/footprint";

/** One placed object's anchor cell and footprint (FR126/FR127): `width`/
 * `height` come from `object_def`, in whole tiles, always >= 1. FR127
 * caps a real footprint at approximately 8x8; this function is total for
 * any positive integer extent -- the cap is enforced where a definition
 * is authored, not here.
 *
 * `x`/`y` are the anchor cell -- the footprint's smallest x, largest y
 * cell (its south-west corner, story 2.2's AC), not its top-left: the
 * footprint extends east (`x` increasing) and north (`y` decreasing) from
 * it. Every object today is one cell tall, which hides this on sight; a
 * multi-row footprint is the only way to tell the two conventions apart,
 * which is exactly what the asymmetric test below pins. */
export interface Footprint {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One per-cell drawable a [`Footprint`] decomposes into: its own world
 * anchor cell, and its own column/row within the source object's art --
 * the seam an atlas will read a sub-rect through once one exists
 * (placeholder graphics are fine for this story; the field is not). */
export interface CellDrawable {
  readonly x: number;
  readonly y: number;
  readonly sourceCol: number;
  readonly sourceRow: number;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`decomposeFootprint: ${name} must be a positive integer, got ${value}`);
  }
}

/** Anchor cell plus extent in, `width * height` per-cell drawables out
 * (FR125), one per cell of the footprint, anchors covering the footprint
 * exactly once -- `inv_multicell_prop_covers_footprint_once`
 * (`client/tests/unit/render/decompose.test.ts`). Row-major, `sourceRow`
 * 0 at the footprint's north (smallest-y) edge -- matching the sprite's
 * own pixel space, top row first -- counting down to `height - 1` at the
 * anchor's own row (the south, largest-y edge, story 2.2's AC). A 1xN
 * counter's cells still come out in a stable, predictable walking order,
 * though nothing downstream depends on the order itself (the sort key
 * does, and it reads `x`/`y`, not array position). */
export function decomposeFootprint(footprint: Footprint): readonly CellDrawable[] {
  assertPositiveInteger(footprint.width, "width");
  assertPositiveInteger(footprint.height, "height");
  if (!Number.isInteger(footprint.x) || !Number.isInteger(footprint.y)) {
    throw new RangeError("decomposeFootprint: x and y must be integers");
  }

  const cells: CellDrawable[] = [];
  const origin = footprintOrigin(footprint.x, footprint.y, footprint);
  for (let row = 0; row < footprint.height; row++) {
    for (let col = 0; col < footprint.width; col++) {
      cells.push({
        x: origin.x + col,
        y: origin.y + row,
        sourceCol: col,
        sourceRow: row,
      });
    }
  }
  return cells;
}
