// Story 1.10 (FR61): pure pixel math over an `AppearanceLayoutDef` -- no
// `pixi.js`, no canvas, no DOM. Two source-rect families:
// `sourceFrameRect` addresses a cell in a part's own full sheet (the
// layout's declared grid); `compositeCellRect`/`compositeSheetSize`
// address the *compact* strip `composite.ts` repacks the layers into
// (only the rows/directions/frames this game actually uses, Tim's
// direction -- an adult idle+walk composite is 2 rows x 24 columns of
// 16x32, never a copy of the much larger vendor sheet).

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

function findRow(layout: AppearanceLayoutDef, animation: string) {
  const row = layout.rows.find((r) => r.animation === animation);
  if (!row) {
    throw new Error(
      `frame-rect: layout '${layout.key}' declares no animation '${animation}' (has: ${layout.rows.map((r) => r.animation).join(", ")})`,
    );
  }
  return row;
}

function checkFrame(row: { framesPerDirection: number }, frame: number, animation: string): void {
  if (!Number.isInteger(frame) || frame < 0 || frame >= row.framesPerDirection) {
    throw new Error(
      `frame-rect: frame ${frame} is out of range for animation '${animation}' (0..${row.framesPerDirection - 1})`,
    );
  }
}

/** The source rect for `(animation, direction, frame)` in a part's own
 * full sheet, in that sheet's declared grid -- this is what a
 * live six-sprite stack (the e2e pixel check's other half) crops
 * straight out of the vendor PNG. */
export function sourceFrameRect(
  layout: AppearanceLayoutDef,
  animation: string,
  direction: string,
  frame: number,
): FrameRect {
  const row = findRow(layout, animation);
  checkFrame(row, frame, animation);
  const dirIndex = directionIndex(layout, direction);
  const column = dirIndex * row.framesPerDirection + frame;
  return {
    x: column * layout.cellWidth,
    y: row.row * layout.cellHeight,
    width: layout.cellWidth,
    height: layout.cellHeight,
  };
}

/** The compact composite strip's own total size: exactly as many rows as
 * `layout.rows` (in declaration order) and as many columns as
 * `framesPerDirection * directions.length` needs -- never the source
 * sheet's own width/height, and never dependent on which row has the
 * most frames if that ever differs (each row is packed at its own
 * declared `framesPerDirection`, so a wider row still reports its own
 * width; callers needing one rectangular canvas take the max via
 * [`compositeSheetSize`]). */
export function compositeSheetSize(layout: AppearanceLayoutDef): {
  width: number;
  height: number;
} {
  const width = Math.max(
    0,
    ...layout.rows.map((r) => r.framesPerDirection * layout.directions.length * layout.cellWidth),
  );
  const height = layout.rows.length * layout.cellHeight;
  return { width, height };
}

/** The destination rect for `(animation, direction, frame)` in the
 * compact composite strip -- rows packed in `layout.rows` declaration
 * order (row index, not the source sheet's own row number), columns
 * packed exactly like [`sourceFrameRect`] within that row. */
export function compositeCellRect(
  layout: AppearanceLayoutDef,
  animation: string,
  direction: string,
  frame: number,
): FrameRect {
  const rowIndex = layout.rows.findIndex((r) => r.animation === animation);
  const row = rowIndex < 0 ? undefined : layout.rows[rowIndex];
  if (!row) {
    throw new Error(`frame-rect: layout '${layout.key}' declares no animation '${animation}'`);
  }
  checkFrame(row, frame, animation);
  const dirIndex = directionIndex(layout, direction);
  const column = dirIndex * row.framesPerDirection + frame;
  return {
    x: column * layout.cellWidth,
    y: rowIndex * layout.cellHeight,
    width: layout.cellWidth,
    height: layout.cellHeight,
  };
}
