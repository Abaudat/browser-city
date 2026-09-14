// The one mutation path for everything derived from `placed_object` rows
// (Tim's direction, story 1.9): a single `insert`/`delete`/`update` that
// feeds both the FR128 collision grid and the FR148 footprint index, so
// the two can never drift apart. Callers never hold either one directly;
// a second, separate feed of one of them is exactly the bug this class
// exists to make impossible.

import type { PlacedObject } from "../net/bindings/types";
import type { ColliderSource, CollisionGridQuery, GridEntry } from "./collision-grid";
import { CollisionGrid } from "./collision-grid";
import type { FootprintEntry, FootprintQuery } from "./footprint-index";
import { FootprintIndex } from "./footprint-index";

export class WorldIndex implements CollisionGridQuery, FootprintQuery {
  private readonly grid: CollisionGrid;
  private readonly footprints: FootprintIndex;

  /** `subcellsPerCell` is `defs/`'s own generated
   * `COLLIDER_SUBCELLS_PER_CELL`; `objectDefs` carries both the footprint
   * every object has and the collider only some of them do, so one map
   * feeds both indexes. */
  constructor(subcellsPerCell: number, objectDefs: ReadonlyMap<number, ColliderSource>) {
    this.grid = new CollisionGrid(subcellsPerCell, objectDefs);
    this.footprints = new FootprintIndex(objectDefs);
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
}
