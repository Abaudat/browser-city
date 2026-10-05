// Whether the player's body can stand somewhere on the real collision grid:
// one pure answer shared by the scene's mount-time checks and the tests, so
// "standable" never means two things. Half-open rects, so touching a face is
// not overlapping.

import type { CollisionGridQuery } from "./collision-grid";
import type { MovementConfig } from "./movement";

/** Whether the body, with its horizontal centre at `cx` and its feet at
 * `feet` (sub-cell units), overlaps no collider entry on `floor`. An overlap
 * test, not a probe step: the resolver never blocks a body that already
 * overlaps a collider. */
export function isBodyClear(
  world: CollisionGridQuery,
  config: MovementConfig,
  floor: number,
  cx: number,
  feet: number,
): boolean {
  const s = config.subcellsPerCell;
  const halfWidth = config.bodyWidthSubcells / 2;
  const body = {
    x0: cx - halfWidth,
    x1: cx + halfWidth,
    y0: feet - config.bodyHeightSubcells,
    y1: feet,
  };
  for (let cy = Math.floor(body.y0 / s); cy <= Math.floor((body.y1 - 1) / s); cy++) {
    for (let cellX = Math.floor(body.x0 / s); cellX <= Math.floor((body.x1 - 1) / s); cellX++) {
      for (const { rect } of world.entriesInCell(floor, cellX, cy)) {
        if (rect.x0 < body.x1 && body.x0 < rect.x1 && rect.y0 < body.y1 && body.y0 < rect.y1) {
          return false;
        }
      }
    }
  }
  return true;
}

/** Whether a whole cell can be stood on: the body, centred in the cell the
 * way a floor transition lands it, overlaps no collider. */
export function isCellStandable(
  world: CollisionGridQuery,
  config: MovementConfig,
  x: number,
  y: number,
  floor: number,
): boolean {
  const s = config.subcellsPerCell;
  return isBodyClear(world, config, floor, (x + 0.5) * s, (y + 0.5) * s);
}
