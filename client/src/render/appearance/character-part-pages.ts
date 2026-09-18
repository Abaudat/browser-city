// Story 2.7: replaces `part-sheets.ts`'s Epic-1 shortcut entirely -- the
// client fetches packed character-part *pages* (`tools/defs-build`'s own
// `character_body`/`character_eyes`/`character_hairstyle`/
// `character_outfit`/`character_accessory` groups), never a raw vendor
// per-part PNG (`scripts/ci/check-no-raw-part-sheets.sh` enforces this).
// A page is decoded once, shared by every part packed onto it
// (`ref-counted-cache.ts`), and never uploaded to the GPU: this loader
// imports no `pixi.js` (enforced by the same Biome restricted-import
// rule that protects `visibility.ts` -- `biome.json`), because a part
// page is only ever a CPU-side compositing source, never bound directly.
//
// Thin wiring over `ref-counted-cache.ts`'s own generic, tested
// bookkeeping and `atlas-pages.ts`'s own `atlasPageUrl` helper -- this
// file's only untested logic is the `fetch`/`createImageBitmap` calls
// themselves, a browser runtime concern a plain node unit test cannot
// exercise meaningfully, which is why it, alone, is excluded from the
// coverage gate (`client/vitest.config.ts`), the same way `part-sheets.ts`
// was.

import { atlasPageUrl } from "../atlas-url";
import { createRefCountedCache } from "./ref-counted-cache";

/** Fetches and decodes `file` (a packed character-part page's own
 * content-hashed filename, `defs.atlasPages[n].file`) as a CPU-side
 * `ImageBitmap`, `baseUrl`-relative -- no caching of its own,
 * `loadCharacterPage`/`test-street/compare-pipeline-vs-stack.ts`'s own,
 * entirely separate cache both call this as their `ref-counted-cache.ts`
 * `load`. Throws, naming the file, when the fetch itself fails. */
export async function fetchCharacterPageBitmap(
  baseUrl: string,
  file: string,
): Promise<ImageBitmap> {
  const response = await fetch(atlasPageUrl(baseUrl, file));
  if (!response.ok) {
    throw new Error(
      `character-part-pages: '${file}' fetch failed with ${response.status} ${response.statusText}`,
    );
  }
  const blob = await response.blob();
  return createImageBitmap(blob);
}

function closeBitmap(bitmap: ImageBitmap): void {
  bitmap.close();
}

/** One production loader, `baseUrl`-bound -- never through Pixi's
 * `Assets`/`Texture`: a character-part page is only ever a `drawImage`
 * source for the composite, and uploading every one of them to the GPU
 * as its own texture would defeat the point of compositing at all
 * (exactly `part-sheets.ts`'s own former reasoning, now over whole pages
 * instead of ~500 individual vendor sheets). A decoded page is only held
 * while at least one composite build is actively using it. */
export class CharacterPartPageLoader {
  private readonly cache: ReturnType<typeof createRefCountedCache<ImageBitmap>>;

  constructor(baseUrl: string) {
    this.cache = createRefCountedCache(
      (file) => fetchCharacterPageBitmap(baseUrl, file),
      closeBitmap,
    );
  }

  /** Every call must be paired with exactly one `release` once the
   * caller is done drawing from the bitmap -- `appearance-texture.ts` is
   * the one production caller, right after a look's own composite draw
   * finishes. */
  acquire(file: string): Promise<ImageBitmap> {
    return this.cache.acquire(file);
  }

  release(file: string, bitmap: ImageBitmap): void {
    this.cache.release(file, bitmap);
  }
}
