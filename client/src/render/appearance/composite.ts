// Story 1.10 (AC5, FR61/FR62): composites the five appearance layers into
// one compact strip -- body -> eyes -> outfit -> hairstyle -> accessory
// (Artie's direction, the order the sheets were authored for), `0`
// skipped, nearest-neighbour sampled, no premultiply halo. Pure: no
// `pixi.js`, no canvas, no DOM -- the one real-canvas adapter this feeds
// is `composite-canvas.ts`, split out so that file alone needs the
// coverage-gate carve-out (`client/vitest.config.ts`) an `OffscreenCanvas`
// forces on it.

import type { AppearanceLayoutDef, OutfitDef } from "../../defs/types";
import { compositeCellRect, sourceFrameRect } from "./frame-rect";

/** The five stored layer indices (mirrors `sim::appearance::Appearance`,
 * FR61) -- `0` means "no layer" on `hairstyle`/`accessory` only. */
export interface AppearanceTuple {
  readonly body: number;
  readonly eyes: number;
  readonly outfit: number;
  readonly hairstyle: number;
  readonly accessory: number;
}

/** FR62: a profession's fixed override for the outfit and/or accessory
 * layer, applied only at render time -- never written back into the
 * stored tuple. */
export interface UniformOverride {
  readonly outfit?: number;
  readonly accessory?: number;
}

/** Artie's direction: the outfit and accessory layer each resolve to the
 * override's value when the override names one, otherwise the citizen's
 * own civilian value. */
export function effectiveOutfitAndAccessory(
  tuple: AppearanceTuple,
  override: UniformOverride | null,
): { outfit: number; accessory: number } {
  return {
    outfit: override?.outfit ?? tuple.outfit,
    accessory: override?.accessory ?? tuple.accessory,
  };
}

/** Artie's direction: "cache key = tuple + override, so a uniformed and a
 * civilian version of the same citizen are two entries" -- the full
 * tuple and the full override, not just the effective outfit/accessory,
 * so this stays a plain, obviously-injective encoding rather than a hash
 * that could collide. */
export function appearanceCacheKey(
  tuple: AppearanceTuple,
  override: UniformOverride | null,
): string {
  const outfitOverride = override?.outfit ?? -1;
  const accessoryOverride = override?.accessory ?? -1;
  return [
    tuple.body,
    tuple.eyes,
    tuple.outfit,
    tuple.hairstyle,
    tuple.accessory,
    outfitOverride,
    accessoryOverride,
  ].join(",");
}

const LAYER_ORDER = ["body", "eyes", "outfit", "hairstyle", "accessory"] as const;
type Layer = (typeof LAYER_ORDER)[number];

/** One already-loaded part image per layer, or `null` for "no layer"
 * (`hairstyle`/`accessory` at `0`) -- the caller (`part-sheets.ts`)
 * resolves ids to loaded images; this module only draws them. */
export type LayerImages = Readonly<Record<Layer, unknown | null>>;

/** The minimal `CanvasRenderingContext2D` surface this module needs --
 * an interface rather than the DOM type, so a plain object can stand in
 * for it in a unit test with no real canvas. */
export interface CanvasLike {
  imageSmoothingEnabled: boolean;
  drawImage(
    image: unknown,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

/** Draws every declared `(animation, direction, frame)` cell of `layout`
 * into `ctx`'s compact composite strip, layer by layer in
 * `LAYER_ORDER`, cropping each layer's own full sheet at exactly that
 * cell (`sourceFrameRect`) and placing it at the same cell in the
 * compact strip (`compositeCellRect`) -- one frame index always picks
 * the matching cell on every sheet, because every part shares one
 * family layout. Skips a `null` layer image (the "no layer" sentinel)
 * and skips the hairstyle layer entirely when `effectiveOutfit.
 * hidesHairstyle` is set (the frog/tiger kid pyjama hoods), even when the
 * citizen has a hairstyle. */
export function drawComposite(
  ctx: CanvasLike,
  layout: AppearanceLayoutDef,
  images: LayerImages,
  effectiveOutfit: Pick<OutfitDef, "hidesHairstyle">,
): void {
  ctx.imageSmoothingEnabled = false;
  for (const row of layout.rows) {
    for (const direction of layout.directions) {
      for (let frame = 0; frame < row.framesPerDirection; frame++) {
        const src = sourceFrameRect(layout, row.animation, direction, frame);
        const dst = compositeCellRect(layout, row.animation, direction, frame);
        for (const layer of LAYER_ORDER) {
          if (layer === "hairstyle" && effectiveOutfit.hidesHairstyle) continue;
          const image = images[layer];
          if (image === null || image === undefined) continue;
          ctx.drawImage(
            image,
            src.x,
            src.y,
            src.width,
            src.height,
            dst.x,
            dst.y,
            dst.width,
            dst.height,
          );
        }
      }
    }
  }
}
