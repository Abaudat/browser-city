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
