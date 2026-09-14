// Resolves a part's `sheet` (a repo-relative path under `ModernTileset/`,
// as declared in `defs/appearance/`) to a hashed, lazily-fetched URL via
// `import.meta.glob` -- Vite only emits and fetches a sheet once some
// citizen on screen actually references it, never the whole catalogue up
// front. Excluded from the coverage gate (`client/vitest.config.ts`):
// `import.meta.glob` and `fetch`/`createImageBitmap` are both Vite/browser
// runtime concerns a plain node unit test cannot exercise meaningfully.

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

// Keyed by `sheet`, not by URL: two parts naming the same sheet share one
// in-flight (or already-resolved) fetch+decode, never fetching or
// decoding it twice. Holds the promise, not just the result, so
// concurrent callers before the first decode finishes still share it.
const imageCache = new Map<string, Promise<ImageBitmap>>();

/** Loads `sheet` as a CPU-side `ImageBitmap` -- never through Pixi's
 * `Assets`/`Texture`: a vendor sheet is only ever a `drawImage` source
 * for the composite, and uploading all ~500 of them to the GPU as
 * textures (the one cost this whole module exists to avoid) would defeat
 * the point of compositing at all. Throws, naming the path, when `sheet`
 * matches none of the glob patterns above -- a defs-authoring mistake,
 * not a silent blank layer. */
export function loadPartImage(sheet: string): Promise<ImageBitmap> {
  const cached = imageCache.get(sheet);
  if (cached) return cached;

  const loader = SHEET_MODULES[moduleKeyFor(sheet)];
  if (!loader) {
    throw new Error(`part-sheets: '${sheet}' is not under a known character-part folder`);
  }

  const promise = (async () => {
    const url = await loader();
    const response = await fetch(url);
    const blob = await response.blob();
    return createImageBitmap(blob);
  })();
  imageCache.set(sheet, promise);
  return promise;
}
