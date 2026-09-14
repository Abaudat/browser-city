// The derived footprint index (story 1.9, FR148): which object occupies
// which world cell, for picking. Sparse by chunk, dense inside a chunk,
// expanded from `placed_object`-shaped rows on `insert`, `delete` and
// `update` -- the same storage shape and the same chunk freeing as
// `collision-grid.ts`, and like it, never queried by scanning rows.
//
// Deliberately not the collision grid itself: that one only knows
// colliders, and FR128 makes an absent collider mean "walkable", so a
// bench or a poster with no collider is invisible to it. A click must
// still resolve to those (Tim's direction), so this index keys on the
// object's own *footprint* -- every cell `width x height` covers -- and
// carries nothing about whether it blocks movement. `world/world-index.ts`
// is what guarantees the two are always fed by the same call.

import type { PlacedObject } from "../net/bindings/types";
import { CHUNK_SIZE, chunkKey } from "./chunk";

/** The minimal shape this index needs from an object's definition -- the
 * footprint, and nothing else. `defs/`'s `ObjectDef` and
 * `collision-grid.ts`'s `ColliderSource` both satisfy it structurally, so
 * one `defId -> def` map feeds both indexes. */
export interface FootprintSource {
  readonly width: number;
  readonly height: number;
}

/** One object occupying one cell. `defId` is what a pick resolves the
 * object's own `interact_at` through; `layer` is the placed row's own
 * layer code, which is what the FR123 rank -- and therefore which of two
 * objects sharing a cell is the front-most one -- is resolved from. */
export interface FootprintEntry {
  readonly objectId: bigint;
  readonly defId: number;
  readonly layer: number;
  /** The placed row's own anchor cell -- carried because an `interact_at`
   * rect is declared relative to it, so a reach check translates the rect
   * into world sub-cells without going back to the row. */
  readonly anchorX: number;
  readonly anchorY: number;
}

/** The narrow read interface a pick depends on: one dense-storage-shaped
 * cell lookup, never a row scan. */
export interface FootprintQuery {
  objectsAt(floor: number, cellX: number, cellY: number): readonly FootprintEntry[];
}

interface Chunk {
  readonly cells: (FootprintEntry[] | undefined)[];
  occupiedCells: number;
}

function localIndex(cellX: number, cellY: number): number {
  const localX = ((cellX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const localY = ((cellY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return localY * CHUNK_SIZE + localX;
}

const NO_ENTRIES: readonly FootprintEntry[] = [];

/**
 * `Map<floor, Map<chunk key, Chunk>>`, exactly as `CollisionGrid` stores
 * colliders: a chunk with no object in it never allocates its dense
 * array, and one whose last object is deleted frees it again. Mutated
 * only through `insert`/`delete`/`update`.
 */
export class FootprintIndex implements FootprintQuery {
  private readonly floors = new Map<number, Map<bigint, Chunk>>();

  /** `objectDefs` is resolved once, at construction -- `insert` does one
   * map lookup per row, never per frame. */
  constructor(private readonly objectDefs: ReadonlyMap<number, FootprintSource>) {}

  objectsAt(floor: number, cellX: number, cellY: number): readonly FootprintEntry[] {
    const chunk = this.floors.get(floor)?.get(chunkKey(cellX, cellY, floor));
    return chunk?.cells[localIndex(cellX, cellY)] ?? NO_ENTRIES;
  }

  /** How many dense chunk arrays are allocated right now, across every
   * floor -- storage shape, not a query result (`inv_footprint_index_matches_rebuild`
   * compares it, so an index that never frees an emptied chunk fails). */
  allocatedChunkCount(): number {
    let total = 0;
    for (const byChunk of this.floors.values()) total += byChunk.size;
    return total;
  }

  /** A row whose `defId` resolves to nothing contributes nothing -- an
   * object whose definition the client has not got cannot be drawn
   * either, so it can never be under the pointer. */
  insert(row: PlacedObject): void {
    const entry: FootprintEntry = {
      objectId: row.objectId,
      defId: row.defId,
      layer: row.layer,
      anchorX: row.x,
      anchorY: row.y,
    };
    this.forEachFootprintCell(row, (cellX, cellY) => {
      let byChunk = this.floors.get(row.floor);
      if (!byChunk) {
        byChunk = new Map();
        this.floors.set(row.floor, byChunk);
      }
      const key = chunkKey(cellX, cellY, row.floor);
      let chunk = byChunk.get(key);
      if (!chunk) {
        chunk = { cells: new Array(CHUNK_SIZE * CHUNK_SIZE).fill(undefined), occupiedCells: 0 };
        byChunk.set(key, chunk);
      }
      const idx = localIndex(cellX, cellY);
      const list = chunk.cells[idx];
      if (list) {
        list.push(entry);
      } else {
        chunk.cells[idx] = [entry];
        chunk.occupiedCells++;
      }
    });
  }

  /** Removes every trace of `row.objectId`, recomputed from `row` the
   * same way `insert` placed it, so an `insert`/`delete` pair always
   * leaves the index exactly as it was, down to which chunks are
   * allocated. */
  delete(row: PlacedObject): void {
    this.forEachFootprintCell(row, (cellX, cellY) => {
      const byChunk = this.floors.get(row.floor);
      const key = chunkKey(cellX, cellY, row.floor);
      const chunk = byChunk?.get(key);
      if (!byChunk || !chunk) return;
      const idx = localIndex(cellX, cellY);
      const list = chunk.cells[idx];
      if (!list) return;
      const next = list.filter((e) => e.objectId !== row.objectId);
      if (next.length > 0) {
        chunk.cells[idx] = next;
        return;
      }
      chunk.cells[idx] = undefined;
      chunk.occupiedCells--;
      if (chunk.occupiedCells > 0) return;
      byChunk.delete(key);
      if (byChunk.size === 0) this.floors.delete(row.floor);
    });
  }

  /** Delete then insert -- never an in-place mutation, so a changed
   * `defId`/position/floor is handled uniformly. */
  update(oldRow: PlacedObject, newRow: PlacedObject): void {
    this.delete(oldRow);
    this.insert(newRow);
  }

  private forEachFootprintCell(
    row: PlacedObject,
    fn: (cellX: number, cellY: number) => void,
  ): void {
    const def = this.objectDefs.get(row.defId);
    if (!def) return;
    if (row.orientation !== 0) {
      throw new Error(
        `FootprintIndex: object ${row.objectId} has orientation ${row.orientation} -- rotated footprints are not supported until a story defines them`,
      );
    }
    for (let dy = 0; dy < def.height; dy++) {
      for (let dx = 0; dx < def.width; dx++) {
        fn(row.x + dx, row.y + dy);
      }
    }
  }
}
