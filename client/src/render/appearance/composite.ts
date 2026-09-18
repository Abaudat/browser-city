// Composites the appearance layers into one shared composite-page slot --
// body -> eyes -> outfit -> hairstyle -> accessory -> uniform accessory,
// `0` skipped, nearest-neighbour sampled, no premultiply halo. Pure: no
// `pixi.js`, no canvas, no DOM -- the one real-canvas adapter this feeds
// is `composite-pages.ts`, split out so that file alone needs the
// coverage-gate carve-out (`client/vitest.config.ts`) an `OffscreenCanvas`
// forces on it.

import type {
  AccessoryDef,
  AppearanceLayoutDef,
  AtlasRect,
  Defs,
  OutfitDef,
} from "../../defs/types";
import { COMPOSITE_CELL_GUTTER_PX } from "./composite-slots";
import { compositeCellRect } from "./frame-rect";

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

/** The outfit layer, and the (up to two) accessory layers, once a
 * uniform override is applied. `civilianAccessory` is the citizen's own
 * accessory (FR61), `uniformAccessory` the override's -- a uniform
 * accessory is always an *additional* layer, drawn on top, and only
 * removes the civilian one when both occupy the same body slot (a helmet
 * removes a beanie; a hi-vis jacket over a beard keeps the beard). */
export interface EffectiveLayers {
  readonly outfit: number;
  readonly civilianAccessory: number;
  readonly uniformAccessory: number;
}

/** Resolves `tuple`+`override` to the layers actually drawn. `outfit`
 * always replaces (a citizen has exactly one outfit layer); the
 * accessory layer never simply replaces -- see [`EffectiveLayers`].
 * `accessoryDefs` supplies each accessory id's own `slot`. */
export function effectiveLayers(
  tuple: AppearanceTuple,
  override: UniformOverride | null,
  accessoryDefs: readonly AccessoryDef[],
): EffectiveLayers {
  const outfit = override?.outfit ?? tuple.outfit;
  const uniformAccessory = override?.accessory ?? 0;
  if (uniformAccessory === 0) {
    return { outfit, civilianAccessory: tuple.accessory, uniformAccessory: 0 };
  }
  const uniformSlot = accessoryDefs.find((a) => a.id === uniformAccessory)?.slot;
  const civilianSlot =
    tuple.accessory !== 0 ? accessoryDefs.find((a) => a.id === tuple.accessory)?.slot : undefined;
  const sameSlot = uniformSlot !== undefined && uniformSlot === civilianSlot;
  return {
    outfit,
    civilianAccessory: sameSlot ? 0 : tuple.accessory,
    uniformAccessory,
  };
}

/** "Cache key = tuple + override, so a uniformed and a civilian version
 * of the same citizen are two entries" -- the full tuple and the full
 * override, not just the effective layers, so this stays a plain,
 * obviously-injective encoding rather than a hash that could collide. */
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

// The citizen's own civilian accessory draws before a uniform accessory,
// so the uniform sits visually on top (a hi-vis jacket over the outfit,
// a helmet over -- and in the same-slot case, instead of -- a beanie).
const LAYER_ORDER = [
  "body",
  "eyes",
  "outfit",
  "hairstyle",
  "accessory",
  "uniformAccessory",
] as const;
type Layer = (typeof LAYER_ORDER)[number];

/** One already-loaded layer: the packed atlas *page* image this part's
 * own strip lives on (never just the strip alone -- Story 2.7's page
 * loader hands back a whole page, shared across every part packed onto
 * it), plus that part's own `atlas` rect on that page. `null` is "no
 * layer" -- the caller (`character-part-pages.ts`) resolves ids to loaded
 * pages; this module only draws them. */
export interface LayerImageEntry {
  readonly image: unknown;
  readonly atlas: AtlasRect;
}
export type LayerImages = Readonly<Record<Layer, LayerImageEntry | null>>;

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
 * into `ctx`, layer by layer in `LAYER_ORDER`, at `slotOrigin` plus that
 * cell's own gutter-padded position (`compositeCellRect` with
 * [`COMPOSITE_CELL_GUTTER_PX`] -- a look's own destination is one slot in
 * a shared composite page, story 2.7, never a fresh per-look canvas).
 * Each layer's own source crop is its packed atlas page, at that layer's
 * own `atlas` rect plus the *same* cell's tight, gutter-0 local offset
 * (`compositeCellRect` with no gutter) -- the packed part strip
 * `tools/defs-build` built is laid out exactly like the compact strip
 * this function destination-packs, just without the gutter, so one frame
 * index always picks the matching cell on every part's own page. Skips a
 * `null` layer image (the "no layer" sentinel) and skips the hairstyle
 * layer entirely when `effectiveOutfit.hidesHairstyle` is set (the
 * frog/tiger kid pyjama hoods), even when the citizen has a hairstyle. */
export function drawComposite(
  ctx: CanvasLike,
  layout: AppearanceLayoutDef,
  images: LayerImages,
  effectiveOutfit: Pick<OutfitDef, "hidesHairstyle">,
  slotOrigin: { readonly x: number; readonly y: number },
): void {
  ctx.imageSmoothingEnabled = false;
  for (const row of layout.rows) {
    for (const direction of layout.directions) {
      for (let frame = 0; frame < row.framesPerDirection; frame++) {
        const srcLocal = compositeCellRect(layout, row.animation, direction, frame);
        const dst = compositeCellRect(
          layout,
          row.animation,
          direction,
          frame,
          COMPOSITE_CELL_GUTTER_PX,
        );
        const dstX = slotOrigin.x + dst.x;
        const dstY = slotOrigin.y + dst.y;
        for (const layer of LAYER_ORDER) {
          if (layer === "hairstyle" && effectiveOutfit.hidesHairstyle) continue;
          const entry = images[layer];
          if (entry === null || entry === undefined) continue;
          ctx.drawImage(
            entry.image,
            entry.atlas.x + srcLocal.x,
            entry.atlas.y + srcLocal.y,
            srcLocal.width,
            srcLocal.height,
            dstX,
            dstY,
            dst.width,
            dst.height,
          );
        }
      }
    }
  }
}

/** FR62: resolves `professionKey`'s fixed uniform override, or `null`
 * when that profession declares no `[[uniform]]` (most professions
 * today) -- the server never re-derives this; `defs/appearance/`'s own
 * `[[uniform]]` table is the one place it is declared, and
 * `tools/defs-build` already proved every entry names a real, adult,
 * role_only outfit/accessory, so this is a plain lookup, not a second
 * validation pass. */
export function resolveUniform(defs: Defs, professionKey: string): UniformOverride | null {
  const uniform = defs.uniforms.find((u) => u.profession === professionKey);
  if (!uniform) return null;

  const outfit =
    uniform.outfit !== undefined
      ? defs.outfits.find((o) => o.key === uniform.outfit)?.id
      : undefined;
  const accessory =
    uniform.accessory !== undefined
      ? defs.accessories.find((a) => a.key === uniform.accessory)?.id
      : undefined;

  return {
    ...(outfit !== undefined ? { outfit } : {}),
    ...(accessory !== undefined ? { accessory } : {}),
  };
}
