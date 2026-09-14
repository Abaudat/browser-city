// Story 1.10 (AC5): the one real-canvas/Pixi adapter over `composite.ts`'s
// pure `drawComposite` -- excluded from the coverage gate
// (`client/vitest.config.ts`) because an `OffscreenCanvas` needs a
// browser; the pixel-identical-to-the-live-stack property this exists to
// deliver is an e2e concern, not a unit one.

import { Texture } from "pixi.js";
import type { AppearanceLayoutDef, OutfitDef } from "../../defs/types";
import { type CanvasLike, drawComposite, type LayerImages } from "./composite";
import { compositeSheetSize } from "./frame-rect";

/** Builds a fresh `OffscreenCanvas` sized to `layout`'s compact strip and
 * draws every layer onto it via `drawComposite` -- exactly one texture
 * upload per unique tuple+override is `appearance-cache.ts`'s job, not
 * this function's. */
export function buildCompositeCanvas(
  layout: AppearanceLayoutDef,
  images: LayerImages,
  effectiveOutfit: Pick<OutfitDef, "hidesHairstyle">,
): OffscreenCanvas {
  const { width, height } = compositeSheetSize(layout);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("composite-canvas: 2d context unavailable");
  drawComposite(ctx as unknown as CanvasLike, layout, images, effectiveOutfit);
  return canvas;
}

/** Wraps an already-drawn composite canvas in one Pixi `Texture` --
 * `Texture.from` over a canvas source, never a GPU render-to-texture
 * pass (still banned under `client/src/`, FR121, and never needed here:
 * a plain `Texture.from` is not that construct). */
export function compositeCanvasToTexture(canvas: OffscreenCanvas): Texture {
  return Texture.from(canvas as unknown as HTMLCanvasElement);
}
