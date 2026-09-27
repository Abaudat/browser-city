// The only thing a debug overlay may read (Tim's direction, story 1.12).
//
// An overlay never sees the scene, the Pixi application, the street or any
// index directly: it sees this interface, which carries exactly what the
// overlays registered today need and nothing else. That is what lets
// `test-street/scene.ts` satisfy it now and Epic 3's real, subscribed pool
// satisfy it later with no overlay changing a line -- and what keeps a
// tool for inspecting the world from being able to perturb it, since
// every method here is a read.
//
// The collision read is `CollisionGridQuery` itself -- the same interface
// `world/movement.ts`'s resolver depends on (Quentin's direction): the
// overlay must show what the grid the player actually collides against
// believes, never a second expansion of `defs/` that could confirm a bug
// that is not there.

import type { Drawable } from "../render/sort-key";
import type { CollisionGridQuery } from "../world/collision-grid";
import type { CellBounds, PlacedObjectView } from "../world/world-index";

export type { CellBounds, PlacedObjectView };

export interface DebugWorldView extends CollisionGridQuery {
  /** `render.tile_size_px`, resolved from `defs/` by the caller -- never
   * a literal anywhere under `debug/`. */
  readonly tileSizePx: number;
  /** The scene's world zoom -- the snap granularity of a drawable's
   * screen position (`screenPositionPx`). */
  readonly zoom: number;
  /** `render.storey_height_px`, same rule (FR124's floor offset). */
  readonly storeyHeightPx: number;
  /** `defs/`'s own generated `COLLIDER_SUBCELLS_PER_CELL`. */
  readonly colliderSubcellsPerCell: number;
  /** The floor the viewer is standing on right now -- the only floor any
   * overlay draws, since it is the only floor the player is looking at. */
  viewerFloor(): number;
  /** The cells currently on screen, on the viewer's own floor. Every
   * overlay's cost is bounded by this window rather than by how much
   * world exists. */
  viewportCells(): CellBounds;
  /** Every placed object reaching into `bounds`, once each -- including
   * the ones the collision grid has nothing to say about
   * (`world/world-index.ts`'s own `objects`). */
  objects(bounds: CellBounds): Iterable<PlacedObjectView>;
  /** The y-sorted pool's own members, as the comparator sees them -- the
   * `Drawable`s themselves, nothing richer, so an overlay can read a sort
   * key but never a sprite. */
  pool(): Iterable<Drawable>;
  /** Where `stableId` came out in the order the renderer actually
   * applied, or `undefined` if it is not in a pool right now. Resolved by
   * the scene that did the ordering, never recomputed here: a sort
   * overlay that re-sorts to decide what to print could never show a
   * wrong order. */
  orderOf(stableId: bigint): number | undefined;
}
