// The demo scene's Pixi mount -- the only file besides `bootstrap.ts` and
// `render/pixi-order.ts`/`render/pixi-visibility.ts` allowed to import
// `pixi.js`. Ordering itself is `render/pixi-order.ts`'s job, visibility
// is `render/pixi-visibility.ts`'s (story 1.7); this file's whole job is
// texture loading, sprite construction, container wiring, keyboard input
// and the mount-time geometry guard. Real LimeZu sprites only, loaded
// straight out of the repo-root `ModernTileset/` (Artie's direction: no
// coloured rectangles, no new PNGs beyond what a new prop genuinely
// needs) -- nearest-neighbour filtering, integer world-pixel positions
// rounded before the zoom scale, bottom-centre sprite anchors pinned to
// each drawable's own cell.
//
// D17: no debug text, no rank numbers, no sort-key readouts on the
// canvas. This module draws the scene and nothing else.

import { type Application, Assets, Container, Rectangle, Sprite, Texture } from "pixi.js";
import { attachKeyboard, KeyboardState } from "../input/keyboard";
import { layerCodeByName } from "../render/layer-table";
import { applyDepthOrder, type OrderedMember } from "../render/pixi-order";
import { VisibilityApplier, type VisibilityMember } from "../render/pixi-visibility";
import { floorOffsetPx, screenPositionPx } from "../render/screen-position";
import { fromSortUnits, toSortUnits } from "../render/sort-units";
import type { VisibilityState, VisibilityViewer } from "../render/visibility";
import { isFloorCulled } from "../render/visibility";
import type { ColliderSource } from "../world/collision-grid";
import { CollisionGrid } from "../world/collision-grid";
import {
  type FloorWalkResult,
  initialFloorWalkState,
  stepAndTransition,
} from "../world/floor-walk";
import type { MovementConfig } from "../world/movement";
import { NO_OWNER, OwnershipIndex } from "../world/ownership";
import { TransitionIndex } from "../world/transitions";
import {
  buildPlayerDrawable,
  buildPropDrawables,
  type PropDrawable,
  updatePlayerDrawable,
} from "./drawables";
import {
  DEMO_BUILDING_AREAS,
  DEMO_GROUND_TILES,
  DEMO_ROOM_AREAS,
  DEMO_TRANSITIONS,
  type DemoGroundTiles,
  demoColliderSources,
  demoPlacedRows,
  PLAYER_START,
} from "./fixture";

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
  // Shop B's own furniture: a grocer, not a second tiki bar (Artie's
  // "grounded city" direction).
  shelf: new URL(
    "../../../ModernTileset/moderninteriors-win/1_Interiors/16x16/Theme_Sorter_Singles/16_Grocery_Store_Singles/Grocery_Store_Singles_113.png",
    import.meta.url,
  ).href,
  basket: new URL(
    "../../../ModernTileset/moderninteriors-win/1_Interiors/16x16/Theme_Sorter_Singles/16_Grocery_Store_Singles/Grocery_Store_Singles_10.png",
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
  // The subway: a real descending stairwell with railings on the street,
  // a visually distinct "going up" stairwell on the platform (Artie's
  // direction: never one sprite playing both roles), and the subway
  // pack's own tiled wall, floor and hazard-striped platform edge --
  // never the shops' own interior art reused underground.
  subwayStairsDown: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_Stairs_Complete_2.png",
    import.meta.url,
  ).href,
  subwayStairsUp: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_Stairs_Complete_4.png",
    import.meta.url,
  ).href,
  subwayBench: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_Two_Seats_Grey_Bench_Frontal_1.png",
    import.meta.url,
  ).href,
  subwayWall: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_Lilac_Tile_1_Vers_1.png",
    import.meta.url,
  ).href,
  subwayFloor: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_White_Tile_1.png",
    import.meta.url,
  ).href,
  subwayEdge: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_Binary_Edge_Left_Down_1.png",
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
 * generated grid.
 *
 * `Premade_Character_01.png` is 896x656px, which is not a uniform grid
 * top to bottom -- 656 does not divide evenly by any single frame
 * height, because the sheet's last 16px strip is a row of small colour
 * swatches, not a character frame (confirmed by measuring the sheet's
 * own opaque-pixel row bands: a `(0, 0, 16, 32)` guess crops across two
 * unrelated frames and reads as a totem pole, not a person -- Artie's
 * finding). The character frames themselves sit on a real 16px-wide,
 * 32px-tall grid starting at `y = 0`, each character bottom-anchored
 * within its own cell (empty headroom above, feet on the cell's bottom
 * edge) -- verified by measuring the sheet's opaque columns (16px period)
 * and row bands (32px period from row 4 on) and by rendering this exact
 * crop in isolation. Row 4, column 0 is a single idle, front-facing
 * frame. */
const PLAYER_FRAME = new Rectangle(0, 128, 16, 32);

/** `wallTileH`/`wallTileV` are two real, whole-tile sub-rects of the same
 * `wallSheet` source file (never a new PNG): a 1x3-tile swatch for the
 * horizontal (north/south) walls, whose un-decomposed axis (height) is
 * free to overhang above each cell, and a flush 1x1-tile swatch for the
 * vertical (west/east) walls, whose width must never overhang
 * horizontally (Artie's rule). Both are reused whole, per cell -- see
 * `sliceTexture`'s "repeat" case. `wallTileV`'s own flush swatch doubles
 * as the FR120 retraction stub (Artie's direction: "the short wall caps
 * already in Room_Builder_Walls_16x16.png", no new art) -- see
 * `wallStub` below. */
const WALL_TILE_H_FRAME = new Rectangle(0, 528, 16, 48);
const WALL_TILE_V_FRAME = new Rectangle(0, 528, 16, 16);

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

const ZOOM = 3;
const CANVAS_MARGIN_PX = 8;

/** Colour the app background switches to while the viewer is on any
 * below-ground floor (Artie's direction: what surrounds the subway
 * platform is plain black, never a texture, never the street's own
 * background bleeding through) -- keyed on the exact same floor-sign
 * rule `render/visibility.ts`'s `isFloorCulled` uses (Tim's direction),
 * never a second, separately-typed `floor < 0` check. */
const SUBWAY_BACKGROUND = 0x000000;

/** The layer code every ground-tile-pass group's own synthetic
 * `VisibilityDrawable` carries -- never read by `computeVisibility`'s
 * wall-layer check (a ground pass is never `isNearSide`), so any live
 * code works; `"objects"` names one that exists without adding a
 * literal number. */
const GROUND_LAYER_CODE = layerCodeByName("objects");

export interface MountDemoSceneOptions {
  readonly tileSizePx: number;
  readonly storeyHeightPx: number;
  readonly rankOf: (layerCode: number) => number;
  /** `render.window_alpha`'s resolved balance value (FR121), already
   * divided down to a plain `(0, 1)` fraction -- never a literal in this
   * file or in `render/visibility.ts`/`pixi-visibility.ts`. */
  readonly windowAlpha: number;
  /** Read once from `defs/`'s `movement.*` balance keys (`main.ts`) --
   * never a literal in this file. */
  readonly movementConfig: MovementConfig;
  /** Real `defs/objects` colliders, keyed by def id
   * (`world/object-defs.ts`), so a prop the demo places by `defId` uses
   * the collider `defs/` declares for it rather than a restated rect. */
  readonly objectDefs: ReadonlyMap<number, ColliderSource>;
  /** The def ids `defs/` marks `window = true` (story 1.7, FR121) --
   * resolved once by the caller from the fetched document. */
  readonly windowDefIds: ReadonlySet<number>;
  /** Called once after every real re-sort (including the first one) with
   * the resulting `stableId` order -- the render path's own event, never
   * polled every frame (Quentin's direction). */
  readonly onOrderChange?: (order: readonly bigint[]) => void;
  /** Called once at mount and then every ticker frame with the player's
   * current continuous position (story 1.8's e2e proof that movement is
   * client-side and immediate, FR137) -- unlike `onOrderChange`, this is
   * polled every frame on purpose. */
  readonly onPlayerMove?: (x: number, y: number) => void;
  /** Called once at mount and then every time visibility is actually
   * re-applied (story 1.7's e2e proof, `enclosure.spec.ts`) -- a map from
   * decimal `stableId` string to its current FR120/FR121/FR122 state,
   * plus the exact `alpha` each one carries, both built from each pool
   * member's own real, just-written `sprite.visible`/`sprite.alpha`
   * (Quentin/Tim's direction: this must prove the real, mounted adapter
   * wrote the right thing, never recompute the pure function a second
   * time). Covers every real pool member, including the FR120 wall-stub
   * companions -- their own ids (`STUB_ID_OFFSET` and above) are exactly
   * as real a fact about what the adapter wrote as any other member's --
   * plus every ground-tile-pass group, keyed `ground:<floor>` (Tim's
   * direction, cycle 2: FR122's flat-pass culling needs a guard that can
   * see it too, not only the sorted pool). */
  readonly onVisibilityChange?: (
    state: Readonly<Record<string, string>>,
    alpha: Readonly<Record<string, number>>,
  ) => void;
  /** Called once, after mount, with whether every mounted sprite and
   * ground-pass container has `mask === null` -- FR121's "no masking or
   * aperture system" acceptance criterion, proven directly against the
   * real display list rather than only by `scripts/ci/check-no-masks.sh`
   * never finding the word `mask` in the source. */
  readonly onMasksChecked?: (allNull: boolean) => void;
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

/** Mount-time geometry guard, in the same family as
 * [`assertSpritesWithinCanvas`] (Artie's direction): a drawable's art may
 * overhang above its own anchor row (bottom-centre anchoring makes that
 * the normal case), but never by more than one storey. The off-canvas
 * wall this pair replaced overhung by a factor of thirteen; this is the
 * rule that would have caught it directly, by name, instead of only via
 * where the sprite happened to land on screen. */
export function assertNoOverhangBeyondStorey(
  sprites: Iterable<{ readonly label: string; readonly overhangPx: number }>,
  storeyHeightPx: number,
): void {
  for (const { label, overhangPx } of sprites) {
    if (overhangPx > storeyHeightPx + 0.5) {
      throw new Error(
        `assertNoOverhangBeyondStorey: '${label}' overhangs its own anchor row by ${overhangPx}px, ` +
          `more than one storey (${storeyHeightPx}px)`,
      );
    }
  }
}

interface PoolEntry extends OrderedMember<PropDrawable>, VisibilityMember<PropDrawable> {
  readonly assetKey: string;
  readonly view: Sprite;
}

/** Picks a wall drawable's real texture from its own declared
 * `wallOrientation` (`demo/fixture.ts`'s `DemoProp.wallOrientation`,
 * carried onto `PropDrawable`) -- never from a decomposed cell's own
 * footprint aspect ratio (Artie's cycle-2 finding: a one-cell-wide
 * *front* wall pier and a one-cell side wall are both `1x1` after
 * decomposition, so the aspect ratio alone cannot tell them apart; a
 * front wall must always be the tall swatch, whatever width it happens to
 * be cut into). Exported for its own unit test. */
export const wallAssetOf = (
  assetKey: string,
  wallOrientation: "horizontal" | "vertical",
): string => {
  if (assetKey === "wallTile") {
    return wallOrientation === "vertical" ? "wallTileV" : "wallTileH";
  }
  // The FR120 stub (Artie's direction): the same flush, short swatch a
  // side wall already uses -- no new art, and deliberately the same
  // swatch regardless of its own parent's orientation (a stub is meant to
  // read as a short baseboard remnant, never a second tall wall).
  if (assetKey === "wallStub") return "wallTileV";
  // The platform's own tiled wall is already a flush single-tile subway
  // swatch (never a 3-tall interior module), so every orientation just
  // repeats it whole -- no H/V distinction needed.
  return assetKey;
};

/** The two sprite properties `VisibilityApplier` ever writes -- read back
 * from a real member's own `view` after `apply`/`applyForce` returns,
 * never a second, recomputed `VisibilityState`. */
interface SpriteVisibilityWrite {
  readonly visible: boolean;
  readonly alpha: number;
}

/** Converts one member's real, just-written sprite state back to the
 * FR120/FR121/FR122 label it corresponds to -- built from `visible`/
 * `alpha` themselves (Quentin/Tim's direction), never from a recomputed
 * `VisibilityState`. */
function stateFromWrite(write: SpriteVisibilityWrite): VisibilityState {
  if (!write.visible) return "hidden";
  return write.alpha < 1 ? "translucent" : "normal";
}

/**
 * Mounts the committed demo scene (`fixture.ts`) into `app`, wires
 * keyboard movement and floor transitions for the player, keeps the pool
 * container's children ordered by `render/pixi-order.ts`'s
 * `applyDepthOrder`, and keeps every member's FR120/FR121/FR122 state
 * current through `render/pixi-visibility.ts`'s `VisibilityApplier` --
 * applied to every ground-tile pass as well as the sorted pool, so a
 * culled floor is culled entirely (FR122), not only its pool sprites.
 * Re-sorts only when the player's own sort key actually changes, and
 * re-applies visibility only when the player's own enclosure/floor
 * changes -- a street of static props costs nothing per frame either way.
 */
export async function mountDemoScene(
  app: Application,
  options: MountDemoSceneOptions,
): Promise<DemoSceneHandle> {
  const {
    tileSizePx,
    storeyHeightPx,
    rankOf,
    windowAlpha,
    movementConfig,
    objectDefs,
    windowDefIds,
    onOrderChange,
    onPlayerMove,
    onVisibilityChange,
    onMasksChecked,
  } = options;

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

  // Story 1.7: one container per distinct floor among the ground-tile
  // groups (Tim's direction) -- toggled as a unit through the same
  // `VisibilityApplier` the pool goes through, so a culled floor's flat
  // passes are culled exactly as completely as its pool sprites are,
  // never a second rule.
  const groundContainersByFloor = new Map<number, Container>();
  function groundContainerFor(floor: number): Container {
    let container = groundContainersByFloor.get(floor);
    if (!container) {
      container = new Container();
      groundContainersByFloor.set(floor, container);
      groundPass.addChild(container);
    }
    return container;
  }

  const groundSprites: Sprite[] = [];
  for (const tiles of DEMO_GROUND_TILES) {
    const groundTexture = textureFor(tiles.assetKey, textures);
    const container = groundContainerFor(tiles.floor);
    const offset = floorOffsetPx(tiles.floor, storeyHeightPx);
    for (let y = tiles.y0; y < tiles.y1; y++) {
      for (let x = tiles.x0; x < tiles.x1; x++) {
        // Every ground pass tile is top-left anchored (default Sprite
        // anchor), unlike the bottom-centre pool sprites -- FR124's
        // floor offset still applies here too.
        const tile = new Sprite(groundTexture);
        tile.x = Math.round(x * tileSizePx);
        tile.y = Math.round(y * tileSizePx + offset);
        container.addChild(tile);
        groundSprites.push(tile);
      }
    }
  }

  const ownership = new OwnershipIndex(DEMO_BUILDING_AREAS, DEMO_ROOM_AREAS);
  const transitions = new TransitionIndex(DEMO_TRANSITIONS);

  const propDrawables = buildPropDrawables({
    rankOf: (layer) => rankOf(layerCodeByName(layer)),
    ownership,
    windowDefIds,
  }).map((d) => ({
    ...d,
    assetKey: wallAssetOf(d.assetKey, d.wallOrientation),
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

  let walk: FloorWalkResult = {
    ...initialFloorWalkState(PLAYER_START.x, PLAYER_START.y, PLAYER_START.floor),
    transitioned: false,
  };
  const playerDrawable = buildPlayerDrawable(
    rankOf(layerCodeByName("characters")),
    walk.x,
    walk.y,
    walk.floor,
  );
  const playerSprite = createSprite(playerDrawable, textures, tileSizePx);
  positionSprite(playerSprite, walk.x, walk.y, walk.floor, tileSizePx, storeyHeightPx, "player");
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

  // `member.view.height` is the sprite's own local (unscaled) pixel
  // height -- independent of the world container's zoom, set below.
  // Subtracting one tile is what turns "total sprite height" into
  // "overhang above the anchor row itself": a sprite exactly as tall as
  // its own row has zero overhang, and Artie's "factor of thirteen" wall
  // was measured the same way (624px of overhang against a 48px storey).
  assertNoOverhangBeyondStorey(
    members.map((m) => ({
      label: `${m.assetKey}#${m.drawable.stableId}`,
      overhangPx: m.view.height - tileSizePx,
    })),
    storeyHeightPx,
  );

  // Camera: translate the world container so its whole content (every
  // floor, both storeys, every overhang) sits inside the canvas with a
  // small margin, then size the canvas to fit exactly -- Artie's
  // direction: nothing this scene contains may be drawn off-canvas.
  // Computed once, over every sprite regardless of its later visibility
  // state, so the canvas never needs to resize again once the player
  // starts walking between floors and enclosures.
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

  // FR121: no masking or aperture system anywhere in the real, mounted
  // display list -- checked directly against every sprite and every
  // ground-pass container this scene actually built, not only by the
  // source-level grep `scripts/ci/check-no-masks.sh` runs. Pixi v8's own
  // default is `undefined`, never `null` (confirmed against a real
  // `Sprite`/`Container`) -- `== null` covers both, `=== null` alone
  // would fail every unmasked sprite in this scene.
  const everyMaskableView = [...members.map((m) => m.view), ...groundContainersByFloor.values()];
  onMasksChecked?.(everyMaskableView.every((view) => view.mask == null));

  // The collision grid: real `defs/objects` colliders (`objectDefs`,
  // resolved from the fetched document in `main.ts`) plus the demo's own
  // walls and world boundary, fed in as `PlacedObject`-shaped rows --
  // exactly the shape a later chunk-streaming story's `onInsert` will
  // feed the same grid, just called directly here instead of from a
  // subscription (`placed_object` stays private in this story).
  const colliderSources = new Map<number, ColliderSource>([
    ...objectDefs,
    ...demoColliderSources(movementConfig.subcellsPerCell),
  ]);
  const collisionGrid = new CollisionGrid(movementConfig.subcellsPerCell, colliderSources);
  for (const placed of demoPlacedRows()) {
    collisionGrid.insert(placed);
  }

  // Story 1.7: the visibility adapter, gated on the viewer's own
  // (floor, buildingId) tuple actually changing (Tim's direction) --
  // computed from the player's own *cell* (`cellOf`, `Math.floor`), never
  // every frame. Applied to the pool and every ground-tile-pass group
  // together, in one call, so nothing is ever culled halfway.
  const visibilityApplier = new VisibilityApplier();
  const originalBackground = app.renderer.background.color;
  const groundMembers: VisibilityMember[] = [...groundContainersByFloor.entries()].map(
    ([floor, container]) => ({
      drawable: {
        floor,
        layerCode: GROUND_LAYER_CODE,
        ownerBuildingId: NO_OWNER,
        isWindow: false,
        isNearSide: false,
        isStub: false,
      },
      view: container,
    }),
  );
  const allVisibilityMembers: VisibilityMember[] = [...members, ...groundMembers];

  function applyVisibilityFor(cellX: number, cellY: number, floor: number, force: boolean): void {
    const viewer: VisibilityViewer = {
      floor,
      buildingId: ownership.ownershipAt(cellX, cellY, floor).buildingId,
    };

    let applied = true;
    if (force) {
      visibilityApplier.applyForce(allVisibilityMembers, viewer, windowAlpha);
    } else {
      applied = visibilityApplier.apply(allVisibilityMembers, viewer, windowAlpha);
    }

    // Keyed on the same floor-sign rule `isFloorCulled` uses (Tim's
    // direction): "below ground" is exactly `isFloorCulled(0, floor)`,
    // since floor 0 is always street-side by construction.
    app.renderer.background.color = isFloorCulled(0, floor)
      ? SUBWAY_BACKGROUND
      : originalBackground;

    // Built straight from each pool member's own real, just-written
    // `view.visible`/`view.alpha` (Quentin/Tim's direction) -- never a
    // second, recomputed `VisibilityState` this could silently disagree
    // with what `VisibilityApplier` actually wrote. Ground-tile-pass
    // groups carry no `stableId` (Tim's direction, cycle 2: FR122's
    // flat-pass culling fix needs a guard that can see them too), so each
    // one is reported under its own `ground:<floor>` key instead.
    if (applied && onVisibilityChange) {
      const reportedState: Record<string, string> = {};
      const reportedAlpha: Record<string, number> = {};
      for (const entry of [...entries, playerEntry]) {
        const id = entry.drawable.stableId.toString();
        reportedState[id] = stateFromWrite({
          visible: entry.view.visible,
          alpha: entry.view.alpha,
        });
        reportedAlpha[id] = entry.view.alpha;
      }
      for (const [floor, container] of groundContainersByFloor) {
        const id = `ground:${floor}`;
        reportedState[id] = stateFromWrite({
          visible: container.visible,
          alpha: container.alpha,
        });
        reportedAlpha[id] = container.alpha;
      }
      onVisibilityChange(reportedState, reportedAlpha);
    }
  }

  let lastCellX = walk.cellX;
  let lastCellY = walk.cellY;
  applyVisibilityFor(lastCellX, lastCellY, walk.floor, true);

  onPlayerMove?.(walk.x, walk.y);

  const keyboard = new KeyboardState();
  attachKeyboard(keyboard);

  app.ticker.add((ticker) => {
    const direction = keyboard.direction();
    if (direction.x === 0 && direction.y === 0) return;

    const before = { x: toSortUnits(walk.x), y: toSortUnits(walk.y) };
    walk = stepAndTransition(
      walk,
      direction,
      ticker.deltaMS,
      collisionGrid,
      movementConfig,
      transitions,
    );

    onPlayerMove?.(walk.x, walk.y);

    updatePlayerDrawable(playerDrawable, walk.x, walk.y, walk.floor);
    positionSprite(playerSprite, walk.x, walk.y, walk.floor, tileSizePx, storeyHeightPx, "player");

    // Only re-sort when the player's own sort key actually moved to a
    // new sub-tile unit (Tim's direction): a street of static props
    // costs nothing per frame.
    const after = { x: toSortUnits(walk.x), y: toSortUnits(walk.y) };
    if (after.x !== before.x || after.y !== before.y) {
      applyDepthOrder(poolContainer, members, renderOrder);
      onOrderChange?.(renderOrder);
    }

    // Ownership is looked up only when the player's own cell actually
    // changed (Tim's direction) -- never every frame -- and visibility is
    // re-applied only when that lookup (or the floor) actually differs
    // from last time (`VisibilityApplier`'s own gate).
    if (walk.cellX !== lastCellX || walk.cellY !== lastCellY || walk.transitioned) {
      lastCellX = walk.cellX;
      lastCellY = walk.cellY;
      applyVisibilityFor(walk.cellX, walk.cellY, walk.floor, false);
    }
  });

  return {
    app,
    getRenderOrder: () => renderOrder,
  };
}

// `DemoGroundTiles` is re-exported for callers (tests) that iterate
// `DEMO_GROUND_TILES` without importing `fixture.ts` a second time.
export type { DemoGroundTiles };
