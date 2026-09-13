import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ColliderSource } from "../../../src/world/collision-grid";
import { CollisionGrid } from "../../../src/world/collision-grid";

const SUBCELLS_PER_CELL = 16;

interface Row {
  readonly objectId: bigint;
  readonly defId: number;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly layer: number;
  readonly orientation: number;
  readonly chunkKey: bigint;
}

function row(overrides: Partial<Row> & { objectId: bigint }): Row {
  return {
    defId: 1,
    x: 0,
    y: 0,
    floor: 0,
    layer: 0,
    orientation: 0,
    chunkKey: 0n,
    ...overrides,
  };
}

const DEF_WITH_COLLIDER: ColliderSource = {
  width: 1,
  height: 1,
  collider: { x0: 4, y0: 4, x1: 12, y1: 12 },
};
const DEF_WITHOUT_COLLIDER: ColliderSource = { width: 1, height: 1 };

function gridWith(defs: ReadonlyMap<number, ColliderSource>): CollisionGrid {
  return new CollisionGrid(SUBCELLS_PER_CELL, defs);
}

describe("CollisionGrid", () => {
  // A def with no collider contributes nothing on insert or delete.
  it("inv_absent_collider_is_walkable", () => {
    const grid = gridWith(new Map([[1, DEF_WITHOUT_COLLIDER]]));
    const r = row({ objectId: 1n, x: 0, y: 0 });
    grid.insert(r);
    expect(grid.entriesInCell(0, 0, 0)).toEqual([]);
    grid.delete(r);
    expect(grid.entriesInCell(0, 0, 0)).toEqual([]);
  });

  it("an unresolvable defId is treated the same as an absent collider", () => {
    const grid = gridWith(new Map());
    grid.insert(row({ objectId: 1n, defId: 999 }));
    expect(grid.entriesInCell(0, 0, 0)).toEqual([]);
  });

  it("inserts a whole-cell collider into exactly the one cell it occupies", () => {
    const wholeCell: ColliderSource = {
      width: 1,
      height: 1,
      collider: { x0: 0, y0: 0, x1: 16, y1: 16 },
    };
    const grid = gridWith(new Map([[1, wholeCell]]));
    grid.insert(row({ objectId: 5n, x: 3, y: 2 }));
    expect(grid.entriesInCell(0, 3, 2)).toHaveLength(1);
    expect(grid.entriesInCell(0, 3, 2)[0]?.objectId).toBe(5n);
    expect(grid.entriesInCell(0, 4, 2)).toEqual([]);
    expect(grid.entriesInCell(0, 2, 2)).toEqual([]);
  });

  it("the lamppost worked example: a sub-cell collider only occupies its own cell, with a rect narrower than the cell", () => {
    const grid = gridWith(new Map([[1, DEF_WITH_COLLIDER]]));
    grid.insert(row({ objectId: 1n, x: 5, y: 5 }));
    const entries = grid.entriesInCell(0, 5, 5);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.rect).toEqual({ x0: 84, y0: 84, x1: 92, y1: 92 });
  });

  it("a collider overhanging a chunk edge is rasterised into every cell it overlaps, across chunks", () => {
    // CHUNK_SIZE is 32; a 2-wide collider anchored at cell (31, 0) covers
    // cells (31, 0) in chunk (0,0) and (32, 0) in chunk (1, 0).
    const twoWide: ColliderSource = {
      width: 2,
      height: 1,
      collider: { x0: 0, y0: 0, x1: 32, y1: 16 },
    };
    const grid = gridWith(new Map([[1, twoWide]]));
    grid.insert(row({ objectId: 9n, x: 31, y: 0 }));
    expect(grid.entriesInCell(0, 31, 0)).toHaveLength(1);
    expect(grid.entriesInCell(0, 32, 0)).toHaveLength(1);
  });

  it("deleting one of two overlapping colliders never unblocks the space the other still covers", () => {
    const grid = gridWith(
      new Map([
        [1, DEF_WITH_COLLIDER],
        [2, DEF_WITH_COLLIDER],
      ]),
    );
    const a = row({ objectId: 1n, defId: 1, x: 5, y: 5 });
    const b = row({ objectId: 2n, defId: 2, x: 5, y: 5 });
    grid.insert(a);
    grid.insert(b);
    grid.delete(a);
    expect(grid.entriesInCell(0, 5, 5)).toHaveLength(1);
    expect(grid.entriesInCell(0, 5, 5)[0]?.objectId).toBe(2n);
  });

  it("update is delete then insert", () => {
    const grid = gridWith(new Map([[1, DEF_WITH_COLLIDER]]));
    const before = row({ objectId: 1n, x: 5, y: 5 });
    const after = row({ objectId: 1n, x: 8, y: 8 });
    grid.insert(before);
    grid.update(before, after);
    expect(grid.entriesInCell(0, 5, 5)).toEqual([]);
    expect(grid.entriesInCell(0, 8, 8)).toHaveLength(1);
  });

  it("a floor's set is independent of every other floor (FR117)", () => {
    const grid = gridWith(new Map([[1, DEF_WITH_COLLIDER]]));
    grid.insert(row({ objectId: 1n, x: 5, y: 5, floor: 0 }));
    expect(grid.entriesInCell(1, 5, 5)).toEqual([]);
  });

  it("deleting a row that was never inserted is a no-op, not a throw", () => {
    const grid = gridWith(new Map([[1, DEF_WITH_COLLIDER]]));
    expect(() => grid.delete(row({ objectId: 42n, x: 9, y: 9 }))).not.toThrow();
    // Even for a floor/cell where something else does exist.
    grid.insert(row({ objectId: 1n, x: 5, y: 5 }));
    expect(() => grid.delete(row({ objectId: 42n, x: 5, y: 5 }))).not.toThrow();
    expect(grid.entriesInCell(0, 5, 5)).toHaveLength(1);
    // A chunk that exists (because a neighbouring cell has an entry) but
    // whose own slot for this cell is empty.
    expect(() => grid.delete(row({ objectId: 42n, x: 6, y: 5 }))).not.toThrow();
  });

  it("throws on a non-zero orientation, rather than silently using an unrotated collider", () => {
    const grid = gridWith(new Map([[1, DEF_WITH_COLLIDER]]));
    expect(() => grid.insert(row({ objectId: 1n, orientation: 1 }))).toThrow(/orientation/);
  });
});

describe("inv_collision_grid_matches_rebuild", () => {
  // Three kinds of def, because a `delete` that used the wrong def could
  // not be caught by one: no collider at all, a collider inside one cell,
  // and one wide enough to overhang a chunk edge.
  const NO_COLLIDER_DEF = 1;
  const SUB_CELL_DEF = 2;
  const MULTI_CELL_DEF = 3;
  const objectDefs = new Map<number, ColliderSource>([
    [NO_COLLIDER_DEF, DEF_WITHOUT_COLLIDER],
    [SUB_CELL_DEF, DEF_WITH_COLLIDER],
    [
      MULTI_CELL_DEF,
      { width: 3, height: 2, collider: { x0: 4, y0: 0, x1: 3 * 16, y1: 2 * 16 - 3 } },
    ],
  ]);
  const defIdArb = fc.constantFrom(NO_COLLIDER_DEF, SUB_CELL_DEF, MULTI_CELL_DEF);
  const floorArb = fc.constantFrom(-1, 0, 1);
  // Straddling a chunk boundary (CHUNK_SIZE is 32) on both signs, so an
  // insert or delete that got the chunk key wrong shows up.
  const coordArb = fc.integer({ min: -33, max: 33 });

  const rowArb = fc.record({
    objectId: fc.integer({ min: 1, max: 6 }).map(BigInt),
    x: coordArb,
    y: coordArb,
    floor: floorArb,
    defId: defIdArb,
  });

  function gridOf(rows: Iterable<Row>): CollisionGrid {
    const grid = gridWith(objectDefs);
    for (const r of rows) grid.insert(r);
    return grid;
  }

  /** Full entries -- object id *and* rect -- across every floor in play,
   * plus the grid's own allocated-chunk count, so "identical to a fresh
   * build" covers storage shape and not only query answers. */
  function snapshot(grid: CollisionGrid): unknown {
    const cells: unknown[] = [];
    for (const floor of [-1, 0, 1]) {
      for (let x = -35; x <= 36; x++) {
        for (let y = -35; y <= 36; y++) {
          const entries = [...grid.entriesInCell(floor, x, y)]
            .map((e) => `${e.objectId}@${e.rect.x0},${e.rect.y0},${e.rect.x1},${e.rect.y1}`)
            .sort();
          if (entries.length > 0) cells.push([floor, x, y, entries]);
        }
      }
    }
    return { cells, allocatedChunks: grid.allocatedChunkCount() };
  }

  // A sequence of random insert/delete/update calls always equals a
  // fresh build of the survivors -- including which chunks are allocated,
  // so a grid that never frees an emptied chunk fails here.
  it("inv_collision_grid_matches_rebuild", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({ kind: fc.constant("insert" as const), row: rowArb }),
            fc.record({
              kind: fc.constant("delete" as const),
              objectId: fc.integer({ min: 1, max: 6 }).map(BigInt),
            }),
            fc.record({ kind: fc.constant("update" as const), row: rowArb }),
          ),
          { maxLength: 40 },
        ),
        (ops) => {
          const grid = gridWith(objectDefs);
          const survivors = new Map<bigint, Row>();
          for (const op of ops) {
            if (op.kind === "insert") {
              // A real `onInsert` never fires twice for the same primary
              // key without an intervening delete -- skip a duplicate
              // insert rather than modelling a scenario the real table
              // can never produce.
              if (survivors.has(op.row.objectId)) continue;
              const r = row(op.row);
              grid.insert(r);
              survivors.set(r.objectId, r);
            } else if (op.kind === "delete") {
              const existing = survivors.get(op.objectId);
              if (existing) {
                grid.delete(existing);
                survivors.delete(op.objectId);
              }
            } else {
              // An update may change def and floor, not only position.
              const newRow = row(op.row);
              const existing = survivors.get(op.row.objectId);
              if (existing) {
                grid.update(existing, newRow);
              } else {
                grid.insert(newRow);
              }
              survivors.set(op.row.objectId, newRow);
            }
          }

          expect(snapshot(grid)).toEqual(snapshot(gridOf(survivors.values())));
        },
      ),
      { numRuns: 60 },
    );
  });

  it("frees a chunk as soon as its last entry goes, and the floor with its last chunk", () => {
    const grid = gridWith(objectDefs);
    const a = row({ objectId: 1n, defId: SUB_CELL_DEF, x: 0, y: 0, floor: 0 });
    const b = row({ objectId: 2n, defId: SUB_CELL_DEF, x: 40, y: 40, floor: 1 });
    expect(grid.allocatedChunkCount()).toBe(0);
    grid.insert(a);
    grid.insert(b);
    expect(grid.allocatedChunkCount()).toBe(2);
    grid.delete(a);
    expect(grid.allocatedChunkCount()).toBe(1);
    grid.delete(b);
    expect(grid.allocatedChunkCount()).toBe(0);
    // The emptied floor answers queries exactly as it did before anything
    // was ever inserted.
    expect(grid.entriesInCell(0, 0, 0)).toEqual([]);
    expect(grid.entriesInCell(1, 40, 40)).toEqual([]);
  });

  it("keeps a chunk while any other entry in it survives", () => {
    const grid = gridWith(objectDefs);
    const a = row({ objectId: 1n, defId: SUB_CELL_DEF, x: 0, y: 0, floor: 0 });
    const b = row({ objectId: 2n, defId: SUB_CELL_DEF, x: 1, y: 1, floor: 0 });
    grid.insert(a);
    grid.insert(b);
    expect(grid.allocatedChunkCount()).toBe(1);
    grid.delete(a);
    expect(grid.allocatedChunkCount()).toBe(1);
    expect(grid.entriesInCell(0, 1, 1)).toHaveLength(1);
  });
});
