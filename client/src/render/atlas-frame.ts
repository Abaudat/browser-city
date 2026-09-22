// Story 2.6: the pure half of atlas-pages.ts -- no `pixi.js`, no canvas,
// no DOM, kept in its own module so it stays in the coverage gate the
// same way `appearance/frame-rect.ts` does for `appearance-texture.ts`.

import type { AtlasRect } from "../defs/types";

export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The page-pixel crop rect an `AtlasRect` names -- the gutter already
 * excluded (`tools/defs-build`'s own packer only ever records an
 * object's whole sprite, never its extruded border). */
export function atlasFrameRect(rect: AtlasRect): FrameRect {
  return { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
}

/**
 * Story 2.13 (Tim's direction, cycle 2): one def-placed prop's own
 * per-cell crop rect, sliced off the object's whole-sprite frame
 * (`whole`, `atlasFrameRect`'s own output) -- the pure half of
 * `AtlasPageLoader.objectCellTexture`'s own per-cell cache, which is the
 * one caller and the one place that rejects a def taller than one row
 * before this function ever runs (`objectCellTexture`'s own doc comment
 * says why: never silently cropping only a taller def's own top row).
 * `whole`'s own `x`/`y` are already wherever the packer placed this
 * object's whole sprite on its page, never the page's own origin -- so
 * the frame this function builds starts from that same offset, not from
 * `(0, 0)`, or a `sourceCol > 0` (or even `sourceCol === 0` on any object
 * the packer did not place at the page's own origin) would crop a
 * neighbouring object's pixels instead (the real bug this function's own
 * test fixture is shaped to catch). `tools/defs-build`'s own validator
 * already fixes `object.atlas`'s width to exactly `width * tileSizePx`
 * (FR126), so a one-cell def (`sourceCol` always 0) crops to its own
 * whole extent by the same arithmetic a wide def slices by.
 */
export function defCellFrameRect(
  whole: FrameRect,
  sourceCol: number,
  tileSizePx: number,
): FrameRect {
  return {
    x: whole.x + sourceCol * tileSizePx,
    y: whole.y,
    width: tileSizePx,
    height: whole.height,
  };
}
