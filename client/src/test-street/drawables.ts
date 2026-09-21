// Turns the committed street fixture (`fixture.ts`) into the plain
// `Drawable`s `sort-key.ts`'s comparator orders (FR123), each also
// carrying the fields `render/visibility.ts`'s `computeVisibility` needs
// (FR120/FR121/FR122, story 1.7). Pure, zero PixiJS -- `scene.ts` is the
// only thing that turns this module's output into sprites.

import { decomposeFootprint } from "../render/decompose";
import { layerCodeByName } from "../render/layer-table";
import { type Drawable, setDrawableFloor, setDrawablePosition } from "../render/sort-key";
import { toSortUnits } from "../render/sort-units";
import { isNearSideWall, type VisibilityDrawable } from "../render/visibility";
import { NO_OWNER, type OwnershipIndex } from "../world/ownership";
import {
  isDefStreetProp,
  PLAYER_STABLE_ID,
  STREET_PROPS,
  type StreetFootprint,
  type StreetLayer,
  type StreetPropByDef,
} from "./fixture";

/** Every field a `Drawable` carries regardless of where its art comes
 * from, plus what `render/visibility.ts` needs to decide its
 * FR120/FR121/FR122 state -- never consulted by either comparator
 * directly. */
interface PropDrawableBase extends Drawable, VisibilityDrawable {
  readonly sourceCol: number;
  readonly sourceRow: number;
  readonly footprintWidth: number;
  readonly footprintHeight: number;
  /** Which run a `wallTile`/`wallStub` drawable belongs to (Artie's
   * cycle-2 direction) -- `scene.ts`'s own swatch picker reads this, never
   * a decomposed cell's own footprint aspect ratio (which cannot tell a
   * one-cell-wide front wall pier from a one-cell side wall). Copied
   * straight from `StreetProp.wallOrientation`, defaulting to `"horizontal"`
   * for every prop that does not declare one -- meaningless for anything
   * that is not a wall, but always present so no caller needs an
   * `undefined` branch. */
  readonly wallOrientation: "horizontal" | "vertical";
}

/** A drawable for a prop placed by a real `defs/objects` id (story 2.13):
 * its texture comes only from `render/def-texture.ts`, resolved through
 * `render/atlas-pages.ts`'s `AtlasPageLoader` -- never carries `assetKey`. */
export interface PropDrawableByDef extends PropDrawableBase {
  readonly defId: number;
}

/** A drawable for a prop placed by a hand-picked asset key into `scene.ts`'s
 * own raw texture table -- never carries `defId`. */
export interface PropDrawableByAsset extends PropDrawableBase {
  readonly assetKey: string;
}

/** A `Drawable` plus what `scene.ts` needs to pick and slice a texture for
 * it -- a discriminated union (Tim's/Quentin's direction, story 2.13): a
 * `defId` drawable has no `assetKey` field at all, and an `assetKey`
 * drawable has no `defId`. */
export type PropDrawable = PropDrawableByDef | PropDrawableByAsset;

/** Narrows a [`PropDrawable`] to its `defId` variant. */
export function isDefPropDrawable(drawable: PropDrawable): drawable is PropDrawableByDef {
  return "defId" in drawable;
}

/** The FR120 wall-stub companion's own stable-id offset: large enough that
 * it can never collide with a real prop id, small enough to read easily
 * in a debugger. Never destroys/rebuilds a sprite (Tim's direction) --
 * this is a second, permanent pool member for every near-side wall
 * segment, always present, drawn at a lower rank than `walls` so the tall
 * wall sprite fully covers it when the wall is not retracted. Its own
 * visibility is `computeVisibility`'s `isStub` rule (story 1.7 cycle 2):
 * the *inverse* of its parent's own retraction, driven from the same
 * `isNearSide`/`ownerBuildingId` the parent carries -- never `isNearSide:
 * false` (that would make it permanently visible, showing through a
 * translucent window as a grey block over the furniture even while the
 * real wall is drawn -- Artie's cycle-2 finding). */
const STUB_ID_OFFSET = 500_000n;

/** The def ids `defs/` marks as windows (FR121) -- resolved once by the
 * caller (`world/object-defs.ts`'s `windowDefIds`), never looked up while
 * drawing. */
export interface BuildPropDrawablesOptions {
  readonly rankOf: (layer: StreetLayer) => number;
  readonly ownership: OwnershipIndex;
  readonly windowDefIds: ReadonlySet<number>;
  /** Real `defs/objects` footprints (story 2.13, Tim's direction, cycle
   * 2): a `defId` row's own extent is read from here, from the resolved
   * def's own `width`/`height`, never a hand-restated `footprint` field
   * on the row itself -- `scene.ts`'s own `objectDefs` (`world/object-defs.
   * ts`'s `objectDefsById`), so this can never fall out of step with the
   * def's own real art the way a restated number could. */
  readonly objectDefs: ReadonlyMap<number, { readonly width: number; readonly height: number }>;
}

/** A `defId` row's own extent, read from the resolved def -- throws
 * naming the def when `objectDefs` has no entry for it, rather than
 * silently falling back to a 1x1 footprint for a row this street placed
 * by a real id (Tim's direction: never a hand-restated number, and never
 * a silent wrong one either). */
function defFootprint(
  prop: StreetPropByDef,
  objectDefs: BuildPropDrawablesOptions["objectDefs"],
): StreetFootprint {
  const source = objectDefs.get(prop.defId);
  if (!source) {
    throw new Error(`buildPropDrawables: objectDefs has no entry for defId ${prop.defId}`);
  }
  return { width: source.width, height: source.height };
}

const WALLS_LAYER_CODE = layerCodeByName("walls");
const STUB_LAYER_CODE = layerCodeByName("furniture");

/** Every non-player prop in the fixture, decomposed (FR125) where it
 * carries a footprint, plus one wall-stub companion drawable per near-side
 * wall cell (story 1.7). `rankOf` is the only way this function learns a
 * layer's rank -- never a literal here (see `render/layer-ranks.ts`).
 * `ownership` resolves each drawable's `ownerBuildingId` once, from the
 * ownership index, at build time -- never looked up while drawing
 * (Tim's direction). Near-side-ness (FR120) is computed the same way, per
 * cell, from `render/visibility.ts`'s `isNearSideWall` -- a pure function
 * of ownership and cell coordinates, never a hand-authored fixture flag
 * (Tim's direction: a generated building must retract correctly with no
 * fixture-only tag to remember). */
export function buildPropDrawables(options: BuildPropDrawablesOptions): PropDrawable[] {
  const { rankOf, ownership, windowDefIds, objectDefs } = options;
  const drawables: PropDrawable[] = [];
  for (const prop of STREET_PROPS) {
    const rank = rankOf(prop.layer);
    const layerCode = layerCodeByName(prop.layer);
    const footprint = isDefStreetProp(prop)
      ? defFootprint(prop, objectDefs)
      : (prop.footprint ?? { width: 1, height: 1 });
    const isDef = isDefStreetProp(prop);
    const isWindow = isDef && windowDefIds.has(prop.defId);
    const cells = decomposeFootprint({
      x: prop.x,
      y: prop.y,
      width: footprint.width,
      height: footprint.height,
    });
    for (const cell of cells) {
      const ownerBuildingId = ownership.ownershipAt(cell.x, cell.y, prop.floor).buildingId;
      const isNearSide =
        layerCode === WALLS_LAYER_CODE &&
        isNearSideWall(ownership, cell.x, cell.y, prop.floor, ownerBuildingId);
      const common = {
        x: toSortUnits(cell.x),
        y: toSortUnits(cell.y),
        rank,
        stableId: prop.id,
        floor: prop.floor,
        sourceCol: cell.sourceCol,
        sourceRow: cell.sourceRow,
        footprintWidth: footprint.width,
        footprintHeight: footprint.height,
        layerCode,
        ownerBuildingId,
        isWindow,
        isNearSide,
        isStub: false as const,
        wallOrientation: prop.wallOrientation ?? ("horizontal" as const),
      };
      drawables.push(
        isDef ? { ...common, defId: prop.defId } : { ...common, assetKey: prop.assetKey },
      );

      // The FR120 wall-stub companion (Artie's direction): only for a
      // near-side wall cell, always a separate, permanent pool member at
      // the identical cell. Carries the same `isNearSide`/`ownerBuildingId`
      // as its parent -- `isStub: true` is what tells `computeVisibility`
      // to invert that into "hidden while the parent shows, normal while
      // it's retracted" rather than applying the ordinary retraction rule
      // a real wall follows.
      if (isNearSide) {
        drawables.push({
          x: toSortUnits(cell.x),
          y: toSortUnits(cell.y),
          rank: rankOf("furniture"),
          stableId: prop.id + STUB_ID_OFFSET,
          floor: prop.floor,
          assetKey: "wallStub",
          sourceCol: 0,
          sourceRow: 0,
          footprintWidth: 1,
          footprintHeight: 1,
          layerCode: STUB_LAYER_CODE,
          ownerBuildingId,
          isWindow: false,
          isNearSide: true,
          isStub: true,
          wallOrientation: prop.wallOrientation ?? "horizontal",
        });
      }
    }
  }
  return drawables;
}

/** The player's own drawable, from its continuous feet position -- never
 * snapped to a cell (Artie's direction). The player is never itself
 * retracted or window-translucent, and its own `ownerBuildingId` is never
 * read by anything (the viewer's building identity is a separate concept,
 * `render/visibility.ts`'s `VisibilityViewer.buildingId`, tracked by
 * `scene.ts`) -- `NO_OWNER` here is a fixed, inert value, not something
 * that needs recomputing as the player moves. `floor` changes only on a
 * floor transition (`scene.ts` rebuilds this drawable then, a rare event,
 * never every frame). */
export function buildPlayerDrawable(
  rank: number,
  feetX: number,
  feetY: number,
  floor: number,
): PropDrawable {
  return {
    x: toSortUnits(feetX),
    y: toSortUnits(feetY),
    rank,
    stableId: PLAYER_STABLE_ID,
    floor,
    assetKey: "player",
    sourceCol: 0,
    sourceRow: 0,
    footprintWidth: 1,
    footprintHeight: 1,
    layerCode: layerCodeByName("characters"),
    ownerBuildingId: NO_OWNER,
    isWindow: false,
    isNearSide: false,
    isStub: false,
    wallOrientation: "horizontal",
  };
}

/** Mutates `player`'s position (and, on a floor transition, its own
 * `floor`) in place from a new continuous feet position -- Quentin's
 * direction: the render path must not allocate a whole new `Drawable`
 * object every frame the player moves, before the re-sort gate is even
 * consulted. `floor` must be kept current too (story 1.7): a player
 * drawable left on its pre-transition floor reads as floor-culled
 * (FR122) from its own new position the instant it lands -- the player
 * itself would be invisible in its own new enclosure. `rank`, `stableId`
 * and the asset fields never change for the player. */
export function updatePlayerDrawable(
  player: PropDrawable,
  feetX: number,
  feetY: number,
  floor: number,
): void {
  setDrawablePosition(player, toSortUnits(feetX), toSortUnits(feetY));
  setDrawableFloor(player, floor);
}
