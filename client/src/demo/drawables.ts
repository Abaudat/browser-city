// Turns the committed demo fixture (`fixture.ts`) into the plain
// `Drawable`s `sort-key.ts`'s comparator orders (FR123), each also
// carrying the fields `render/visibility.ts`'s `computeVisibility` needs
// (FR120/FR121/FR122, story 1.7). Pure, zero PixiJS -- `scene.ts` is the
// only thing that turns this module's output into sprites.

import { decomposeFootprint } from "../render/decompose";
import { layerCodeByName } from "../render/layer-table";
import { type Drawable, setDrawablePosition } from "../render/sort-key";
import { toSortUnits } from "../render/sort-units";
import type { VisibilityDrawable } from "../render/visibility";
import { NO_OWNER } from "../render/visibility";
import type { OwnershipIndex } from "../world/ownership";
import { DEMO_PROPS, type DemoLayer, PLAYER_STABLE_ID } from "./fixture";

/** A `Drawable` plus what `scene.ts` needs to pick and slice a texture
 * for it, plus what `render/visibility.ts` needs to decide its
 * FR120/FR121/FR122 state -- never consulted by either comparator
 * directly. */
export interface PropDrawable extends Drawable, VisibilityDrawable {
  readonly assetKey: string;
  readonly sourceCol: number;
  readonly sourceRow: number;
  readonly footprintWidth: number;
  readonly footprintHeight: number;
}

/** The FR120 wall-stub companion's own stable-id offset: large enough that
 * it can never collide with a real prop id, small enough to read easily
 * in a debugger. Never destroys/rebuilds a sprite (Tim's direction) --
 * this is a second, permanent pool member for every near-side wall
 * segment, always present, whose own visibility never depends on
 * retraction (see its `isNearSide: false` below): when the wall itself is
 * not retracted, it draws behind the (higher-rank) wall and is invisible
 * in practice; the moment the wall's rank-30 sprite goes `hidden`, the
 * stub is what is left on screen (Artie's "shrinks to a baseboard-height
 * stub, does not vanish"). */
const STUB_ID_OFFSET = 500_000n;

/** The def ids `defs/` marks as windows (FR121) -- resolved once by the
 * caller (`world/object-defs.ts`'s `windowDefIds`), never looked up while
 * drawing. */
export interface BuildPropDrawablesOptions {
  readonly rankOf: (layer: DemoLayer) => number;
  readonly ownership: OwnershipIndex;
  readonly windowDefIds: ReadonlySet<number>;
}

const WALLS_LAYER_CODE = layerCodeByName("walls");
const STUB_LAYER_CODE = layerCodeByName("furniture");

/** Every non-player prop in the fixture, decomposed (FR125) where it
 * carries a footprint, plus one wall-stub companion drawable per near-side
 * wall cell (story 1.7). `rankOf` is the only way this function learns a
 * layer's rank -- never a literal here (see `render/layer-ranks.ts`).
 * `ownership` resolves each drawable's `ownerBuildingId` once, from the
 * ownership index, at build time -- never looked up while drawing
 * (Tim's direction). */
export function buildPropDrawables(options: BuildPropDrawablesOptions): PropDrawable[] {
  const { rankOf, ownership, windowDefIds } = options;
  const drawables: PropDrawable[] = [];
  for (const prop of DEMO_PROPS) {
    const rank = rankOf(prop.layer);
    const layerCode = layerCodeByName(prop.layer);
    const footprint = prop.footprint ?? { width: 1, height: 1 };
    const isWindow = prop.defId !== undefined && windowDefIds.has(prop.defId);
    const cells = decomposeFootprint({
      x: prop.x,
      y: prop.y,
      width: footprint.width,
      height: footprint.height,
    });
    for (const cell of cells) {
      const ownerBuildingId = ownership.ownershipAt(cell.x, cell.y, prop.floor).buildingId;
      drawables.push({
        x: toSortUnits(cell.x),
        y: toSortUnits(cell.y),
        rank,
        stableId: prop.id,
        floor: prop.floor,
        assetKey: prop.assetKey,
        sourceCol: cell.sourceCol,
        sourceRow: cell.sourceRow,
        footprintWidth: footprint.width,
        footprintHeight: footprint.height,
        layerCode,
        ownerBuildingId,
        isWindow,
        isNearSide: prop.nearSide === true,
      });

      // The FR120 wall-stub companion (Artie's direction): only for a
      // near-side wall cell, always a separate, permanent pool member at
      // the identical cell, never near-side itself (so it is never, in
      // turn, subject to retraction) and drawn at a lower rank than
      // `walls` so the tall wall sprite fully covers it when the wall is
      // not retracted.
      if (layerCode === WALLS_LAYER_CODE && prop.nearSide === true) {
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
          isNearSide: false,
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
  };
}

/** Mutates `player`'s position in place from a new continuous feet
 * position -- Quentin's direction: the render path must not allocate a
 * whole new `Drawable` object every frame the player moves, before the
 * re-sort gate is even consulted. Only `x`/`y` change here; `rank`,
 * `stableId` and the asset fields never do for the player. */
export function updatePlayerDrawable(player: PropDrawable, feetX: number, feetY: number): void {
  setDrawablePosition(player, toSortUnits(feetX), toSortUnits(feetY));
}

/** Sentinel re-exported for callers that need to compare against "no
 * building" without importing `render/visibility.ts` directly. */
export { NO_OWNER };
