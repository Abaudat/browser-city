// The story 1.6 demo scene's Pixi mount -- the only file besides
// `bootstrap.ts` and `render/pixi-order.ts` allowed to import `pixi.js`.
// Ordering itself is `render/pixi-order.ts`'s job; this file's whole job
// is texture loading, sprite construction, container wiring, keyboard
// input and the mount-time geometry guard. Real LimeZu sprites only,
// loaded straight out of the repo-root `ModernTileset/` (Artie's
// direction: no coloured rectangles, no new PNGs) -- nearest-neighbour
// filtering, integer world-pixel positions rounded before the zoom scale,
// bottom-centre sprite anchors pinned to each drawable's own cell.
//
// D17: no debug text, no rank numbers, no sort-key readouts on the
// canvas. This module draws the scene and nothing else.

import { type Application, Assets, Container, Rectangle, Sprite, Texture } from "pixi.js";
import { layerCodeByName } from "../render/layer-table";
import { applyDepthOrder, type OrderedMember } from "../render/pixi-order";
import { screenPositionPx } from "../render/screen-position";
import { fromSortUnits } from "../render/sort-units";
import {
  buildPlayerDrawable,
  buildPropDrawables,
  type PropDrawable,
  updatePlayerDrawable,
} from "./drawables";
import { INTERIOR_FLOOR_TILES, PLAYER_BOUNDS, PLAYER_START, SIDEWALK_TILES } from "./fixture";
import { type PlayerBounds, stepPlayer } from "./player-step";

// Each `new URL(<literal>, import.meta.url)` call below must stay a
// literal string argument, not a variable or template interpolation --
// that is what lets Vite statically detect each one as an asset
// reference, copy it into the production build, and resolve it correctly
// against the dev server's own module graph. A helper function taking a
// path parameter makes every one of these invisible to that analysis
// (confirmed against `npm run build`'s own output: nothing under
// `dist/assets/*.png`, and the template literal leaking into the bundle
// instead of a resolved URL, when this was tried).
const ASSET_URLS: Readonly<Record<string, string>> = {
  sidewalk: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/2_City_Terrains_Singles_16x16/ME_Singles_City_Terrains_16x16_Sidewalk_1_1.png",
    import.meta.url,
  ).href,
  floorSheet: new URL(
    "../../../ModernTileset/moderninteriors-win/1_Interiors/16x16/Room_Builder_subfiles/Room_Builder_Floors_16x16.png",
    import.meta.url,
  ).href,
  wallSheet: new URL(
    "../../../ModernTileset/moderninteriors-win/1_Interiors/16x16/Room_Builder_subfiles/Room_Builder_Walls_16x16.png",
    import.meta.url,
  ).href,
  window: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/16_Office_Singles_16x16/ME_Singles_Office_16x16_Window_1_Middle_Modular.png",
    import.meta.url,
  ).href,
  poster: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_Poster_1.png",
    import.meta.url,
  ).href,
  counter: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/21_Beach_Singles_16x16/21_Beach_16x16_Bamboo_Bar_Counter_1.png",
    import.meta.url,
  ).href,
  table: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/11_Camping_Singles_16x16/ME_Singles_Camping_16x16_Benched_Table_1.png",
    import.meta.url,
  ).href,
  glass: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/11_Camping_Singles_16x16/ME_Singles_Camping_16x16_Bottle_1.png",
    import.meta.url,
  ).href,
  awning: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/4_Generic_Building_Singles_16x16/ME_Singles_Generic_Building_16x16_Shop_Tent_1.png",
    import.meta.url,
  ).href,
  player: new URL(
    "../../../ModernTileset/moderninteriors-win/2_Characters/Character_Generator/0_Premade_Characters/16x16/Premade_Character_01.png",
    import.meta.url,
  ).href,
};

/** The player sprite is one frame cropped out of a much larger animation
 * sheet -- a fixed source-rect, the same idiom the per-cell decomposition
 * sub-rects use, just applied to a hand-picked frame instead of a
 * generated grid. */
const PLAYER_FRAME = new Rectangle(0, 0, 16, 32);

/** `wallTileH`/`wallTileV` are two real, whole-tile sub-rects of the same
 * `wallSheet` source file (never a new PNG): a 1x3-tile swatch for the
 * horizontal (north/south) walls, whose un-decomposed axis (height) is
 * free to overhang above each cell, and a flush 1x1-tile swatch for the
 * vertical (west/east) walls, whose width must never overhang
 * horizontally (Artie's rule). Both are reused whole, per cell -- see
 * `sliceTexture`'s "repeat" case. `wallTileUpperH` is a visually distinct
 * variant of the same swatch shape, used only for the second storey's
 * wall, so the storey seam reads clearly in a screenshot instead of two
 * identical textures fusing into what looks like one tall wall. */
const WALL_TILE_H_FRAME = new Rectangle(0, 528, 16, 48);
const WALL_TILE_V_FRAME = new Rectangle(0, 528, 16, 16);
const WALL_TILE_UPPER_H_FRAME = new Rectangle(0, 0, 16, 48);

/** A plain, single-tile interior floor swatch cropped from the same
 * Room Builder sheet family as the walls -- real art, never a new PNG,
 * and visually distinct from the exterior `sidewalk` tile (Artie's
 * direction: there must be an inside). */
const FLOOR_TILE_FRAME = new Rectangle(208, 560, 16, 16);

/** A small, purely cosmetic screen-space nudge applied after normal
 * bottom-centre anchoring -- never applied to a drawable's sort
 * position. Only the glass needs one, to sit visually on the table it
 * shares an anchor cell with rather than beside its leg (Artie's
 * direction). */
const SCREEN_Y_NUDGE_PX: Readonly<Partial<Record<string, number>>> = {
  glass: -18,
};

const WALK_TILES_PER_SECOND = 3;
const ZOOM = 3;
const CANVAS_MARGIN_PX = 8;

const KEY_TO_DELTA: Record<string, readonly [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
};

export interface MountDemoSceneOptions {
  readonly tileSizePx: number;
  readonly storeyHeightPx: number;
  readonly rankOf: (layerCode: number) => number;
  /** Called once after every real re-sort (including the first one) with
   * the resulting `stableId` order -- the render path's own event, never
   * polled every frame (Quentin's direction). */
  readonly onOrderChange?: (order: readonly bigint[]) => void;
}

export interface DemoSceneHandle {
  readonly app: Application;
  getRenderOrder(): readonly bigint[];
}

function cropped(base: Texture, frame: Rectangle): Texture {
  return new Texture({ source: base.source, frame, dynamic: false });
}

/**
 * Turns one drawable's placeholder art into the exact texture its own
 * cell should show, in whole pixels only -- Tim/Artie's direction: a
 * per-cell sub-rect is only legal on whole-tile boundaries, and a prop's
 * declared footprint must agree with its art's real pixel dimensions.
 * Two shapes are legal along the decomposed axis: the asset is already
 * exactly one tile long (every cell repeats the whole texture, vertical
 * overhang on the other axis allowed and unconstrained), or the asset is
 * exactly `count * tileSizePx` long (one wide image sliced into `count`
 * equal whole-pixel cells). Anything else -- a fractional slice, or a
 * horizontal mismatch -- throws at mount rather than drawing a stretched
 * lie.
 */
export function sliceTexture(base: Texture, drawable: PropDrawable, tileSizePx: number): Texture {
  const { footprintWidth, footprintHeight, sourceCol, sourceRow, assetKey } = drawable;

  if (footprintWidth === 1 && footprintHeight === 1) {
    return base;
  }
  if (footprintWidth > 1 && footprintHeight === 1) {
    return sliceAlongAxis(base, "horizontal", footprintWidth, sourceCol, tileSizePx, assetKey);
  }
  if (footprintHeight > 1 && footprintWidth === 1) {
    return sliceAlongAxis(base, "vertical", footprintHeight, sourceRow, tileSizePx, assetKey);
  }
  throw new Error(
    `sliceTexture: asset '${assetKey}' has footprint ${footprintWidth}x${footprintHeight} -- decomposition along both axes at once is not supported`,
  );
}

function sliceAlongAxis(
  base: Texture,
  axis: "horizontal" | "vertical",
  cellCount: number,
  index: number,
  tileSizePx: number,
  assetKey: string,
): Texture {
  const extent = axis === "horizontal" ? base.width : base.height;

  if (extent === tileSizePx) {
    // Repeat: this asset is already exactly one cell long on the
    // decomposed axis -- every cell reuses the whole texture.
    return base;
  }
  if (extent === cellCount * tileSizePx) {
    const frame =
      axis === "horizontal"
        ? new Rectangle(index * tileSizePx, 0, tileSizePx, base.height)
        : new Rectangle(0, index * tileSizePx, base.width, tileSizePx);
    return cropped(base, frame);
  }
  throw new Error(
    `sliceTexture: asset '${assetKey}' is ${extent}px along its decomposed (${axis}) axis, which is ` +
      `neither one tile (${tileSizePx}px, a repeating asset) nor exactly ${cellCount} tiles ` +
      `(${cellCount * tileSizePx}px, a sliceable one) -- a fractional or mismatched sub-rect is refused, not drawn`,
  );
}

function textureFor(assetKey: string, textures: ReadonlyMap<string, Texture>): Texture {
  const texture = textures.get(assetKey);
  if (!texture) throw new Error(`scene: no texture loaded for asset '${assetKey}'`);
  return texture;
}

function createSprite(
  drawable: PropDrawable,
  textures: ReadonlyMap<string, Texture>,
  tileSizePx: number,
): Sprite {
  const base = textureFor(drawable.assetKey, textures);
  const texture =
    drawable.assetKey === "player"
      ? cropped(base, PLAYER_FRAME)
      : sliceTexture(base, drawable, tileSizePx);
  const sprite = new Sprite(texture);
  // Bottom-centre origin pinned to the cell's bottom edge (Artie's
  // direction): a tall sprite overhangs upward out of its footprint,
  // never downward.
  sprite.anchor.set(0.5, 1);
  return sprite;
}

function positionSprite(
  sprite: Sprite,
  worldX: number,
  worldY: number,
  floor: number,
  tileSizePx: number,
  storeyHeightPx: number,
  assetKey: string,
): void {
  const pos = screenPositionPx(worldX, worldY, floor, tileSizePx, storeyHeightPx);
  sprite.x = pos.x;
  sprite.y = pos.y + (SCREEN_Y_NUDGE_PX[assetKey] ?? 0);
}

/** Mount-time geometry guard (Artie's direction): a scene made of
 * off-canvas sprites must fail loudly, not pass every check silently.
 * Throws naming the first sprite whose drawn bounds fall outside
 * `[0, canvasWidth] x [0, canvasHeight]`. */
export function assertSpritesWithinCanvas(
  sprites: Iterable<{
    readonly label: string;
    readonly bounds: { x: number; y: number; width: number; height: number };
  }>,
  canvasWidth: number,
  canvasHeight: number,
): void {
  for (const { label, bounds } of sprites) {
    const withinX = bounds.x >= -0.5 && bounds.x + bounds.width <= canvasWidth + 0.5;
    const withinY = bounds.y >= -0.5 && bounds.y + bounds.height <= canvasHeight + 0.5;
    if (!withinX || !withinY) {
      throw new Error(
        `assertSpritesWithinCanvas: '${label}' is drawn at (${bounds.x}, ${bounds.y}) size ` +
          `${bounds.width}x${bounds.height}, outside the ${canvasWidth}x${canvasHeight} canvas`,
      );
    }
  }
}

interface PoolEntry extends OrderedMember<PropDrawable> {
  readonly assetKey: string;
}

/**
 * Mounts the committed story 1.6 demo scene (`fixture.ts`) into `app`,
 * wires keyboard movement for the player, and keeps the pool container's
 * children ordered by `render/pixi-order.ts`'s `applyDepthOrder`.
 * Re-sorts only when the player's own sort key actually changes -- a
 * street of static props costs nothing per frame.
 */
export async function mountDemoScene(
  app: Application,
  options: MountDemoSceneOptions,
): Promise<DemoSceneHandle> {
  const { tileSizePx, storeyHeightPx, rankOf, onOrderChange } = options;

  const rawTextures = new Map<string, Texture>();
  await Promise.all(
    Object.entries(ASSET_URLS).map(async ([key, url]) => {
      const texture = await Assets.load<Texture>(url);
      texture.source.scaleMode = "nearest"; // Artie: nearest-neighbour filtering
      rawTextures.set(key, texture);
    }),
  );

  const wallSheet = textureFor("wallSheet", rawTextures);
  const textures = new Map(rawTextures);
  textures.set("wallTileH", cropped(wallSheet, WALL_TILE_H_FRAME));
  textures.set("wallTileV", cropped(wallSheet, WALL_TILE_V_FRAME));
  textures.set("wallTileUpperH", cropped(wallSheet, WALL_TILE_UPPER_H_FRAME));
  textures.set("floor", cropped(textureFor("floorSheet", rawTextures), FLOOR_TILE_FRAME));

  const world = new Container();
  app.stage.addChild(world);

  // Four passes, declared in order even while empty (Tim's direction):
  // three flat, then the y-sorted pool.
  const groundPass = new Container();
  const groundDecalPass = new Container();
  const groundObjectPass = new Container();
  const poolContainer = new Container();
  poolContainer.sortableChildren = false; // the comparator is the only ordering authority
  world.addChild(groundPass, groundDecalPass, groundObjectPass, poolContainer);

  const groundSprites: Sprite[] = [];
  for (const [tiles, assetKey] of [
    [INTERIOR_FLOOR_TILES, INTERIOR_FLOOR_TILES.assetKey] as const,
    [SIDEWALK_TILES, SIDEWALK_TILES.assetKey] as const,
  ]) {
    const groundTexture = textureFor(assetKey, textures);
    for (let y = tiles.y0; y < tiles.y1; y++) {
      for (let x = tiles.x0; x < tiles.x1; x++) {
        const tile = new Sprite(groundTexture);
        tile.x = Math.round(x * tileSizePx);
        tile.y = Math.round(y * tileSizePx);
        groundPass.addChild(tile);
        groundSprites.push(tile);
      }
    }
  }

  const wallAssetOf = (
    assetKey: string,
    footprintWidth: number,
    footprintHeight: number,
  ): string => {
    if (assetKey === "wallTile")
      return footprintWidth > footprintHeight ? "wallTileH" : "wallTileV";
    if (assetKey === "wallTileUpper") return "wallTileUpperH";
    return assetKey;
  };

  const propDrawables = buildPropDrawables((layer) => rankOf(layerCodeByName(layer))).map((d) => ({
    ...d,
    assetKey: wallAssetOf(d.assetKey, d.footprintWidth, d.footprintHeight),
  }));

  const entries: PoolEntry[] = propDrawables.map((drawable) => {
    const sprite = createSprite(drawable, textures, tileSizePx);
    positionSprite(
      sprite,
      fromSortUnits(drawable.x),
      fromSortUnits(drawable.y),
      drawable.floor,
      tileSizePx,
      storeyHeightPx,
      drawable.assetKey,
    );
    return { drawable, view: sprite, assetKey: drawable.assetKey };
  });

  let playerX: number = PLAYER_START.x;
  let playerY: number = PLAYER_START.y;
  const playerDrawable = buildPlayerDrawable(
    rankOf(layerCodeByName("characters")),
    playerX,
    playerY,
  );
  const playerSprite = createSprite(playerDrawable, textures, tileSizePx);
  positionSprite(
    playerSprite,
    playerX,
    playerY,
    PLAYER_START.floor,
    tileSizePx,
    storeyHeightPx,
    "player",
  );
  const playerEntry: PoolEntry = {
    drawable: playerDrawable,
    view: playerSprite,
    assetKey: "player",
  };
  const members: PoolEntry[] = [...entries, playerEntry];
  for (const m of members) poolContainer.addChild(m.view);

  const renderOrder: bigint[] = [];
  applyDepthOrder(poolContainer, members, renderOrder);
  onOrderChange?.(renderOrder);

  // Camera: translate the world container so its whole content (both
  // storeys, every overhang) sits inside the canvas with a small margin,
  // then size the canvas to fit exactly -- Artie's direction: nothing
  // this scene contains may be drawn off-canvas.
  const worldBounds = world.getLocalBounds();
  const canvasWidth = Math.ceil(worldBounds.width * ZOOM) + CANVAS_MARGIN_PX * 2;
  const canvasHeight = Math.ceil(worldBounds.height * ZOOM) + CANVAS_MARGIN_PX * 2;
  app.renderer.resize(canvasWidth, canvasHeight);
  world.scale.set(ZOOM);
  world.position.set(
    CANVAS_MARGIN_PX - worldBounds.x * ZOOM,
    CANVAS_MARGIN_PX - worldBounds.y * ZOOM,
  );

  // `sprite.getBounds()` already returns bounds in the stage's global
  // space -- it walks every ancestor transform, including `world`'s
  // scale and position just set above -- so this reads real drawn pixel
  // bounds directly, with no second application of the zoom or camera
  // offset.
  assertSpritesWithinCanvas(
    [...groundSprites, ...members.map((m) => m.view)].map((sprite) => {
      const b = sprite.getBounds();
      return {
        label: `${sprite.constructor.name}@(${Math.round(sprite.x)},${Math.round(sprite.y)})`,
        bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      };
    }),
    canvasWidth,
    canvasHeight,
  );

  const pressed = new Set<string>();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key in KEY_TO_DELTA) pressed.add(event.key);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    pressed.delete(event.key);
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  const bounds: PlayerBounds = PLAYER_BOUNDS;

  app.ticker.add((ticker) => {
    let dx = 0;
    let dy = 0;
    for (const key of pressed) {
      const delta = KEY_TO_DELTA[key];
      if (!delta) continue;
      dx += delta[0];
      dy += delta[1];
    }
    if (dx === 0 && dy === 0) return;

    const step = stepPlayer(
      playerX,
      playerY,
      dx,
      dy,
      WALK_TILES_PER_SECOND,
      ticker.deltaMS,
      bounds,
    );
    playerX = step.x;
    playerY = step.y;

    updatePlayerDrawable(playerDrawable, playerX, playerY);
    positionSprite(
      playerSprite,
      playerX,
      playerY,
      PLAYER_START.floor,
      tileSizePx,
      storeyHeightPx,
      "player",
    );

    // Only re-sort when the player's own sort key actually moved to a
    // new sub-tile unit (Tim's direction): a street of static props
    // costs nothing per frame.
    if (step.sortKeyChanged) {
      applyDepthOrder(poolContainer, members, renderOrder);
      onOrderChange?.(renderOrder);
    }
  });

  return {
    app,
    getRenderOrder: () => renderOrder,
  };
}
