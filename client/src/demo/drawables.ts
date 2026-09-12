// Turns the committed demo fixture (`fixture.ts`) into the plain
// `Drawable`s `sort-key.ts`'s comparator orders (FR123). Pure, zero
// PixiJS -- `scene.ts` is the only thing that turns this module's output
// into sprites.

import { decomposeFootprint } from "../render/decompose";
import type { Drawable } from "../render/sort-key";
import { toSortUnits } from "../render/sort-units";
import { DEMO_PROPS, type DemoLayer, PLAYER_STABLE_ID, PLAYER_START } from "./fixture";

/** A `Drawable` plus what `scene.ts` needs to pick and slice a texture
 * for it -- never consulted by the comparator itself. */
export interface PropDrawable extends Drawable {
  readonly assetKey: string;
  readonly sourceCol: number;
  readonly sourceRow: number;
  readonly footprintWidth: number;
  readonly footprintHeight: number;
}

/** Every non-player prop in the fixture, decomposed (FR125) where it
 * carries a footprint. `rankOf` is the only way this function learns a
 * layer's rank -- never a literal here (see `render/layer-ranks.ts`). */
export function buildPropDrawables(rankOf: (layer: DemoLayer) => number): PropDrawable[] {
  const drawables: PropDrawable[] = [];
  for (const prop of DEMO_PROPS) {
    const rank = rankOf(prop.layer);
    const footprint = prop.footprint ?? { width: 1, height: 1 };
    const cells = decomposeFootprint({
      x: prop.x,
      y: prop.y,
      width: footprint.width,
      height: footprint.height,
    });
    for (const cell of cells) {
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
      });
    }
  }
  return drawables;
}

/** The player's own drawable, from its continuous feet position -- never
 * snapped to a cell (Artie's direction). */
export function buildPlayerDrawable(rank: number, feetX: number, feetY: number): PropDrawable {
  return {
    x: toSortUnits(feetX),
    y: toSortUnits(feetY),
    rank,
    stableId: PLAYER_STABLE_ID,
    floor: PLAYER_START.floor,
    assetKey: "player",
    sourceCol: 0,
    sourceRow: 0,
    footprintWidth: 1,
    footprintHeight: 1,
  };
}

/** Mutates `player`'s position in place from a new continuous feet
 * position -- Quentin's direction: the render path must not allocate a
 * whole new `Drawable` object every frame the player moves, before the
 * re-sort gate is even consulted. Only `x`/`y` change; `rank`,
 * `stableId`, `floor` and the asset fields never do for the player. */
export function updatePlayerDrawable(player: PropDrawable, feetX: number, feetY: number): void {
  (player as { x: number }).x = toSortUnits(feetX);
  (player as { y: number }).y = toSortUnits(feetY);
}
