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

interface ImageCacheEntry {
  readonly promise: Promise<ImageBitmap>;
  refCount: number;
}

// Keyed by `sheet`, ref-counted -- a decoded bitmap is only ever held
// while at least one composite build is actively using it, never cached
// beyond that (a decoded 896x656 sheet is ~2.3MB of RGBA, and a long
// session can reference hundreds of distinct sheets; the browser's own
// HTTP cache already makes a later refetch cheap). Two callers asking for
// the same sheet while it is still in flight share one fetch+decode;
// `releasePartImage` is the other half of this contract.
const imageCache = new Map<string, ImageCacheEntry>();

/** Loads `sheet` as a CPU-side `ImageBitmap` -- never through Pixi's
 * `Assets`/`Texture`: a vendor sheet is only ever a `drawImage` source
 * for the composite, and uploading all ~500 of them to the GPU as
 * textures (the one cost this whole module exists to avoid) would defeat
 * the point of compositing at all. Throws, naming the path, when `sheet`
 * matches none of the glob patterns above -- a defs-authoring mistake,
 * not a silent blank layer. Every call must be paired with exactly one
 * `releasePartImage` once the caller is done drawing from the bitmap --
 * `appearance-texture.ts` is the one caller, right after
 * `buildCompositeCanvas` returns. */
export function loadPartImage(sheet: string): Promise<ImageBitmap> {
  let entry = imageCache.get(sheet);
  if (!entry) {
    const loader = SHEET_MODULES[moduleKeyFor(sheet)];
    if (!loader) {
      throw new Error(`part-sheets: '${sheet}' is not under a known character-part folder`);
    }
    const promise = (async () => {
      const url = await loader();
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `part-sheets: '${sheet}' fetch failed with ${response.status} ${response.statusText}`,
        );
      }
      const blob = await response.blob();
      return createImageBitmap(blob);
    })();
    entry = { promise, refCount: 0 };
    imageCache.set(sheet, entry);
    // A rejected fetch/decode must never poison this sheet for the rest
    // of the session -- a later caller gets a fresh attempt, not the same
    // dead promise. Every already-registered caller still observes the
    // rejection through their own reference to this same promise.
    promise.catch(() => {
      if (imageCache.get(sheet) === entry) imageCache.delete(sheet);
    });
  }
  entry.refCount += 1;
  return entry.promise;
}

/** Releases one reference on `sheet`, taken by the matching
 * `loadPartImage` call. Once every caller that shared the in-flight
 * bitmap has released it, the bitmap is `close()`d and its cache entry
 * dropped. A release for a sheet whose load already failed (and was
 * therefore already evicted above) is a no-op. */
export function releasePartImage(sheet: string, bitmap: ImageBitmap): void {
  const entry = imageCache.get(sheet);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    imageCache.delete(sheet);
    bitmap.close();
  }
}
