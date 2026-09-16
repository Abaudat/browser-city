// Story 2.6: the client's one reader for tools/defs-build's own atlas
// packer -- loads a packed page only on first demand (Pixi `Assets.load`,
// nearest-neighbour sampling, mipmaps off) and crops each object's own
// `atlas` rect from it (`new Texture({ source, frame })`, a plain crop --
// the render-to-texture construct docs/architecture.md's "Visibility"
// section bans anywhere under `client/src/` is never used here).
// Excluded from the coverage gate
// (`client/vitest.config.ts`), like `appearance-texture.ts`: a thin
// adapter over `Assets.load`, which needs a real browser Image-decode
// runtime no node test environment provides. `atlasFrameRect` below is
// this module's only pure logic, and it is tested directly.

import { Assets, Rectangle, Texture } from "pixi.js";
import type { AtlasPageDef, Defs, ObjectDef } from "../defs/types";
import { atlasFrameRect } from "./atlas-frame";

/**
 * One shared cache of page `Texture`s, keyed by filename -- a page is
 * decoded at most once no matter how many objects resolve against it,
 * and never preloaded: a page loads only the first time a caller asks
 * for a texture that resolves to it.
 */
export class AtlasPageLoader {
  private readonly baseUrl: string;
  private readonly cache = new Map<string, Promise<Texture>>();

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

  private pageTexture(page: AtlasPageDef): Promise<Texture> {
    let promise = this.cache.get(page.file);
    if (!promise) {
      promise = Assets.load<Texture>(`${this.baseUrl}${page.file}`).then((texture) => {
        texture.source.scaleMode = "nearest";
        texture.source.autoGenerateMipmaps = false;
        return texture;
      });
      this.cache.set(page.file, promise);
    }
    return promise;
  }

  /**
   * The cropped `Texture` for one object's own atlas rect -- a fresh,
   * cheap `Texture` per call (it only ever shares the page's own
   * `TextureSource`): a caller destroys it (without
   * `destroyTextureSource: true`) whenever its own drawable goes away,
   * never this loader's shared page texture underneath it.
   */
  async objectTexture(defs: Defs, object: ObjectDef): Promise<Texture> {
    const page = defs.atlasPages[object.atlas.page];
    if (!page) {
      throw new Error(
        `atlas-pages: object '${object.key}' names atlas page ${object.atlas.page}, but defs only has ${defs.atlasPages.length} page(s)`,
      );
    }
    const source = (await this.pageTexture(page)).source;
    const cell = atlasFrameRect(object.atlas);
    const frame = new Rectangle(cell.x, cell.y, cell.width, cell.height);
    return new Texture({ source, frame, dynamic: false });
  }
}
