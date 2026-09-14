// Story 1.10 (Tim's direction): resolves a part's `sheet` (a repo-relative
// path under `ModernTileset/`, as declared in `defs/appearance/`) to a
// hashed, lazily-fetched URL via `import.meta.glob` -- Vite only emits and
// fetches a sheet once some citizen on screen actually references it,
// never the whole ~14 MB catalogue up front. Excluded from the coverage
// gate (`client/vitest.config.ts`): `import.meta.glob` and `Assets.load`
// are both Vite/Pixi runtime concerns a plain node unit test cannot
// exercise meaningfully.

import { Assets, type Texture } from "pixi.js";

// The five part folders this story's generator draws from, plus the
// exterior add-ons a uniform override can reference (Artie's direction) --
// never a wider glob than this list, so `render/appearance/**` cannot
// accidentally start eagerly bundling unrelated tileset art.
const SHEET_MODULES = import.meta.glob(
  [
    "/../../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Bodies/**/*.png",
    "/../../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Bodies_kids/**/*.png",
    "/../../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Eyes/**/*.png",
    "/../../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Eyes_kids/**/*.png",
    "/../../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Hairstyles/**/*.png",
    "/../../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Hairstyles_kids/**/*.png",
    "/../../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Outfits/**/*.png",
    "/../../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Outfits_kids/**/*.png",
    "/../../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/Accessories/**/*.png",
    "/../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/Character_Generator_Addons_16x16/*.png",
  ],
  { query: "?url", import: "default", eager: false },
) as Record<string, () => Promise<string>>;

/** `sheet` is `defs/appearance/`'s own repo-relative path, e.g.
 * `ModernTileset/moderninteriors-win/2_Characters/Character_Generator/
 * Bodies/16x16/Body_01.png`. Resolves it to the matching glob entry --
 * relative to this file, two directories up from `client/src/render/
 * appearance/` reaches the repo root, matching the glob patterns above. */
function moduleKeyFor(sheet: string): string {
  return `/../../${sheet}`;
}

/** Fetches `sheet`'s URL (Vite emits and hashes it lazily, the first time
 * this is called for that path) and loads it through Pixi's shared
 * `Assets` cache, so two parts naming the same sheet never fetch it
 * twice. Throws, naming the path, when `sheet` matches none of the glob
 * patterns above -- a defs-authoring mistake, not a silent blank
 * texture. */
export async function loadPartTexture(sheet: string): Promise<Texture> {
  const key = moduleKeyFor(sheet);
  const loader = SHEET_MODULES[key];
  if (!loader) {
    throw new Error(`part-sheets: '${sheet}' is not under a known character-part folder`);
  }
  const url = await loader();
  return Assets.load<Texture>(url);
}
