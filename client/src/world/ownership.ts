// The client's own TypeScript mirror of `sim::world::World::ownership_at`
// (Tim's direction, story 1.7): a deliberate, independent
// re-implementation (NFR30 forbids sharing the code), tested against the
// identical fixture (`fixtures/world-conformance.v1.json`) its Rust oracle
// reads. `world/**` rules apply: no `pixi.js`, no DOM, no `net/` beyond
// `net/bindings` types.

import { chunkKey } from "./chunk";

/** A half-open, axis-aligned rect in absolute world tile coordinates --
 * the same shape `sim::world::Rect` describes. */
export interface OwnershipRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** One ownership area (a `building_area`/`room_area` row's shape): an
 * owner id, the floor it is declared on, and its rect. */
export interface OwnershipArea {
  readonly ownerId: bigint;
  readonly floor: number;
  readonly rect: OwnershipRect;
}

/** The sentinel "no owner" id (FR119) -- `#[auto_inc]` surrogate keys
 * start at 1, so 0 is always safe as a sentinel. Mirrors
 * `sim::world::NO_OWNER`. */
export const NO_OWNER = 0n;

/** The building/room ownership id for one cell (FR119), queried
 * independently -- a cell can be inside a building but not inside any one
 * room of it. */
export interface Ownership {
  readonly buildingId: bigint;
  readonly roomId: bigint;
}

function rectContains(rect: OwnershipRect, x: number, y: number): boolean {
  return x >= rect.x0 && x < rect.x1 && y >= rect.y0 && y < rect.y1;
}

function buildIndex(areas: readonly OwnershipArea[]): ReadonlyMap<bigint, OwnershipArea[]> {
  const index = new Map<bigint, OwnershipArea[]>();
  for (const area of areas) {
    const key = chunkKey(area.rect.x0, area.rect.y0, area.floor);
    const bucket = index.get(key);
    if (bucket) {
      bucket.push(area);
    } else {
      index.set(key, [area]);
    }
  }
  return index;
}

function findOwner(
  index: ReadonlyMap<bigint, OwnershipArea[]>,
  key: bigint,
  x: number,
  y: number,
): bigint {
  const bucket = index.get(key);
  if (!bucket) return NO_OWNER;
  for (const area of bucket) {
    if (rectContains(area.rect, x, y)) return area.ownerId;
  }
  return NO_OWNER;
}

/** Areas bucketed by `chunk_key`, exactly like `sim::world::World`'s own
 * `AreaIndex` (Tim's direction): [`OwnershipIndex.ownershipAt`] costs one
 * map lookup plus a scan of one chunk's rects, never a scan of every area
 * declared. */
export class OwnershipIndex {
  private readonly buildingAreas: ReadonlyMap<bigint, OwnershipArea[]>;
  private readonly roomAreas: ReadonlyMap<bigint, OwnershipArea[]>;

  constructor(buildingAreas: readonly OwnershipArea[], roomAreas: readonly OwnershipArea[]) {
    this.buildingAreas = buildIndex(buildingAreas);
    this.roomAreas = buildIndex(roomAreas);
  }

  /** The building/room ownership id for `(x, y, floor)` (FR119). `x`/`y`
   * must already be whole cell coordinates: a continuous player position
   * is turned into a cell with `Math.floor`, never truncation (`x = -0.5`
   * must land in cell `-1`, not cell `0` -- Quentin's direction), and that
   * conversion is the caller's job, not this function's, so it stays
   * total over plain integers like its Rust counterpart. */
  ownershipAt(x: number, y: number, floor: number): Ownership {
    const key = chunkKey(x, y, floor);
    return {
      buildingId: findOwner(this.buildingAreas, key, x, y),
      roomId: findOwner(this.roomAreas, key, x, y),
    };
  }

  /** The number of areas sharing the chunk `chunkKey(x, y, floor)` names,
   * in the building index -- exposes the bounded-cost data shape
   * [`OwnershipIndex.ownershipAt`] rests on, mirroring
   * `World::building_areas_in_chunk_of`. */
  buildingAreasInChunkOf(x: number, y: number, floor: number): number {
    return this.buildingAreas.get(chunkKey(x, y, floor))?.length ?? 0;
  }
}

/** Turns a continuous world position into the cell it occupies --
 * `Math.floor`, never `Math.trunc`/truncation, so a negative position like
 * `x = -0.5` resolves to cell `-1`, matching the server's own
 * `div_euclid`-flavoured cell semantics (Quentin's direction: this is the
 * exact bug a `Math.trunc` port would silently reintroduce -- it resolves
 * `-0.5` to cell `0` instead). */
export function cellOf(position: number): number {
  return Math.floor(position);
}
