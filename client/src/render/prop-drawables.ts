// Turns streamed `placed_object` rows into the plain `Drawable`s
// `sort-key.ts`'s comparator orders (FR123), each also carrying the fields
// `visibility.ts`'s `computeVisibility` needs (FR120/FR121/FR122). Pure,
// zero PixiJS -- `world-scene.ts` is the only thing that turns this
// module's output into sprites.
//
// A wall's owner and near-side-ness are read from the live ownership index
// on demand and re-derived whenever it changed, never frozen at build
// time: building areas stream in beside the walls they own, in no
// guaranteed order, and a chunk seam must never decide a wall's facing.

import type { OwnershipIndex } from "../world/ownership";
import { NO_OWNER } from "../world/ownership";
import { decomposeFootprint } from "./decompose";
import { layerCodeByName } from "./layer-table";
import { cellBottomCentre } from "./screen-position";
import { type Drawable, setDrawableFloor, setDrawablePosition } from "./sort-key";
import { toSortUnits } from "./sort-units";
import { isNearSideWall, type VisibilityDrawable } from "./visibility";

/** The one stable id of the local player's drawable. */
export const PLAYER_STABLE_ID = 1000n;

/** Every field a `Drawable` carries regardless of where its art comes
 * from, plus what `visibility.ts` needs to decide its FR120/FR121/FR122
 * state -- never consulted by either comparator directly. */
interface PropDrawableBase extends Drawable, VisibilityDrawable {
  readonly sourceCol: number;
  readonly sourceRow: number;
  readonly footprintWidth: number;
  readonly footprintHeight: number;
}

/** A drawable for a prop placed by a real `defs/objects` id: its texture
 * comes only from `atlas-pages.ts`'s `AtlasPageLoader.objectCellTexture`. */
export interface PropDrawableByDef extends PropDrawableBase {
  readonly defId: number;
  /** Source pixels the sprite is drawn above its sort anchor (the wall-top
   * band over a doorway: its threshold's own sprite height); sorting and
   * visibility are unchanged. */
  readonly liftSourcePx?: number;
}

/** A drawable keyed by a raw asset name -- the characters (player, remote
 * players), which have no `defs/objects` entry. */
export interface PropDrawableByAsset extends PropDrawableBase {
  readonly assetKey: string;
}

export type PropDrawable = PropDrawableByDef | PropDrawableByAsset;

/** Narrows a [`PropDrawable`] to its `defId` variant. */
export function isDefPropDrawable(drawable: PropDrawable): drawable is PropDrawableByDef {
  return "defId" in drawable;
}

/** The wall-stub companion's own stable-id offset: large enough that it
 * can never collide with a real object id, small enough to read easily in
 * a debugger. Always present for a wall cell, always drawn at a lower rank
 * than `walls`; its visibility is `computeVisibility`'s `isStub` rule, the
 * inverse of its parent's retraction. */
export const STUB_ID_OFFSET = 500_000_000_000n;

/** The wall-top band companion's stable-id offset: a threshold is shorter
 * than the wall run beside it; the band is the flush swatch drawn above
 * the threshold's own sprite height, retracted with the threshold. */
export const BAND_ID_OFFSET = 600_000_000_000n;

/** One streamed row, as the builder reads it. */
export interface PlacedRowView {
  readonly objectId: bigint;
  readonly defId: number;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly layer: number;
}

export interface BuildPropDrawablesOptions {
  /** The rank of a layer code (`layer-ranks.ts`'s `resolveRank`). */
  readonly rankOf: (layerCode: number) => number;
  readonly ownership: OwnershipIndex;
  readonly windowDefIds: ReadonlySet<number>;
  /** The def ids carrying the `threshold` role. */
  readonly thresholdDefIds: ReadonlySet<number>;
  /** The flat wall swatch a stub and a doorway's band are drawn with
   * (`render.wall_stub_object_id`). */
  readonly wallStubDefId: number;
  /** Real `defs/objects` footprints: a row's own extent is read from its
   * def, never restated on the row. */
  readonly objectDefs: ReadonlyMap<
    number,
    {
      readonly width: number;
      readonly height: number;
      readonly spriteHeightPx?: number;
      readonly undrawn?: true;
    }
  >;
}

const WALLS_LAYER_CODE = layerCodeByName("walls");
const STUB_LAYER_CODE = layerCodeByName("furniture");

/** A drawable's ownership-derived fields, read lazily and re-derived when
 * the ownership index moved. */
function ownershipFields(
  ownership: OwnershipIndex,
  x: number,
  y: number,
  floor: number,
  isWall: boolean,
): { read(): { owner: bigint; near: boolean } } {
  let revision = -1;
  let owner = NO_OWNER;
  let near = false;
  return {
    read() {
      if (revision !== ownership.revision) {
        owner = ownership.ownershipAt(x, y, floor).buildingId;
        near = isWall && isNearSideWall(ownership, x, y, floor, owner);
        revision = ownership.revision;
      }
      return { owner, near };
    },
  };
}

/** Every drawable of `rows`, decomposed (FR125) where a def carries a
 * footprint, plus one wall-stub companion per wall cell and one band per
 * doorway. `rankOf` is the only way this function learns a layer's rank. */
export function buildPropDrawables(
  rows: Iterable<PlacedRowView>,
  options: BuildPropDrawablesOptions,
): PropDrawable[] {
  const { rankOf, ownership, windowDefIds, thresholdDefIds, objectDefs, wallStubDefId } = options;
  const drawables: PropDrawable[] = [];
  for (const row of rows) {
    const def = objectDefs.get(row.defId);
    if (!def) {
      throw new Error(`buildPropDrawables: objectDefs has no entry for defId ${row.defId}`);
    }
    // An undrawn flight is walk data: nothing to draw.
    if (def.undrawn) continue;
    const rank = rankOf(row.layer);
    const isWallLayer = row.layer === WALLS_LAYER_CODE;
    const isWindow = windowDefIds.has(row.defId);
    const isThreshold = thresholdDefIds.has(row.defId);
    const cells = decomposeFootprint({
      x: row.x,
      y: row.y,
      width: def.width,
      height: def.height,
    });
    for (const cell of cells) {
      const fields = ownershipFields(ownership, cell.x, cell.y, row.floor, isWallLayer);
      // `Drawable.x`/`y` are the drawn bottom-centre point, in sort units.
      const anchor = cellBottomCentre(cell.x, cell.y);
      const x = toSortUnits(anchor.x);
      const y = toSortUnits(anchor.y);
      drawables.push({
        x,
        y,
        rank,
        stableId: row.objectId,
        floor: row.floor,
        sourceCol: cell.sourceCol,
        sourceRow: cell.sourceRow,
        footprintWidth: def.width,
        footprintHeight: def.height,
        layerCode: row.layer,
        get ownerBuildingId() {
          return fields.read().owner;
        },
        isWindow,
        get isNearSide() {
          return fields.read().near;
        },
        isStub: false as const,
        defId: row.defId,
      });
      if (isThreshold) {
        drawables.push({
          x,
          y,
          rank,
          stableId: row.objectId + BAND_ID_OFFSET,
          floor: row.floor,
          defId: wallStubDefId,
          sourceCol: 0,
          sourceRow: 0,
          footprintWidth: 1,
          footprintHeight: 1,
          layerCode: row.layer,
          get ownerBuildingId() {
            return fields.read().owner;
          },
          isWindow: false,
          get isNearSide() {
            return fields.read().near;
          },
          isStub: false,
          liftSourcePx: def.spriteHeightPx ?? 0,
        });
      } else if (isWallLayer) {
        // A doorway has no wall stub: an opening stays an opening.
        drawables.push({
          x,
          y,
          rank: rankOf(STUB_LAYER_CODE),
          stableId: row.objectId + STUB_ID_OFFSET,
          floor: row.floor,
          defId: wallStubDefId,
          sourceCol: 0,
          sourceRow: 0,
          footprintWidth: 1,
          footprintHeight: 1,
          layerCode: STUB_LAYER_CODE,
          get ownerBuildingId() {
            return fields.read().owner;
          },
          isWindow: false,
          get isNearSide() {
            return fields.read().near;
          },
          isStub: true,
        });
      }
    }
  }
  return drawables;
}

/** A character's own drawable (the player by default), from its continuous
 * feet position -- never snapped to a cell. `feetX`/`feetY` already are the
 * drawn bottom-centre point. A character is never retracted or
 * window-translucent, and its own `ownerBuildingId` is never read. */
export function buildCharacterDrawable(
  rank: number,
  feetX: number,
  feetY: number,
  floor: number,
  stableId: bigint = PLAYER_STABLE_ID,
  assetKey = "player",
): PropDrawable {
  return {
    x: toSortUnits(feetX),
    y: toSortUnits(feetY),
    rank,
    stableId,
    floor,
    assetKey,
    sourceCol: 0,
    sourceRow: 0,
    footprintWidth: 1,
    footprintHeight: 1,
    layerCode: layerCodeByName("characters"),
    ownerBuildingId: NO_OWNER,
    isWindow: false,
    isNearSide: false,
    isStub: false,
  };
}

/** Remote players' tie-breaker ids: one reserved range, far above every
 * placed object's id, handed out on spawn. Only the sort comparator reads
 * them; they need not agree across clients. */
export const REMOTE_STABLE_ID_BASE = 1n << 40n;

/** Mutates `player`'s position (and, on a floor transition, its own
 * `floor`) in place from a new continuous feet position: the render path
 * must not allocate a whole new `Drawable` every frame the player moves. */
export function updateCharacterDrawable(
  player: PropDrawable,
  feetX: number,
  feetY: number,
  floor: number,
): void {
  setDrawablePosition(player, toSortUnits(feetX), toSortUnits(feetY));
  setDrawableFloor(player, floor);
}
