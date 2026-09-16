// The collision overlay's pure half (story 1.12, AC2): world state in,
// plain records out. No DOM, no `pixi.js`, nothing drawn -- so what the
// overlay claims about the collision system is provable in a node test,
// at the same bar as the collision system itself. `collision-overlay.ts`
// turns these records into elements and decides nothing.
//
// Two sources, each for what only it can know (Quentin/Tim's directions):
//
//   - a real collider comes from the *live collision grid*, the same
//     `entriesInCell` read `world/movement.ts`'s resolver makes. Never a
//     second expansion of `defs/`: an overlay reading its own copy of the
//     world could happily confirm a bug that is not there.
//   - "this object declares no collider at all" is a fact the grid cannot
//     hold, by construction (FR128: absence of a collider *is*
//     walkability), so that one state -- and only that one -- comes from
//     the world index's own object enumeration.
//
// Both reads are bounded by the viewport, never by how much world exists.

import { subcellRectPx } from "../render/screen-position";
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
  const floor = view.viewerFloor();
  const { colliderSubcellsPerCell, tileSizePx, storeyHeightPx } = view;

  const rects: CollisionRect[] = [];
  const drawn = new Set<bigint>();

  // The live grid first: one entry per (object, cell) it covers, so the
  // same object is reported by every cell its collider spans.
  for (let cellY = bounds.cellY0; cellY <= bounds.cellY1; cellY++) {
    for (let cellX = bounds.cellX0; cellX <= bounds.cellX1; cellX++) {
      for (const entry of view.entriesInCell(floor, cellX, cellY)) {
        if (drawn.has(entry.objectId)) continue;
        drawn.add(entry.objectId);
        const hasArea = entry.rect.x1 > entry.rect.x0 && entry.rect.y1 > entry.rect.y0;
        const kind: CollisionRectKind = hasArea ? "collider" : "empty";
        rects.push({
          objectId: entry.objectId,
          kind,
          ...subcellRectPx(entry.rect, floor, colliderSubcellsPerCell, tileSizePx, storeyHeightPx),
          stroke: STROKE_BY_KIND[kind],
          fill: hasArea ? DEBUG_STYLE.palette.collider : "none",
        });
      }
    }
  }

  // Then the one state the grid cannot report: no collider at all. The
  // footprint is what there is to show -- there is no rect to draw
  // otherwise, and "nothing drawn here" would be indistinguishable from
  // "this overlay is broken", which is the whole failure mode AC2 names.
  for (const object of view.objects(bounds)) {
    if (object.collider || drawn.has(object.objectId)) continue;
    drawn.add(object.objectId);
    rects.push({
      objectId: object.objectId,
      kind: "none",
      ...subcellRectPx(
        {
          x0: object.anchorX * colliderSubcellsPerCell,
          y0: object.anchorY * colliderSubcellsPerCell,
          x1: (object.anchorX + object.width) * colliderSubcellsPerCell,
          y1: (object.anchorY + object.height) * colliderSubcellsPerCell,
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
  }

  return rects;
}
