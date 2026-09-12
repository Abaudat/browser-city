// The derived collision grid (story 1.8): sparse by chunk, dense inside a
// chunk, expanded from `placed_object`-shaped rows on `insert`, `delete`
// and `update` -- never queried by scanning rows. `world/**` may only
// import `PlacedObject` as a type from `net/bindings` (Tim's direction,
// enforced by `client/biome.json`'s `noRestrictedImports` override); this
// module knows nothing else about `net/`.

import type { PlacedObject } from "../net/bindings/types";
import { CHUNK_SIZE, chunkKey } from "./chunk";
import { cellsForRange } from "./subcells";

/** A half-open rect in absolute sub-cell coordinates (not relative to any
 * one object's anchor) -- the same shape `defs/`'s `ObjectDef.collider`
 * uses, just translated by the placed object's own anchor cell. */
export interface ColliderRectSubcells {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The minimal shape `CollisionGrid` needs from an object's definition --
 * exactly `defs/`'s `ObjectDef`, but named locally so this module never
 * has to import `defs/types` just to read two fields and stay decoupled
 * from the defs schema's own evolution. */
export interface ColliderSource {
  readonly width: number;
  readonly height: number;
  readonly collider?: ColliderRectSubcells;
}

export interface GridEntry {
  readonly objectId: bigint;
  readonly rect: ColliderRectSubcells;
}

/** The narrow read interface `world/movement.ts`'s resolver depends on --
 * a single dense-storage-shaped cell lookup, never a row scan. A counting
 * wrapper implementing this same interface is how the O(1) property test
 * proves the resolver's own cost is bounded by the cells a swept body
 * spans, never by how many objects the grid holds (Quentin's direction).
 */
export interface CollisionGridQuery {
  entriesInCell(floor: number, cellX: number, cellY: number): readonly GridEntry[];
}

type ChunkCells = (GridEntry[] | undefined)[];

function localIndex(cellX: number, cellY: number): number {
  const localX = ((cellX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const localY = ((cellY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return localY * CHUNK_SIZE + localX;
}

/**
 * `Map<floor, Map<chunk key, ChunkCells>>`: sparse by chunk (a chunk with
 * no collider anywhere never allocates its dense array), dense inside a
 * chunk (`CHUNK_SIZE*CHUNK_SIZE`, indexed arithmetically, matching the
 * server's own dense-per-floor collision grid's cost shape). Mutated only
 * through `insert`/`delete`/`update` -- there is no other way to change
 * what this grid reports.
 */
export class CollisionGrid implements CollisionGridQuery {
  private readonly floors = new Map<number, Map<bigint, ChunkCells>>();

  /** `subcellsPerCell` is `defs/`'s own generated
   * `COLLIDER_SUBCELLS_PER_CELL`, never a literal here (Tim's direction).
   * `objectDefs` is resolved once, at construction -- `insert` does one
   * map lookup per row, never per frame. */
  constructor(
    private readonly subcellsPerCell: number,
    private readonly objectDefs: ReadonlyMap<number, ColliderSource>,
  ) {}

  entriesInCell(floor: number, cellX: number, cellY: number): readonly GridEntry[] {
    const chunk = this.floors.get(floor)?.get(chunkKey(cellX, cellY, floor));
    return chunk?.[localIndex(cellX, cellY)] ?? [];
  }

  /** Absent from `objectDefs`, or with no `collider` declared, contributes
   * nothing (FR128: absence of a collider is walkability) -- `insert`'s
   * and `delete`'s own no-op in that case is `inv_absent_collider_is_walkable`. */
  insert(row: PlacedObject): void {
    this.forEachCoveredCell(row, (cellX, cellY, entry) => {
      let byFloor = this.floors.get(row.floor);
      if (!byFloor) {
        byFloor = new Map();
        this.floors.set(row.floor, byFloor);
      }
      const key = chunkKey(cellX, cellY, row.floor);
      let chunk = byFloor.get(key);
      if (!chunk) {
        chunk = new Array(CHUNK_SIZE * CHUNK_SIZE).fill(undefined);
        byFloor.set(key, chunk);
      }
      const idx = localIndex(cellX, cellY);
      const list = chunk[idx] ?? [];
      list.push(entry);
      chunk[idx] = list;
    });
  }

  /** Removes every trace of `row.objectId` from the cells it was inserted
   * into -- recomputed from `row` the same way `insert` did, so an
   * `insert`/`delete` pair always leaves the grid exactly as it was
   * (`inv_collision_grid_matches_rebuild`). Deleting one of two
   * overlapping colliders never unblocks the space the other one still
   * covers: only entries matching this exact `objectId` are removed. */
  delete(row: PlacedObject): void {
    this.forEachCoveredCell(row, (cellX, cellY) => {
      const byFloor = this.floors.get(row.floor);
      const key = chunkKey(cellX, cellY, row.floor);
      const chunk = byFloor?.get(key);
      if (!chunk) return;
      const idx = localIndex(cellX, cellY);
      const list = chunk[idx];
      if (!list) return;
      const next = list.filter((e) => e.objectId !== row.objectId);
      chunk[idx] = next.length > 0 ? next : undefined;
    });
  }

  /** Delete then insert (Tim's direction) -- never an in-place mutation,
   * so a changed `defId`/position/floor is handled uniformly with no
   * separate "what actually changed" logic. */
  update(oldRow: PlacedObject, newRow: PlacedObject): void {
    this.delete(oldRow);
    this.insert(newRow);
  }

  private forEachCoveredCell(
    row: PlacedObject,
    fn: (cellX: number, cellY: number, entry: GridEntry) => void,
  ): void {
    const def = this.objectDefs.get(row.defId);
    if (!def?.collider) return;
    if (row.orientation !== 0) {
      throw new Error(
        `CollisionGrid: object ${row.objectId} has orientation ${row.orientation} -- rotated colliders are not supported until a story defines them`,
      );
    }

    const anchorXSub = row.x * this.subcellsPerCell;
    const anchorYSub = row.y * this.subcellsPerCell;
    const rect: ColliderRectSubcells = {
      x0: anchorXSub + def.collider.x0,
      y0: anchorYSub + def.collider.y0,
      x1: anchorXSub + def.collider.x1,
      y1: anchorYSub + def.collider.y1,
    };
    const entry: GridEntry = { objectId: row.objectId, rect };

    const [cellX0, cellX1] = cellsForRange(rect.x0, rect.x1, this.subcellsPerCell);
    const [cellY0, cellY1] = cellsForRange(rect.y0, rect.y1, this.subcellsPerCell);
    for (let cy = cellY0; cy <= cellY1; cy++) {
      for (let cx = cellX0; cx <= cellX1; cx++) {
        fn(cx, cy, entry);
      }
    }
  }
}
