// Story 4.8: a reconnect is a new connection with a new SDK cache whose
// initial apply re-inserts everything. While the new connection's initial
// region applies, the superseded connection's cache says what consumers
// already hold: a re-insert of a held key is handed on as an update (nothing
// when unchanged), and afterwards each held key the new cache did not bring
// back is handed on as a delete. Never clear-and-reload. Pure: two lookups
// in, decisions out.

/** Structural equality of two rows (primitives, bigints, arrays, plain and
 * class-instance objects such as SDK timestamps). */
export function rowsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    rowsEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

export type Reconciled<R> =
  | { readonly kind: "insert" }
  | { readonly kind: "update"; readonly old: R }
  | { readonly kind: "none" };

/** What an arriving row means to a consumer that holds `held` for its key. */
export function reconcileInsert<R>(held: R | undefined, row: R): Reconciled<R> {
  if (held === undefined) return { kind: "insert" };
  return rowsEqual(held, row) ? { kind: "none" } : { kind: "update", old: held };
}

/** Held rows whose key the new connection did not bring back (or delete). */
export function unseenRows<R>(held: ReadonlyMap<string, R>, seen: ReadonlySet<string>): R[] {
  const out: R[] = [];
  for (const [key, row] of held) if (!seen.has(key)) out.push(row);
  return out;
}
