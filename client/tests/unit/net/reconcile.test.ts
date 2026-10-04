// Story 4.8: a new connection re-applies everything; consumers must see one
// continuous world -- re-inserts become updates, vanished rows become deletes.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { reconcileInsert, rowsEqual, unseenRows } from "../../../src/net/reconcile";

describe("reconcileInsert", () => {
  it("a key nobody holds is an insert", () => {
    expect(reconcileInsert(undefined, { id: 1 })).toEqual({ kind: "insert" });
  });

  it("a held key with a different row is an update carrying the held row", () => {
    expect(reconcileInsert({ id: 1, v: 1 }, { id: 1, v: 2 })).toEqual({
      kind: "update",
      old: { id: 1, v: 1 },
    });
  });

  it("an unchanged row raises nothing", () => {
    expect(reconcileInsert({ id: 1, v: 1 }, { id: 1, v: 1 })).toEqual({ kind: "none" });
  });
});

describe("unseenRows", () => {
  it("removals are exactly the held set minus the newly seen one", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 40 }), { maxLength: 41 }),
        fc.uniqueArray(fc.integer({ min: 0, max: 40 }), { maxLength: 41 }),
        (heldIds, seenIds) => {
          const held = new Map(heldIds.map((i) => [String(i), { id: i }]));
          const removed = unseenRows(held, new Set(seenIds.map(String))).map((r) => r.id);
          expect(removed.sort()).toEqual(heldIds.filter((i) => !seenIds.includes(i)).sort());
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
