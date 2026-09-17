// Story 1.10 (FR61) / Story 2.7: pure pixel math over an
// `AppearanceLayoutDef` -- no `pixi.js`, no canvas, no DOM.
// `compositeCellRect`/`compositeSheetSize` address the *compact* strip a
// part's own packed atlas rect holds (only the rows/directions/frames
// this game actually uses -- an adult idle+walk strip is 2 rows x 24
// columns of 16x32, never a copy of the much larger vendor sheet) --
// `tools/defs-build`'s own `atlas::character::strip_size` mirrors this
// exactly (with `gutter` always 0 on that side: the packed atlas strip
// itself is never gutter-padded between frames, only the client's own
// shared composite pages are).
//
// An optional `gutter` widens every cell's own pitch by that many pixels
// on every side (still `0` by default, matching a packed atlas part
// strip's own tight layout) -- the client's own composite-page slots use
// this to leave a transparent gutter between neighbouring frames
// (Artie's direction, story 2.7: a character frame sits on a transparent
// background, so neighbouring frames must never bleed into each other at
// a fractional camera position).

import { compositeStripSize } from "../../defs/composite-strip";
import type { AppearanceLayoutDef } from "../../defs/types";

export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function directionIndex(layout: AppearanceLayoutDef, direction: string): number {
  const index = layout.directions.indexOf(direction);
  if (index < 0) {
    throw new Error(
      `frame-rect: layout '${layout.key}' declares no direction '${direction}' (has: ${layout.directions.join(", ")})`,
    );
  }
  return index;
}

function checkFrame(row: { framesPerDirection: number }, frame: number, animation: string): void {
  if (!Number.isInteger(frame) || frame < 0 || frame >= row.framesPerDirection) {
    throw new Error(
      `frame-rect: frame ${frame} is out of range for animation '${animation}' (0..${row.framesPerDirection - 1})`,
    );
  }
}

/** The compact strip's own total size, `gutter` pixels of padding added
 * around every cell (default `0`, a packed atlas part strip's own tight
 * layout) -- exactly as many rows as `layout.rows` (in declaration
 * order) and as many columns as `framesPerDirection * directions.length`
 * needs. Re-exported under this name for this module's own callers;
 * `defs/composite-strip.ts` owns the one implementation (Tim's
 * direction, cycle 1: shared with `defs/parse.ts`'s own AC1 check,
 * rather than each keeping its own copy). */
export function compositeSheetSize(
  layout: AppearanceLayoutDef,
  gutter = 0,
): {
  width: number;
  height: number;
} {
  return compositeStripSize(layout, gutter);
}

/** The destination rect for `(animation, direction, frame)` in the
 * compact composite strip -- rows packed in `layout.rows` declaration
 * order (row index, not the source sheet's own row number), columns
 * packed left to right within a row, `gutter` pixels of padding added
 * around every cell (default `0`). */
export function compositeCellRect(
  layout: AppearanceLayoutDef,
  animation: string,
  direction: string,
  frame: number,
  gutter = 0,
): FrameRect {
  const rowIndex = layout.rows.findIndex((r) => r.animation === animation);
  const row = rowIndex < 0 ? undefined : layout.rows[rowIndex];
  if (!row) {
    throw new Error(`frame-rect: layout '${layout.key}' declares no animation '${animation}'`);
  }
  checkFrame(row, frame, animation);
  const dirIndex = directionIndex(layout, direction);
  const column = dirIndex * row.framesPerDirection + frame;
  const cellWidth = layout.cellWidth + 2 * gutter;
  const cellHeight = layout.cellHeight + 2 * gutter;
  return {
    x: column * cellWidth + gutter,
    y: rowIndex * cellHeight + gutter,
    width: layout.cellWidth,
    height: layout.cellHeight,
  };
}
