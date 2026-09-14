// FR148's click resolution: world point in, an [`Intent`] or an ignore
// out. Pure -- no DOM, no PixiJS, no network -- so every rule below is
// provable in vitest without a canvas. `input/pointer.ts` is the only
// thing that turns a real `pointerdown` into a call here.
//
// Two rules this module borrows rather than restates:
//   - which of several objects sharing a cell is in front is
//     `render/sort-key.ts`'s FR123 comparator, the renderer's own
//     ordering authority. There is no second ordering rule here.
//   - whether an object is visible at all is the caller's
//     `isVisible` predicate, fed from story 1.7's own visibility state.
//     If it cannot be seen it cannot be clicked (Artie's direction), and
//     a retracted wall does not block a click on what is now behind it.

import { compareDrawables, type Drawable } from "../render/sort-key";
import { toSortUnits } from "../render/sort-units";
import type { FootprintEntry, FootprintQuery } from "../world/footprint-index";
import type { Intent } from "./intent";

/** A half-open integer rect in sub-cells, relative to an object's own
 * anchor cell -- `defs/`'s `interact_at`, unchanged. */
export interface ReachRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The minimal shape a pick needs from an object's definition. An absent
 * `interactAt` *is* "this object declares no interaction" (FR148) -- there
 * is no separate flag. */
export interface PickObjectDef {
  readonly width: number;
  readonly height: number;
  readonly interactAt?: ReachRect;
}

/** The player's own continuous feet position -- the same point
 * `world/movement.ts` anchors its body on, in the same world-cell units,
 * never a snapped cell. */
export interface PickPlayer {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}

export interface PickContext {
  readonly index: FootprintQuery;
  readonly objectDefs: ReadonlyMap<number, PickObjectDef>;
  /** A layer code's FR123 rank (`render/layer-ranks.ts`) -- never a
   * literal here, the same resolver the render path uses. */
  readonly rankOf: (layerCode: number) => number;
  /** `defs/`'s generated `COLLIDER_SUBCELLS_PER_CELL`. */
  readonly subcellsPerCell: number;
  /** Story 1.7's visibility, per object instance. Absent means
   * everything is visible (the pure-unit-test case). */
  readonly isVisible?: (objectId: bigint) => boolean;
}

/** What a click resolved to. Empty ground and a prop that declares no
 * interaction both resolve to `undefined`: no intent *and* no ignore,
 * because nothing was refused -- there was nothing there to refuse
 * (Artie's direction: the cursor stays `default` and nothing happens). */
export type ClickResolution = { readonly intent: Intent } | { readonly ignored: bigint };

/** Just enough of a placed object to place its own reach rect in the
 * world -- [`FootprintEntry`] satisfies it structurally. */
export interface ReachAnchor {
  readonly anchorX: number;
  readonly anchorY: number;
}

/**
 * FR148's reachability: the player's feet are inside the object's own
 * `interact_at`, translated into world sub-cells from its anchor cell,
 * and the player is on the object's floor.
 *
 * Integers and half-open comparisons only (Tim's direction): the feet
 * position is floored to the sub-cell it is in, and the rect bounds are
 * already integers, so this is exact -- no distance, no radius, no
 * epsilon, and no way for a float to make the same position read
 * differently on two frames. A definition with no `interact_at` is never
 * reachable, because it declares no interaction at all.
 */
export function isWithinReach(
  anchor: ReachAnchor,
  def: PickObjectDef,
  player: PickPlayer,
  objectFloor: number,
  subcellsPerCell: number,
): boolean {
  const rect = def.interactAt;
  if (!rect) return false;
  if (player.floor !== objectFloor) return false;

  const feetX = Math.floor(player.x * subcellsPerCell);
  const feetY = Math.floor(player.y * subcellsPerCell);
  const x0 = anchor.anchorX * subcellsPerCell + rect.x0;
  const y0 = anchor.anchorY * subcellsPerCell + rect.y0;
  const x1 = anchor.anchorX * subcellsPerCell + rect.x1;
  const y1 = anchor.anchorY * subcellsPerCell + rect.y1;

  return feetX >= x0 && feetX < x1 && feetY >= y0 && feetY < y1;
}

/**
 * The visible object drawn last -- i.e. in front -- in the cell, or
 * `undefined` if the cell is empty or everything in it is hidden. Costs
 * exactly one cell lookup: the footprint index answers from that cell's
 * own chunk, whatever else the world holds.
 *
 * Every candidate in one cell shares that cell's own `x`/`y`, so the
 * FR123 key reduces to rank then stable id here -- but it is still the
 * real comparator that decides, not a hand-rolled "higher rank wins"
 * restatement that could drift from it.
 */
export function topmostAt(
  cellX: number,
  cellY: number,
  floor: number,
  context: PickContext,
): FootprintEntry | undefined {
  const { index, rankOf, isVisible } = context;
  let best: FootprintEntry | undefined;
  let bestKey: Drawable | undefined;

  for (const candidate of index.objectsAt(floor, cellX, cellY)) {
    if (isVisible && !isVisible(candidate.objectId)) continue;
    const key: Drawable = {
      x: toSortUnits(cellX),
      y: toSortUnits(cellY),
      rank: rankOf(candidate.layer),
      stableId: candidate.objectId,
      floor,
    };
    if (!bestKey || compareDrawables(key, bestKey) > 0) {
      best = candidate;
      bestKey = key;
    }
  }
  return best;
}

/**
 * FR148, whole: resolve the world point `(worldX, worldY)` on `floor` to
 * the object under it, and decide -- from that object's own `interact_at`
 * and the player's feet -- whether this click is an intent or an ignore.
 *
 * Exactly one of three things happens, and the caller cannot get a fourth:
 * an intent (reachable, interactable), an ignore (interactable, out of
 * reach), or nothing at all (empty ground, a prop that declares no
 * interaction, or an object whose definition this client has not got).
 */
export function resolveClick(
  worldX: number,
  worldY: number,
  floor: number,
  player: PickPlayer,
  context: PickContext,
): ClickResolution | undefined {
  const entry = topmostAt(Math.floor(worldX), Math.floor(worldY), floor, context);
  if (!entry) return undefined;

  const def = context.objectDefs.get(entry.defId);
  if (!def?.interactAt) return undefined;

  if (!isWithinReach(entry, def, player, floor, context.subcellsPerCell)) {
    return { ignored: entry.objectId };
  }
  return { intent: { objectId: entry.objectId, defId: entry.defId } };
}
