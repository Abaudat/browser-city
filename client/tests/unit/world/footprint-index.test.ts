import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ColliderSource } from "../../../src/world/collision-grid";
import type { FootprintSource } from "../../../src/world/footprint-index";
import { FootprintIndex } from "../../../src/world/footprint-index";
import { WorldIndex } from "../../../src/world/world-index";

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

const ONE_CELL: FootprintSource = { width: 1, height: 1 };
const THREE_WIDE: FootprintSource = { width: 3, height: 1 };
const TWO_BY_TWO: FootprintSource = { width: 2, height: 2 };

function indexWith(defs: ReadonlyMap<number, FootprintSource>): FootprintIndex {
  return new FootprintIndex(defs);
}

describe("FootprintIndex", () => {
  it("indexes an object with no collider at all -- a footprint is not a collider", () => {
    const index = indexWith(new Map([[1, ONE_CELL]]));
    index.insert(row({ objectId: 7n, x: 4, y: 5 }));
    expect(index.objectsAt(0, 4, 5).map((e) => e.objectId)).toEqual([7n]);
  });

  it("covers every cell of a multi-cell footprint, and no cell beyond it", () => {
    const index = indexWith(new Map([[1, THREE_WIDE]]));
    index.insert(row({ objectId: 8n, x: 4, y: 2 }));
    expect(index.objectsAt(0, 4, 2)).toHaveLength(1);
    expect(index.objectsAt(0, 5, 2)).toHaveLength(1);
    expect(index.objectsAt(0, 6, 2)).toHaveLength(1);
    expect(index.objectsAt(0, 7, 2)).toEqual([]);
    expect(index.objectsAt(0, 3, 2)).toEqual([]);
    expect(index.objectsAt(0, 4, 3)).toEqual([]);
  });

  it("carries the def id and the layer code each pick needs", () => {
    const index = indexWith(new Map([[3, ONE_CELL]]));
    index.insert(row({ objectId: 9n, defId: 3, layer: 42, x: 1, y: 1 }));
    expect(index.objectsAt(0, 1, 1)[0]).toEqual({
      objectId: 9n,
      defId: 3,
      layer: 42,
      anchorX: 1,
      anchorY: 1,
    });
  });

  it("covers the cells a prop's art overhangs into, not only its footprint", () => {
    // Our props are bottom-anchored and draw upward past their own row
    // (a 16x32 bin on a 1x1 footprint). A click on the drawn part must
    // find the object, so the broad phase has to reach those cells too.
    const tall: FootprintSource = { width: 1, height: 1, drawOverhangCellsUp: 1 };
    const index = indexWith(new Map([[1, tall]]));
    index.insert(row({ objectId: 7n, x: 4, y: 5 }));
    expect(index.objectsAt(0, 4, 5).map((e) => e.objectId)).toEqual([7n]);
    expect(index.objectsAt(0, 4, 4).map((e) => e.objectId)).toEqual([7n]);
    // Never below its own row, and never further up than it draws.
    expect(index.objectsAt(0, 4, 6)).toEqual([]);
    expect(index.objectsAt(0, 4, 3)).toEqual([]);
  });

  it("covers sideways overhang too, on both sides", () => {
    const wide: FootprintSource = { width: 1, height: 1, drawOverhangCellsX: 1 };
    const index = indexWith(new Map([[1, wide]]));
    index.insert(row({ objectId: 8n, x: 4, y: 5 }));
    for (const cellX of [3, 4, 5]) {
      expect(index.objectsAt(0, cellX, 5).map((e) => e.objectId)).toEqual([8n]);
    }
    expect(index.objectsAt(0, 2, 5)).toEqual([]);
    expect(index.objectsAt(0, 6, 5)).toEqual([]);
  });

  it("an overhanging object is removed from its overhang cells too", () => {
    const tall: FootprintSource = { width: 1, height: 1, drawOverhangCellsUp: 2 };
    const index = indexWith(new Map([[1, tall]]));
    const r = row({ objectId: 9n, x: 4, y: 5 });
    index.insert(r);
    index.delete(r);
    for (const cellY of [3, 4, 5]) expect(index.objectsAt(0, 4, cellY)).toEqual([]);
    expect(index.allocatedChunkCount()).toBe(0);
  });

  it("keeps floors independent (FR117)", () => {
    const index = indexWith(new Map([[1, ONE_CELL]]));
    index.insert(row({ objectId: 1n, x: 2, y: 2, floor: 0 }));
    expect(index.objectsAt(-1, 2, 2)).toEqual([]);
    expect(index.objectsAt(1, 2, 2)).toEqual([]);
  });

  it("an unresolvable defId contributes nothing rather than throwing", () => {
    const index = indexWith(new Map());
    expect(() => index.insert(row({ objectId: 1n, defId: 999 }))).not.toThrow();
    expect(index.objectsAt(0, 0, 0)).toEqual([]);
  });

  it("throws on a non-zero orientation rather than indexing an unrotated footprint", () => {
    const index = indexWith(new Map([[1, THREE_WIDE]]));
    expect(() => index.insert(row({ objectId: 1n, orientation: 1 }))).toThrow(/orientation/);
  });

  it("deleting one of two objects sharing a cell leaves the other", () => {
    const index = indexWith(new Map([[1, ONE_CELL]]));
    const a = row({ objectId: 1n, x: 3, y: 3 });
    const b = row({ objectId: 2n, x: 3, y: 3 });
    index.insert(a);
    index.insert(b);
    index.delete(a);
    expect(index.objectsAt(0, 3, 3).map((e) => e.objectId)).toEqual([2n]);
  });

  it("update is delete then insert, across a chunk boundary", () => {
    const index = indexWith(new Map([[1, TWO_BY_TWO]]));
    const before = row({ objectId: 1n, x: 1, y: 1 });
    const after = row({ objectId: 1n, x: 31, y: 31 });
    index.insert(before);
    index.update(before, after);
    expect(index.objectsAt(0, 1, 1)).toEqual([]);
    // A 2x2 footprint anchored at (31, 31) spans four cells across four
    // chunks (CHUNK_SIZE is 32).
    expect(index.objectsAt(0, 31, 31)).toHaveLength(1);
    expect(index.objectsAt(0, 32, 31)).toHaveLength(1);
    expect(index.objectsAt(0, 31, 32)).toHaveLength(1);
    expect(index.objectsAt(0, 32, 32)).toHaveLength(1);
  });

  it("deleting a row that was never inserted is a no-op, not a throw", () => {
    const index = indexWith(new Map([[1, ONE_CELL]]));
    expect(() => index.delete(row({ objectId: 42n, x: 9, y: 9 }))).not.toThrow();
  });

  it("frees a chunk as soon as its last entry goes, and the floor with its last chunk", () => {
    const index = indexWith(new Map([[1, ONE_CELL]]));
    const a = row({ objectId: 1n, x: 0, y: 0, floor: 0 });
    const b = row({ objectId: 2n, x: 40, y: 40, floor: 1 });
    expect(index.allocatedChunkCount()).toBe(0);
    index.insert(a);
    index.insert(b);
    expect(index.allocatedChunkCount()).toBe(2);
    index.delete(a);
    expect(index.allocatedChunkCount()).toBe(1);
    index.delete(b);
    expect(index.allocatedChunkCount()).toBe(0);
    expect(index.objectsAt(0, 0, 0)).toEqual([]);
  });

  // A cell lookup answers from that cell's own chunk alone: a world with
  // 10,000 objects elsewhere answers exactly what a world with 10 does.
  it("a cell lookup is unaffected by how many objects the index holds elsewhere", () => {
    const defs = new Map([[1, ONE_CELL]]);
    function entriesAtTarget(objectCount: number): string[] {
      const index = indexWith(defs);
      // Every filler object gets its own far-away chunk.
      for (let i = 1; i <= objectCount; i++) {
        index.insert(row({ objectId: BigInt(i), x: i * 64, y: i * 64 }));
      }
      index.insert(row({ objectId: 999_999n, x: -5, y: -5 }));
      return index.objectsAt(0, -5, -5).map((e) => e.objectId.toString());
    }
    expect(entriesAtTarget(10)).toEqual(["999999"]);
    expect(entriesAtTarget(10_000)).toEqual(["999999"]);
  });

  it("inv_footprint_index_matches_rebuild", () => {
    const defs = new Map<number, FootprintSource>([
      [1, ONE_CELL],
      [2, THREE_WIDE],
      [3, TWO_BY_TWO],
    ]);
    const rowArb = fc.record({
      objectId: fc.integer({ min: 1, max: 6 }).map(BigInt),
      x: fc.integer({ min: -33, max: 33 }),
      y: fc.integer({ min: -33, max: 33 }),
      floor: fc.constantFrom(-1, 0, 1),
      defId: fc.constantFrom(1, 2, 3),
      layer: fc.constantFrom(10, 20, 30),
    });

    function snapshot(index: FootprintIndex): unknown {
      const cells: unknown[] = [];
      for (const floor of [-1, 0, 1]) {
        for (let x = -35; x <= 37; x++) {
          for (let y = -35; y <= 37; y++) {
            const entries = [...index.objectsAt(floor, x, y)]
              .map((e) => `${e.objectId}/${e.defId}/${e.layer}@${e.anchorX},${e.anchorY}`)
              .sort();
            if (entries.length > 0) cells.push([floor, x, y, entries]);
          }
        }
      }
      return { cells, allocatedChunks: index.allocatedChunkCount() };
    }

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
          { maxLength: 30 },
        ),
        (ops) => {
          const index = indexWith(defs);
          const survivors = new Map<bigint, Row>();
          for (const op of ops) {
            if (op.kind === "insert") {
              if (survivors.has(op.row.objectId)) continue;
              const r = row(op.row);
              index.insert(r);
              survivors.set(r.objectId, r);
            } else if (op.kind === "delete") {
              const existing = survivors.get(op.objectId);
              if (existing) {
                index.delete(existing);
                survivors.delete(op.objectId);
              }
            } else {
              const next = row(op.row);
              const existing = survivors.get(op.row.objectId);
              if (existing) index.update(existing, next);
              else index.insert(next);
              survivors.set(next.objectId, next);
            }
          }
          const rebuilt = indexWith(defs);
          for (const r of survivors.values()) rebuilt.insert(r);
          expect(snapshot(index)).toEqual(snapshot(rebuilt));
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe("WorldIndex", () => {
  const defs = new Map<number, ColliderSource>([
    [1, { width: 1, height: 1, collider: { x0: 0, y0: 0, x1: 16, y1: 16 } }],
    [2, { width: 2, height: 1 }],
  ]);

  it("one insert feeds both the collision grid and the footprint index", () => {
    const world = new WorldIndex(SUBCELLS_PER_CELL, defs);
    world.insert(row({ objectId: 1n, defId: 1, x: 2, y: 2 }));
    expect(world.entriesInCell(0, 2, 2)).toHaveLength(1);
    expect(world.objectsAt(0, 2, 2)).toHaveLength(1);
  });

  it("an object with no collider is still clickable", () => {
    const world = new WorldIndex(SUBCELLS_PER_CELL, defs);
    world.insert(row({ objectId: 2n, defId: 2, x: 5, y: 5 }));
    expect(world.entriesInCell(0, 5, 5)).toEqual([]);
    expect(world.objectsAt(0, 5, 5)).toHaveLength(1);
    expect(world.objectsAt(0, 6, 5)).toHaveLength(1);
  });

  it("one delete empties both, and one update moves both", () => {
    const world = new WorldIndex(SUBCELLS_PER_CELL, defs);
    const before = row({ objectId: 1n, defId: 1, x: 2, y: 2 });
    const after = row({ objectId: 1n, defId: 1, x: 8, y: 8 });
    world.insert(before);
    world.update(before, after);
    expect(world.entriesInCell(0, 2, 2)).toEqual([]);
    expect(world.objectsAt(0, 2, 2)).toEqual([]);
    expect(world.entriesInCell(0, 8, 8)).toHaveLength(1);
    expect(world.objectsAt(0, 8, 8)).toHaveLength(1);

    world.delete(after);
    expect(world.entriesInCell(0, 8, 8)).toEqual([]);
    expect(world.objectsAt(0, 8, 8)).toEqual([]);
  });
});
