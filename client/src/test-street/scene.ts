// The street scene's Pixi mount -- one of a small, named set of files
// allowed to import `pixi.js` (`bootstrap.ts`,
// `render/pixi-order.ts`/`render/pixi-visibility.ts`/`render/pixi-highlight.ts`,
// and story 1.10/2.7's `render/appearance/composite-pages.ts`/`appearance-texture.ts` and
// `test-street/citizens-layer.ts`/`test-street/compare-pipeline-vs-stack.ts`, each its
// own real-canvas/Pixi adapter). Ordering itself is
// `render/pixi-order.ts`'s job, visibility is `render/pixi-visibility.
// ts`'s (story 1.7), FR173's affordance mark is `render/pixi-highlight.
// ts`'s (story 1.15); this file's whole job is texture loading, sprite
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

import {
  type Application,
  Assets,
  Container,
  Rectangle,
  Sprite,
  Texture,
  UPDATE_PRIORITY,
} from "pixi.js";
import { BOOT_MARK, markBoot } from "../boot/boot-marks";
import type { VerifiedDefs } from "../boot/handshake";
import type { IgnoredSink, IntentSink } from "../input/intent";
import { attachKeyboard, type KeyboardState } from "../input/keyboard";
import type { PickContext, PickRect } from "../input/pick";
import { attachPointer } from "../input/pointer";
import { AppearanceTextureCache } from "../render/appearance/appearance-texture";
import type { AppearanceTuple } from "../render/appearance/composite";
import {
  AtlasPageLoader,
  countAllBoundTextureSources,
  countBoundAtlasPages,
} from "../render/atlas-pages";
import { type Camera, computeCamera, worldPxFromClient } from "../render/camera";
import { FloorStacks } from "../render/floor-stacks";
import { layerCodeByName, passOfLayer } from "../render/layer-table";
import { HighlightApplier } from "../render/pixi-highlight";
import { applyDepthOrder, type OrderedMember } from "../render/pixi-order";
import { VisibilityApplier, type VisibilityMember } from "../render/pixi-visibility";
import { floorOffsetPx, screenPositionPx } from "../render/screen-position";
import type { Drawable } from "../render/sort-key";
import { fromSortUnits, toSortUnits } from "../render/sort-units";
import type { VisibilityState, VisibilityViewer } from "../render/visibility";
import { isFloorCulled } from "../render/visibility";
import type { GridEntry } from "../world/collision-grid";
import {
  type FloorWalkResult,
  initialFloorWalkState,
  stepAndTransition,
} from "../world/floor-walk";
import type { MovementConfig } from "../world/movement";
import { buildObjectDefIndex, type ObjectSource, objectDefById } from "../world/object-defs";
import { NO_OWNER, OwnershipIndex } from "../world/ownership";
import { TransitionIndex } from "../world/transitions";
import type { CellBounds, PlacedObjectView } from "../world/world-index";
import { WorldIndex } from "../world/world-index";
import { ASSET_URLS, type PixelRect, WALL_TILE_H_FRAME, WALL_TILE_V_FRAME } from "./assets";
import { buildPlayerAppearanceTuple } from "./citizens";
import { type CitizensLayerHandle, mountCitizensLayer } from "./citizens-layer";
import {
  buildPlayerDrawable,
  buildPropDrawables,
  isDefPropDrawable,
  type PropDrawable,
  type PropDrawableByAsset,
  updatePlayerDrawable,
} from "./drawables";
import {
  PLAYER_START,
  STREET_BUILDING_AREAS,
  STREET_GROUND_TILES,
  STREET_ROOM_AREAS,
  STREET_TRANSITIONS,
  type StreetGroundTiles,
  streetColliderSources,
  streetPlacedRows,
} from "./fixture";

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
const GROUND_LAYER_CODE = layerCodeByName("ground");
const GROUND_OBJECTS_LAYER_CODE = layerCodeByName("ground_objects");

export interface MountStreetSceneOptions {
  /** Story 1.10: the fetched, parsed defs document -- needed to build the
   * street crowd's real appearance textures (`citizens-layer.ts`) and, via
   * `citizens.ts`, the tuples themselves. Story 2.8 (FR147): typed as
   * `VerifiedDefs`, not `Defs` -- `boot/handshake.ts`'s `markVerified` is
   * the only way to produce one, so a caller cannot mount the scene with
   * a defs document the FR147 handshake has not cleared (or explicitly
   * decided is "unknown", never "known stale"). */
  readonly defs: VerifiedDefs;
  /** Story 2.6: the already-resolved base a packed atlas page's own
   * filename is appended to (e.g. `` `${import.meta.env.BASE_URL}atlas/`
   * `` at the real call site) -- never hard-coded and never read from
   * `import.meta.env` in this file, the same idiom `main.ts` already uses
   * for `defs/defs.json`'s own fetch path. */
  readonly atlasBaseUrl: string;
  readonly tileSizePx: number;
  readonly storeyHeightPx: number;
  readonly rankOf: (layerCode: number) => number;
  /** `render.window_alpha`'s resolved balance value (FR121), already
   * divided down to a plain `(0, 1)` fraction -- never a literal in this
   * file or in `render/visibility.ts`/`pixi-visibility.ts`. */
  readonly windowAlpha: number;
  /** `render.highlight_alpha`'s resolved balance value (FR173), already
   * divided down to a plain `(0, 1)` fraction -- the ceiling
   * `render/highlight.ts`'s `highlightOverlayAlpha` scales by the U1
   * display-strength dial, never a literal in `render/highlight.ts` or
   * `render/pixi-highlight.ts`. */
  readonly highlightAlpha: number;
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
   * plus every ground-tile-pass group, keyed `ground:<floor>`, and every
   * flat ground-object pass group, keyed `ground_objects:<floor>` (Tim's
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
  /** Called once, synchronously, the instant `world` (the container every
   * ground tile and drawable is a descendant of) exists -- before any
   * asset-loading `await` in this function has a chance to let the
   * ticker render a frame with it. The callback receives a live getter
   * over the real container's own `scale`/`position`, so a caller (`main.
   * ts`, wiring `client/tests/e2e/camera-viewport.spec.ts`'s AC4 load
   * spec) can observe the real, mounted transform for every frame of the
   * whole load, not only after `mountStreetScene`'s own promise
   * resolves. */
  readonly onWorldReady?: (
    worldTransform: () => { scaleX: number; scaleY: number; x: number; y: number },
  ) => void;
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
  /** FR173's affordance dial (story 1.11, the U1 dial from `docs/ux.md`):
   * 0-100, scaling `highlightAlpha` linearly (`render/highlight.ts`'s
   * `highlightOverlayAlpha`). Required, not defaulted here (Tim's
   * direction, cycle 2): `settings/display-settings.ts`'s
   * `DEFAULT_DISPLAY_SETTINGS` is the one place a default for this value
   * exists -- a second opinion on it here is exactly what let the range
   * `[20, 100]` and this file's own fallback of 100 disagree. */
  readonly highlightStrength: number;
  /** The keyboard state to drive movement with -- required, and built by
   * the caller from the player's own stored bindings. No default here on
   * purpose: one falling back to `DEFAULT_BINDINGS` would silently ignore
   * what the player had set. */
  readonly keyboard: KeyboardState;
  /** Story 1.13: starts the street crowd's own walk-cycle ticker paused
   * -- every citizen stays at its initial, fixed-fixture pose, forever,
   * rather than animating. Exists solely so `test-street.spec.ts`'s
   * `toHaveScreenshot` checks have a deterministic frame to compare: the
   * crowd's own animation state otherwise depends on real wall-clock
   * timing between mount and screenshot, which no baseline could ever
   * match twice. Absent (or `false`) means the crowd walks normally. */
  readonly startWithCrowdFrozen?: boolean;
  /** Story 2.7 (Quentin's direction): collapses the street crowd's own
   * distinct-per-citizen appearance tuples down to one shared tuple per
   * family, same count and positions -- exists solely so `test-street.
   * spec.ts`'s "different people cost about as much as identical ones"
   * comparison can mount the "identical" half without a second crowd
   * fixture module. Absent (or `false`) means the crowd's own tuples
   * stay distinct, exactly as they always have. */
  readonly crowdIdenticalTuples?: boolean;
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
  /** Story 2.6 (NFR12): how many distinct atlas page `TextureSource`s are
   * actually reachable from the mounted display list right now
   * (`countBoundAtlasPages` over `app.stage`, not the loader's own
   * request count -- Quentin's direction), for `main.ts` to wire its own
   * DEV-only `window.__bc` hook against, the same way it does for the
   * crowd's own texture identity count. */
  readonly distinctBoundAtlasPages: number;
  /** Every distinct `TextureSource` reachable from the mounted display
   * list right now, *unfiltered* (`countAllBoundTextureSources` over
   * `app.stage`, never narrowed to a known-page set) -- for
   * `appearance.spec.ts`'s crowd-cost proof, which needs to see a
   * regression back to one standalone texture per composited look that
   * `distinctBoundAtlasPages` alone cannot (Quentin's direction, cycle
   * 1). */
  readonly allBoundTextureSources: number;
  /** The player sprite's own real, live global screen bounds (Pixi's own
   * `getBounds()`, which walks every ancestor transform, camera
   * included) -- a getter, not a value snapshotted once, so
   * `camera-viewport.spec.ts` can sample the *actual drawn position*
   * every frame without ever recomputing it from `viewTransform` itself
   * (Quentin's direction: a follow-camera proof must never check its own
   * implementation). */
  playerScreenBounds(): { x: number; y: number; width: number; height: number };
  /** Removes every listener this scene attached (keyboard and pointer). */
  destroy(): void;
  /** Live-updates the FR173 highlight dial (0-100) -- re-applies
   * immediately to whatever is highlighted right now, so dragging the
   * options-menu slider while an object is marked is visible without a
   * re-hover. */
  setHighlightStrength(strength: number): void;
  /** Ignores new pointer input (no new hovers, no clicks) until
   * [`resumePointer`], without touching an already-true mark (Derek's
   * direction) -- `main.ts` calls this from the options menu's own
   * `onOpenChange(true)`. */
  suspendPointer(): void;
  /** Stops ignoring pointer input, and re-resolves the hover at the last
   * known pointer position, if any -- `main.ts` calls this from
   * `onOpenChange(false)`. */
  resumePointer(): void;

  // Story 1.12 (FR165): the reads `main.ts` assembles a `DebugWorldView`
  // out of. Deliberately four plain reads rather than a `DebugWorldView`
  // built here: `test-street/` never imports `debug/` (nothing but
  // `main.ts` does), and Epic 3's real pool will expose the same four
  // facts from somewhere else entirely.

  /** The floor the player is standing on right now. */
  currentFloor(): number;
  /** Every member of every floor's y-sorted pool, as the comparator sees
   * them. The street crowd is not in here, because it is not in the
   * sorted pool (`citizens.ts`) -- an overlay showing it would be
   * claiming an ordering authority that does not exist. */
  poolDrawables(): readonly Drawable[];
  /** Where `stableId` came out in the order actually applied, or
   * `undefined` when it is in no pool. Read from the same `renderOrder`
   * the render path rebuilds, never re-sorted here. */
  orderIndexOf(stableId: bigint): number | undefined;
  /** FR128's live collision read -- the very same grid `world/movement.ts`
   * resolves a step against. */
  collidersInCell(floor: number, cellX: number, cellY: number): readonly GridEntry[];
  /** Every placed object reaching into `bounds`, once each -- including
   * the ones with no collider, which the grid above cannot report. */
  worldObjects(bounds: CellBounds): Iterable<PlacedObjectView>;
}

function cropped(base: Texture, frame: Rectangle | PixelRect): Texture {
  const rect =
    frame instanceof Rectangle ? frame : new Rectangle(frame.x, frame.y, frame.width, frame.height);
  return new Texture({ source: base.source, frame: rect, dynamic: false });
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
 * equal whole-pixel cells). A footprint decomposed along both axes is
 * sliced one tile per cell, from art exactly its size. Anything else -- a
 * fractional slice, or a mismatch -- throws at mount rather than drawing
 * a stretched lie.
 */
export function sliceTexture(
  base: Texture,
  drawable: PropDrawableByAsset,
  tileSizePx: number,
): Texture {
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
  // Both axes: only art exactly `width x height` tiles, one tile per cell.
  if (base.width === footprintWidth * tileSizePx && base.height === footprintHeight * tileSizePx) {
    return cropped(
      base,
      new Rectangle(sourceCol * tileSizePx, sourceRow * tileSizePx, tileSizePx, tileSizePx),
    );
  }
  throw new Error(
    `sliceTexture: asset '${assetKey}' is ${base.width}x${base.height}px, not exactly its ${footprintWidth}x${footprintHeight}-tile footprint -- a two-axis footprint is only sliced from art that size`,
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

/** One drawable's own real texture (story 2.13): a `defId` drawable draws
 * only through `AtlasPageLoader.objectCellTexture` -- never a
 * `ModernTileset/` import; an `assetKey` drawable keeps drawing from
 * `scene.ts`'s own raw texture table via `sliceTexture`, exactly as
 * before. The one place this file dispatches on the `PropDrawable`
 * union's own discriminant. `objectDefIndex` is built once at mount
 * (Tim's direction, cycle 2) -- never a fresh linear `find` per drawable. */
function resolvePropTexture(
  drawable: PropDrawable,
  defs: VerifiedDefs,
  objectDefIndex: ReturnType<typeof buildObjectDefIndex>,
  atlasPageLoader: AtlasPageLoader,
  textures: ReadonlyMap<string, Texture>,
  tileSizePx: number,
): Promise<Texture> {
  if (isDefPropDrawable(drawable)) {
    const object = objectDefById(objectDefIndex, drawable.defId);
    return atlasPageLoader.objectCellTexture(defs, object, drawable.sourceCol, tileSizePx);
  }
  const base = textureFor(drawable.assetKey, textures);
  return Promise.resolve(sliceTexture(base, drawable, tileSizePx));
}

function createSprite(texture: Texture): Sprite {
  const sprite = new Sprite(texture);
  // Bottom-centre origin pinned to the cell's bottom edge (Artie's
  // direction): a tall sprite overhangs upward out of its footprint,
  // never downward.
  sprite.anchor.set(0.5, 1);
  return sprite;
}

/** `SCREEN_Y_NUDGE_PX`'s own screen-space nudge, in pixels -- structurally
 * unreachable from a `defId` drawable (Tim's direction, cycle 2: not
 * merely "misses today"), so no `"def:<id>"` entry could ever apply one
 * to a def row: an `assetKey` drawable looks its own key up in the
 * table; a `defId` drawable is never even offered the chance to. */
function assetNudgePx(drawable: PropDrawable): number {
  return isDefPropDrawable(drawable) ? 0 : (SCREEN_Y_NUDGE_PX[drawable.assetKey] ?? 0);
}

/** A debug-only label for a drawable (`PoolEntry.label`,
 * `assertNoOverhangBeyondStorey`'s own failure message) -- never read to
 * pick a texture or a nudge; `resolvePropTexture`/`assetNudgePx` do that
 * from the drawable itself. */
function debugLabel(drawable: PropDrawable): string {
  return isDefPropDrawable(drawable) ? `def:${drawable.defId}` : drawable.assetKey;
}

function positionSprite(
  sprite: Sprite,
  worldX: number,
  worldY: number,
  floor: number,
  tileSizePx: number,
  storeyHeightPx: number,
  nudgePx: number,
): void {
  const pos = screenPositionPx(worldX, worldY, floor, tileSizePx, storeyHeightPx);
  sprite.x = pos.x;
  sprite.y = pos.y + nudgePx;
}

/** Mount-time geometry guard (Artie's direction): a drawable's art may
 * overhang above its own anchor row (bottom-centre anchoring makes that
 * the normal case), but never by more than one storey. The off-canvas
 * wall this pair replaced overhung by a factor of thirteen; this is the
 * rule that would have caught it directly, by name, instead of only via
 * where the sprite happened to land on screen.
 *
 * Its own former sibling, `assertSpritesWithinCanvas`, is gone (the
 * camera/viewport story, Quentin's direction): the canvas is sized to the
 * viewport now, never fitted to the world's own content, so "every sprite
 * is drawn within the canvas" stopped being a fact about the *scene* the
 * moment the world could be larger than what is on screen at once -- a
 * prop two blocks from the player is correctly off-canvas. This guard
 * survives because it never depended on the canvas at all. */
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
  /** A debug-only label (Artie's `assertNoOverhangBeyondStorey` failure
   * message) -- the drawable's own `assetKey`, or `def:<id>` for a
   * `defId` drawable (`debugLabel`'s own idiom). Never read to pick a
   * texture or a nudge; `resolvePropTexture`/`assetNudgePx` do that from
   * the drawable itself. */
  readonly label: string;
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
 * The camera/viewport story's own wiring, factored out for its own unit
 * test (Quentin's direction): the one call every ticker frame makes to
 * apply the camera. Its signature is the structural guarantee that it
 * can never call `renderer.resize`/`world.getLocalBounds` -- it does not
 * receive a renderer or the world's own bounds, only the pure inputs
 * `render/camera.ts`'s `computeCamera` takes (`world` itself supplies the
 * zoom), plus the `Container` to write the result onto. It only ever
 * writes `world.position` -- never `world.scale` -- so `ZOOM` set once at
 * mount (before this container had a single child) stays exactly what it
 * was set to, call after call.
 *
 * Zoom is read from `world.scale.x` (cycle 2, Quentin's direction), never
 * taken as a second, free parameter next to a container that already
 * carries its own scale: two numbers that are supposed to always agree
 * is two sources of truth, and a unit test could pass with them silently
 * disagreeing. Throws if `world.scale.x` and `.y` themselves disagree --
 * this scene never sets them independently, so that can only mean a
 * caller broke the one-zoom-for-everything invariant this whole module
 * exists to hold.
 */
export function applyCameraToWorld(
  world: Container,
  playerScreenX: number,
  playerScreenY: number,
  viewportWidth: number,
  viewportHeight: number,
): Camera {
  if (world.scale.x !== world.scale.y) {
    throw new Error(
      `applyCameraToWorld: world.scale is not uniform (x=${world.scale.x}, y=${world.scale.y}) -- ` +
        "this scene only ever sets one zoom for both axes",
    );
  }
  const camera = computeCamera(
    playerScreenX,
    playerScreenY,
    viewportWidth,
    viewportHeight,
    world.scale.x,
  );
  world.position.set(camera.offsetX, camera.offsetY);
  return camera;
}

/**
 * The picker's own inverse projection (cycle 2, Quentin's direction):
 * client pixels to the world-pixel space `screen-position.ts` produces,
 * through `render/camera.ts`'s `worldPxFromClient` -- the same function
 * `applyCameraToWorld`'s own camera is built for, so the real, mounted
 * picker and the real, mounted camera can never quietly drift onto two
 * different projections. `canvasRect`/`screenWidth`/`screenHeight` are
 * plain numbers rather than a live `HTMLCanvasElement`/`Application` so
 * this is callable from a unit test with no canvas or GPU; the real call
 * site supplies them from `app.canvas.getBoundingClientRect()` and
 * `app.screen` (logical units -- never `renderer.width`/`height`, which
 * are device pixels and only match while `resolution` is 1).
 */
export function clientToWorldPx(
  clientX: number,
  clientY: number,
  canvasRect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
  screenWidth: number,
  screenHeight: number,
  world: Container,
): { readonly x: number; readonly y: number } {
  const scaleX = canvasRect.width > 0 ? screenWidth / canvasRect.width : 1;
  const scaleY = canvasRect.height > 0 ? screenHeight / canvasRect.height : 1;
  const logicalX = (clientX - canvasRect.left) * scaleX;
  const logicalY = (clientY - canvasRect.top) * scaleY;
  if (world.scale.x !== world.scale.y) {
    throw new Error(
      `clientToWorldPx: world.scale is not uniform (x=${world.scale.x}, y=${world.scale.y})`,
    );
  }
  return worldPxFromClient(logicalX, logicalY, {
    zoom: world.scale.x,
    offsetX: world.position.x,
    offsetY: world.position.y,
  });
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
    atlasBaseUrl,
    tileSizePx,
    storeyHeightPx,
    rankOf,
    windowAlpha,
    highlightAlpha,
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
    onWorldReady,
    onHighlightChange,
    startWithCrowdFrozen,
    crowdIdenticalTuples,
    highlightStrength,
  } = options;
  const crowdFrozen = startWithCrowdFrozen ?? false;

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

  // Story 2.6/2.13: every `defId`-placed prop draws through
  // `AtlasPageLoader` instead of a `ModernTileset/` URL import -- its own
  // per-cell texture is resolved per drawable, below, by
  // `resolvePropTexture`. This loader is the one place a packed atlas
  // page is ever fetched.
  const atlasPageLoader = new AtlasPageLoader(atlasBaseUrl);
  // Built once (Tim's direction, cycle 2): every `defId` lookup below goes
  // through this index, never a fresh linear `Array.find` per drawable.
  const objectDefIndex = buildObjectDefIndex(defs);

  const world = new Container();
  // The camera/viewport story (Quentin's direction): zoom is set here,
  // before this container has a single child and before it is even
  // attached to the stage, and never touched again -- only the camera's
  // own `position` (below, `applyCamera`) changes after this point, once
  // per frame. The renderer's own size is the caller's concern
  // (`main.ts`'s `resizeTo: window`, never `app.renderer.resize` called
  // from here): this scene never sizes the canvas to its own content any
  // more.
  world.scale.set(ZOOM);

  // The player's own starting state (cycle 2, Quentin's direction):
  // computed synchronously from `PLAYER_START` alone, so it is available
  // here -- before `world` has a single child, before it is even
  // attached to the stage, and before any of the awaits above or below
  // this point (texture/atlas/appearance/crowd loads, all network-bound)
  // next suspend this function. The camera is applied immediately after,
  // in the same synchronous stretch, so `world.position` is already its
  // final value the instant the first real content becomes a child of
  // it -- no frame is ever drawn with the world at its own default
  // `(0, 0)` position while ground tiles or props already sit inside it,
  // the exact defect (a mount-time jump) this cycle's finding 1 named.
  let walk: FloorWalkResult = {
    ...initialFloorWalkState(PLAYER_START.x, PLAYER_START.y, PLAYER_START.floor),
    transitioned: false,
  };

  // `app.screen` is the renderer's *logical* size (cycle 2, Quentin's
  // direction) -- the same space `world.position`/`world.scale` live in.
  // `app.renderer.width`/`height` are device pixels and match only while
  // `resolution` is 1; reading them here would silently de-centre the
  // player the day `autoDensity`/a non-1 `resolution` is ever turned on.
  let lastCamera: Camera | undefined;
  function applyCamera(): void {
    const anchor = screenPositionPx(walk.x, walk.y, walk.floor, tileSizePx, storeyHeightPx);
    const camera = applyCameraToWorld(
      world,
      anchor.x,
      anchor.y,
      app.screen.width,
      app.screen.height,
    );
    if (
      !lastCamera ||
      lastCamera.zoom !== camera.zoom ||
      lastCamera.offsetX !== camera.offsetX ||
      lastCamera.offsetY !== camera.offsetY
    ) {
      lastCamera = camera;
      onViewTransform?.(camera.zoom, camera.offsetX, camera.offsetY);
    }
  }
  applyCamera();

  app.stage.addChild(world);
  onWorldReady?.(() => ({
    scaleX: world.scale.x,
    scaleY: world.scale.y,
    x: world.position.x,
    y: world.position.y,
  }));

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

  // `wallAssetOf`'s swatch picker only ever applies to a hand-picked
  // `assetKey` drawable (a wall run with no real `defs/objects` id behind
  // it) -- a `defId` wall (the window, the bridge's own parapet cells) is
  // one def, one sprite, chosen once in `defs/objects/city-props.toml`,
  // never swapped per placement on the client (Tim's direction, story
  // 2.13).
  const propDrawables: readonly PropDrawable[] = buildPropDrawables({
    rankOf: (layer) => rankOf(layerCodeByName(layer)),
    ownership,
    windowDefIds,
    objectDefs,
  }).map((d) =>
    isDefPropDrawable(d) ? d : { ...d, assetKey: wallAssetOf(d.assetKey, d.wallOrientation) },
  );

  const entries: PoolEntry[] = await Promise.all(
    propDrawables.map(async (drawable) => {
      const texture = await resolvePropTexture(
        drawable,
        defs,
        objectDefIndex,
        atlasPageLoader,
        textures,
        tileSizePx,
      );
      const sprite = createSprite(texture);
      positionSprite(
        sprite,
        fromSortUnits(drawable.x),
        fromSortUnits(drawable.y),
        drawable.floor,
        tileSizePx,
        storeyHeightPx,
        assetNudgePx(drawable),
      );
      return { drawable, view: sprite, label: debugLabel(drawable) };
    }),
  );

  // FR173's affordance mark (`render/highlight.ts`/`render/pixi-highlight.ts`):
  // one `HighlightApplier` per scene, built once from the same
  // `entries` this scene already has, threaded through picking's own
  // drawn-rect index below with no second lookup, and given `app.ticker`
  // itself so it can own its own per-frame `refresh` subscription
  // (Quentin's direction: that guarantee belongs in the permanent module,
  // not in this file). `reorderFloor` (the one wrapper that calls
  // `applyDepthOrder`) is the only place this file calls `refresh()`
  // directly -- see that function, just below.
  const spritesByObjectId = new Map<bigint, Sprite[]>();
  for (const entry of entries) {
    const id = entry.drawable.stableId;
    const list = spritesByObjectId.get(id);
    if (list) list.push(entry.view);
    else spritesByObjectId.set(id, [entry.view]);
  }
  const highlightApplier = new HighlightApplier(
    spritesByObjectId,
    highlightAlpha,
    highlightStrength,
    app.ticker,
  );

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
  const appearanceCache = new AppearanceTextureCache(defs, atlasBaseUrl);
  const playerTuple = buildPlayerAppearanceTuple(defs);
  const playerFrames = await appearanceCache.acquire(playerTuple);
  const playerSprite = new Sprite(playerFrames.frame("idle", "down", 0));
  playerSprite.anchor.set(0.5, 1);
  positionSprite(playerSprite, walk.x, walk.y, walk.floor, tileSizePx, storeyHeightPx, 0);
  const playerEntry: PoolEntry = {
    drawable: playerDrawable,
    view: playerSprite,
    label: "player",
  };
  // A flat-layer entry (the manholes, the doormat) goes into its floor's
  // `groundObjects` pass in insertion order and never into the pool, so
  // nothing ever y-sorts it against an actor. Which pass an entry joins is
  // read from its layer alone (`layer-table.ts`'s `passOfLayer`).
  const groundObjectsContainersByFloor = new Map<number, Container>();
  const poolEntries: PoolEntry[] = [];
  for (const entry of entries) {
    const pass = passOfLayer(entry.drawable.layerCode);
    if (pass === "pool") {
      poolEntries.push(entry);
      continue;
    }
    if (pass === "ground") {
      throw new Error(`scene: prop ${entry.label} is on the ground layer, which only tiles use`);
    }
    const container = stacks.stackFor(entry.drawable.floor).groundObjects;
    container.addChild(entry.view);
    groundObjectsContainersByFloor.set(entry.drawable.floor, container);
  }
  const members: PoolEntry[] = [...poolEntries, playerEntry];

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
    // The one call site (Tim's direction): `applyDepthOrder`'s own
    // `removeChildren()` orphans every overlay along with anything else it
    // does not own, so every re-sort re-attaches whatever is currently
    // marked (`refresh()` reuses the same overlay instances rather than
    // rebuilding them). A no-op while nothing is marked.
    highlightApplier.refresh();
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
    [...entries, playerEntry].map((m) => ({
      label: `${m.label}#${m.drawable.stableId}`,
      overhangPx: m.view.height - tileSizePx,
    })),
    storeyHeightPx,
  );

  // FR121: no masking or aperture system anywhere in the real, mounted
  // display list -- checked directly against every sprite and every
  // ground-pass container this scene actually built, not only by the
  // source-level grep `scripts/ci/check-no-masks.sh` runs. Pixi v8's own
  // default is `undefined`, never `null` (confirmed against a real
  // `Sprite`/`Container`) -- `== null` covers both, `=== null` alone
  // would fail every unmasked sprite in this scene.
  const everyMaskableView = [
    ...entries.map((m) => m.view),
    playerEntry.view,
    ...groundContainersByFloor.values(),
    ...groundObjectsContainersByFloor.values(),
  ];
  onMasksChecked?.(everyMaskableView.every((view) => view.mask == null));

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
  const groundObjectsMembers: VisibilityMember[] = [
    ...groundObjectsContainersByFloor.entries(),
  ].map(([floor, container]) => ({
    drawable: {
      floor,
      layerCode: GROUND_OBJECTS_LAYER_CODE,
      ownerBuildingId: NO_OWNER,
      isWindow: false,
      isNearSide: false,
      isStub: false,
    },
    view: container,
  }));
  const allVisibilityMembers: VisibilityMember[] = [
    ...members,
    ...groundMembers,
    ...groundObjectsMembers,
  ];

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
      for (const entry of [...poolEntries, playerEntry]) {
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
      for (const [floor, container] of groundObjectsContainersByFloor) {
        const id = `ground_objects:${floor}`;
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
      // A flat-pass sprite is culled with its floor's group container.
      const shown = entry.view.visible && (entry.view.parent?.visible ?? true);
      anyVisible.set(id, (anyVisible.get(id) ?? false) || shown);
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

  // FR173's affordance mark: `highlightApplier` (built above, straight
  // after `entries`) owns every overlay sprite this scene ever draws for
  // it, and its own per-frame `refresh` subscription. `setHighlight` below
  // is the whole of this file's own opinion on the mark -- gating
  // `onHighlightChange` on the applier's own report of real change, never
  // a second, separately-tracked id (Tim's direction).
  function setHighlight(objectId: bigint | undefined): void {
    if (highlightApplier.set(objectId)) onHighlightChange?.(objectId);
  }

  function setHighlightStrength(strength: number): void {
    highlightApplier.setStrength(strength);
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
    // `clientToWorldPx` (above): the one projection every click, hover
    // and camera-centring computation in this client shares -- never a
    // second, hand-derived copy of the camera's own arithmetic.
    toWorldPx: (clientX, clientY) =>
      clientToWorldPx(
        clientX,
        clientY,
        app.canvas.getBoundingClientRect(),
        app.screen.width,
        app.screen.height,
        world,
      ),
    context: pickContext,
    player: () => ({ x: walk.x, y: walk.y, floor: walk.floor }),
    tileSizePx,
    storeyHeightPx,
    onIntent: (intent) => onIntent?.(intent),
    onIgnored: (objectId) => onIgnored?.(objectId),
    onHighlightChange: setHighlight,
  });

  // NFR2's measurement point: the scene's own CPU work for the *whole*
  // frame, not one system's callback (Quentin/Tim's direction, cycle 1).
  // Pixi's own `Application` renders through a `TickerPlugin` listener
  // registered at `UPDATE_PRIORITY.LOW` (confirmed against pixi.js's own
  // source, `app/TickerPlugin.js`); every other listener this scene adds
  // below defaults to `NORMAL`, which runs before it. So a listener at
  // `INTERACTION` (higher than everything) marks the start, and one at
  // `UTILITY` (lower than `LOW`, so it runs after the render call
  // returns) marks the end -- between them sits movement, re-sorting,
  // visibility, the crowd's own update and the render itself: the whole
  // per-frame cost this app pays, in one pair of `performance.now()`
  // calls that allocate nothing and cost nothing measurable on their own.
  let frameWorkStartMs = 0;
  app.ticker.add(
    () => {
      frameWorkStartMs = performance.now();
    },
    undefined,
    UPDATE_PRIORITY.INTERACTION,
  );

  app.ticker.add((ticker) => {
    tick(ticker.deltaMS);
  });

  function tick(deltaMS: number): void {
    const direction = keyboard.direction();
    if (direction.x === 0 && direction.y === 0) {
      // Still applied on an idle frame (Quentin's direction): a window
      // resize does not move the player, but the camera's own offset has
      // to react to it the instant `app.renderer.width`/`height` do,
      // never only on the next keypress.
      applyCamera();
      return;
    }

    const before = { x: toSortUnits(walk.x), y: toSortUnits(walk.y) };
    const floorBefore = walk.floor;
    walk = stepAndTransition(walk, direction, deltaMS, worldIndex, movementConfig, transitions);

    onPlayerMove?.(walk.x, walk.y, walk.floor);

    updatePlayerDrawable(playerDrawable, walk.x, walk.y, walk.floor);
    positionSprite(playerSprite, walk.x, walk.y, walk.floor, tileSizePx, storeyHeightPx, 0);

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
      onOrderChange?.(renderOrder);
    } else {
      const after = { x: toSortUnits(walk.x), y: toSortUnits(walk.y) };
      if (after.x !== before.x || after.y !== before.y) {
        // Only the player's own floor can have changed order: every
        // other member of every other pool is static.
        reorderFloor(walk.floor);
        rebuildRenderOrder();
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

    // The camera, last: a pure function of the *new* position this same
    // frame just computed, applied in the same tick as the move so there
    // is never a frame where the player is drawn off-centre (Quentin's
    // "applied in the same ticker frame as the move" direction).
    applyCamera();
  }

  // Story 1.10: the street crowd, a second, additive layer under `world`
  // -- never part of `members`/`poolContainer` (see `citizens.ts`'s own
  // module doc for why: it must never move this scene's own committed
  // depth-order goldens). Mounted last, after every signal an existing
  // e2e spec's own `ready()` gate depends on
  // (`onOrderChange`/`onPlayerMove`/`onVisibilityChange`/
  // `onMasksChecked`, and the keyboard itself) has already fired -- those
  // all run synchronously, in this same function body, before this
  // `await`; only `mountStreetScene`'s own promise waits on the crowd's
  // own network-bound texture loads. The camera/viewport story (Quentin's
  // direction): there is no second camera fit here any more -- the canvas
  // was never sized to this scene's own content, crowd included, so the
  // crowd needs none of its own. `onViewTransform`/`window.__bc.
  // viewTransform` already fired, live, from `applyCamera()`'s own first
  // call above; `appearance-test-support.ts`/`intents.spec.ts` wait on
  // the boot mark below instead of on its mere existence for exactly this
  // reason -- it is no longer a one-shot readiness signal.
  const citizensLayer = await mountCitizensLayer(
    world,
    defs,
    tileSizePx,
    appearanceCache,
    textureFor("sidewalk", textures),
    atlasBaseUrl,
    crowdIdenticalTuples ?? false,
  );
  // Story 1.14 (NFR1): the atlas term's own end -- every texture this
  // scene loads before its first frame (the static tiles above, the
  // player's own composite and the street crowd's own part sheets just
  // above) has resolved by this line, not only the small static set. There
  // is no real atlas yet, so this pairs with Resource Timing's own
  // per-image request count and byte total for everything awaited above.
  markBoot(BOOT_MARK.ATLAS_READY);

  // Story 1.10: the one walking citizen's own animation, always
  // ticking -- unlike the player's own ticker above, this must never
  // early-return while the player stands still, so it is a second,
  // independent `app.ticker.add` registration rather than folded into
  // the one above. Still runs before the render (`NORMAL`, the default,
  // is above the render's own `LOW`), so it stays inside the frame-work
  // window the two listeners above bound. `crowdFrozen` (story 1.13,
  // `startWithCrowdFrozen`) is the one exception: a screenshot test needs
  // every citizen pinned at its initial pose, never this scene's own
  // concern otherwise.
  app.ticker.add((ticker) => {
    if (!crowdFrozen) citizensLayer.update(ticker.deltaMS);
  });

  // Story 2.7 (Tim's direction): a composite page re-uploads at most
  // once per frame -- every look's own draw this tick only marks its
  // page dirty; this is the one place `source.update()` actually runs,
  // and only for a page a draw actually touched.
  appearanceCache.flush();
  app.ticker.add(() => {
    appearanceCache.flush();
  });

  // The frame-work window's own closing bracket: below the render's own
  // `LOW` priority, so this always runs after `app.render()` has
  // returned for the frame just drawn.
  app.ticker.add(
    () => {
      onFrameWork?.(performance.now() - frameWorkStartMs);
    },
    undefined,
    UPDATE_PRIORITY.UTILITY,
  );

  // Story 1.14 (NFR1): fires once, after the first frame has actually
  // rendered (`UPDATE_PRIORITY.UTILITY` runs after Pixi's own render --
  // see the frame-work window comment above). FR144's name prompt does
  // not exist yet, so `INTERACTIVE_PROMPT` and `PLAYER_CONTROLLABLE` are
  // both stand-ins fired at this same instant (Tim's direction): the
  // keyboard was already attached before the ticker started, so input is
  // genuinely accepted from here on -- `docs/spikes/1.14-boot-budget.md`'s
  // harness proves it by pressing a key right after this mark and
  // asserting the player's position actually changes.
  app.ticker.addOnce(
    () => {
      markBoot(BOOT_MARK.FIRST_FRAME_RENDERED);
      markBoot(BOOT_MARK.INTERACTIVE_PROMPT);
      markBoot(BOOT_MARK.PLAYER_CONTROLLABLE);
    },
    undefined,
    UPDATE_PRIORITY.UTILITY,
  );

  // Story 1.12: built once, here -- the pool's membership is fixed at
  // mount (a floor transition moves the player between floor buckets, it
  // does not change who is in the pool), and every `Drawable` in it is
  // mutated in place as the player moves, so this array is always
  // current without being rebuilt.
  const allDrawables: readonly Drawable[] = members.map((m) => m.drawable);

  return {
    app,
    playerAppearance: playerTuple,
    getRenderOrder: () => renderOrder,
    keyboard,
    citizensLayer,
    distinctBoundAtlasPages: countBoundAtlasPages(app.stage, atlasPageLoader, appearanceCache),
    allBoundTextureSources: countAllBoundTextureSources(app.stage),
    playerScreenBounds: () => {
      const b = playerSprite.getBounds();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    },
    setHighlightStrength,
    currentFloor: () => walk.floor,
    poolDrawables: () => allDrawables,
    orderIndexOf: (stableId) => {
      const index = renderOrder.indexOf(stableId);
      return index === -1 ? undefined : index;
    },
    collidersInCell: (floor, cellX, cellY) => worldIndex.entriesInCell(floor, cellX, cellY),
    worldObjects: (bounds) => worldIndex.objects(bounds),
    suspendPointer: () => pointer.suspend(),
    resumePointer: () => pointer.resume(),
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
