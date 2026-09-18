// Story 1.10/2.7 (AC5/AC3): the one place that wires the whole
// appearance pipeline end to end -- tuple(+override) -> `resolve-layers.ts`
// -> loaded character-part pages -> drawn into one slot of a shared,
// canvas-backed composite page -> a cached, ref-counted set of pre-built,
// *slot-fixed* Pixi `Texture`s, one per `(animation, direction, frame)` --
// built once per slot index, on that slot's first ever occupancy, and
// reused by every later occupant (never rebuilt per look, Tim's
// direction). The one look-level cache is `AppearanceCache<PendingLook>`
// -- the same LRU/ref-count semantics every other cache in this pipeline
// uses, its own `dispose` synchronously releasing the evicted look's own
// slot (`composite-look-cache.ts`'s `SlotClaimAllocator`, a pure module
// covered by its own unit tests). `CompositePageProvider`/
// `CharacterPageLoader` are both constructor-injectable (Quentin/Tim's
// direction, cycle 1), so this file's own remaining logic (the slot
// exhaustion/staleness plumbing, the release-on-failure catch, the
// build-once-per-slot frame cache) is unit-tested too (`pixi.js` mocked,
// `atlas-pages.test.ts`'s own idiom), and is back inside the coverage
// gate.

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
import { type SlotClaim, SlotClaimAllocator } from "./composite-look-cache";
import { type CompositePageProvider, CompositePageSet } from "./composite-pages";
import { COMPOSITE_CELL_GUTTER_PX } from "./composite-slots";
import { compositeCellRect } from "./frame-rect";
import { loadLayerImages } from "./layer-images";
import { type ResolvedLayerParts, type ResolvedLayers, resolveLayers } from "./resolve-layers";

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

/** `null` (no layer) is only ever "no layer": `part` absent. */
function layerEntry(
  atlas: AtlasRect | undefined,
  image: unknown | undefined,
): LayerImageEntry | null {
  if (!atlas || !image) return null;
  return { image, atlas };
}

/** What this module needs from `character-part-pages.ts`'s own
 * `CharacterPartPageLoader` -- an interface, not the class, so a unit
 * test can inject a fake with no real `fetch`. */
export interface CharacterPageLoader {
  acquire(file: string): Promise<unknown>;
  release(file: string, image: unknown): void;
}

/** One composited tuple+override's own texture set -- every frame
 * `Texture` is shared with (and outlives) this particular look: it
 * belongs to the slot, not the look. Releasing a look is `cache.release`
 * alone (`AppearanceTextureCache.release`, keyed on the tuple/override
 * the caller itself already holds) -- never a second, unnamed way to
 * drop a reference on a `CompositeFrames` instance itself (Tim's
 * direction, cycle 2: a caller that called *both* would silently drop
 * another holder's reference, since `AppearanceCache.release` clamps at
 * zero rather than erroring on an extra call). */
export class CompositeFrames {
  private readonly frames: ReadonlyMap<string, Texture>;

  constructor(frames: ReadonlyMap<string, Texture>) {
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

/** One look's own cache entry: its slot claim (known synchronously, the
 * moment `acquire` is called) plus the async work that draws into it. */
interface PendingLook {
  readonly claim: SlotClaim;
  readonly promise: Promise<CompositeFrames>;
}

/** Story 2.7's composite pipeline: one shared `CharacterPageLoader`, one
 * shared `CompositePageProvider` and one shared `SlotClaimAllocator`, all
 * owned for the whole session's lifetime. `compositePages`/`pageLoader`
 * default to the real, production adapters; a test injects fakes. */
export class AppearanceTextureCache {
  private readonly defs: Defs;
  private readonly pageLoader: CharacterPageLoader;
  private readonly compositePages: CompositePageProvider;
  private readonly slots: SlotClaimAllocator;
  private readonly cache: AppearanceCache<PendingLook>;
  private readonly slotFrames = new Map<number, ReadonlyMap<string, Texture>>();

  constructor(
    defs: Defs,
    atlasBaseUrl: string,
    compositePages: CompositePageProvider = new CompositePageSet(defs.characterCompositePages),
    pageLoader: CharacterPageLoader = new CharacterPartPageLoader(atlasBaseUrl),
  ) {
    this.defs = defs;
    this.compositePages = compositePages;
    this.pageLoader = pageLoader;
    this.slots = new SlotClaimAllocator(defs.characterCompositePages);
    // `capacity` is a live getter over the slot pool's own total, known
    // only once the first look is composited -- until then, unbounded
    // (nothing has been built yet to evict). `dispose` releases the
    // evicted look's own slot *synchronously* (Quentin/Tim's direction,
    // cycle 1) -- never a `.then(...)` deferred to a microtask, which
    // would free it one tick too late for the very acquire that is
    // making room.
    const totalSlots = () => this.slots.totalSlots ?? Number.POSITIVE_INFINITY;
    this.cache = new AppearanceCache<PendingLook>({
      get capacity() {
        return totalSlots();
      },
      dispose: (look) => {
        this.slots.release(look.claim);
        look.promise.catch(() => {});
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

  /** A slot's own frame `Texture`s, built once on first occupancy and
   * reused by every later occupant (Tim's direction) -- keyed by slot
   * index, never rebuilt once cached. */
  private framesForSlot(
    claim: SlotClaim,
    layout: AppearanceLayoutDef,
  ): ReadonlyMap<string, Texture> {
    const existing = this.slotFrames.get(claim.slotIndex);
    if (existing) return existing;
    const pageTexture = this.compositePages.texture(claim.position.page);
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
              frame: new Rectangle(
                claim.position.x + cell.x,
                claim.position.y + cell.y,
                cell.width,
                cell.height,
              ),
            }),
          );
        }
      }
    }
    this.slotFrames.set(claim.slotIndex, frames);
    return frames;
  }

  private async draw(claim: SlotClaim, resolved: ResolvedLayers): Promise<CompositeFrames> {
    const pageFiles = pageFilesFor(this.defs, resolved.parts);
    const bitmaps = await loadLayerImages(
      pageFiles,
      (file) => this.pageLoader.acquire(file),
      (file, bitmap) => this.pageLoader.release(file, bitmap),
    );

    // This look's own slot may have been evicted (and reassigned to a
    // different look) while the pages above were loading -- drawing now
    // would silently overwrite whoever already owns it (Tim's direction,
    // cycle 1: "mind the in-flight case"). Release the freshly-loaded
    // bitmaps and abort instead.
    if (claim.isStale()) {
      for (const key of LAYER_KEYS) {
        const file = pageFiles[key];
        const bitmap = bitmaps[key];
        if (file && bitmap) this.pageLoader.release(file, bitmap);
      }
      throw new Error("appearance-texture: slot reassigned before this look could draw");
    }

    const images = {} as Record<Layer, LayerImageEntry | null>;
    for (const key of LAYER_KEYS) {
      images[key] = layerEntry(resolved.parts[key] ?? undefined, bitmaps[key]);
    }

    const { page, x, y } = claim.position;
    this.compositePages.clearSlot(page, x, y, claim.width, claim.height);
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

    const frames = this.framesForSlot(claim, resolved.layout);
    return new CompositeFrames(frames);
  }

  /** Never throws synchronously (Tim's direction, cycle 2): a
   * promise-returning method rejects, it never throws -- a caller
   * chaining straight off this call (`citizens-layer.ts`'s
   * `compareForE2e`, `cache.acquire(...).then(...)`) must see every
   * failure, including exhaustion and a cell-geometry mismatch, arrive
   * as a rejection, never as an exception escaping this call itself.
   * `this.cache.acquire`'s own `build` closure below still claims the
   * slot synchronously, before any async work -- only where that throw
   * surfaces changes here, not when it happens. */
  acquire(
    tuple: AppearanceTuple,
    override: UniformOverride | null = null,
  ): Promise<CompositeFrames> {
    const key = appearanceCacheKey(tuple, override);
    let look: PendingLook;
    try {
      look = this.cache.acquire(key, () => {
        const resolved = resolveLayers(this.defs, tuple, override);
        const claim = this.slots.claim(resolved.layout);
        const promise = this.draw(claim, resolved);
        promise.catch(() => {
          // A build failure releases its own slot immediately, exactly
          // once (Quentin's direction, cycle 1), and forgets the cache
          // entry so a retry gets a fresh attempt -- identity-guarded via
          // `forget`, the same as every other cache in this pipeline.
          this.cache.forget(key, look);
          this.slots.release(claim);
        });
        return { claim, promise };
      });
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    return look.promise;
  }

  release(tuple: AppearanceTuple, override: UniformOverride | null = null): void {
    this.cache.release(appearanceCacheKey(tuple, override));
  }
}
