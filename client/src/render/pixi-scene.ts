// The story 1.6 demo scene's Pixi adapter -- the only file besides
// `bootstrap.ts` allowed to import `pixi.js` (Tim's direction).
// Everything about depth order is decided by `sort-key.ts`'s comparator;
// this file's whole job is to hand that comparator's output to a real
// display list. Real LimeZu sprites only, loaded straight out of the
// repo-root `ModernTileset/` (Artie's direction: no coloured rectangles,
// no new PNGs) -- nearest-neighbour filtering, integer world-pixel
// positions rounded before the 3x zoom scale, bottom-centre sprite
// anchors pinned to each drawable's own cell.
//
// D17: no debug text, no rank numbers, no sort-key readouts on the
// canvas. This module draws the scene and nothing else.

import type { Application } from "pixi.js";
import { Assets, Container, Rectangle, Sprite, Texture } from "pixi.js";
import { type DemoLayer, GROUND_TILES, PLAYER_START } from "./demo-fixture";
import {
  buildPlayerDrawable,
  buildPropDrawables,
  type PropDrawable,
  SORT_SUBDIVISIONS,
  toSortUnits,
} from "./demo-scene-drawables";
import { compareDrawables } from "./sort-key";

// Each `new URL(<literal>, import.meta.url)` call below must stay a
// literal string argument, not a variable or template interpolation --
// that is what lets Vite statically detect each one as an asset
// reference, copy it into the production build, and resolve it correctly
// against the dev server's own module graph. A helper function taking a
// path parameter would make every one of these invisible to that
// analysis (confirmed against `npm run build`'s output: nothing under
// `dist/assets/*.png` and the literal template string leaking into the
// bundle instead of a resolved URL).
const ASSET_URLS: Readonly<Record<string, string>> = {
  ground: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/2_City_Terrains_Singles_16x16/ME_Singles_City_Terrains_16x16_Sidewalk_1_1.png",
    import.meta.url,
  ).href,
  wall: new URL(
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
 * sheet -- a fixed source-rect, the same idiom `decompose.ts`'s per-cell
 * sub-rects use, just applied to a hand-picked frame instead of a
 * generated grid. */
const PLAYER_FRAME = new Rectangle(0, 0, 16, 32);

const RANK_CODE_BY_LAYER: Record<DemoLayer, number> = {
  furniture: 2,
  objects: 3,
  walls: 4,
  wall_decals: 5,
  characters: 6,
};

const WALK_TILES_PER_SECOND = 3;
const PLAYER_BOUNDS = { x0: 2, x1: 9, y0: 1, y1: 7 };

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

export interface PoolMember {
  drawable: PropDrawable;
  sprite: Sprite;
}

export interface MountDemoSceneOptions {
  readonly tileSizePx: number;
  readonly storeyHeightPx: number;
  readonly rankOf: (layerCode: number) => number;
}

export interface DemoSceneHandle {
  readonly app: Application;
  getRenderOrder(): bigint[];
}

/** Placeholder-graphics source-rect decomposition (Tim's direction): with
 * no atlas yet, a multi-cell prop's per-cell texture is a proportional
 * slice of its one placeholder sprite along the axis it decomposes on --
 * the seam an atlas will read a real per-cell sub-rect through once one
 * exists. */
function sliceTexture(base: Texture, drawable: PropDrawable): Texture {
  if (drawable.footprintWidth > 1 && drawable.footprintHeight === 1) {
    const sliceWidth = base.width / drawable.footprintWidth;
    return cropped(
      base,
      new Rectangle(drawable.sourceCol * sliceWidth, 0, sliceWidth, base.height),
    );
  }
  if (drawable.footprintHeight > 1 && drawable.footprintWidth === 1) {
    const sliceHeight = base.height / drawable.footprintHeight;
    return cropped(
      base,
      new Rectangle(0, drawable.sourceRow * sliceHeight, base.width, sliceHeight),
    );
  }
  return base;
}

function createSprite(drawable: PropDrawable, textures: ReadonlyMap<string, Texture>): Sprite {
  const base = textures.get(drawable.assetKey);
  if (!base) throw new Error(`pixi-scene: no texture loaded for asset '${drawable.assetKey}'`);
  const texture =
    drawable.assetKey === "player" ? cropped(base, PLAYER_FRAME) : sliceTexture(base, drawable);
  const sprite = new Sprite(texture);
  // Bottom-centre origin pinned to the cell's bottom edge (Artie's
  // direction): a tall sprite overhangs upward out of its footprint,
  // never downward.
  sprite.anchor.set(0.5, 1);
  return sprite;
}

function cropped(base: Texture, frame: Rectangle): Texture {
  return new Texture({ source: base.source, frame, dynamic: false });
}

function positionSprite(
  sprite: Sprite,
  worldX: number,
  worldY: number,
  floor: number,
  tileSizePx: number,
  storeyHeightPx: number,
): void {
  // Integer world-pixel positions, rounded before the 3x zoom scale is
  // applied by the containing `world` container (Artie's pixel
  // discipline) -- floor is a screen offset only (FR124), never folded
  // into the sort key.
  sprite.x = Math.round((worldX + 0.5) * tileSizePx);
  sprite.y = Math.round((worldY + 1) * tileSizePx - floor * storeyHeightPx);
}

/** Reorders `poolContainer`'s children from `members`, sorted by
 * `compareDrawables` -- the sole ordering authority. `addChild` on an
 * already-attached child moves it rather than duplicating it, so this
 * never allocates a new display object. Returns the resulting stableId
 * order. */
export function applyDepthOrder(poolContainer: Container, members: PoolMember[]): bigint[] {
  members.sort((a, b) => compareDrawables(a.drawable, b.drawable));
  for (const member of members) {
    poolContainer.addChild(member.sprite);
  }
  return members.map((m) => m.drawable.stableId);
}

/**
 * Mounts the committed story 1.6 demo scene (`demo-fixture.ts`) into
 * `app`, wires keyboard movement for the player, and keeps the pool
 * container's children ordered by `sort-key.ts`'s comparator. Re-sorts
 * only when the player's own sort key actually changes -- a street of
 * static props costs nothing per frame.
 */
export async function mountDemoScene(
  app: Application,
  options: MountDemoSceneOptions,
): Promise<DemoSceneHandle> {
  const { tileSizePx, storeyHeightPx, rankOf } = options;

  const textures = new Map<string, Texture>();
  await Promise.all(
    Object.entries(ASSET_URLS).map(async ([key, url]) => {
      const texture = await Assets.load<Texture>(url);
      texture.source.scaleMode = "nearest"; // Artie: nearest-neighbour filtering
      textures.set(key, texture);
    }),
  );

  const world = new Container();
  world.scale.set(3); // Artie: 3x zoom, applied after positions are rounded
  app.stage.addChild(world);

  // Four passes, declared in order even while empty (Tim's direction):
  // three flat, then the y-sorted pool.
  const groundPass = new Container();
  const groundDecalPass = new Container();
  const groundObjectPass = new Container();
  const poolContainer = new Container();
  poolContainer.sortableChildren = false; // the comparator is the only ordering authority
  world.addChild(groundPass, groundDecalPass, groundObjectPass, poolContainer);

  const groundTexture = textures.get(GROUND_TILES.assetKey);
  if (!groundTexture) throw new Error("mountDemoScene: missing ground texture");
  for (let y = GROUND_TILES.y0; y < GROUND_TILES.y1; y++) {
    for (let x = GROUND_TILES.x0; x < GROUND_TILES.x1; x++) {
      const tile = new Sprite(groundTexture);
      tile.x = Math.round(x * tileSizePx);
      tile.y = Math.round(y * tileSizePx);
      groundPass.addChild(tile);
    }
  }

  const propDrawables = buildPropDrawables((layer) => rankOf(RANK_CODE_BY_LAYER[layer]));
  const members: PoolMember[] = propDrawables.map((drawable) => {
    const sprite = createSprite(drawable, textures);
    positionSprite(
      sprite,
      drawable.x / SORT_SUBDIVISIONS,
      drawable.y / SORT_SUBDIVISIONS,
      drawable.floor,
      tileSizePx,
      storeyHeightPx,
    );
    poolContainer.addChild(sprite);
    return { drawable, sprite };
  });

  let playerX: number = PLAYER_START.x;
  let playerY: number = PLAYER_START.y;
  const playerDrawable = buildPlayerDrawable(
    rankOf(RANK_CODE_BY_LAYER.characters),
    playerX,
    playerY,
  );
  const playerSprite = createSprite(playerDrawable, textures);
  positionSprite(playerSprite, playerX, playerY, PLAYER_START.floor, tileSizePx, storeyHeightPx);
  poolContainer.addChild(playerSprite);
  const playerMember: PoolMember = { drawable: playerDrawable, sprite: playerSprite };
  members.push(playerMember);

  let renderOrder = applyDepthOrder(poolContainer, members);

  const pressed = new Set<string>();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key in KEY_TO_DELTA) pressed.add(event.key);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    pressed.delete(event.key);
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

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

    const distancePerFrame = (WALK_TILES_PER_SECOND * ticker.deltaMS) / 1000;
    const length = Math.hypot(dx, dy) || 1;
    const nextX = clamp(
      playerX + (dx / length) * distancePerFrame,
      PLAYER_BOUNDS.x0,
      PLAYER_BOUNDS.x1,
    );
    const nextY = clamp(
      playerY + (dy / length) * distancePerFrame,
      PLAYER_BOUNDS.y0,
      PLAYER_BOUNDS.y1,
    );

    const previousSortY = toSortUnits(playerY);
    const previousSortX = toSortUnits(playerX);
    playerX = nextX;
    playerY = nextY;

    playerMember.drawable = buildPlayerDrawable(playerMember.drawable.rank, playerX, playerY);
    positionSprite(
      playerMember.sprite,
      playerX,
      playerY,
      PLAYER_START.floor,
      tileSizePx,
      storeyHeightPx,
    );

    // Only re-sort when the player's own sort key actually moved to a
    // new sub-tile unit (Tim's direction): a street of static props
    // costs nothing per frame, and a sub-pixel key-repeat that rounds
    // back to the same unit costs nothing either.
    if (toSortUnits(playerX) !== previousSortX || toSortUnits(playerY) !== previousSortY) {
      renderOrder = applyDepthOrder(poolContainer, members);
    }
  });

  return {
    app,
    getRenderOrder: () => renderOrder,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
