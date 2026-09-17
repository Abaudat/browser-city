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

import { Assets, Rectangle, Texture } from "pixi.js";
import type { AtlasPageDef, Defs, ObjectDef } from "../defs/types";
import { atlasFrameRect } from "./atlas-frame";

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
   * How many distinct pages this loader has actually resolved a demand
   * for so far -- NFR12's own "simultaneously bound" count, read by a
   * caller that wants to assert how many atlas pages the current scene
   * actually binds (never every page `defs.atlasPages` declares, only
   * the ones something on screen resolved to).
   */
  boundPageCount(): number {
    return this.pages.size;
  }

  private pageTexture(page: AtlasPageDef): Promise<Texture> {
    let promise = this.pages.get(page.file);
    if (!promise) {
      promise = Assets.load<Texture>(`${this.baseUrl}${page.file}`)
        .then((texture) => {
          texture.source.scaleMode = "nearest";
          texture.source.autoGenerateMipmaps = false;
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
}
