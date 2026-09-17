// Story 2.7 (Tim's direction, cycle 1): the compact composite strip's own
// total size -- one pure computation, owned by `defs/` (the base layer
// every render module already depends on, never the other way), so
// `defs/parse.ts`'s own AC1 cross-reference check
// (`checkPartAtlasRect`) and `render/appearance/frame-rect.ts`'s
// `compositeSheetSize` (re-exported there under that name for its own
// callers) share the one implementation instead of two copies that could
// drift. `tools/defs-build`'s own `strip_size` mirrors this exactly, with
// `gutter` always 0 on that side: the packed atlas strip itself is never
// gutter-padded between frames, only the client's own shared composite
// pages are (`gutter` here defaults to 0 for the same reason).

import type { AppearanceLayoutDef } from "./types";

export function compositeStripSize(
  layout: AppearanceLayoutDef,
  gutter = 0,
): {
  width: number;
  height: number;
} {
  const cellWidth = layout.cellWidth + 2 * gutter;
  const cellHeight = layout.cellHeight + 2 * gutter;
  const width = Math.max(
    0,
    ...layout.rows.map((r) => r.framesPerDirection * layout.directions.length * cellWidth),
  );
  const height = layout.rows.length * cellHeight;
  return { width, height };
}
