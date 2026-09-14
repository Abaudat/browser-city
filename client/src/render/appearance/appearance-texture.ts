// Story 1.10 (AC5): the one place that wires the whole appearance
// pipeline end to end -- tuple(+override) -> `resolve-layers.ts` ->
// loaded part images (`part-sheets.ts`) -> a drawn composite
// (`composite-canvas.ts`) -> one cached, ref-counted Pixi `Texture`
// (`appearance-cache.ts`). Excluded from the coverage gate
// (`client/vitest.config.ts`), like `composite-canvas.ts` and
// `part-sheets.ts` it composes: a thin adapter with no logic of its own
// left to unit-test once those, and `resolve-layers.ts`, are each
// covered on their own.

import type { Texture } from "pixi.js";
import type { Defs } from "../../defs/types";
import { AppearanceCache } from "./appearance-cache";
import {
  type AppearanceTuple,
  appearanceCacheKey,
  type LayerImages,
  type UniformOverride,
} from "./composite";
import { buildCompositeCanvas, compositeCanvasToTexture } from "./composite-canvas";
import { loadPartImage } from "./part-sheets";
import { type ResolvedLayerSheets, resolveLayers } from "./resolve-layers";

/** An engineering cap on distinct composited tuples+overrides held at
 * once -- generous for a street's worth of citizens sharing a modest
 * pool of generated looks, without letting an unbounded population of
 * distinct tuples grow the GPU texture set forever. */
export const APPEARANCE_TEXTURE_CACHE_CAPACITY = 256;

async function loadLayerImages(sheets: ResolvedLayerSheets): Promise<LayerImages> {
  const [body, eyes, outfit, hairstyle, accessory, uniformAccessory] = await Promise.all([
    loadPartImage(sheets.body),
    sheets.eyes ? loadPartImage(sheets.eyes) : null,
    loadPartImage(sheets.outfit),
    sheets.hairstyle ? loadPartImage(sheets.hairstyle) : null,
    sheets.accessory ? loadPartImage(sheets.accessory) : null,
    sheets.uniformAccessory ? loadPartImage(sheets.uniformAccessory) : null,
  ]);
  return { body, eyes, outfit, hairstyle, accessory, uniformAccessory };
}

async function buildAppearanceTexture(
  defs: Defs,
  tuple: AppearanceTuple,
  override: UniformOverride | null,
): Promise<Texture> {
  const resolved = resolveLayers(defs, tuple, override);
  const images = await loadLayerImages(resolved.sheets);
  const canvas = buildCompositeCanvas(resolved.layout, images, resolved.effectiveOutfit);
  const texture = compositeCanvasToTexture(canvas);
  texture.source.scaleMode = "nearest";
  return texture;
}

/** `appearanceCacheKey`'s own inverse -- the encoding is a plain
 * comma-joined tuple, so decoding it back to the tuple+override the
 * cache's `factory` needs (given only the string key `AppearanceCache`
 * calls it with) is exact, not a lossy heuristic. */
function decodeCacheKey(key: string): { tuple: AppearanceTuple; override: UniformOverride | null } {
  const parts = key.split(",").map(Number);
  const [
    body = 0,
    eyes = 0,
    outfit = 0,
    hairstyle = 0,
    accessory = 0,
    outfitOverride = -1,
    accessoryOverride = -1,
  ] = parts;
  const override: UniformOverride | null =
    outfitOverride === -1 && accessoryOverride === -1
      ? null
      : {
          ...(outfitOverride !== -1 ? { outfit: outfitOverride } : {}),
          ...(accessoryOverride !== -1 ? { accessory: accessoryOverride } : {}),
        };
  return { tuple: { body, eyes, outfit, hairstyle, accessory }, override };
}

/** One composited `Texture` per unique tuple+override (AC5), shared by
 * every character with that same look, ref-counted and bounded via
 * `AppearanceCache`. The cache holds a *promise*, not a resolved
 * texture: two concurrent `acquire`s of a key never in the cache yet
 * share the one in-flight build (the second `acquire` hits the same
 * `Map` entry `AppearanceCache` already put there for the first, before
 * either awaits it); a `release` that drops a still-building entry's
 * count to zero, and eviction later reclaiming it, still disposes
 * correctly once the build resolves -- `dispose` itself awaits the
 * promise before destroying, so a texture finishing its build after its
 * last reference already left is destroyed, not leaked, and never
 * handed to a caller that no longer wants it. */
export class AppearanceTextureCache {
  private readonly defs: Defs;
  private readonly cache: AppearanceCache<Promise<Texture>>;

  constructor(defs: Defs, capacity: number = APPEARANCE_TEXTURE_CACHE_CAPACITY) {
    this.defs = defs;
    this.cache = new AppearanceCache<Promise<Texture>>({
      capacity,
      factory: (key) => {
        const { tuple, override } = decodeCacheKey(key);
        return buildAppearanceTexture(this.defs, tuple, override);
      },
      dispose: (pending) => {
        void pending.then((texture) => texture.destroy(true));
      },
    });
  }

  acquire(tuple: AppearanceTuple, override: UniformOverride | null = null): Promise<Texture> {
    return this.cache.acquire(appearanceCacheKey(tuple, override));
  }

  release(tuple: AppearanceTuple, override: UniformOverride | null = null): void {
    this.cache.release(appearanceCacheKey(tuple, override));
  }
}
