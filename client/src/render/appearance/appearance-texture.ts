// Story 1.10/2.7 (AC5/AC3): the one place that wires the whole
// appearance pipeline end to end -- tuple(+override) -> `resolve-layers.ts`
// -> loaded character-part pages (`character-part-pages.ts`) -> drawn
// into one slot of a shared, canvas-backed composite page
// (`composite-pages.ts`, `composite-slots.ts`) -> a cached, ref-counted
// set of pre-built, *slot-fixed* Pixi `Texture`s, one per `(animation,
// direction, frame)` -- built once per slot index, on that slot's first
// ever occupancy, and reused by every later occupant (never rebuilt per
// look, Tim's direction). Excluded from the coverage gate
// (`client/vitest.config.ts`), like `composite-pages.ts` and
// `character-part-pages.ts` it composes: a thin adapter with no logic of
// its own left to unit-test once those, `composite.ts` and
// `resolve-layers.ts` are each covered on their own.

import { Rectangle, Texture, type TextureSource } from "pixi.js";
import type { AppearanceLayoutDef, AtlasRect, Defs } from "../../defs/types";
import { AppearanceCache } from "./appearance-cache";
import { CharacterPartPageLoader } from "./character-part-pages";
import {
  type AppearanceTuple,
  appearanceCacheKey,
  drawComposite,
  type LayerImageEntry,
  type UniformOverride,
} from "./composite";
import { CompositePageSet } from "./composite-pages";
import {
  COMPOSITE_CELL_GUTTER_PX,
  computeSlotLayout,
  SlotAllocator,
  type SlotLayout,
  slotIndexToPosition,
} from "./composite-slots";
import { compositeCellRect, compositeSheetSize } from "./frame-rect";
import { loadLayerImages } from "./layer-images";
import { type ResolvedLayerParts, resolveLayers } from "./resolve-layers";

function frameKey(animation: string, direction: string, frameIndex: number): string {
  return `${animation}|${direction}|${frameIndex}`;
}

type Layer = keyof ResolvedLayerParts;
const LAYER_KEYS: readonly Layer[] = [
  "body",
  "eyes",
  "outfit",
  "hairstyle",
  "accessory",
  "uniformAccessory",
];

/** `null` (no layer, or the load for this layer's own page failed --
 * never reachable here since a rejection already threw) is only ever
 * "no layer": `part` absent. */
function layerEntry(
  atlas: AtlasRect | undefined,
  image: unknown | undefined,
): LayerImageEntry | null {
  if (!atlas || !image) return null;
  return { image, atlas };
}

/** One composited tuple+override's own texture set -- every frame
 * `Texture` is shared with (and outlives) this particular look: it
 * belongs to the slot, not the look. `destroy` therefore never destroys
 * a `Texture`; it only releases the slot back to the allocator, for the
 * next distinct look to claim (and redraw, `clearSlot` first). */
export class CompositeFrames {
  private readonly slotIndex: number;
  private readonly frames: ReadonlyMap<string, Texture>;
  private readonly releaseSlot: (slotIndex: number) => void;

  constructor(
    slotIndex: number,
    frames: ReadonlyMap<string, Texture>,
    releaseSlot: (slotIndex: number) => void,
  ) {
    this.slotIndex = slotIndex;
    this.frames = frames;
    this.releaseSlot = releaseSlot;
  }

  frame(animation: string, direction: string, frameIndex: number): Texture {
    const key = frameKey(animation, direction, frameIndex);
    const found = this.frames.get(key);
    if (!found) {
      throw new Error(`appearance-texture: no pre-built frame for '${key}'`);
    }
    return found;
  }

  destroy(): void {
    this.releaseSlot(this.slotIndex);
  }
}

/** Resolves each layer's own atlas page to its `atlasPages[n].file`, or
 * `null` for "no layer" -- the key `loadLayerImages` loads/releases
 * through. */
function pageFilesFor(defs: Defs, parts: ResolvedLayerParts): Record<Layer, string | null> {
  const files = {} as Record<Layer, string | null>;
  for (const key of LAYER_KEYS) {
    const part = parts[key];
    if (!part) {
      files[key] = null;
      continue;
    }
    const page = defs.atlasPages[part.page];
    if (!page) {
      throw new Error(`appearance-texture: atlas page ${part.page} does not exist`);
    }
    files[key] = page.file;
  }
  return files;
}

/** `Story 2.7's` composite pipeline: one shared `CharacterPartPageLoader`
 * and one shared pool of `CompositePageSet` slots, both owned for the
 * whole session's lifetime. */
export class AppearanceTextureCache {
  private readonly defs: Defs;
  private readonly pageLoader: CharacterPartPageLoader;
  private readonly compositePages: CompositePageSet;
  private readonly cache: AppearanceCache<Promise<CompositeFrames>>;
  private slotAllocator: SlotAllocator | null = null;
  private slotLayout: SlotLayout | null = null;
  private readonly slotFrames = new Map<number, ReadonlyMap<string, Texture>>();

  constructor(defs: Defs, atlasBaseUrl: string) {
    this.defs = defs;
    this.pageLoader = new CharacterPartPageLoader(atlasBaseUrl);
    this.compositePages = new CompositePageSet(defs.characterCompositePages);
    // `capacity` is a live getter over the slot pool's own total, known
    // only once the first look is composited (`ensureSlotLayout`) --
    // until then, unbounded (nothing has been built yet to evict).
    // Capping the cache at the real slot count is what lets a fully-
    // released, no-longer-referenced look's own slot be reclaimed for a
    // new one *before* the allocator ever has to reject an acquire.
    const totalSlots = () => this.slotLayout?.totalSlots ?? Number.POSITIVE_INFINITY;
    this.cache = new AppearanceCache<Promise<CompositeFrames>>({
      get capacity() {
        return totalSlots();
      },
      dispose: (pending) => {
        pending.then((frames) => frames.destroy()).catch(() => {});
      },
    });
  }

  /** The pages sprites actually read from -- `atlas-pages.ts`'s
   * `countBoundAtlasPages` folds this into NFR12's own bound-page count. */
  pageSources(): ReadonlySet<TextureSource> {
    return this.compositePages.pageSources();
  }

  /** One `source.update()` per composite page this tick actually dirtied
   * -- called once per frame's own ticker flush, never per composite
   * draw. */
  flush(): void {
    this.compositePages.flush();
  }

  /** The shared slot pool's own capacity is derived from the *first*
   * family layout this cache ever composites (today's real defs: every
   * family shares one compact-strip shape) -- every later layout's own
   * `compositeSheetSize` must match it exactly, or this throws by name
   * rather than silently mis-packing a differently-shaped family into
   * the same slot grid. */
  private ensureSlotLayout(layout: AppearanceLayoutDef): {
    allocator: SlotAllocator;
    layout: SlotLayout;
  } {
    if (!this.slotLayout || !this.slotAllocator) {
      this.slotLayout = computeSlotLayout(layout, this.defs.characterCompositePages);
      this.slotAllocator = new SlotAllocator(this.slotLayout.totalSlots);
      return { allocator: this.slotAllocator, layout: this.slotLayout };
    }
    const { width, height } = compositeSheetSize(layout, COMPOSITE_CELL_GUTTER_PX);
    if (width !== this.slotLayout.slotWidth || height !== this.slotLayout.slotHeight) {
      throw new Error(
        `appearance-texture: layout '${layout.key}' needs a ${width}x${height}px slot but the shared pool is already sized ${this.slotLayout.slotWidth}x${this.slotLayout.slotHeight}px`,
      );
    }
    return { allocator: this.slotAllocator, layout: this.slotLayout };
  }

  /** A slot's own frame `Texture`s, built once on first occupancy and
   * reused by every later occupant (Tim's direction) -- keyed by slot
   * index, never rebuilt once cached. */
  private framesForSlot(
    slotIndex: number,
    layout: AppearanceLayoutDef,
    page: number,
    slotX: number,
    slotY: number,
  ): ReadonlyMap<string, Texture> {
    const existing = this.slotFrames.get(slotIndex);
    if (existing) return existing;
    const pageTexture = this.compositePages.texture(page);
    const frames = new Map<string, Texture>();
    for (const row of layout.rows) {
      for (const direction of layout.directions) {
        for (let frameIndex = 0; frameIndex < row.framesPerDirection; frameIndex++) {
          const cell = compositeCellRect(
            layout,
            row.animation,
            direction,
            frameIndex,
            COMPOSITE_CELL_GUTTER_PX,
          );
          frames.set(
            frameKey(row.animation, direction, frameIndex),
            new Texture({
              source: pageTexture.source,
              frame: new Rectangle(slotX + cell.x, slotY + cell.y, cell.width, cell.height),
            }),
          );
        }
      }
    }
    this.slotFrames.set(slotIndex, frames);
    return frames;
  }

  private async buildCompositeFrames(
    tuple: AppearanceTuple,
    override: UniformOverride | null,
  ): Promise<CompositeFrames> {
    const resolved = resolveLayers(this.defs, tuple, override);
    const { allocator, layout: slotLayout } = this.ensureSlotLayout(resolved.layout);

    // Exhaustion (every slot referenced) rejects the acquire through the
    // same path a failed part fetch takes today -- never a third page,
    // never a fallback standalone texture (Tim's direction).
    const slotIndex = allocator.acquire();
    try {
      const { page, x, y } = slotIndexToPosition(slotIndex, slotLayout);
      const pageFiles = pageFilesFor(this.defs, resolved.parts);
      const bitmaps = await loadLayerImages(
        pageFiles,
        (file) => this.pageLoader.acquire(file),
        (file, bitmap) => this.pageLoader.release(file, bitmap),
      );

      const images = {} as Record<Layer, LayerImageEntry | null>;
      for (const key of LAYER_KEYS) {
        images[key] = layerEntry(resolved.parts[key]?.atlas, bitmaps[key]);
      }

      this.compositePages.clearSlot(page, x, y, slotLayout.slotWidth, slotLayout.slotHeight);
      drawComposite(
        this.compositePages.contextFor(page),
        resolved.layout,
        images,
        resolved.effectiveOutfit,
        { x, y },
      );
      // The page is now dirty -- `flush()` (called once per frame's own
      // ticker tick, never here) is what actually re-uploads it.

      for (const key of LAYER_KEYS) {
        const file = pageFiles[key];
        const bitmap = bitmaps[key];
        if (file && bitmap) this.pageLoader.release(file, bitmap);
      }

      const frames = this.framesForSlot(slotIndex, resolved.layout, page, x, y);
      return new CompositeFrames(slotIndex, frames, (idx) => allocator.release(idx));
    } catch (err) {
      allocator.release(slotIndex);
      throw err;
    }
  }

  acquire(
    tuple: AppearanceTuple,
    override: UniformOverride | null = null,
  ): Promise<CompositeFrames> {
    const key = appearanceCacheKey(tuple, override);
    return this.cache.acquire(key, () => {
      const pending = this.buildCompositeFrames(tuple, override);
      pending.catch(() => {
        this.cache.forget(key, pending);
      });
      return pending;
    });
  }

  release(tuple: AppearanceTuple, override: UniformOverride | null = null): void {
    this.cache.release(appearanceCacheKey(tuple, override));
  }
}
