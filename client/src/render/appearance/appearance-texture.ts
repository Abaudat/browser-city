// Story 1.10 (AC5): the one place that wires the whole appearance
// pipeline end to end -- tuple(+override) -> `resolve-layers.ts` ->
// loaded part images (`part-sheets.ts`) -> a drawn composite
// (`composite-canvas.ts`) -> one cached, ref-counted set of Pixi
// `Texture`s, one per `(animation, direction, frame)`, plus the full
// composite strip itself (`appearance-cache.ts`). Excluded from the
// coverage gate (`client/vitest.config.ts`), like `composite-canvas.ts`
// and `part-sheets.ts` it composes: a thin adapter with no logic of its
// own left to unit-test once those, and `resolve-layers.ts`, are each
// covered on their own.

import { Rectangle, Texture } from "pixi.js";
import type { Defs } from "../../defs/types";
import { AppearanceCache } from "./appearance-cache";
import {
  type AppearanceTuple,
  appearanceCacheKey,
  type LayerImages,
  type UniformOverride,
} from "./composite";
import { buildCompositeCanvas, compositeCanvasToTexture } from "./composite-canvas";
import { compositeCellRect } from "./frame-rect";
import { loadPartImage, releasePartImage } from "./part-sheets";
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

/** Releases every bitmap `loadLayerImages` acquired -- called right after
 * `buildCompositeCanvas` has drawn from them, since a bitmap is never
 * needed again once its pixels are already in the composite canvas. */
function releaseLayerImages(sheets: ResolvedLayerSheets, images: LayerImages): void {
  releasePartImage(sheets.body, images.body as ImageBitmap);
  if (sheets.eyes && images.eyes) releasePartImage(sheets.eyes, images.eyes as ImageBitmap);
  releasePartImage(sheets.outfit, images.outfit as ImageBitmap);
  if (sheets.hairstyle && images.hairstyle) {
    releasePartImage(sheets.hairstyle, images.hairstyle as ImageBitmap);
  }
  if (sheets.accessory && images.accessory) {
    releasePartImage(sheets.accessory, images.accessory as ImageBitmap);
  }
  if (sheets.uniformAccessory && images.uniformAccessory) {
    releasePartImage(sheets.uniformAccessory, images.uniformAccessory as ImageBitmap);
  }
}

function frameKey(animation: string, direction: string, frameIndex: number): string {
  return `${animation}|${direction}|${frameIndex}`;
}

/** One composited tuple+override's own texture set: the full compact
 * strip (`texture`, which `compare-pipeline-vs-stack.ts`'s pixel-diff
 * proof reads directly), and one already-cropped `Texture` per
 * `(animation, direction, frame)` cell, built once here rather than on
 * every animation tick -- a caller only ever looks a frame up, never
 * constructs one. */
export class CompositeFrames {
  readonly texture: Texture;
  private readonly frames: ReadonlyMap<string, Texture>;

  constructor(texture: Texture, frames: ReadonlyMap<string, Texture>) {
    this.texture = texture;
    this.frames = frames;
  }

  frame(animation: string, direction: string, frameIndex: number): Texture {
    const key = frameKey(animation, direction, frameIndex);
    const found = this.frames.get(key);
    if (!found) {
      throw new Error(`appearance-texture: no pre-built frame for '${key}'`);
    }
    return found;
  }

  /** Destroys every pre-built frame texture, then the composite strip
   * they all crop -- frame textures first, and never with
   * `destroyTextureSource: true` (each one subscribes to the shared
   * composite source's own events, per Pixi v8; only the one full-strip
   * `texture` below owns that source and destroys it). */
  destroy(): void {
    for (const frame of this.frames.values()) frame.destroy(false);
    this.texture.destroy(true);
  }
}

async function buildCompositeFrames(
  defs: Defs,
  tuple: AppearanceTuple,
  override: UniformOverride | null,
): Promise<CompositeFrames> {
  const resolved = resolveLayers(defs, tuple, override);
  const images = await loadLayerImages(resolved.sheets);
  const canvas = buildCompositeCanvas(resolved.layout, images, resolved.effectiveOutfit);
  releaseLayerImages(resolved.sheets, images);

  const texture = compositeCanvasToTexture(canvas);
  texture.source.scaleMode = "nearest";

  const frames = new Map<string, Texture>();
  for (const row of resolved.layout.rows) {
    for (const direction of resolved.layout.directions) {
      for (let frameIndex = 0; frameIndex < row.framesPerDirection; frameIndex++) {
        const cell = compositeCellRect(resolved.layout, row.animation, direction, frameIndex);
        frames.set(
          frameKey(row.animation, direction, frameIndex),
          new Texture({
            source: texture.source,
            frame: new Rectangle(cell.x, cell.y, cell.width, cell.height),
          }),
        );
      }
    }
  }

  return new CompositeFrames(texture, frames);
}

/** One `CompositeFrames` per unique tuple+override (AC5), shared by every
 * character with that same look, ref-counted and bounded via
 * `AppearanceCache`. The cache holds a *promise*, not a resolved value:
 * two concurrent `acquire`s of a key never in the cache yet share the one
 * in-flight build; a `release` that drops a still-building entry's count
 * to zero, and eviction later reclaiming it, still disposes correctly
 * once the build resolves -- `dispose` itself awaits the promise before
 * destroying, so a build finishing after its last reference already left
 * is destroyed, not leaked, and never handed to a caller that no longer
 * wants it. A build that *rejects* (a part sheet's fetch failed) is
 * evicted immediately rather than cached as a permanently broken entry,
 * and never becomes an unhandled rejection. */
export class AppearanceTextureCache {
  private readonly defs: Defs;
  private readonly cache: AppearanceCache<Promise<CompositeFrames>>;

  constructor(defs: Defs, capacity: number = APPEARANCE_TEXTURE_CACHE_CAPACITY) {
    this.defs = defs;
    this.cache = new AppearanceCache<Promise<CompositeFrames>>({
      capacity,
      dispose: (pending) => {
        pending.then((frames) => frames.destroy()).catch(() => {});
      },
    });
  }

  acquire(
    tuple: AppearanceTuple,
    override: UniformOverride | null = null,
  ): Promise<CompositeFrames> {
    const key = appearanceCacheKey(tuple, override);
    return this.cache.acquire(key, () => {
      const pending = buildCompositeFrames(this.defs, tuple, override);
      pending.catch(() => {
        this.cache.forget(key);
      });
      return pending;
    });
  }

  release(tuple: AppearanceTuple, override: UniformOverride | null = null): void {
    this.cache.release(appearanceCacheKey(tuple, override));
  }
}
