// The street scene's Pixi mount -- one of a small, named set of files
// allowed to import `pixi.js` (`bootstrap.ts`,
// `render/pixi-order.ts`/`render/pixi-visibility.ts`, and story 1.10's
// `render/appearance/composite-canvas.ts`/`appearance-texture.ts` and
// `test-street/citizens-layer.ts`/`test-street/compare-pipeline-vs-stack.ts`, each its
// own real-canvas/Pixi adapter). Ordering itself is
// `render/pixi-order.ts`'s job, visibility is `render/pixi-visibility.
// ts`'s (story 1.7); this file's whole job is texture loading, sprite
// construction, container wiring, keyboard input and the mount-time
// geometry guard. Real LimeZu sprites only, loaded straight out of the
// repo-root `ModernTileset/` (Artie's direction: no coloured rectangles,
// no new PNGs beyond what a new prop genuinely needs) -- nearest-
// neighbour filtering, integer world-pixel positions rounded before the
// zoom scale, bottom-centre sprite anchors pinned to each drawable's own
// cell.
//
// D17: no debug text, no rank numbers, no sort-key readouts on the
// canvas. This module draws the scene and nothing else.

import { type Application, Assets, Container, Rectangle, Sprite, Texture } from "pixi.js";
import type { Defs } from "../defs/types";
import type { IgnoredSink, IntentSink } from "../input/intent";
import { attachKeyboard, type KeyboardState } from "../input/keyboard";
import type { PickContext, PickRect } from "../input/pick";
import { attachPointer } from "../input/pointer";
import { AppearanceTextureCache } from "../render/appearance/appearance-texture";
import type { AppearanceTuple } from "../render/appearance/composite";
import { layerCodeByName } from "../render/layer-table";
import { FloorStacks } from "../render/floor-stacks";
import { applyDepthOrder, type OrderedMember } from "../render/pixi-order";
import { VisibilityApplier, type VisibilityMember } from "../render/pixi-visibility";
import { floorOffsetPx, screenPositionPx } from "../render/screen-position";
import { fromSortUnits, toSortUnits } from "../render/sort-units";
import type { VisibilityState, VisibilityViewer } from "../render/visibility";
import { isFloorCulled } from "../render/visibility";
import {
  type FloorWalkResult,
  initialFloorWalkState,
  stepAndTransition,
} from "../world/floor-walk";
import type { MovementConfig } from "../world/movement";
import type { ObjectSource } from "../world/object-defs";
import { NO_OWNER, OwnershipIndex } from "../world/ownership";
import { TransitionIndex } from "../world/transitions";
import { WorldIndex } from "../world/world-index";
import { buildPlayerAppearanceTuple } from "./citizens";
import { type CitizensLayerHandle, mountCitizensLayer } from "./citizens-layer";
import {
  buildPlayerDrawable,
  buildPropDrawables,
  type PropDrawable,
  updatePlayerDrawable,
} from "./drawables";
import {
  STREET_BUILDING_AREAS,
  STREET_GROUND_TILES,
  STREET_ROOM_AREAS,
  STREET_TRANSITIONS,
  type StreetGroundTiles,
  streetColliderSources,
  streetPlacedRows,
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
  // Story 1.9's interaction target on the pavement: a real single street
  // bin from the city-props pack, 16x32px -- one cell wide, bottom
  // anchored, overhanging one tile upward like every other tall prop.
  trashBin: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/3_City_Props_Singles_16x16/ME_Singles_City_Props_16x16_Small_Closed_Trash_Can.png",
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
  // Story 1.13's footbridge: a concrete deck (the same city pavement
  // tile the street below it is paved with, repeated per deck cell) and
  // a flight of steps at each end. Real LimeZu art, no new PNGs.
  bridgeDeck: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/2_City_Terrains_Singles_16x16/ME_Singles_City_Terrains_16x16_Sidewalk_1_1.png",
    import.meta.url,
  ).href,
  bridgeStairsUp: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_Stairs_Complete_4.png",
    import.meta.url,
  ).href,
  bridgeStairsDown: new URL(
    "../../../ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/20_Subway_and_Train_Station_Singles_16x16/ME_Singles_Subway_and_Train_Station_16x16_Stairs_Complete_2.png",
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
};

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

/** FR173's affordance mark, as one dial (Artie's direction, cycle 2):
 * how strongly the additive overlay copy of a hovered object's own
 * sprites is drawn. Additive blending brightens that object's own opaque
 * pixels neutrally; a tint can only multiply, which reads as stained
 * rather than lit and carries the state change in hue alone. A blend mode
 * is not a filter, so FR121's ban is untouched. */
const HIGHLIGHT_ALPHA = 0.18;
/** The overlay's blend mode -- one of Pixi's basic modes, which needs no
 * filter path in the renderer. */
const HIGHLIGHT_BLEND_MODE = "add" as const;

/** The layer code every ground-tile-pass group's own synthetic
 * `VisibilityDrawable` carries -- never read by `computeVisibility`'s
 * wall-layer check (a ground pass is never `isNearSide`), so any live
 * code works; `"objects"` names one that exists without adding a
 * literal number. */
const GROUND_LAYER_CODE = layerCodeByName("objects");

export interface MountStreetSceneOptions {
  /** Story 1.10: the fetched, parsed defs document -- needed to build the
   * street crowd's real appearance textures (`citizens-layer.ts`) and, via
   * `citizens.ts`, the tuples themselves. */
  readonly defs: Defs;
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
  /** Real `defs/objects` footprints, colliders and FR148 reach rects,
   * keyed by def id (`world/object-defs.ts`), so a prop the street places
   * by `defId` uses what `defs/` declares for it rather than a restated
   * rect. */
  readonly objectDefs: ReadonlyMap<number, ObjectSource>;
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
  readonly onPlayerMove?: (x: number, y: number, floor: number) => void;
  /** Story 1.13 (NFR2): how long this scene's own ticker callback took,
   * in ms, every frame it runs -- the frame *work* the perf harness
   * gates on, never a rAF interval. One call per frame into a sink that
   * does nothing unless a perf run has asked for samples. */
  readonly onFrameWork?: (ms: number) => void;
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
  /** Called once, after the camera is set, with the zoom and the world
   * container's own offset -- what a caller needs to turn a world pixel
   * into a canvas one (story 1.9's e2e spec computes its click points
   * that way rather than hard-coding a pixel). */
  readonly onViewTransform?: (zoom: number, offsetX: number, offsetY: number) => void;
  /** Story 1.9 (FR148): where a click's intent goes. One injected sink,
   * and the only thing Epic 8 has to replace -- this scene neither knows
   * nor decides what an intent means. Absent means intents are simply
   * dropped, which is exactly what "unresolved until Epic 8" looks like. */
  readonly onIntent?: IntentSink;
  /** Called instead of `onIntent` when the player clicks an interactable
   * object that is out of reach (AC2) -- the render side's own cue that
   * the click was refused. */
  readonly onIgnored?: IgnoredSink;
  /** Called whenever the affordance-marked object changes (FR173), with
   * `undefined` when nothing is marked -- the render path's own event,
   * never polled. */
  readonly onHighlightChange?: (objectId: bigint | undefined) => void;
  /** The keyboard state to drive movement with -- required, and built by
   * the caller from the player's own stored bindings. No default here on
   * purpose: one falling back to `DEFAULT_BINDINGS` would silently ignore
   * what the player had set. */
  readonly keyboard: KeyboardState;
}

export interface StreetSceneHandle {
  readonly app: Application;
  /** The player's own appearance tuple, as composited at mount (FR61) --
   * `main.ts` wires its DEV-only `window.__bc` hook against this, the
   * same way it does for the crowd's own texture identities. */
  readonly playerAppearance: AppearanceTuple;
  getRenderOrder(): readonly bigint[];
  /** The keyboard this scene is actually driven by -- the caller's own
   * instance when it supplied one. */
  readonly keyboard: KeyboardState;
  /** Story 1.10: the mounted street crowd, for `main.ts` to wire its own
   * DEV-only `window.__bc` hooks against -- never read by this file. */
  readonly citizensLayer: CitizensLayerHandle;
  /** Removes every listener this scene attached (keyboard and pointer). */
  destroy(): void;
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
  const texture = sliceTexture(base, drawable, tileSizePx);
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
 * `wallOrientation` (`test-street/fixture.ts`'s `StreetProp.wallOrientation`,
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
 * Mounts the committed street scene (`fixture.ts`) into `app`, wires
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
export async function mountStreetScene(
  app: Application,
  options: MountStreetSceneOptions,
): Promise<StreetSceneHandle> {
  const {
    defs,
    tileSizePx,
    storeyHeightPx,
    rankOf,
    windowAlpha,
    movementConfig,
    objectDefs,
    windowDefIds,
    onOrderChange,
    onPlayerMove,
    onFrameWork,
    onVisibilityChange,
    onMasksChecked,
    onIntent,
    onIgnored,
    onViewTransform,
    onHighlightChange,
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

  // Story 1.13 (Tim's direction): one four-pass stack per floor -- three
  // flat passes then the y-sorted pool, declared in order even while
  // empty -- with the stacks themselves drawn in ascending floor order.
  // That is what lets a bridge deck on floor 1 sit over the street it
  // spans without floor ever entering the FR123 sort key.
  const stacks = new FloorStacks(world);

  // Story 1.7: the flat ground pass of each floor's own stack is toggled
  // as a unit through the same `VisibilityApplier` the pool goes through,
  // so a culled floor's flat passes are culled exactly as completely as
  // its pool sprites are, never a second rule.
  const groundContainersByFloor = new Map<number, Container>();
  function groundContainerFor(floor: number): Container {
    let container = groundContainersByFloor.get(floor);
    if (!container) {
      container = stacks.stackFor(floor).ground;
      groundContainersByFloor.set(floor, container);
    }
    return container;
  }

  const groundSprites: Sprite[] = [];
  for (const tiles of STREET_GROUND_TILES) {
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

  const ownership = new OwnershipIndex(STREET_BUILDING_AREAS, STREET_ROOM_AREAS);
  const transitions = new TransitionIndex(STREET_TRANSITIONS);

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

  // Story 1.10 (Artie's direction): the player itself is one generated
  // tuple through the real pipeline, never the placeholder
  // `Premade_Character_01.png` crop -- shares `appearanceCache` with the
  // street crowd (`citizensLayer` below), so a player who happens to
  // match a crowd member's tuple reuses that texture too (AC5).
  const appearanceCache = new AppearanceTextureCache(defs);
  const playerTuple = buildPlayerAppearanceTuple(defs);
  const playerFrames = await appearanceCache.acquire(playerTuple);
  const playerSprite = new Sprite(playerFrames.frame("idle", "down", 0));
  playerSprite.anchor.set(0.5, 1);
  positionSprite(playerSprite, walk.x, walk.y, walk.floor, tileSizePx, storeyHeightPx, "player");
  const playerEntry: PoolEntry = {
    drawable: playerDrawable,
    view: playerSprite,
    assetKey: "player",
  };
  const members: PoolEntry[] = [...entries, playerEntry];

  // One pool per floor (`FloorStacks`), so the comparator only ever
  // orders drawables that share a floor and the stacks themselves settle
  // what covers what between floors.
  const membersByFloor = new Map<number, PoolEntry[]>();
  function poolMembersOf(floor: number): PoolEntry[] {
    let list = membersByFloor.get(floor);
    if (!list) {
      list = [];
      membersByFloor.set(floor, list);
      stacks.stackFor(floor);
    }
    return list;
  }
  for (const m of members) poolMembersOf(m.drawable.floor).push(m);

  /** The order every floor's pool is in, concatenated ascending -- what
   * `window.__bc.renderOrder` reports and what the golden pins. Rebuilt
   * in place, never reallocated. */
  const renderOrder: bigint[] = [];
  const orderByFloor = new Map<number, bigint[]>();

  function reorderFloor(floor: number): void {
    const list = membersByFloor.get(floor);
    if (!list) return;
    let order = orderByFloor.get(floor);
    if (!order) {
      order = [];
      orderByFloor.set(floor, order);
    }
    applyDepthOrder(stacks.stackFor(floor).pool, list, order);
  }

  function rebuildRenderOrder(): void {
    renderOrder.length = 0;
    for (const floor of stacks.floors()) {
      for (const id of orderByFloor.get(floor) ?? []) renderOrder.push(id);
    }
  }

  function reorderAll(): void {
    for (const floor of stacks.floors()) reorderFloor(floor);
    rebuildRenderOrder();
  }

  reorderAll();
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

  // `onViewTransform` fires once, later, after the street crowd's own
  // camera re-fit below -- never here, while the camera is still only
  // fitted to the pre-crowd content and about to move again. A caller
  // reading `window.__bc.viewTransform` the moment it first appears must
  // see the one, final transform every click/hover computation the rest
  // of this scene's own lifetime will actually use, never a value that
  // is about to go stale.

  // The derived indexes: real `defs/objects` footprints, colliders and
  // FR148 reach rects (`objectDefs`, resolved from the fetched document
  // in `main.ts`) plus the street's own walls and world boundary, fed in as
  // `PlacedObject`-shaped rows through the one `WorldIndex.insert` that
  // feeds both the collision grid and the footprint index -- exactly the
  // shape a later chunk-streaming story's `onInsert` will feed, just
  // called directly here instead of from a subscription (`placed_object`
  // stays private in this story).
  // How far each definition's *art* is drawn outside its own footprint,
  // measured from the real sprites this scene just built (never a second,
  // hand-typed height). The footprint index needs it so that a click on
  // the part of a tall prop drawn over the cells above it still finds
  // that prop: our sprites are bottom-centre anchored, so a 16x32 bin on
  // a 1x1 footprint draws a whole cell up into the row behind it.
  const placedRows = streetPlacedRows();
  const defIdByObjectId = new Map(placedRows.map((row) => [row.objectId, row.defId]));
  const overhangByDefId = new Map<number, { up: number; side: number }>();
  for (const entry of entries) {
    const defId = defIdByObjectId.get(entry.drawable.stableId);
    if (defId === undefined) continue;
    const footprintWidthPx = entry.drawable.footprintWidth * tileSizePx;
    const up = Math.max(0, Math.ceil((entry.view.height - tileSizePx) / tileSizePx));
    const side = Math.max(0, Math.ceil((entry.view.width - footprintWidthPx) / 2 / tileSizePx));
    const current = overhangByDefId.get(defId);
    overhangByDefId.set(defId, {
      up: Math.max(current?.up ?? 0, up),
      side: Math.max(current?.side ?? 0, side),
    });
  }

  const objectSources = new Map<number, ObjectSource>(
    [...objectDefs, ...streetColliderSources(movementConfig.subcellsPerCell)].map(
      ([defId, source]) => {
        const overhang = overhangByDefId.get(defId);
        return [
          defId,
          overhang
            ? { ...source, drawOverhangCellsUp: overhang.up, drawOverhangCellsX: overhang.side }
            : source,
        ];
      },
    ),
  );
  const worldIndex = new WorldIndex(movementConfig.subcellsPerCell, objectSources);
  for (const placed of placedRows) {
    worldIndex.insert(placed);
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

  // Story 1.9: which objects are currently visible, rebuilt from each
  // pool member's own just-written `sprite.visible` whenever visibility
  // is re-applied (a rare event, never per frame). A click resolves
  // through this: if it cannot be seen it cannot be clicked, so a
  // retracted front wall is neither clickable itself nor in the way of
  // what is now visible behind it.
  const hiddenObjectIds = new Set<bigint>();
  function refreshHiddenObjects(): void {
    const anyVisible = new Map<bigint, boolean>();
    for (const entry of entries) {
      const id = entry.drawable.stableId;
      anyVisible.set(id, (anyVisible.get(id) ?? false) || entry.view.visible);
    }
    hiddenObjectIds.clear();
    for (const [id, visible] of anyVisible) {
      if (!visible) hiddenObjectIds.add(id);
    }
  }

  let lastCellX = walk.cellX;
  let lastCellY = walk.cellY;
  applyVisibilityFor(lastCellX, lastCellY, walk.floor, true);
  refreshHiddenObjects();

  onPlayerMove?.(walk.x, walk.y, walk.floor);

  const { keyboard } = options;
  const detachKeyboard = attachKeyboard(keyboard);

  // FR173's affordance mark (Artie's direction, cycle 2): while an object
  // is hovered and in reach, one extra sprite per drawable of that object
  // -- same texture, same transform, drawn in the slot directly above its
  // own source sprite -- composited additively. That brightens the
  // object's own opaque pixels and nothing else: not its tile, not a box
  // around it, and nothing left in the world once the pointer moves on.
  // Built lazily on hover and destroyed on un-hover, so a scene at rest
  // carries none of them.
  const spritesByObjectId = new Map<bigint, Sprite[]>();
  for (const entry of entries) {
    const id = entry.drawable.stableId;
    const list = spritesByObjectId.get(id);
    if (list) list.push(entry.view);
    else spritesByObjectId.set(id, [entry.view]);
  }

  let highlightedObjectId: bigint | undefined;
  let highlightOverlays: Sprite[] = [];

  function clearHighlightOverlays(): void {
    for (const overlay of highlightOverlays) {
      overlay.parent?.removeChild(overlay);
      overlay.destroy();
    }
    highlightOverlays = [];
  }

  function buildHighlightOverlays(objectId: bigint): void {
    for (const source of spritesByObjectId.get(objectId) ?? []) {
      const parent = source.parent;
      if (!parent || !source.visible) continue;
      const overlay = new Sprite(source.texture);
      overlay.anchor.set(source.anchor.x, source.anchor.y);
      overlay.x = source.x;
      overlay.y = source.y;
      overlay.scale.set(source.scale.x, source.scale.y);
      overlay.alpha = HIGHLIGHT_ALPHA * source.alpha;
      overlay.blendMode = HIGHLIGHT_BLEND_MODE;
      parent.addChildAt(overlay, parent.getChildIndex(source) + 1);
      highlightOverlays.push(overlay);
    }
  }

  function setHighlight(objectId: bigint | undefined): void {
    if (highlightedObjectId === objectId) return;
    clearHighlightOverlays();
    highlightedObjectId = objectId;
    if (objectId !== undefined) buildHighlightOverlays(objectId);
    onHighlightChange?.(objectId);
  }

  /** Re-attaches the overlays after something rebuilt the pool
   * container's children: `applyDepthOrder` drops every child it does not
   * own, and an overlay is deliberately not a pool member. */
  function reapplyHighlight(): void {
    if (highlightedObjectId === undefined) return;
    clearHighlightOverlays();
    buildHighlightOverlays(highlightedObjectId);
  }

  // FR148's one pointer listener, on the canvas element itself -- no Pixi
  // `eventMode`, no `interactive`, no per-sprite `on("pointer…")`
  // anywhere in this client.
  // The rect each object's sprites actually cover, in the world
  // container's own pixel space -- measured once from the real sprites
  // this scene built, never a second hand-typed height. This is what lets
  // a click on any drawn part of a prop resolve to it, including the part
  // that overhangs the cells above its own footprint.
  const drawnRects = new Map<bigint, PickRect>();
  for (const [objectId, sprites] of spritesByObjectId) {
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const sprite of sprites) {
      const left = sprite.x - sprite.width * sprite.anchor.x;
      const top = sprite.y - sprite.height * sprite.anchor.y;
      x0 = Math.min(x0, left);
      y0 = Math.min(y0, top);
      x1 = Math.max(x1, left + sprite.width);
      y1 = Math.max(y1, top + sprite.height);
    }
    if (Number.isFinite(x0)) drawnRects.set(objectId, { x0, y0, x1, y1 });
  }

  const pickContext = (): PickContext => ({
    index: worldIndex,
    objectDefs: objectSources,
    rankOf,
    subcellsPerCell: movementConfig.subcellsPerCell,
    isVisible: (objectId) => !hiddenObjectIds.has(objectId),
    drawnRectOf: (objectId) => drawnRects.get(objectId),
  });
  const pointer = attachPointer({
    element: app.canvas,
    // Client pixels to the world-pixel space `screenPositionPx` produces:
    // undo the canvas's own CSS scaling, then the camera offset and zoom
    // this scene applied to the world container.
    toWorldPx: (clientX, clientY) => {
      const rect = app.canvas.getBoundingClientRect();
      // `app.screen` is in the renderer's *logical* units -- the same
      // space `world.position`/`world.scale` live in. `canvas.width` is in
      // device pixels and matches only while `resolution` is 1, so the day
      // someone turns on `autoDensity` for HiDPI it would put every click
      // on the wrong cell with nothing to catch it.
      const scaleX = rect.width > 0 ? app.screen.width / rect.width : 1;
      const scaleY = rect.height > 0 ? app.screen.height / rect.height : 1;
      return {
        x: ((clientX - rect.left) * scaleX - world.position.x) / world.scale.x,
        y: ((clientY - rect.top) * scaleY - world.position.y) / world.scale.y,
      };
    },
    context: pickContext,
    player: () => ({ x: walk.x, y: walk.y, floor: walk.floor }),
    tileSizePx,
    storeyHeightPx,
    onIntent: (intent) => onIntent?.(intent),
    onIgnored: (objectId) => onIgnored?.(objectId),
    onHighlightChange: setHighlight,
  });

  app.ticker.add((ticker) => {
    // NFR2's measurement point: the scene's own work for this frame,
    // start to finish. `performance.now()` twice per frame allocates
    // nothing and costs nothing measurable; the sink itself keeps no
    // samples unless a perf run has asked for them.
    const frameStart = performance.now();
    tick(ticker.deltaMS);
    onFrameWork?.(performance.now() - frameStart);
  });

  function tick(deltaMS: number): void {
    const direction = keyboard.direction();
    if (direction.x === 0 && direction.y === 0) return;

    const before = { x: toSortUnits(walk.x), y: toSortUnits(walk.y) };
    const floorBefore = walk.floor;
    walk = stepAndTransition(
      walk,
      direction,
      deltaMS,
      worldIndex,
      movementConfig,
      transitions,
    );

    onPlayerMove?.(walk.x, walk.y, walk.floor);

    updatePlayerDrawable(playerDrawable, walk.x, walk.y, walk.floor);
    positionSprite(playerSprite, walk.x, walk.y, walk.floor, tileSizePx, storeyHeightPx, "player");

    // Only re-sort when the player's own sort key actually moved to a
    // new sub-tile unit (Tim's direction): a street of static props
    // costs nothing per frame.
    // A floor transition moves the player between two pools -- a rare
    // event, never the per-frame path -- so its own floor's pool and the
    // one it left are both re-sorted, which is also what re-parents the
    // player's sprite into the stack it now belongs to.
    if (walk.floor !== floorBefore) {
      const leaving = membersByFloor.get(floorBefore);
      if (leaving) {
        const index = leaving.indexOf(playerEntry);
        if (index >= 0) leaving.splice(index, 1);
      }
      poolMembersOf(walk.floor).push(playerEntry);
      reorderFloor(floorBefore);
      reorderFloor(walk.floor);
      rebuildRenderOrder();
      reapplyHighlight();
      onOrderChange?.(renderOrder);
    } else {
      const after = { x: toSortUnits(walk.x), y: toSortUnits(walk.y) };
      if (after.x !== before.x || after.y !== before.y) {
        // Only the player's own floor can have changed order: every
        // other member of every other pool is static.
        reorderFloor(walk.floor);
        rebuildRenderOrder();
        reapplyHighlight();
        onOrderChange?.(renderOrder);
      }
    }

    // Ownership is looked up only when the player's own cell actually
    // changed (Tim's direction) -- never every frame -- and visibility is
    // re-applied only when that lookup (or the floor) actually differs
    // from last time (`VisibilityApplier`'s own gate).
    if (walk.cellX !== lastCellX || walk.cellY !== lastCellY || walk.transitioned) {
      lastCellX = walk.cellX;
      lastCellY = walk.cellY;
      applyVisibilityFor(walk.cellX, walk.cellY, walk.floor, false);
      refreshHiddenObjects();
    }

    // The hover has to follow the world, not only the mouse: movement is
    // keyboard-only, so walking into or out of an object's reach with the
    // mouse held still is the normal way a player meets the affordance.
    // Reach is sub-cell, so this runs on every step that actually moved,
    // not only when the player enters a new cell. It is still an event --
    // a frame where nothing moved returns above and never reaches here.
    pointer.refresh();
  }

  // Story 1.10: the street crowd, a second, additive layer under `world`
  // -- never part of `members`/`poolContainer` (see `citizens.ts`'s own
  // module doc for why: it must never move this scene's own committed
  // depth-order goldens). Mounted last, after every signal an existing
  // e2e spec's own `ready()` gate depends on
  // (`onOrderChange`/`onPlayerMove`/`onVisibilityChange`/
  // `onMasksChecked`, and the keyboard itself) has already fired -- those
  // all run synchronously, in this same function body, before this
  // `await`; only `mountStreetScene`'s own promise (`onViewTransform`
  // included, deliberately fired only once, below) waits on the crowd's
  // own network-bound texture loads. The camera fit above already sized
  // the canvas to the pre-crowd content; the crowd needs its own second,
  // one-time re-fit once it exists, since Artie's "nothing this scene
  // contains may be drawn off-canvas" applies to it too.
  const citizensLayer = await mountCitizensLayer(
    world,
    defs,
    tileSizePx,
    appearanceCache,
    textureFor("sidewalk", textures),
  );
  const worldBoundsWithCrowd = world.getLocalBounds();
  const canvasWidthWithCrowd = Math.ceil(worldBoundsWithCrowd.width * ZOOM) + CANVAS_MARGIN_PX * 2;
  const canvasHeightWithCrowd =
    Math.ceil(worldBoundsWithCrowd.height * ZOOM) + CANVAS_MARGIN_PX * 2;
  app.renderer.resize(canvasWidthWithCrowd, canvasHeightWithCrowd);
  world.scale.set(ZOOM);
  world.position.set(
    CANVAS_MARGIN_PX - worldBoundsWithCrowd.x * ZOOM,
    CANVAS_MARGIN_PX - worldBoundsWithCrowd.y * ZOOM,
  );
  onViewTransform?.(ZOOM, world.position.x, world.position.y);

  // Story 1.10: the one walking citizen's own animation, always
  // ticking -- unlike the player's own ticker above, this must never
  // early-return while the player stands still, so it is a second,
  // independent `app.ticker.add` registration rather than folded into
  // the one above.
  app.ticker.add((ticker) => citizensLayer.update(ticker.deltaMS));

  return {
    app,
    playerAppearance: playerTuple,
    getRenderOrder: () => renderOrder,
    keyboard,
    citizensLayer,
    destroy: () => {
      detachKeyboard();
      pointer.detach();
      setHighlight(undefined);
    },
  };
}

// `StreetGroundTiles` is re-exported for callers (tests) that iterate
// `STREET_GROUND_TILES` without importing `fixture.ts` a second time.
export type { StreetGroundTiles };
