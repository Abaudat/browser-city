// FR148's click resolution: a point in, an [`Intent`] or an ignore out.
// Pure -- no DOM, no PixiJS, no network -- so every rule below is provable
// in vitest without a canvas. `input/pointer.ts` is the only thing that
// turns a real `pointerdown` into a call here.
//
// A pick is two phases, because what a player sees and what the derived
// grid holds are not the same shape:
//
//   Broad phase, by cell. The footprint index answers one cell in one
//   chunk lookup, whatever else the world holds. Objects are registered
//   in every cell their *drawn sprite* covers, not only their footprint
//   (`world/footprint-index.ts`), because our props are bottom-anchored
//   and draw upward past their own row.
//
//   Narrow phase, by drawn rect. A candidate only counts if the point is
//   inside the rect its sprite actually occupies (Artie's direction: a
//   click on any part of what you can see hits that object -- clicking
//   the lid of a tall bin must not hit the wall it is drawn over). An
//   object with no sprite has no rect and stays resolvable through its
//   own cells alone.
//
// Two rules this module borrows rather than restates: which of several
// overlapping objects is in front is `render/sort-key.ts`'s FR123
// comparator, and whether an object is visible at all is the caller's
// `isVisible` predicate, fed from story 1.7's own visibility state. If it
// cannot be seen it cannot be clicked, and a retracted wall does not
// block a click on what is now behind it.

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

/** A half-open rect in world pixels -- the space `screenPositionPx`
 * produces, before the camera's own offset and zoom. */
export interface PickRect {
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

/** Where the pointer is, in both units a pick needs: the whole cell for
 * the broad phase (`render/screen-position.ts`'s `worldCellFromScreenPx`
 * is the one thing that produces it) and the world pixel for the narrow
 * phase. Nothing here is derived from the other -- the caller converts
 * once and passes both, so this module never floors a coordinate itself. */
export interface PickPoint {
  readonly cellX: number;
  readonly cellY: number;
  readonly worldXPx: number;
  readonly worldYPx: number;
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
  /** The rect an object's sprites actually cover, in world pixels --
   * supplied by whoever built them, never measured a second time here.
   * `undefined` for an object that draws nothing, which then resolves
   * through its own footprint cells alone. */
  readonly drawnRectOf?: (objectId: bigint) => PickRect | undefined;
}

/** What a click resolved to. Empty ground and a prop that declares no
 * interaction both resolve to `undefined`: no intent *and* no ignore,
 * because nothing was refused -- there was nothing there to refuse. */
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
 *
 * This predicate is a promise about what the server will accept once
 * Epic 8 wires a reducer to `interact_at` (Derek's direction): FR173's
 * in-world mark exists only because this function said yes, so it must
 * stay identical to whatever check that reducer applies -- never a
 * second, even slightly more generous copy, which would turn the mark
 * into a lie the server then refuses.
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
 * The FR123 key a candidate is ordered by -- its own drawn row, which is
 * the row its sprite is anchored on, never the cell the pointer happens
 * to be in (a tall prop is picked from cells above its own). Exported so
 * a test can use the renderer's own sort as its oracle instead of
 * restating this rule.
 */
export function pickSortKey(
  entry: FootprintEntry,
  def: PickObjectDef | undefined,
  floor: number,
  context: Pick<PickContext, "rankOf">,
): Drawable {
  const bottomRow = entry.anchorY + Math.max(1, def?.height ?? 1) - 1;
  return {
    x: toSortUnits(entry.anchorX),
    y: toSortUnits(bottomRow),
    rank: context.rankOf(entry.layer),
    stableId: entry.objectId,
    floor,
  };
}

function containsPoint(rect: PickRect, x: number, y: number): boolean {
  return x >= rect.x0 && x < rect.x1 && y >= rect.y0 && y < rect.y1;
}

/**
 * The visible object drawn in front at `point`, or `undefined` if nothing
 * drawn covers it. Costs exactly one cell lookup: the footprint index
 * answers from that cell's own chunk, whatever else the world holds.
 */
export function topmostAt(
  point: PickPoint,
  floor: number,
  context: PickContext,
): FootprintEntry | undefined {
  const { index, isVisible, drawnRectOf, objectDefs } = context;
  let best: FootprintEntry | undefined;
  let bestKey: Drawable | undefined;

  for (const candidate of index.objectsAt(floor, point.cellX, point.cellY)) {
    if (isVisible && !isVisible(candidate.objectId)) continue;

    // An object that draws something is picked by what it draws; one
    // that draws nothing keeps the cell it was found under.
    const rect = drawnRectOf?.(candidate.objectId);
    if (rect && !containsPoint(rect, point.worldXPx, point.worldYPx)) continue;

    const key = pickSortKey(candidate, objectDefs.get(candidate.defId), floor, context);
    if (!bestKey || compareDrawables(key, bestKey) > 0) {
      best = candidate;
      bestKey = key;
    }
  }
  return best;
}

/**
 * FR148, whole: resolve `point` on `floor` to the object drawn under it,
 * and decide -- from that object's own `interact_at` and the player's
 * feet -- whether this click is an intent or an ignore.
 *
 * Exactly one of three things happens, and the caller cannot get a
 * fourth: an intent (reachable, interactable), an ignore (interactable,
 * out of reach), or nothing at all (empty ground, a prop that declares no
 * interaction, or an object whose definition this client has not got).
 */
export function resolveClick(
  point: PickPoint,
  floor: number,
  player: PickPlayer,
  context: PickContext,
): ClickResolution | undefined {
  const entry = topmostAt(point, floor, context);
  if (!entry) return undefined;

  const def = context.objectDefs.get(entry.defId);
  if (!def?.interactAt) return undefined;

  if (!isWithinReach(entry, def, player, floor, context.subcellsPerCell)) {
    return { ignored: entry.objectId };
  }
  return { intent: { objectId: entry.objectId, defId: entry.defId } };
}
