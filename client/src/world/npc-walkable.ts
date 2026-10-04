// The one tile-walkability predicate for NPCs (FR63): a cell is walkable iff
// no collider touches it. Conservative on purpose -- an NPC has no collision
// body, so a tile any collider touches is not one it may be routed through.
// A chunk that has not streamed in reads as empty. The revision moves with
// every change to the grid, so a cached path can be keyed by it.

import type { CollisionGridQuery } from "./collision-grid";

export interface NpcWalkability {
  revision(): number;
  walkable(floor: number, x: number, y: number): boolean;
}

/** Any collision grid that reports its own revision. */
export type RevisedGrid = CollisionGridQuery & { readonly revision: number };

export function npcWalkability(grid: RevisedGrid): NpcWalkability {
  return {
    revision: () => grid.revision,
    walkable: (floor, x, y) => grid.entriesInCell(floor, x, y).length === 0,
  };
}
