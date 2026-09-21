// Story 2.6: the client's one reader for tools/defs-build's own atlas
// packer -- loads a packed page only on first demand (Pixi `Assets.load`,
// nearest-neighbour sampling, mipmaps off) and crops each object's own
// `atlas` rect from it (`new Texture({ source, frame })`, a plain crop --
// the render-to-texture construct docs/architecture.md's "Visibility"
// section bans anywhere under `client/src/` is never used here). Its own
// pure frame-rect math lives in `atlas-frame.ts` (the `frame-rect.ts`
// split). `tests/unit/render/atlas-pages.test.ts` mocks `pixi.js` itself
// to prove the caching, eviction-on-rejection and error-naming behaviour
// without a real browser Image-decode runtime; the shop counter
// (`test-street/scene.ts`) is this loader's first real caller.

import { Assets, type Container, Rectangle, Sprite, Texture, type TextureSource } from "pixi.js";
import type { AtlasPageDef, Defs, ObjectDef } from "../defs/types";
import { atlasFrameRect, defCellFrameRect } from "./atlas-frame";
import { atlasPageUrl } from "./atlas-url";

/**
 * One shared cache of page `Texture`s (keyed by filename) and of the
 * cropped per-object `Texture` each object's own `atlas` rect resolves
 * to (keyed by object id, Artie's direction: the same shared-cache shape
 * as the page it crops, never a fresh `Texture` built on every call) --
 * a page is decoded at most once and a crop built at most once, no
 * matter how many callers ask for the same object. Neither cache is ever
 * preloaded: a page loads, and a crop is built, only the first time a
 * caller actually asks for it. Both caches are owned by this loader
 * alone; a caller never destroys a texture it got from `objectTexture`.
 *
 * A rejected load is evicted from whichever cache it failed in (Artie's
 * direction): one dropped page request on a flaky link must not
 * permanently hide every prop on that page for the rest of the session --
 * the next demand for the same page or object retries instead of
 * replaying the same rejection forever.
 */
export class AtlasPageLoader {
  private readonly baseUrl: string;
  private readonly pages = new Map<string, Promise<Texture>>();
  private readonly objectTextures = new Map<number, Promise<Texture>>();
  /** Story 2.13 (Tim's direction, cycle 2): one shared cropped `Texture`
   * per `(object id, column)`, next to [`objectTextures`] above -- a
   * `defId`-placed prop's own per-cell texture is built at most once no
   * matter how many placements of the same def (four `bridge_deck`
   * placements share one; a generated city sharing one def across many
   * placed cells shares one per column that def ever needs), never a
   * fresh `Texture` allocated on every call the way `defCellTexture` used
   * to. */
  private readonly objectCellTextures = new Map<string, Promise<Texture>>();
  /** Every page `TextureSource` this loader has actually resolved --
   * populated only once a page's own load settles, never while pending
   * (Quentin's direction: the mounted-scene page count must read what
   * really reached the display list, not merely what was requested). */
  private readonly resolvedSources = new Set<TextureSource>();

  /**
   * `baseUrl` is the already-resolved base a page filename is appended
   * to (e.g. `` `${import.meta.env.BASE_URL}atlas/` `` at the real call
   * site) -- never hard-coded and never read from `import.meta.env` in
   * this module itself, the same idiom `defs/load.ts`'s `fetchDefs`
   * already uses (the Pages base is a CLI flag, docs/architecture.md's
   * "Atlases" section).
   */
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * How many page loads this loader has requested and not yet had
   * rejected -- includes pages still pending, so it is a cheap
   * upper-bound sanity check for the loader's own unit tests, never the
   * NFR12 fact. That fact is [`pageSources`]: the mounted display list is
   * what actually proves a page is bound, not this loader's own request
   * bookkeeping (Quentin's direction) -- a page whose sprite was later
   * destroyed, or one that never finished loading, is not "bound" no
   * matter what this count says.
   */
  boundPageCount(): number {
    return this.pages.size;
  }

  /**
   * Every page `TextureSource` this loader has actually resolved so far
   * -- a caller walks the real, mounted display list and intersects it
   * against this set to get NFR12's own "simultaneously bound" count,
   * since neither this loader nor any single object knows what the
   * renderer actually kept on screen.
   */
  pageSources(): ReadonlySet<TextureSource> {
    return this.resolvedSources;
  }

  private pageTexture(page: AtlasPageDef): Promise<Texture> {
    let promise = this.pages.get(page.file);
    if (!promise) {
      promise = Assets.load<Texture>(atlasPageUrl(this.baseUrl, page.file))
        .then((texture) => {
          texture.source.scaleMode = "nearest";
          texture.source.autoGenerateMipmaps = false;
          this.resolvedSources.add(texture.source);
          return texture;
        })
        .catch((err: unknown) => {
          this.pages.delete(page.file);
          throw err;
        });
      this.pages.set(page.file, promise);
    }
    return promise;
  }

  /**
   * The cropped `Texture` for one object's own atlas rect -- cached by
   * object id (Artie's direction), shared and never destroyed by an
   * individual caller.
   */
  objectTexture(defs: Defs, object: ObjectDef): Promise<Texture> {
    let promise = this.objectTextures.get(object.id);
    if (promise) return promise;

    const page = defs.atlasPages[object.atlas.page];
    if (!page) {
      return Promise.reject(
        new Error(
          `atlas-pages: object '${object.key}' names atlas page ${object.atlas.page}, but defs only has ${defs.atlasPages.length} page(s)`,
        ),
      );
    }
    promise = this.pageTexture(page)
      .then((pageTexture) => {
        const cell = atlasFrameRect(object.atlas);
        const frame = new Rectangle(cell.x, cell.y, cell.width, cell.height);
        return new Texture({ source: pageTexture.source, frame, dynamic: false });
      })
      .catch((err: unknown) => {
        this.objectTextures.delete(object.id);
        throw err;
      });
    this.objectTextures.set(object.id, promise);
    return promise;
  }

  /**
   * One def-placed prop's own per-cell texture (story 2.13, Tim's
   * direction cycle 2): the def's whole atlas-cropped sprite
   * ([`objectTexture`], already cached above), further cropped to the
   * exact `tileSizePx`-wide column `sourceCol` names
   * ([`defCellFrameRect`]'s own pure math, `atlas-frame.ts`) -- cached
   * per `(object id, column)`, shared and never destroyed by an
   * individual caller, the same shape [`objectTexture`]'s own cache
   * already has. A rejected load is evicted the same way
   * [`objectTexture`]'s own cache is (Artie's direction): one dropped
   * page request must not permanently hide this cell for the rest of the
   * session.
   *
   * `object.height` is checked here, not in `defCellFrameRect` (never
   * silent, Tim's direction): every real `defs/objects` entry is one row
   * tall today, so `sourceRow` is accepted for a future caller that slices
   * a taller def's own rows properly, but this throws naming the object
   * rather than silently drawing only its own top row on every row the
   * day a taller one exists.
   */
  objectCellTexture(
    defs: Defs,
    object: ObjectDef,
    sourceCol: number,
    _sourceRow: number,
    tileSizePx: number,
  ): Promise<Texture> {
    if (object.height > 1) {
      return Promise.reject(
        new Error(
          `atlas-pages: object '${object.key}' is ${object.height} cells tall -- per-cell ` +
            "slicing along the vertical axis is not supported yet",
        ),
      );
    }
    const key = `${object.id}:${sourceCol}`;
    let promise = this.objectCellTextures.get(key);
    if (promise) return promise;

    promise = this.objectTexture(defs, object)
      .then((base) => {
        const frame = defCellFrameRect(base.frame, sourceCol, tileSizePx);
        return new Texture({
          source: base.source,
          frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
          dynamic: false,
        });
      })
      .catch((err: unknown) => {
        this.objectCellTextures.delete(key);
        throw err;
      });
    this.objectCellTextures.set(key, promise);
    return promise;
  }
}

/** Anything that can report its own set of "known page" `TextureSource`s
 * -- `AtlasPageLoader` (props/tiles) and `CompositePageSet` (story 2.7's
 * shared character composite pages) both implement this, so
 * [`countBoundAtlasPages`] can count either, or both together, without
 * caring which. */
export interface PageSourceProvider {
  pageSources(): ReadonlySet<TextureSource>;
}

/**
 * NFR12's own "simultaneously bound" fact: the number of distinct atlas
 * page `TextureSource`s actually reachable from `root`'s own display
 * list right now (Quentin's direction) -- never a loader's own request
 * count, which can't see a sprite that was later destroyed or one that
 * reached the tree some other way. Walks every descendant, `Sprite` or
 * not (a composite or a container can hold sprites at any depth).
 * `providers` is one or more source-providers (Story 2.7: a street's own
 * `AtlasPageLoader` plus its `CompositePageSet`, so a crowd's own shared
 * composite pages count towards the same NFR12 total as tile/prop
 * pages).
 */
export function countBoundAtlasPages(root: Container, ...providers: PageSourceProvider[]): number {
  const pageSources = new Set<TextureSource>();
  for (const provider of providers) {
    for (const source of provider.pageSources()) pageSources.add(source);
  }
  const found = new Set<TextureSource>();
  const stack: Container[] = [root];
  while (stack.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: length checked above
    const container = stack.pop()!;
    if (container instanceof Sprite && pageSources.has(container.texture.source)) {
      found.add(container.texture.source);
    }
    for (const child of container.children) {
      stack.push(child as Container);
    }
  }
  return found.size;
}

/**
 * Every distinct `TextureSource` reachable from `root`'s own display list
 * right now, *unfiltered* -- unlike [`countBoundAtlasPages`], never
 * narrowed to a caller-supplied set of "known page" sources (Quentin's
 * direction, story 2.7 cycle 1: a regression back to one standalone
 * texture per composited look would contribute nothing to the filtered
 * count, and the crowd-cost e2e proof would keep passing while the
 * regression it exists to catch had already landed). Counts every
 * `Sprite` at any depth, whatever texture it holds.
 */
export function countAllBoundTextureSources(root: Container): number {
  const found = new Set<TextureSource>();
  const stack: Container[] = [root];
  while (stack.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: length checked above
    const container = stack.pop()!;
    if (container instanceof Sprite) found.add(container.texture.source);
    for (const child of container.children) {
      stack.push(child as Container);
    }
  }
  return found.size;
}
