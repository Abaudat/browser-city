// The one Pixi-touching visibility adapter (Tim's direction, story 1.7):
// the sole place `visibility.ts`'s pure result turns into
// `sprite.visible`/`sprite.alpha`. Mirrors `pixi-order.ts`'s role for the
// sort key. Hiding means `visible = false` -- sprites are never destroyed
// or rebuilt, and the pool is never reordered or split by floor here.
//
// Unlike `pixi-order.ts` (which always re-applies when called, leaving the
// re-sort gate to its caller), this adapter owns its own gate: it recomputes
// nothing unless the viewer's own `(floor, buildingId)` tuple actually
// changed since the last call, so a street of static props costs nothing
// per frame the player has not crossed into a new enclosure or floor
// (Tim's direction).

import type { Sprite } from "pixi.js";
import { computeVisibility, type VisibilityDrawable, type VisibilityViewer } from "./visibility";

/** One visibility-managed pool member: a [`VisibilityDrawable`] (what
 * `computeVisibility` reads) plus the sprite it owns. Structural over
 * `visible`/`alpha` only, so a fake sprite-like object can stand in for
 * unit tests with no real Pixi `Sprite`. */
export interface VisibilityMember<D extends VisibilityDrawable = VisibilityDrawable> {
  readonly drawable: D;
  readonly view: Pick<Sprite, "visible" | "alpha">;
}

function viewerEquals(a: VisibilityViewer | undefined, b: VisibilityViewer): boolean {
  return a !== undefined && a.floor === b.floor && a.buildingId === b.buildingId;
}

/**
 * Applies FR120/FR121/FR122's visibility to every member's sprite,
 * gated on the viewer's own enclosure/floor tuple actually changing since
 * the last call (or never having been applied at all). `windowAlpha` is
 * `render.window_alpha`'s resolved balance value -- never a literal here.
 */
export class VisibilityApplier {
  private lastViewer: VisibilityViewer | undefined;

  /** Applies visibility unconditionally, ignoring the gate -- the first
   * call after mount and any caller that must force a re-apply (e.g. the
   * pool membership itself changed) uses this. */
  applyForce(
    members: readonly VisibilityMember[],
    viewer: VisibilityViewer,
    windowAlpha: number,
  ): void {
    for (const member of members) {
      const state = computeVisibility(viewer, member.drawable);
      member.view.visible = state !== "hidden";
      member.view.alpha = state === "translucent" ? windowAlpha : 1;
    }
    this.lastViewer = viewer;
  }

  /** Applies visibility only if `viewer` differs from the last viewer this
   * instance applied (or none has been applied yet) -- the gate Tim's
   * direction describes. Returns whether it actually wrote anything, so a
   * caller can tell a no-op frame from a real re-apply without inspecting
   * sprite state itself. */
  apply(
    members: readonly VisibilityMember[],
    viewer: VisibilityViewer,
    windowAlpha: number,
  ): boolean {
    if (viewerEquals(this.lastViewer, viewer)) return false;
    this.applyForce(members, viewer, windowAlpha);
    return true;
  }
}
