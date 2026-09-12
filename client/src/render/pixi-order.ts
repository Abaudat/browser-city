// The one Pixi-touching ordering adapter (Tim/Quentin, story 1.6 cycle
// 2): the sole place `sort-key.ts`'s comparator output reaches a real
// display list. Everything here is sprite construction and container
// wiring, nothing that decides an order or a position -- it stays in
// `src/render/` (unlike `src/demo/`) because it outlives the demo scene:
// the next story that builds a real, subscribed drawable pool calls this
// same function.

import type { Container } from "pixi.js";
import { type Drawable, sortByDrawable } from "./sort-key";

/** One pool member: a `Drawable` (what the comparator reads) plus the
 * display object it owns. */
export interface OrderedMember<D extends Drawable = Drawable> {
  readonly drawable: D;
  readonly view: Container;
}

// Hoisted once, module-level (Quentin's direction: no fresh accessor
// closure per re-sort) -- the one thing `sortByDrawable` needs to treat
// an `OrderedMember` as the `Drawable` it carries.
function memberDrawable(member: OrderedMember): Drawable {
  return member.drawable;
}

/**
 * Sorts `members` in place by `compareDrawables` and makes
 * `poolContainer`'s children match that order -- the one and only
 * ordering authority (`poolContainer.sortableChildren` must stay
 * `false`). Reorders in a single pass: `removeChildren()` then one
 * append per member, never `addChild` on an already-parented child
 * (which in Pixi v8 costs an `indexOf` + `splice` to detach first, so
 * naively re-attaching N already-parented children is O(N^2) churn on
 * every re-sort -- Tim's direction).
 *
 * Writes the resulting `stableId` order into `outOrder` (cleared and
 * refilled in place) rather than returning a freshly allocated array, so
 * a caller that re-sorts every time a moving character crosses a sort
 * unit never allocates for it either.
 */
export function applyDepthOrder(
  poolContainer: Container,
  members: OrderedMember[],
  outOrder: bigint[],
): void {
  sortByDrawable(members, memberDrawable);

  poolContainer.removeChildren();
  outOrder.length = 0;
  for (const member of members) {
    poolContainer.addChild(member.view);
    outOrder.push(member.drawable.stableId);
  }
}
