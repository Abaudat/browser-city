// FR123's rank source (Tim/Quentin, story 1.6): the client never holds a
// second hand-maintained copy of `sim::codes::layer`'s tens ranks. This
// module builds a lookup from the `layer_code` rows the connection
// subscribes to (the same shape `net/bindings` generates from the
// server's schema; this module takes a plain, minimal shape rather than
// importing the SDK type, so it stays testable with fabricated data and
// so `sort-key.ts`'s "zero net/bindings imports" rule is never even a
// question for the modules next to it) -- never a rank typed in here by
// hand. Pure, zero PixiJS.

import { DEPRECATED_LAYER_CODES } from "./layer-table";

/** The `layer_code` row shape this module needs -- a structural subset of
 * `net/bindings`'s generated `LayerCode`, so a caller can pass the real
 * subscribed rows directly without an adapter. */
export interface LayerCodeRow {
  readonly code: number;
  readonly rank: number;
}

/** Builds the live code-to-rank lookup from subscribed `layer_code` rows.
 * A deprecated code's row is dropped rather than included -- it must
 * never be resolvable, not even to its own frozen rank. */
export function buildLayerRankTable(rows: readonly LayerCodeRow[]): ReadonlyMap<number, number> {
  const table = new Map<number, number>();
  for (const row of rows) {
    if (DEPRECATED_LAYER_CODES.has(row.code)) continue;
    table.set(row.code, row.rank);
  }
  return table;
}

export class UnknownLayerCodeError extends Error {
  constructor(public readonly code: number) {
    super(`layer code ${code} is unknown or deprecated -- refusing to sort it silently`);
    this.name = "UnknownLayerCodeError";
  }
}

/** The rank for a live layer `code`, or throws [`UnknownLayerCodeError`]
 * for a code the table has no row for (never seen, or deprecated and
 * dropped by [`buildLayerRankTable`]) -- never a silent fallback rank,
 * which is exactly how an unknown layer would otherwise sort at a fixed,
 * wrong position forever. */
export function resolveRank(table: ReadonlyMap<number, number>, code: number): number {
  const rank = table.get(code);
  if (rank === undefined) {
    throw new UnknownLayerCodeError(code);
  }
  return rank;
}
