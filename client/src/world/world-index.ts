// The one mutation path for everything derived from `placed_object` rows
// (Tim's direction, story 1.9): a single `insert`/`delete`/`update` that
// feeds both the FR128 collision grid and the FR148 footprint index, so
// the two can never drift apart. Callers never hold either one directly;
// a second, separate feed of one of them is exactly the bug this class
// exists to make impossible.

import type { PlacedObject } from "../net/bindings/types";
import { chunkKey } from "./chunk";
import type {
  ColliderRectSubcells,
  ColliderSource,
  CollisionGridQuery,
  GridEntry,
} from "./collision-grid";
import { CollisionGrid } from "./collision-grid";
import type { FootprintEntry, FootprintQuery } from "./footprint-index";
import { FootprintIndex } from "./footprint-index";

/** An inclusive window of whole cells on one floor -- the unit
 * [`WorldIndex.objects`] is bounded by. Inclusive on both ends because a
 * viewport's own last visible cell is visible. */
export interface CellBounds {
  readonly floor: number;
  readonly cellX0: number;
  readonly cellY0: number;
  readonly cellX1: number;
  readonly cellY1: number;
}

/** One placed object, as a reader outside `world/` may see it (story
 * 1.12, FR165): its identity, where it sits, how big its footprint is,
 * and the collider it declares -- or `undefined`, which is FR128's
 * walkability and a real state a debug overlay has to be able to show.
 * `collider` is the definition's own rect, relative to the anchor cell,
 * in sub-cells; translating it into world sub-cells is the reader's job,
 * exactly as it is `CollisionGrid`'s. */
export interface PlacedObjectView {
  readonly objectId: bigint;
  readonly defId: number;
  readonly floor: number;
  readonly chunkKey: bigint;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly width: number;
  readonly height: number;
  readonly collider?: ColliderRectSubcells;
}

export class WorldIndex implements CollisionGridQuery, FootprintQuery {
  private readonly grid: CollisionGrid;
  private readonly footprints: FootprintIndex;
  private readonly objectDefs: ReadonlyMap<number, ColliderSource>;

  /** `subcellsPerCell` is `defs/`'s own generated
   * `COLLIDER_SUBCELLS_PER_CELL`; `objectDefs` carries both the footprint
   * every object has and the collider only some of them do, so one map
   * feeds both indexes. */
  constructor(subcellsPerCell: number, objectDefs: ReadonlyMap<number, ColliderSource>) {
    this.grid = new CollisionGrid(subcellsPerCell, objectDefs);
    this.footprints = new FootprintIndex(objectDefs);
    this.objectDefs = objectDefs;
  }

  insert(row: PlacedObject): void {
    this.grid.insert(row);
    this.footprints.insert(row);
  }

  delete(row: PlacedObject): void {
    this.grid.delete(row);
    this.footprints.delete(row);
  }

  update(oldRow: PlacedObject, newRow: PlacedObject): void {
    this.grid.update(oldRow, newRow);
    this.footprints.update(oldRow, newRow);
  }

  /** FR128's collision read (`world/movement.ts`'s resolver). */
  entriesInCell(floor: number, cellX: number, cellY: number): readonly GridEntry[] {
    return this.grid.entriesInCell(floor, cellX, cellY);
  }

  /** FR148's pick read (`input/pick.ts`). */
  objectsAt(floor: number, cellX: number, cellY: number): readonly FootprintEntry[] {
    return this.footprints.objectsAt(floor, cellX, cellY);
  }

  /**
   * Every placed object whose footprint reaches into `bounds`, once each
   * (story 1.12, FR165) -- the one read-only enumeration of what has been
   * placed, and the only one there will be. Built on the footprint index's
   * own public per-cell query, because every object is in that index
   * whether or not it declares a collider: an enumeration driven off the
   * collision grid instead could never yield a prop with no collider, nor
   * one whose collider has no area, which are exactly the two states a
   * collision overlay exists to make distinguishable (FR128).
   *
   * Bounded by `bounds`, never by how many objects the world holds: it
   * visits that window's cells and nothing else, so a debug overlay drawn
   * over one viewport keeps costing one viewport in a streamed city. There
   * is deliberately no unbounded form -- a caller that wants everything
   * must say how much everything is.
   *
   * Hands out plain records, never an internal map: the indexes stay
   * mutable only through `insert`/`delete`/`update`.
   */
  *objects(bounds: CellBounds): IterableIterator<PlacedObjectView> {
    const seen = new Set<bigint>();
    for (let cellY = bounds.cellY0; cellY <= bounds.cellY1; cellY++) {
      for (let cellX = bounds.cellX0; cellX <= bounds.cellX1; cellX++) {
        for (const entry of this.objectsAt(bounds.floor, cellX, cellY)) {
          if (seen.has(entry.objectId)) continue;
          seen.add(entry.objectId);
          const def = this.objectDefs.get(entry.defId);
          if (!def) continue;
          yield {
            objectId: entry.objectId,
            defId: entry.defId,
            floor: bounds.floor,
            chunkKey: chunkKey(entry.anchorX, entry.anchorY, bounds.floor),
            anchorX: entry.anchorX,
            anchorY: entry.anchorY,
            width: def.width,
            height: def.height,
            ...(def.collider ? { collider: def.collider } : {}),
          };
        }
      }
    }
  }
}
