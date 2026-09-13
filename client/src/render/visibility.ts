// FR120/FR121/FR122's visibility rules, and nothing else (Tim/Quentin,
// story 1.7). Zero PixiJS: pure arithmetic over plain records, exactly
// like `sort-key.ts` -- this module is the sole place these three rules
// live. `render/pixi-visibility.ts` is the only file allowed to turn its
// output into `sprite.visible`/`sprite.alpha`.
//
// Retraction is keyed on the building/room ownership id, never on
// proximity: [`isRetracted`] never reads a screen-space distance, a
// player position or a radius, only ids and the drawable's own near-side
// flag. Floor culling compares floor by *sign*, never against a literal
// `-1` (FR122's "the subway is floor -1" is a fact about this world's
// content, not a magic number this module hard-codes).

import { layerCodeByName } from "./layer-table";

export type VisibilityState = "hidden" | "translucent" | "normal";

/** The viewer's own enclosure identity: which building it is inside (or
 * [`NO_OWNER`] if none) and which floor it stands on -- resolved once, on
 * an enclosure or floor change, never every frame (Tim's direction). */
export interface VisibilityViewer {
  readonly floor: number;
  readonly buildingId: bigint;
}

/** The sentinel "no owner" id (mirrors `world/ownership.ts`'s `NO_OWNER`,
 * restated here rather than imported so this module stays free of any
 * dependency beyond `layer-table.ts`). */
export const NO_OWNER = 0n;

/** The minimal shape [`computeVisibility`] needs from a drawable --
 * structural, so a caller's own richer drawable type (`demo/drawables.ts`'s
 * `PropDrawable`) can be passed directly with no adapter object. */
export interface VisibilityDrawable {
  readonly floor: number;
  readonly layerCode: number;
  /** [`NO_OWNER`] means the drawable belongs to no building (street
   * furniture, a lamppost). Resolved once when the drawable is built, from
   * the ownership index -- never looked up while drawing. */
  readonly ownerBuildingId: bigint;
  /** A window wall tile (`defs/`'s `[[object]] window = true`) draws
   * semi-transparently and lets the furniture behind it show through
   * (FR121). */
  readonly isWindow: boolean;
  /** Only a south-facing (front) wall run occludes the room from the
   * camera in this 3/4 view (Artie's direction) -- side walls, party
   * walls and the back wall are never near-side and never retract. */
  readonly isNearSide: boolean;
}

const WALLS_LAYER_CODE = layerCodeByName("walls");

/** FR122: two floors of opposite sign are never co-visible. `viewerFloor
 * >= 0` (the street, or any storey above it) culls every floor `< 0` (the
 * subway); `viewerFloor < 0` culls every floor `>= 0`. Compared by sign
 * only -- never against the literal `-1` -- so a second below-ground floor
 * added later culls the same way with no change here. */
export function isFloorCulled(viewerFloor: number, drawableFloor: number): boolean {
  return viewerFloor >= 0 ? drawableFloor < 0 : drawableFloor >= 0;
}

/** FR120: a near-side wall of the building the viewer occupies is
 * retracted -- keyed on the building ownership id alone, never on
 * distance. A wall with a different owner, or [`NO_OWNER`], is never
 * retracted, however close the viewer stands to it (the "not proximity"
 * acceptance criterion, restated as a pure predicate here so
 * `inv_retraction_keyed_on_ownership` can hold it to arbitrary positions
 * that share an ownership id, not just one hand-walked example). */
export function isRetracted(viewer: VisibilityViewer, drawable: VisibilityDrawable): boolean {
  if (drawable.layerCode !== WALLS_LAYER_CODE) return false;
  if (!drawable.isNearSide) return false;
  if (drawable.ownerBuildingId === NO_OWNER) return false;
  return drawable.ownerBuildingId === viewer.buildingId;
}

/** Artie's direction, story 1.7: while the viewer is inside an enclosure,
 * that same building's floors *above* the viewer's own are culled too --
 * otherwise an upper storey's walls, shifted up only by the FR124 screen
 * offset, draw over the room the player just opened. The same
 * per-enclosure, ownership-keyed rule as retraction (never proximity),
 * just applied to every layer of the building above, not only its walls.
 * Never fires for [`NO_OWNER`] (the street is nobody's "storey above"). */
export function isStoreyAboveCulled(
  viewer: VisibilityViewer,
  drawable: VisibilityDrawable,
): boolean {
  if (viewer.buildingId === NO_OWNER) return false;
  if (drawable.ownerBuildingId !== viewer.buildingId) return false;
  return drawable.floor > viewer.floor;
}

/**
 * The one function every one of FR120/FR121/FR122's rules is decided by,
 * in a fixed order: floor culling first (a drawable on a co-invisible
 * floor is simply `hidden`, regardless of anything else about it), then
 * storey-above culling, then retraction (a retracted near-side wall is
 * `hidden`), then the window rule (a non-hidden window drawable is
 * `translucent`) -- anything else is `normal`.
 */
export function computeVisibility(
  viewer: VisibilityViewer,
  drawable: VisibilityDrawable,
): VisibilityState {
  if (isFloorCulled(viewer.floor, drawable.floor)) return "hidden";
  if (isStoreyAboveCulled(viewer, drawable)) return "hidden";
  if (isRetracted(viewer, drawable)) return "hidden";
  if (drawable.isWindow) return "translucent";
  return "normal";
}
