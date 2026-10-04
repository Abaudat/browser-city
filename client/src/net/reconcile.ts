// Story 4.8: a reconnect is a new connection with a new SDK cache whose
// initial apply re-inserts everything. This keeps what consumers hold in
// step: a re-insert of a held key is handed on as an update (or nothing when
// unchanged), and once the new region has applied, every row still tagged
// with an older generation is handed on as a delete. Never clear-and-reload.

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

export class GenerationStore<R> {
  private readonly held = new Map<string, { gen: number; row: R }>();

  constructor(private readonly keyOf: (row: R) => string) {}

  insert(gen: number, row: R): Reconciled<R> {
    const key = this.keyOf(row);
    const prev = this.held.get(key);
    this.held.set(key, { gen, row });
    if (!prev) return { kind: "insert" };
    return rowsEqual(prev.row, row) ? { kind: "none" } : { kind: "update", old: prev.row };
  }

  update(gen: number, row: R): void {
    this.held.set(this.keyOf(row), { gen, row });
  }

  remove(row: R): void {
    this.removeKey(this.keyOf(row));
  }

  removeKey(key: string): void {
    this.held.delete(key);
  }

  /** Forgets, and returns, every row tagged with a generation before `gen`. */
  sweep(gen: number): R[] {
    const out: R[] = [];
    for (const [key, entry] of this.held) {
      if (entry.gen >= gen) continue;
      out.push(entry.row);
      this.held.delete(key);
    }
    return out;
  }

  size(): number {
    return this.held.size;
  }
}
