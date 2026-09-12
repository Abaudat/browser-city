// The one client-side mirror of `sim::codes::layer` (Quentin/Tim, story
// 1.6 cycle 2): every other place in this client that used to hand-copy
// a code, a name, a rank or the deprecated set now imports this table
// instead. `scripts/ci/check-layer-table-current.sh` parses
// `server/sim/tests/goldens/codes_v1.golden`'s `layer` rows and fails the
// build if this table disagrees with it on any code, name, rank or
// deprecation -- a hand-maintained copy with no guard is exactly what
// this story does not get away with a second time.
//
// There is still no live `layer_code` subscription in this story (Tim's
// scope call) -- this table is what a caller reaches for until one
// exists, and it is what the demo scene resolves ranks through
// (`layer-ranks.ts`'s `buildLayerRankTable`), never a second set of
// literals next to it.

export interface LayerTableRow {
  readonly code: number;
  readonly name: string;
  readonly rank: number;
  readonly deprecated: boolean;
}

/** Mirrors `server/sim/tests/goldens/codes_v1.golden`'s `layer` rows
 * exactly, in the same order. `check-layer-table-current.sh` is what
 * makes that a checked fact rather than a claim. */
export const LAYER_TABLE: readonly LayerTableRow[] = [
  { code: 0, name: "ground", rank: 0, deprecated: false },
  { code: 1, name: "overhead", rank: 1, deprecated: true },
  { code: 2, name: "furniture", rank: 10, deprecated: false },
  { code: 3, name: "objects", rank: 20, deprecated: false },
  { code: 4, name: "walls", rank: 30, deprecated: false },
  { code: 5, name: "wall_decals", rank: 40, deprecated: false },
  { code: 6, name: "characters", rank: 50, deprecated: false },
];

/** Codes [`LAYER_TABLE`] marks deprecated -- the client-side mirror of
 * `sim::codes::layer::DEPRECATED_CODES`. */
export const DEPRECATED_LAYER_CODES: ReadonlySet<number> = new Set(
  LAYER_TABLE.filter((row) => row.deprecated).map((row) => row.code),
);

/** Looks up a live (non-deprecated) code by its layer name -- what a
 * caller building drawables from a name-keyed source (the demo fixture)
 * uses instead of typing a code number by hand. Throws for an unknown or
 * deprecated name, same refusal posture as `layer-ranks.ts`'s
 * `resolveRank`. */
export function layerCodeByName(name: string): number {
  const row = LAYER_TABLE.find((r) => r.name === name && !r.deprecated);
  if (!row) {
    throw new Error(`layerCodeByName: '${name}' is not a known, live layer name`);
  }
  return row.code;
}
