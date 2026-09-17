// The one place a packed atlas page's own URL is built, `baseUrl`-
// relative -- `atlas-pages.ts`'s `AtlasPageLoader` and
// `appearance/character-part-pages.ts`'s own page loader both resolve
// through this (Tim's direction, story 2.7). No `pixi.js` import here on
// purpose: `character-part-pages.ts` must never touch Pixi at all, so
// this tiny shared helper stays free of it too, rather than pulling it
// in transitively through `atlas-pages.ts`.

export function atlasPageUrl(baseUrl: string, file: string): string {
  return `${baseUrl}${file}`;
}
