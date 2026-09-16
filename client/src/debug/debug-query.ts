// `?debug=collision,sort` -- the whole activation surface, parsed purely
// (story 1.12, Tim's direction). Exactly the `freezeCrowd` idiom already
// in `main.ts`: a URL query read once, inside the DEV-only branch. An
// unknown id is ignored with a warning naming the ones that exist, never
// an error -- a stale bookmark must never stop the game from booting.
//
// The query selects *which* overlay, and only inside the DEV branch: it
// is never the gate itself. In a production build there is no debug chunk
// for any query string to reach (`main.ts`).

/** What a `?debug=` query asked for, split into what exists and what does
 * not. */
export interface DebugQuery {
  /** Ids that name a registered overlay, in the order written, with
   * duplicates and blanks dropped. */
  readonly ids: readonly string[];
  /** Ids that name nothing -- reported, never activated. */
  readonly unknown: readonly string[];
  /** Whether `debug` appeared at all. `?debug=` with no value is a
   * present-but-empty selection, not an absent one. */
  readonly present: boolean;
}

export function parseDebugQuery(search: string, knownIds: readonly string[]): DebugQuery {
  const value = new URLSearchParams(search).get("debug");
  if (value === null) return { ids: [], unknown: [], present: false };

  const known = new Set(knownIds);
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const raw of value.split(",")) {
    const id = raw.trim();
    if (id === "") continue;
    if (!known.has(id)) {
      if (!unknown.includes(id)) unknown.push(id);
      continue;
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return { ids, unknown, present: true };
}

/** The warning text for a query naming overlays that do not exist -- one
 * message, listing what there is, so the next thing a developer types is
 * right. */
export function unknownOverlayWarning(
  unknown: readonly string[],
  knownIds: readonly string[],
): string {
  return `[debug] no such overlay: ${unknown.join(", ")} -- known overlays: ${knownIds.join(", ")}`;
}
