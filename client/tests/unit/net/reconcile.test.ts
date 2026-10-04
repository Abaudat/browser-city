// Story 4.8: a new connection re-applies everything; consumers must see one
// continuous world -- re-inserts become updates, vanished rows become deletes.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GenerationStore, rowsEqual } from "../../../src/net/reconcile";

interface Row {
  id: number;
  v: number;
}

const store = () => new GenerationStore<Row>((r) => String(r.id));

describe("GenerationStore", () => {
  it("hands a first insert on as an insert", () => {
    expect(store().insert(1, { id: 1, v: 1 })).toEqual({ kind: "insert" });
  });

  it("hands a re-insert of a held key on as an update with the held row", () => {
    const s = store();
    s.insert(1, { id: 1, v: 1 });
    expect(s.insert(2, { id: 1, v: 2 })).toEqual({ kind: "update", old: { id: 1, v: 1 } });
  });

  it("raises nothing for a re-insert of an unchanged row, but still re-tags it", () => {
    const s = store();
    s.insert(1, { id: 1, v: 1 });
    expect(s.insert(2, { id: 1, v: 1 })).toEqual({ kind: "none" });
    expect(s.sweep(2)).toEqual([]);
  });

  it("sweeps exactly the rows an older generation left behind", () => {
    const s = store();
    s.insert(1, { id: 1, v: 1 });
    s.insert(1, { id: 2, v: 1 });
    s.insert(2, { id: 2, v: 1 });
    s.insert(2, { id: 3, v: 1 });
    expect(s.sweep(2)).toEqual([{ id: 1, v: 1 }]);
    expect(s.size()).toBe(2);
  });

  it("forgets a deleted row, and tolerates a delete of an unknown one", () => {
    const s = store();
    s.insert(1, { id: 1, v: 1 });
    s.remove({ id: 1, v: 1 });
    s.remove({ id: 9, v: 1 });
    expect(s.size()).toBe(0);
  });

  it("an update re-tags the row with the current generation", () => {
    const s = store();
    s.insert(1, { id: 1, v: 1 });
    s.update(2, { id: 1, v: 5 });
    expect(s.sweep(2)).toEqual([]);
  });
});

describe("sweep as a property", () => {
  it("removals are exactly the old set minus the newly applied one", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 40 }), { maxLength: 41 }),
        fc.uniqueArray(fc.integer({ min: 0, max: 40 }), { maxLength: 41 }),
        (oldIds, newIds) => {
          const s = store();
          for (const id of oldIds) s.insert(1, { id, v: 0 });
          for (const id of newIds) s.insert(2, { id, v: 0 });
          const removed = s.sweep(2).map((r) => r.id);
          expect(removed.sort()).toEqual(oldIds.filter((i) => !newIds.includes(i)).sort());
          expect(s.size()).toBe(newIds.length);
        },
      ),
    );
  });
});

describe("rowsEqual", () => {
  it("compares primitives, bigints, arrays and nested objects structurally", () => {
    expect(rowsEqual({ a: 1n, b: [1, { c: "x" }] }, { a: 1n, b: [1, { c: "x" }] })).toBe(true);
    expect(rowsEqual({ a: 1n }, { a: 2n })).toBe(false);
    expect(rowsEqual({ a: [1] }, { a: [1, 2] })).toBe(false);
    expect(rowsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(rowsEqual({ a: null }, { a: { b: 1 } })).toBe(false);
    expect(rowsEqual({ a: { b: 1 } }, { a: null })).toBe(false);
    expect(rowsEqual({ a: [1] }, { a: { 0: 1 } })).toBe(false);
  });
});
