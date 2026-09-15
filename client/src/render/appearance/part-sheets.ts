// Resolves a part's `sheet` (a repo-relative path under `ModernTileset/`,
// as declared in `defs/appearance/`) to a hashed, lazily-fetched URL via
// `import.meta.glob` -- Vite only emits and fetches a sheet once some
// citizen on screen actually references it, never the whole catalogue up
// front. Thin wiring over `ref-counted-cache.ts`'s own generic, tested
// bookkeeping: this file's only untested logic is the glob lookup and the
// `fetch`/`createImageBitmap` calls themselves, both Vite/browser runtime
// concerns a plain node unit test cannot exercise meaningfully -- which is
// why it, alone, is excluded from the coverage gate
// (`client/vitest.config.ts`).

import { createRefCountedCache } from "./ref-counted-cache";

// The five part folders the generator draws from, plus the exterior
// add-ons a uniform override can reference -- never a wider glob than
// this list, so `render/appearance/**` cannot accidentally start eagerly
// bundling unrelated tileset art. A glob path starting with `/` resolves
// relative to Vite's project root (`client/`), not to this file's own
// directory: one `/..` reaches the repo root from there.
const SHEET_MODULES = import.meta.glob(
  [
    "/../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Bodies/**/*.png",
    "/../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Bodies_kids/**/*.png",
    "/../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Eyes/**/*.png",
    "/../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Eyes_kids/**/*.png",
    "/../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Hairstyles/**/*.png",
    "/../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Hairstyles_kids/**/*.png",
    "/../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Outfits/**/*.png",
    "/../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Outfits_kids/**/*.png",
    "/../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Accessories/**/*.png",
    "/../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/Character_Generator_Addons_16x16/*.png",
  ],
  { query: "?url", import: "default", eager: false },
) as Record<string, () => Promise<string>>;

/** `sheet` is `defs/appearance/`'s own repo-relative path, e.g.
 * `ModernTileset/moderninteriors-win/2_Characters/Character_Generator/
 * Bodies/16x16/Body_01.png`. Resolves it to the matching glob entry --
 * `import.meta.glob`'s own produced keys for a pattern that resolves
 * outside the project root drop the leading `/` the pattern itself
 * needed (confirmed against the real dev-server-served module: the key
 * is `../ModernTileset/...`, never `/../ModernTileset/...`), so this is
 * not simply the glob pattern's own `/../` prefix restated. */
function moduleKeyFor(sheet: string): string {
  return `../${sheet}`;
}

/** Fetches and decodes `sheet` as a CPU-side `ImageBitmap`, with no
 * caching of its own -- `loadPartImage` below and `test-street/compare-pipeline-
 * vs-stack.ts`'s own, entirely separate cache both call this as their
 * `ref-counted-cache.ts` `load`. Throws, naming the path, when `sheet`
 * matches none of the glob patterns above (a defs-authoring mistake, not
 * a silent blank layer) or when the fetch itself fails. */
export async function fetchPartBitmap(sheet: string): Promise<ImageBitmap> {
  const loader = SHEET_MODULES[moduleKeyFor(sheet)];
  if (!loader) {
    throw new Error(`part-sheets: '${sheet}' is not under a known character-part folder`);
  }
  const url = await loader();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `part-sheets: '${sheet}' fetch failed with ${response.status} ${response.statusText}`,
    );
  }
  const blob = await response.blob();
  return createImageBitmap(blob);
}

function closeBitmap(bitmap: ImageBitmap): void {
  bitmap.close();
}

// Never through Pixi's `Assets`/`Texture`: a vendor sheet is only ever a
// `drawImage` source for the composite, and uploading all ~500 of them to
// the GPU as textures (the one cost this whole module exists to avoid)
// would defeat the point of compositing at all. A decoded bitmap is only
// held while at least one composite build is actively using it -- a
// decoded 896x656 sheet is ~2.3MB of RGBA, and a long session can
// reference hundreds of distinct sheets; the browser's own HTTP cache
// already makes a later refetch cheap.
const cache = createRefCountedCache(fetchPartBitmap, closeBitmap);

/** Every call must be paired with exactly one `releasePartImage` once the
 * caller is done drawing from the bitmap -- `appearance-texture.ts` is
 * the one production caller, right after `buildCompositeCanvas`
 * returns. */
export function loadPartImage(sheet: string): Promise<ImageBitmap> {
  return cache.acquire(sheet);
}

/** Releases one reference on `sheet`, taken by the matching
 * `loadPartImage` call. */
export function releasePartImage(sheet: string, bitmap: ImageBitmap): void {
  cache.release(sheet, bitmap);
}
