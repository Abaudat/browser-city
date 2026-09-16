// The collision overlay's pure half (story 1.12, AC2): world state in,
// plain records out. No DOM, no `pixi.js`, nothing drawn -- so what the
// overlay claims about the collision system is provable in a node test,
// at the same bar as the collision system itself. `collision-overlay.ts`
// turns these records into elements and decides nothing.
//
// Two sources, each for exactly what only it can know (Quentin/Tim's
// directions):
//
//   - a real, area-having collider comes from the *live collision grid*,
//     the same `entriesInCell` read `world/movement.ts`'s resolver makes.
//     Never a second expansion of `defs/`: an overlay reading its own copy
//     of the world could happily confirm a bug that is not there.
//   - the two states the grid cannot represent come from the object's own
//     *definition*, via the world index's enumeration:
//       * no collider at all -- FR128 makes absence walkability, so there
//         is nothing in the grid to find;
//       * a collider declared with no area -- `CollisionGrid` rasterises
//         through `cellsForRange(min, max, s)` = `[floor(min/s),
//         ceil(max/s) - 1]`, which for `min === max` is an *empty* range
//         whenever the value is a multiple of `s`. A cell-aligned
//         zero-area collider is therefore in no cell of the grid at all.
//         Reading this state from the grid would draw such an object
//         nothing whatsoever -- and "nothing drawn" is indistinguishable
//         from "this overlay is broken", which is the failure AC2 exists
//         to prevent. The definition is the only source that always knows.
//
// Both reads are bounded by the viewport, never by how much world exists.

import { subcellRectPx } from "../render/screen-position";
import { isEmptyCellBounds } from "../world/world-index";
import { DEBUG_STYLE } from "./debug-style";
import type { DebugWorldView } from "./world-view";

/**
 * The three states AC2 requires be distinguishable, decided here and
 * never in a drawing layer:
 *   - `collider`: a declared collider with area -- this is what stops a
 *     step.
 *   - `empty`: a collider declared with no area. It blocks nothing, but
 *     it is not absent, and the two are different bugs.
 *   - `none`: no collider declared at all (FR128's walkability).
 */
export type CollisionRectKind = "collider" | "empty" | "none";

/** One rect to draw, in world pixels on the viewer's own floor. */
export interface CollisionRect {
  readonly objectId: bigint;
  readonly kind: CollisionRectKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly stroke: string;
  /** `"none"` or a palette colour -- only a real collider is filled, so
   * an outline never reads as a blocking area. */
  readonly fill: string;
  /** Set only for `none`, whose whole difference is that it is an
   * outline of something that does not block. */
  readonly dashArray?: string;
}

const STROKE_BY_KIND: Readonly<Record<CollisionRectKind, string>> = {
  collider: DEBUG_STYLE.palette.collider,
  empty: DEBUG_STYLE.palette.emptyCollider,
  none: DEBUG_STYLE.palette.noCollider,
};

/**
 * Every collider state visible in `view`'s current viewport, on the
 * viewer's own floor. One record per object, whatever number of cells its
 * collider rasterises into: a reader is looking for the collider, not for
 * the grid's storage.
 */
export function buildCollisionRects(view: DebugWorldView): CollisionRect[] {
  const bounds = view.viewportCells();
  if (isEmptyCellBounds(bounds)) return [];
  const floor = view.viewerFloor();
  const { colliderSubcellsPerCell, tileSizePx, storeyHeightPx } = view;

  const rects: CollisionRect[] = [];
  const drawn = new Set<bigint>();

  // The live grid first, for real colliders only: one entry per (object,
  // cell) it covers, so the same object is reported by every cell its
  // collider spans. A zero-area entry is skipped here and picked up from
  // its own definition below -- the grid cannot be trusted to hold one.
  for (let cellY = bounds.cellY0; cellY <= bounds.cellY1; cellY++) {
    for (let cellX = bounds.cellX0; cellX <= bounds.cellX1; cellX++) {
      for (const entry of view.entriesInCell(floor, cellX, cellY)) {
        if (drawn.has(entry.objectId)) continue;
        const hasArea = entry.rect.x1 > entry.rect.x0 && entry.rect.y1 > entry.rect.y0;
        if (!hasArea) continue;
        drawn.add(entry.objectId);
        rects.push({
          objectId: entry.objectId,
          kind: "collider",
          ...subcellRectPx(entry.rect, floor, colliderSubcellsPerCell, tileSizePx, storeyHeightPx),
          stroke: STROKE_BY_KIND.collider,
          fill: DEBUG_STYLE.palette.collider,
        });
      }
    }
  }

  // Then the two states only the definition knows. Something is always
  // drawn for each: there is no rect to take from the grid, and "nothing
  // drawn here" would be indistinguishable from "this overlay is broken",
  // which is the whole failure mode AC2 names.
  for (const object of view.objects(bounds)) {
    if (drawn.has(object.objectId)) continue;
    const anchorXSub = object.anchorX * colliderSubcellsPerCell;
    const anchorYSub = object.anchorY * colliderSubcellsPerCell;
    const collider = object.collider;

    if (!collider) {
      drawn.add(object.objectId);
      rects.push({
        objectId: object.objectId,
        kind: "none",
        ...subcellRectPx(
          {
            x0: anchorXSub,
            y0: anchorYSub,
            x1: anchorXSub + object.width * colliderSubcellsPerCell,
            y1: anchorYSub + object.height * colliderSubcellsPerCell,
          },
          floor,
          colliderSubcellsPerCell,
          tileSizePx,
          storeyHeightPx,
        ),
        stroke: STROKE_BY_KIND.none,
        fill: "none",
        dashArray: DEBUG_STYLE.dashArray,
      });
      continue;
    }

    // A declared collider with no area. It blocks nothing, but it is not
    // absent, and those are two different bugs to be looking at.
    if (collider.x1 === collider.x0 || collider.y1 === collider.y0) {
      drawn.add(object.objectId);
      rects.push({
        objectId: object.objectId,
        kind: "empty",
        ...subcellRectPx(
          {
            x0: anchorXSub + collider.x0,
            y0: anchorYSub + collider.y0,
            x1: anchorXSub + collider.x1,
            y1: anchorYSub + collider.y1,
          },
          floor,
          colliderSubcellsPerCell,
          tileSizePx,
          storeyHeightPx,
        ),
        stroke: STROKE_BY_KIND.empty,
        fill: "none",
      });
    }
    // An area-having collider that the grid did not report in this window
    // is simply not in view: its footprint reaches in, its collider does
    // not. Nothing to draw, and nothing wrong.
  }

  return rects;
}
