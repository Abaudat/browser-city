// The world scene's Pixi mount -- one of a small, named set of files
// allowed to import `pixi.js` (`bootstrap.ts`,
// `render/pixi-order.ts`/`render/pixi-visibility.ts`/`render/pixi-highlight.ts`,
// and story 1.10/2.7's `render/appearance/composite-pages.ts`/`appearance-texture.ts` and
// `render/citizens-layer.ts`/`render/remote-players-layer.ts`, each its
// own real-canvas/Pixi adapter). Ordering itself is
// `render/pixi-order.ts`'s job, visibility is `render/pixi-visibility.
// ts`'s (story 1.7), FR173's affordance mark is `render/pixi-highlight.
// ts`'s (story 1.15); this file's whole job is texture loading, sprite
// construction, container wiring, keyboard input and the mount-time
// geometry guard. The world it draws is the generated district's rows,
// streamed (story 3.16) -- never a hand-laid scene. Real LimeZu sprites
// only, resolved through the atlas -- nearest-neighbour filtering, integer
// world-pixel positions rounded before the zoom scale, bottom-centre
// sprite anchors pinned to each drawable's own cell.
//
// D17: no debug text, no rank numbers, no sort-key readouts on the
// canvas. This module draws the scene and nothing else.

import {
  type Application,
  Container,
  Mesh,
  MeshGeometry,
  Sprite,
  Texture,
  UPDATE_PRIORITY,
} from "pixi.js";
import { BOOT_MARK, markBoot } from "../boot/boot-marks";
import type { VerifiedDefs } from "../boot/handshake";
import type { BodyControl } from "../input/body-control";
import type { IgnoredSink, Intent, IntentSink } from "../input/intent";
import { attachKeyboard, type KeyboardState } from "../input/keyboard";
import type { PickContext, PickRect } from "../input/pick";
import { attachPointer } from "../input/pointer";
import { type BodyDials, type BodyFrame, createBodyMotion, poseBody } from "../l3/body-pose";
import { framesByAnimation, loadL3Config, walkFramesPerCycle } from "../l3/config";
import type { PlacedObject } from "../net/bindings/types";
import { type BodyZone, bodyZoneOf, type Rect } from "../world/body-zone";
import { CHUNK_SIZE, chunkKey, unpackChunkKey } from "../world/chunk";
import type { ChunkData, ChunkStore } from "../world/chunk-store";
import type { ColliderRectSubcells, GridEntry } from "../world/collision-grid";
import { type CellRect, type HeldRow, shouldClose } from "../world/container-view";
import { buildFlights, FlightIndex, type PlacedFlightRow } from "../world/flights";
import {
  type FloorWalkResult,
  initialFloorWalkState,
  type PlayerStep,
  stepAndTransition,
} from "../world/floor-walk";
import { bodyRect, type MovementConfig } from "../world/movement";
import { npcWalkability } from "../world/npc-walkable";
import { buildObjectDefIndex, type ObjectSource, objectDefById } from "../world/object-defs";
import { NO_OWNER, OwnershipIndex } from "../world/ownership";
import { bandOf } from "../world/region";
import { isBodyClear, isCellStandable } from "../world/standable";
import type { TransitionSpec } from "../world/transitions";
import { TransitionIndex } from "../world/transitions";
import type { CellBounds, PlacedObjectView } from "../world/world-index";
import { WorldIndex } from "../world/world-index";
import { type ActorPlacement, placeActorAt } from "./actor-placement";
import { AppearanceTextureCache } from "./appearance/appearance-texture";
import type { AppearanceTuple } from "./appearance/composite";
import { buildPlayerAppearanceTuple } from "./appearance/player-look";
import { AtlasPageLoader, countAllBoundTextureSources, countBoundAtlasPages } from "./atlas-pages";
import { newBodySprite, setBodyFrame } from "./body-sprite";
import { type Camera, computeCamera, worldPxFromClient, ZOOM } from "./camera";
import { chunkResidency, DRAW_MARGIN_CELLS } from "./chunk-residency";
import {
  type BodyScreenBounds,
  type CitizensLayerHandle,
  CROWD_FLOOR,
  type CrowdSource,
  type L3BodyReport,
  mountCitizensLayer,
} from "./citizens-layer";
import { decomposeFootprint } from "./decompose";
import { assertStageIsWorld, FloorStacks } from "./floor-stacks";
import { type GroundCell, type GroundFrame, groundQuads } from "./ground-mesh";
import {
  openGroundDefId as findOpenGroundDefId,
  NO_GROUND,
  paintChunkGround,
} from "./ground-paint";
import { layerCodeByName, passOfLayer } from "./layer-table";
import { ContainerViewController } from "./pixi-container-view";
import { HighlightApplier } from "./pixi-highlight";
import { applyDepthOrder, type OrderedMember } from "./pixi-order";
import { VisibilityApplier, type VisibilityMember } from "./pixi-visibility";
import {
  BAND_ID_OFFSET,
  type BuildPropDrawablesOptions,
  buildCharacterDrawable,
  buildPropDrawables,
  buildRoofDrawable,
  isDefPropDrawable,
  type PlacedRowView,
  type PropDrawable,
  REMOTE_STABLE_ID_BASE,
  roofBottoms,
  STUB_ID_OFFSET,
  updateCharacterDrawable,
} from "./prop-drawables";
import {
  type ActorHost,
  mountRemotePlayersLayer,
  type RemotePlayersLayer,
  type RemotePlayersSource,
} from "./remote-players-layer";
import { floorOffsetPx, snapToScreenPx, visibleCellBounds, worldPointPx } from "./screen-position";
import type { Drawable } from "./sort-key";
import { fromSortUnits } from "./sort-units";
import { StreetLife } from "./street-life";
import type { VisibilityState, VisibilityViewer } from "./visibility";
import { isFloorCulled } from "./visibility";

/** Colour the app background switches to while the viewer is on any
 * below-ground floor (Artie's direction: what surrounds the subway
 * platform is plain black, never a texture, never the street's own
 * background bleeding through) -- keyed on the exact same floor-sign
 * rule `render/visibility.ts`'s `isFloorCulled` uses (Tim's direction),
 * never a second, separately-typed `floor < 0` check. */
const SUBWAY_BACKGROUND = 0x000000;

/** The layer codes the flat passes' synthetic `VisibilityDrawable`s carry:
 * the ground pass carries the `ground` layer's own code and the
 * ground-objects pass the `ground_objects` layer's, so each group reads as
 * what it is (a flat pass is never `isNearSide`, so only floor culling
 * applies to it). */
const GROUND_LAYER_CODE = layerCodeByName("ground");
const GROUND_OBJECTS_LAYER_CODE = layerCodeByName("ground_objects");

/** The street crowd's own synthetic `VisibilityDrawable` carries the
 * `characters` layer's code (story 15.8) -- it is a flat pass exactly
 * like the ground/ground-objects passes above, never `isNearSide`, so
 * only floor culling ever applies to it; the layer code is purely
 * descriptive of what it draws. */
const CROWD_LAYER_CODE = layerCodeByName("characters");

/** `render/floor-stacks.ts`'s `groundDecals` pass has no dedicated layer
 * code in `defs/`'s own table yet (only `ground`/`ground_objects` do) --
 * its own synthetic `VisibilityDrawable` carries the `ground` layer's
 * code instead, which `computeVisibility` never reads beyond "not
 * `walls`" for a flat, ownerless member like this one (story 15.8,
 * Quentin's finding: this pass sits under every stack root and must be
 * culled exactly like `ground:<floor>` is, even while nothing is ever
 * drawn on it yet -- registered, never deleted, so a future decal lands
 * inside FR122's culling for free). */
const GROUND_DECALS_LAYER_CODE = GROUND_LAYER_CODE;

export interface MountWorldSceneOptions {
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
  /** The def ids carrying the `threshold` role, resolved once by the caller. */
  readonly thresholdDefIds: ReadonlySet<number>;
  /** The flat wall swatch a wall stub and a doorway band draw with
   * (`render.wall_stub_object_id`). */
  readonly wallStubDefId: number;
  /** The streamed world: every row the scene draws and collides with. */
  readonly world: ChunkStore;
  /** A crowd to mount (a DEV harness), built once the world is held and
   * told which cells a body may stand on: absent means the street is drawn
   * with nobody on it. */
  readonly crowd?: (world: {
    readonly standable: (x: number, y: number) => boolean;
    readonly start: { readonly x: number; readonly y: number };
  }) => CrowdSource;
  /** Called once after every real re-sort (including the first one) with
   * the resulting `stableId` order -- the render path's own event, never
   * polled every frame (Quentin's direction). */
  readonly onOrderChange?: (order: readonly bigint[]) => void;
  /** Called once at mount and then every ticker frame with the player's
   * current continuous position (story 1.8's e2e proof that movement is
   * client-side and immediate, FR137) -- unlike `onOrderChange`, this is
   * polled every frame on purpose. */
  readonly onPlayerMove?: (x: number, y: number, floor: number) => void;
  /** Every walked step of the player: the state it started from, the held
   * direction and frame time it was resolved with, and where it ended (a
   * DEV build's e2e step log, story 15.21). */
  readonly onPlayerStep?: (step: PlayerStep) => void;
  /** Story 4.4 (FR138): where the other players come from. Absent means
   * none are drawn (a DEV build's isolation switch; always present in a
   * production build). */
  readonly remotePlayers?: RemotePlayersSource;
  /** The local character's id: seeds the player's gait and idle phase the
   * way every client seeds this body's, so others see what the player sees.
   * Absent until the character exists. */
  readonly playerCharacterId?: () => string | undefined;
  /** Called every ticker frame with what the player's body is drawing (a DEV
   * build's e2e hook). */
  readonly onPlayerBody?: (frame: Readonly<BodyFrame>) => void;
  /** Called every ticker frame with where each citizen body is on the
   * renderer (a DEV build's e2e hook). */
  readonly onCitizenBodies?: (
    bodies: readonly BodyScreenBounds[],
    screen: { readonly width: number; readonly height: number },
    citizenCount: number,
  ) => void;
  /** Story 1.13 (NFR2): how long this scene's own ticker callback took,
   * in ms, every frame it runs -- the frame *work* the perf harness
   * gates on, never a rAF interval. One call per frame into a sink that
   * does nothing unless a perf run has asked for samples. */
  readonly onFrameWork?: (ms: number) => void;
  /** Where the player starts: the server's `my_start` -- its stored
   * position, else the district's arrival cell. Never a client constant. */
  readonly playerStart: {
    readonly x: number;
    readonly y: number;
    readonly floor: number;
  };
  /** The scene's first frame has rendered (story 4.6). */
  readonly onFirstFrame?: (at: number) => void;
  /** Story 5.4 (NFR11): how long L3 took this frame, in ms -- the pose,
   * avoidance and flavour solve plus the crowd's body zone and sprite writes,
   * never Pixi's render. Called every frame the crowd ticks; the sink does
   * nothing unless a perf run has asked for samples. `l3/` itself reads no
   * clock: the bracket is here. */
  readonly onL3Work?: (ms: number) => void;
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
    worldTransform: () => {
      scaleX: number;
      scaleY: number;
      x: number;
      y: number;
    },
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
  /** Story 4.8: whether the body answers the player. While closed no
   * movement is applied and no intent reaches the sinks; looking (hover) is
   * unaffected. Absent means always open. */
  readonly bodyControl?: Pick<BodyControl, "isOpen">;
  /** Story 6.10 (FR94): subscribes to one container's contents while its
   * view is open (`net/container-subscription.ts`); `onRows` is called with
   * the held set on every change, and `release` ends the subscription.
   * Absent means a container opens with nothing in it. */
  readonly containerRows?: (
    containerId: bigint,
    onRows: (rows: readonly HeldRow[]) => void,
    onError: () => void,
  ) => { release(): void };
  /** Whether a server-backed container's object still exists (its
   * streamed `placed_object` row is in the cache). Absent means it does. */
  readonly containerPresent?: (objectId: bigint) => boolean;
  /** Pins every body at its initial pose, forever, rather than animating.
   * Exists solely so a `toHaveScreenshot` check has a deterministic frame
   * to compare: a body's animation state otherwise depends on real
   * wall-clock timing between mount and screenshot. */
  readonly freezeBodies?: boolean;
  /** City time since the epoch in milliminutes, or `undefined` while the
   * clock cannot tell it. Every L3 body is posed from this and nothing
   * else; with no reading, no body is drawn. */
  readonly cityMilliminutes?: () => number | undefined;
}

export interface WorldSceneHandle {
  readonly app: Application;
  /** The player's own appearance tuple, as composited at mount (FR61) --
   * `main.ts` wires its DEV-only `window.__bc` hook against this, the
   * same way it does for the crowd's own texture identities. */
  readonly playerAppearance: AppearanceTuple;
  /** The look cache the scene's bodies share (a DEV hook compares its
   * composites against a stack of layers). */
  readonly appearanceCache: AppearanceTextureCache;
  getRenderOrder(): readonly bigint[];
  /** How many chunks are drawn right now, and how many pool and flat
   * sprites they hold: what the leak check compares. */
  drawnChunkCount(): number;
  /** The cells the page's own carrier sprites were placed on. */
  localPropCells(): readonly { objectId: bigint; x: number; y: number }[];
  /** Draws the page's own carrier (the link offer's post) on the standable
   * cell nearest the player, at least `minDistance` away: a scene-local
   * sprite the pointer can pick, never a row of the streamed world and
   * never in the collision grid. `undefined` when no cell qualifies. */
  placeCarrier(spec: CarrierSpec): { readonly x: number; readonly y: number } | undefined;
  liveSpriteCount(): number;
  /** The building and room the player's own cell is in. */
  ownershipAtPlayer(): { readonly buildingId: bigint; readonly roomId: bigint };
  /** The keyboard this scene is actually driven by -- the caller's own
   * instance when it supplied one. */
  readonly keyboard: KeyboardState;
  /** Story 1.10: the mounted street crowd, for `main.ts` to wire its own
   * DEV-only `window.__bc` hooks against -- never read by this file. */
  readonly citizensLayer: CitizensLayerHandle;
  /** Story 4.4: the other players, when the caller supplied a source. */
  readonly remotePlayers?: RemotePlayersLayer;
  /** Story 2.6 (NFR12): how many distinct atlas page `TextureSource`s are
   * actually reachable from the mounted display list right now
   * (`countBoundAtlasPages` over `app.stage`, not the loader's own
   * request count -- Quentin's direction), for `main.ts` to wire its own
   * DEV-only `window.__bc` hook against, the same way it does for the
   * crowd's own texture identity count. */
  readonly distinctBoundAtlasPages: number;
  /** Story 2.14: every mounted threshold sprite and its wall-top band --
   * resolved texture size and lift above the sort anchor, for the e2e
   * proof that the doorways really draw. */
  doorways(): readonly {
    readonly stableId: string;
    readonly textureWidth: number;
    readonly textureHeight: number;
    readonly liftPx: number;
  }[];
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
  /** The player's sprite point in world pixels, for the e2e hook. */
  playerDrawnPoint(): { x: number; y: number };
  /** DEV harness only (`window.__bc.teleport`): stands the player at a
   * point, as the server's start would have, and draws what is there. */
  teleport(x: number, y: number, floor: number): void;
  /** What each live L3 body says about itself, for the debug tooling. */
  l3Bodies(): readonly L3BodyReport[];
  /** Story 6.10: opens the view of the container `intent` names, replacing
   * any open one; does nothing for an object that declares no grid. */
  openContainer(intent: Intent): void;
  /** Closes the open container view, if any. */
  closeContainer(): void;
  /** The open container view as data (an e2e hook reads this, never
   * pixels): the object it is bound to and the cell rects it draws. */
  containerView(): { readonly objectId: bigint; readonly rects: readonly CellRect[] } | undefined;
  /** How many children `app.stage` has: exactly the world root, so no
   * screen-space layer exists for a view to be drawn in. */
  stageChildCount(): number;
  /** Story 5.4 (NFR11): runs the L3 frame -- solve and the layer's update,
   * the same window `onL3Work` brackets -- for `frames` successive 60 Hz
   * instants from the current city time, timing each. No render, so a
   * GPU-less runner that draws few frames still yields thousands of samples. */
  l3Sweep(frames: number): number[];
  /** Story 5.4 (an e2e switch): draws nothing while off, leaving every ticker
   * listener, and so L3, running -- the runner's software rasteriser is not
   * what NFR11 measures. */
  setRender(on: boolean): void;
  /** The viewport in floor-0 cells (an e2e read), or none before a camera. */
  viewportCells(): { x0: number; y0: number; x1: number; y1: number } | undefined;
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
  // out of. Deliberately five plain reads rather than a `DebugWorldView`
  // built here: `render/world-scene.ts` never imports `debug/` (nothing but
  // `main.ts` does), and Epic 3's real pool will expose the same five
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
  /** The player's own collision body right now, in absolute sub-cells,
   * from the same `world/movement.ts` `bodyRect` the resolver itself
   * builds its start box from (story 15.4) -- never a second computation
   * from `MovementConfig` alone. */
  playerBody(): ColliderRectSubcells;
}

function createSprite(texture: Texture): Sprite {
  const sprite = new Sprite(texture);
  // Bottom-centre origin pinned to the cell's bottom edge (Artie's
  // direction): a tall sprite overhangs upward out of its footprint,
  // never downward.
  sprite.anchor.set(0.5, 1);
  return sprite;
}

/** How far above its sort anchor a drawable is drawn, in the world
 * container's own (native) pixels. */
function liftPx(drawable: PropDrawable): number {
  return isDefPropDrawable(drawable) ? (drawable.liftSourcePx ?? 0) : 0;
}

/** A debug-only label for a drawable (`PoolEntry.label`,
 * `assertNoOverhangBeyondStorey`'s own failure message) -- never read to
 * pick a texture or a nudge; `resolvePropTexture`/`assetNudgePx` do that
 * from the drawable itself. */
function debugLabel(drawable: PropDrawable): string {
  return isDefPropDrawable(drawable) ? `def:${drawable.defId}` : drawable.assetKey;
}

/** Positions `sprite` at `worldX`/`worldY`'s own screen pixel -- already
 * the drawn bottom-centre point the caller means to draw at (story 15.4:
 * a prop's own cell goes through `cellBottomCentre` before it ever
 * reaches here, and the player's continuous feet position already is
 * that point), through the one plain projection every actor and the
 * camera anchor share. */
function positionSprite(
  sprite: Sprite,
  worldX: number,
  worldY: number,
  floor: number,
  tileSizePx: number,
  storeyHeightPx: number,
  nudgePx: number,
  flightOffsetPx: number,
): void {
  const pos = worldPointPx(worldX, worldY, floor, tileSizePx, storeyHeightPx, ZOOM, flightOffsetPx);
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

/** One visibility member `window.__bc.visibility` reports, named the way
 * it is keyed there -- a pool member's own decimal `stableId`, a flat
 * pass's `<layer>:<floor>`, or the crowd's `crowd:<floor>` (story 15.8).
 * `scene.ts` builds exactly one list of these; `allVisibilityMembers` (what
 * `VisibilityApplier` walks) and the `onVisibilityChange` report are both
 * derived from it, never from two separately maintained lists. */
interface NamedVisibilityMember {
  readonly id: string;
  readonly member: VisibilityMember;
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
 * Mounts the streamed world into `app`: the scene is built from the rows in
 * `options.world` (the region subscription's `placed_object`,
 * `building_area`, `room_area` and `floor_transition` rows) and from
 * nothing else. Wires keyboard movement and floor transitions for the
 * player, keeps each floor's pool ordered by `render/pixi-order.ts`'s
 * `applyDepthOrder`, and keeps every member's FR120/FR121/FR122 state
 * current through `render/pixi-visibility.ts`'s `VisibilityApplier`.
 *
 * Held rows feed the collision and ownership indexes at once; their art is
 * drawn chunk by chunk as the viewport comes within `DRAW_MARGIN_CELLS` of
 * a chunk (`chunk-residency.ts`), and released a chunk past it. Re-sorts
 * only when an actor's own sort key changes, and re-applies visibility
 * only when the player's own enclosure or floor changes, or ownership
 * itself moved.
 */
export async function mountWorldScene(
  app: Application,
  options: MountWorldSceneOptions,
): Promise<WorldSceneHandle> {
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
    thresholdDefIds,
    wallStubDefId,
    world: store,
    onOrderChange,
    onPlayerMove,
    onPlayerStep,
    remotePlayers: remotePlayersWiring,
    playerCharacterId,
    onPlayerBody,
    onCitizenBodies,
    onFrameWork,
    onFirstFrame,
    playerStart,
    onVisibilityChange,
    onMasksChecked,
    onIntent,
    onIgnored,
    onViewTransform,
    onWorldReady,
    onHighlightChange,
    freezeBodies,
    onL3Work,
    crowd,
    cityMilliminutes,
    highlightStrength,
  } = options;
  const bodiesFrozen = freezeBodies ?? false;

  // Story 2.6/2.13: every prop draws through `AtlasPageLoader`; this loader
  // is the one place a packed atlas page is ever fetched.
  const atlasPageLoader = new AtlasPageLoader(atlasBaseUrl);
  const objectDefIndex = buildObjectDefIndex(defs);

  const world = new Container();
  // The camera/viewport story: zoom is set here, before this container has
  // a single child, and never touched again -- only the camera's own
  // `position` changes after this point, once per frame.
  world.scale.set(ZOOM);

  // The player's own starting state is computed synchronously from the
  // start the server gave, so the camera is final before the first real
  // content becomes a child of `world`.
  let walk: FloorWalkResult = {
    ...initialFloorWalkState(playerStart.x, playerStart.y, playerStart.floor),
    transitioned: false,
  };

  let lastCamera: Camera | undefined;
  // FR182: the player's flight offset, computed once per move in `tick` and
  // read by both the sprite and the camera anchor.
  let flights = new FlightIndex([], movementConfig);
  let playerFlightOffsetPx = 0;
  /** The camera's viewport in floor-0 cells, or none before a camera. */
  function viewportRect(): Rect | undefined {
    if (!lastCamera) return undefined;
    const b = visibleCellBounds(
      app.screen.width,
      app.screen.height,
      lastCamera,
      CROWD_FLOOR,
      tileSizePx,
      storeyHeightPx,
    );
    if (b.cellX1 <= b.cellX0 || b.cellY1 <= b.cellY0) return undefined;
    return { x0: b.cellX0, y0: b.cellY0, x1: b.cellX1, y1: b.cellY1 };
  }
  /** The body zone around the viewport: judged per floor and over the
   * player's co-visible band. */
  function bodyZone(): BodyZone | undefined {
    const view = viewportRect();
    if (!view) return undefined;
    return bodyZoneOf(view, storeyHeightPx / tileSizePx, bandOf(walk.floor));
  }
  function applyCamera(): void {
    const anchor = worldPointPx(
      walk.x,
      walk.y,
      walk.floor,
      tileSizePx,
      storeyHeightPx,
      ZOOM,
      playerFlightOffsetPx,
    );
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
  assertStageIsWorld(app.stage, world);
  onWorldReady?.(() => ({
    scaleX: world.scale.x,
    scaleY: world.scale.y,
    x: world.position.x,
    y: world.position.y,
  }));

  // Story 1.13: one four-pass stack per floor -- three flat passes then the
  // y-sorted pool -- with the stacks themselves drawn in ascending floor
  // order.
  const stacks = new FloorStacks(world);

  // Every def's per-cell art, resolved once and kept: a chunk is drawn
  // synchronously from here. The overhang each def's art reaches outside
  // its footprint is measured from the same textures, so a click on the
  // drawn part of a tall prop still finds it.
  const cellTextures = new Map<string, Texture>();
  const overhangByDefId = new Map<number, { up: number; side: number }>();
  await Promise.all(
    [...objectDefs].flatMap(([defId, source]) => {
      if (source.undrawn) return [];
      const def = objectDefById(objectDefIndex, defId);
      return decomposeFootprint({
        x: 0,
        y: 0,
        width: source.width,
        height: source.height,
      }).map(async (cell) => {
        const texture = await atlasPageLoader.objectCellTexture(
          defs,
          def,
          cell.sourceCol,
          tileSizePx,
          cell.sourceRow,
        );
        cellTextures.set(`${defId}:${cell.sourceCol}:${cell.sourceRow}`, texture);
        const up = Math.max(0, Math.ceil((texture.height - tileSizePx) / tileSizePx));
        const footprintWidthPx = source.width * tileSizePx;
        const side = Math.max(0, Math.ceil((texture.width - footprintWidthPx) / 2 / tileSizePx));
        const current = overhangByDefId.get(defId);
        overhangByDefId.set(defId, {
          up: Math.max(current?.up ?? 0, up),
          side: Math.max(current?.side ?? 0, side),
        });
      });
    }),
  );
  /** A whole atlas page as a texture, so a mesh's UVs are the page's own. */
  const pageTextures = new Map<Texture["source"], Texture>();
  function pageTexture(source: Texture["source"]): Texture {
    let t = pageTextures.get(source);
    if (!t) {
      t = new Texture({ source });
      pageTextures.set(source, t);
    }
    return t;
  }
  function groundFrameOf(defId: number): GroundFrame {
    const t = cellTexture(defId, 0, 0);
    return { page: t.source, u0: t.uvs.x0, v0: t.uvs.y0, u1: t.uvs.x2, v1: t.uvs.y2 };
  }

  function cellTexture(defId: number, col: number, row: number): Texture {
    const t = cellTextures.get(`${defId}:${col}:${row}`);
    if (!t) throw new Error(`world-scene: no art resolved for def ${defId} cell ${col},${row}`);
    return t;
  }

  const objectSources = new Map<number, ObjectSource>(
    [...objectDefs].map(([defId, source]) => {
      const overhang = overhangByDefId.get(defId);
      return [
        defId,
        overhang
          ? {
              ...source,
              drawOverhangCellsUp: overhang.up,
              drawOverhangCellsX: overhang.side,
            }
          : source,
      ];
    }),
  );

  // The derived indexes, fed row by row from the store: the one
  // `WorldIndex.insert` feeds both the collision grid and the footprint
  // index. A ground row is walkable art, never a collider or a pick target,
  // so it never enters them.
  const GROUND_CODE = layerCodeByName("ground");
  // The open-ground def (found by its tags) and the empty chunk an
  // unwritten one is drawn from.
  const openTag = defs.balance.find((b) => b.key === "city.ground.open_tag_id")?.value;
  const openGroundDefId =
    openTag === undefined ? undefined : findOpenGroundDefId(defs.objects, openTag);
  const EMPTY_CHUNK: ChunkData = {
    placed: new Map(),
    buildingAreas: new Map(),
    roomAreas: new Map(),
    transitions: new Map(),
    ground: new Map(),
    roofs: new Map(),
  };
  const WALLS_RANK = rankOf(layerCodeByName("walls"));
  const ownership = new OwnershipIndex();
  const worldIndex = new WorldIndex(movementConfig.subcellsPerCell, objectSources);
  const heldTransitions = new Map<bigint, TransitionSpec>();
  const heldFlightRows = new Map<bigint, PlacedFlightRow>();
  let transitionsDirty = false;
  store.attach({
    placedInserted(row) {
      if (row.layer === GROUND_CODE) return;
      worldIndex.insert(row);
      if (objectSources.get(row.defId)?.flight !== undefined) {
        heldFlightRows.set(row.objectId, {
          defId: row.defId,
          x: row.x,
          y: row.y,
          floor: row.floor,
        });
        transitionsDirty = true;
      }
    },
    placedDeleted(row) {
      if (row.layer === GROUND_CODE) return;
      worldIndex.delete(row);
      if (heldFlightRows.delete(row.objectId)) transitionsDirty = true;
    },
    buildingAreaInserted(r) {
      ownership.insertBuilding(r.areaId, {
        ownerId: r.buildingId,
        floor: r.floor,
        rect: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 },
      });
    },
    buildingAreaDeleted: (r) => ownership.deleteBuilding(r.areaId),
    roomAreaInserted(r) {
      ownership.insertRoom(r.areaId, {
        ownerId: r.roomId,
        floor: r.floor,
        rect: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 },
      });
    },
    roomAreaDeleted: (r) => ownership.deleteRoom(r.areaId),
    transitionInserted(r) {
      heldTransitions.set(r.transitionId, {
        x: r.x,
        y: r.y,
        floor: r.floor,
        targetX: r.targetX,
        targetY: r.targetY,
        targetFloor: r.targetFloor,
      });
      transitionsDirty = true;
    },
    transitionDeleted(r) {
      heldTransitions.delete(r.transitionId);
      transitionsDirty = true;
    },
  });

  // The flights and transitions, rebuilt whenever a streamed flight or
  // transition row changed: each far-end cell of a flight must be an anchor
  // on the real grid, or the build throws.
  let transitions = new TransitionIndex([], {
    isStandable: (x, y, floor) => isCellStandable(worldIndex, movementConfig, x, y, floor),
    entryBand: {
      subcellsPerCell: movementConfig.subcellsPerCell,
      isBodyClear: (floor, cx, feet) => isBodyClear(worldIndex, movementConfig, floor, cx, feet),
    },
    // The held rows are a region of the world: a pair's far half may lie in
    // a band not subscribed. Symmetry is the generator's and `WorldSpec`'s.
    skipPairSymmetry: true,
  });
  function rebuildTransitions(): void {
    transitionsDirty = false;
    const specs = [...heldTransitions.values()];
    flights = new FlightIndex(
      buildFlights(specs, [...heldFlightRows.values()], objectDefs, tileSizePx, (x, y, floor) =>
        isCellStandable(worldIndex, movementConfig, x, y, floor),
      ),
      movementConfig,
    );
    transitions = new TransitionIndex(specs, {
      isStandable: (x, y, floor) => isCellStandable(worldIndex, movementConfig, x, y, floor),
      entryBand: {
        subcellsPerCell: movementConfig.subcellsPerCell,
        isBodyClear: (floor, cx, feet) => isBodyClear(worldIndex, movementConfig, floor, cx, feet),
      },
      // The held rows are a region of the world: a pair's far half may lie in
      // a band not subscribed. Symmetry is the generator's and `WorldSpec`'s.
      skipPairSymmetry: true,
    });
  }
  if (transitionsDirty) rebuildTransitions();

  // The flat ground pass of each floor's own stack is toggled as a unit
  // through the same `VisibilityApplier` the pool goes through, so a
  // culled floor's flat passes are culled exactly as completely as its
  // pool sprites are.
  const groundContainersByFloor = new Map<number, Container>();
  const groundObjectsContainersByFloor = new Map<number, Container>();
  const groundDecalsContainersByFloor = new Map<number, Container>();
  /** Every flat pass and the crowd, named the way `window.__bc.visibility`
   * reports it. */
  const flatNamedMembers: NamedVisibilityMember[] = [];
  const flatIds = new Map<VisibilityMember, string>();
  /** Pool members and the flat passes: what `VisibilityApplier` walks. */
  const allVisibilityMembers: VisibilityMember[] = [];
  function flatMember(id: string, floor: number, layerCode: number, view: Container): void {
    const named: NamedVisibilityMember = {
      id,
      member: {
        drawable: {
          floor,
          layerCode,
          ownerBuildingId: NO_OWNER,
          isWindow: false,
          isNearSide: false,
          isStub: false,
        },
        view,
      },
    };
    flatNamedMembers.push(named);
    flatIds.set(named.member, id);
    allVisibilityMembers.push(named.member);
  }
  /** Creates floor `floor`'s three flat passes and registers each as a
   * visibility member, once. */
  function ensureFloorPasses(floor: number): void {
    if (groundContainersByFloor.has(floor)) return;
    const stack = stacks.stackFor(floor);
    groundContainersByFloor.set(floor, stack.ground);
    groundObjectsContainersByFloor.set(floor, stack.groundObjects);
    groundDecalsContainersByFloor.set(floor, stack.groundDecals);
    flatMember(`ground:${floor}`, floor, GROUND_LAYER_CODE, stack.ground);
    flatMember(`ground_objects:${floor}`, floor, GROUND_OBJECTS_LAYER_CODE, stack.groundObjects);
    flatMember(`ground_decals:${floor}`, floor, GROUND_DECALS_LAYER_CODE, stack.groundDecals);
  }
  ensureFloorPasses(walk.floor);
  ensureFloorPasses(CROWD_FLOOR);

  // Story 1.10: the player is one generated tuple through the real
  // pipeline; the cache is shared with every other body.
  const appearanceCache = new AppearanceTextureCache(defs, atlasBaseUrl);
  const playerTuple = buildPlayerAppearanceTuple(defs);
  const playerFrames = await appearanceCache.acquire(playerTuple);
  const playerDrawable = buildCharacterDrawable(
    rankOf(layerCodeByName("characters")),
    walk.x,
    walk.y,
    walk.floor,
  );
  // The player's body is posed by the same function as every other
  // character's (`l3/body-pose.ts`) and drawn through the same adapter.
  const playerMotion = createBodyMotion();
  const playerBodyFrame: BodyFrame = {
    animation: "idle",
    direction: "down",
    frameIndex: 0,
  };
  const playerSprite = newBodySprite(playerFrames, playerBodyFrame);
  const playerEntry: PoolEntry = {
    drawable: playerDrawable,
    view: playerSprite,
    label: "player",
  };

  // One pool per floor (`FloorStacks`), so the comparator only ever orders
  // drawables that share a floor.
  const membersByFloor = new Map<number, PoolEntry[]>();
  function poolMembersOf(floor: number): PoolEntry[] {
    let list = membersByFloor.get(floor);
    if (!list) {
      list = [];
      membersByFloor.set(floor, list);
      ensureFloorPasses(floor);
    }
    return list;
  }
  poolMembersOf(walk.floor).push(playerEntry);

  /** The order every floor's pool is in, concatenated ascending -- what
   * `window.__bc.renderOrder` reports. Rebuilt in place. */
  const renderOrder: bigint[] = [];
  const orderByFloor = new Map<number, bigint[]>();

  // FR173's affordance mark: one applier per scene, over the live
  // object-id -> sprites map.
  const spritesByObjectId = new Map<bigint, Sprite[]>();
  const highlightApplier = new HighlightApplier(
    spritesByObjectId,
    highlightAlpha,
    highlightStrength,
    app.ticker,
  );

  function reorderFloor(floor: number): void {
    const list = membersByFloor.get(floor);
    if (!list) return;
    let order = orderByFloor.get(floor);
    if (!order) {
      order = [];
      orderByFloor.set(floor, order);
    }
    applyDepthOrder(stacks.stackFor(floor).pool, list, order);
    // `applyDepthOrder`'s own `removeChildren()` orphans every overlay along
    // with anything else it does not own, so every re-sort re-attaches
    // whatever is currently marked.
    highlightApplier.refresh();
  }

  /** Pool members that sort and draw like any other but are not part of the
   * reported order: bodies that move with the clock. */
  const unreportedIds = new Set<bigint>();

  function rebuildRenderOrder(): void {
    renderOrder.length = 0;
    for (const floor of stacks.floors()) {
      for (const id of orderByFloor.get(floor) ?? []) {
        if (!unreportedIds.has(id)) renderOrder.push(id);
      }
    }
  }

  // Re-sorts are batched: placing an actor only marks its floor dirty, and
  // `flushOrder` re-sorts each dirty floor once.
  const dirtyFloors = new Set<number>();
  let reportedMoved = false;

  function flushOrder(): void {
    if (dirtyFloors.size === 0) return;
    for (const floor of dirtyFloors) reorderFloor(floor);
    dirtyFloors.clear();
    if (reportedMoved) {
      reportedMoved = false;
      rebuildRenderOrder();
      onOrderChange?.(renderOrder);
    }
  }

  /** Seats a new actor in `floor`'s pool, in the display list at once. */
  function enterPool(entry: PoolEntry, floor: number): void {
    poolMembersOf(floor).push(entry);
    stacks.stackFor(floor).pool.addChild(entry.view);
    dirtyFloors.add(floor);
  }

  /** The one placement every actor goes through (the local player, remote
   * players): refresh the drawable, put the sprite at the point
   * `placeActorAt` gives (flight offset included), move it between floor
   * pools at once on a floor change and mark its floor for the frame's one
   * re-sort when its key moved. */
  function placeActor(entry: PoolEntry, x: number, y: number, floor: number): ActorPlacement {
    const drawable = entry.drawable;
    const floorBefore = drawable.floor;
    const keyX = drawable.x;
    const keyY = drawable.y;
    updateCharacterDrawable(drawable, x, y, floor);
    const placed = placeActorAt(
      (px, py, pf) => flights.offsetPx(px, py, pf),
      { x, y, floor },
      floorBefore,
      { tileSizePx, storeyHeightPx, zoom: ZOOM },
    );
    entry.view.x = placed.point.x;
    entry.view.y = placed.point.y;
    let moved = drawable.x !== keyX || drawable.y !== keyY;
    if (placed.leavesFloor !== undefined) {
      const leaving = membersByFloor.get(placed.leavesFloor);
      const index = leaving ? leaving.indexOf(entry) : -1;
      if (leaving && index >= 0) leaving.splice(index, 1);
      dirtyFloors.add(placed.leavesFloor);
      enterPool(entry, placed.stackFloor);
      visibilityApplier.applyMember(entry, windowAlpha);
      moved = true;
    } else if (moved) {
      dirtyFloors.add(floor);
    }
    if (moved && !unreportedIds.has(drawable.stableId)) reportedMoved = true;
    return placed;
  }

  function reorderAll(): void {
    for (const floor of stacks.floors()) reorderFloor(floor);
    rebuildRenderOrder();
  }

  // The player seats itself in its floor's pool like any other actor.
  stacks.stackFor(walk.floor).pool.addChild(playerEntry.view);
  allVisibilityMembers.push(playerEntry);

  // Story 15.8: the crowd's own container -- created here, synchronously,
  // and attached under floor 0's own stack root, a floor-0 visibility
  // member from the instant it exists.
  const crowdContainer = new Container();
  stacks.stackFor(CROWD_FLOOR).root.addChild(crowdContainer);
  flatMember(`crowd:${CROWD_FLOOR}`, CROWD_FLOOR, CROWD_LAYER_CODE, crowdContainer);

  // By value: the renderer's own colour object is overwritten below.
  const originalBackground = app.renderer.background.color.toNumber();
  const visibilityApplier = new VisibilityApplier();

  // ---- the drawn chunks -------------------------------------------------

  /** What one drawn chunk holds, so it can be released whole. */
  interface DrawnChunk {
    readonly key: bigint;
    readonly floor: number;
    readonly groundLayer: Container;
    readonly entries: PoolEntry[];
    readonly flatEntries: PoolEntry[];
    /** The buildings this chunk draws a roof for. */
    readonly roofed: readonly bigint[];
    /** The rows' own revision: a changed chunk is rebuilt. */
    stale: boolean;
  }
  const drawnChunks = new Map<bigint, DrawnChunk>();
  /** The buildings whose roof is drawn: what stands inside one is hidden
   * from a viewer outside it (`isUnderRoof`). A building's roof rows are
   * all one chunk's. */
  const roofedBuildings = new Set<bigint>();
  /** Every pool entry of every drawn chunk, for the reads that walk them. */
  const liveEntries = new Set<PoolEntry>();
  /** The rect each object's sprites cover, in the world container's own
   * pixel space: what lets a click on any drawn part of a prop resolve to
   * it. */
  const drawnRects = new Map<bigint, PickRect>();

  const propOptions: BuildPropDrawablesOptions = {
    rankOf,
    ownership,
    windowDefIds,
    thresholdDefIds,
    wallStubDefId,
    objectDefs,
  };

  function ownerRow(entry: PoolEntry): bigint {
    // A companion drawable (stub, band) is owned by its parent's object.
    const id = entry.drawable.stableId;
    if (id >= BAND_ID_OFFSET) return id - BAND_ID_OFFSET;
    if (id >= STUB_ID_OFFSET) return id - STUB_ID_OFFSET;
    return id;
  }

  /** Draws `propRows` on `floor`: pool entries into the floor's pool and
   * the visibility members, flat ones into its ground-object pass, each
   * registered for picking. Returns what it drew, for release. */
  function drawPropRows(
    propRows: PlacedRowView[],
    floor: number,
  ): { entries: PoolEntry[]; flatEntries: PoolEntry[] } {
    const entries: PoolEntry[] = [];
    const flatEntries: PoolEntry[] = [];
    for (const drawable of buildPropDrawables(propRows, propOptions)) {
      if (!isDefPropDrawable(drawable)) continue;
      const sprite = createSprite(
        cellTexture(drawable.defId, drawable.sourceCol, drawable.sourceRow),
      );
      positionSprite(
        sprite,
        fromSortUnits(drawable.x),
        fromSortUnits(drawable.y),
        drawable.floor,
        tileSizePx,
        storeyHeightPx,
        0,
        0,
      );
      // The wall-top band sits above its doorway's own sprite.
      if (drawable.liftSourcePx) sprite.y -= liftPx(drawable);
      const entry: PoolEntry = {
        drawable,
        view: sprite,
        label: debugLabel(drawable),
      };
      const pass = passOfLayer(drawable.layerCode);
      if (pass === "pool") {
        entries.push(entry);
        poolMembersOf(floor).push(entry);
        stacks.stackFor(floor).pool.addChild(sprite);
        allVisibilityMembers.push(entry);
      } else {
        flatEntries.push(entry);
        stacks.stackFor(floor).groundObjects.addChild(sprite);
      }
      liveEntries.add(entry);
      const objectId = ownerRow(entry);
      const sprites = spritesByObjectId.get(objectId);
      if (sprites) sprites.push(sprite);
      else spritesByObjectId.set(objectId, [sprite]);
    }
    // Per-object drawn rects, from the real sprites just built.
    for (const entry of [...entries, ...flatEntries]) {
      const objectId = ownerRow(entry);
      const sprite = entry.view;
      const left = sprite.x - sprite.width * sprite.anchor.x;
      const top = sprite.y - sprite.height * sprite.anchor.y;
      const held = drawnRects.get(objectId);
      drawnRects.set(
        objectId,
        held
          ? {
              x0: Math.min(held.x0, left),
              y0: Math.min(held.y0, top),
              x1: Math.max(held.x1, left + sprite.width),
              y1: Math.max(held.y1, top + sprite.height),
            }
          : {
              x0: left,
              y0: top,
              x1: left + sprite.width,
              y1: top + sprite.height,
            },
      );
    }
    assertNoOverhangBeyondStorey(
      entries.map((m) => ({
        label: `${m.label}#${m.drawable.stableId}`,
        overhangPx: m.view.height - tileSizePx,
      })),
      storeyHeightPx,
    );
    return { entries, flatEntries };
  }

  function buildChunk(key: bigint): void {
    const { cx, cy, floor } = unpackChunkKey(key);
    const held = store.chunk(key);
    // A chunk with no rows is drawn only as open ground, on floor 0.
    if (!held && !(floor === 0 && openGroundDefId !== undefined)) return;
    const data = held ?? EMPTY_CHUNK;
    ensureFloorPasses(floor);
    const groundLayer = new Container();
    const offset = floorOffsetPx(floor, storeyHeightPx);
    // The chunk's ground is one static mesh per atlas page, not a sprite
    // per cell (`ground-mesh.ts`).
    const cells: GroundCell[] = [];
    // Ground rects, painted in row order over open ground; a floor with no
    // open ground draws only the rects it holds.
    const painted = paintChunkGround(
      data.ground.values(),
      cx,
      cy,
      floor === 0 && openGroundDefId !== undefined ? openGroundDefId : NO_GROUND,
    );
    for (let i = 0; i < painted.length; i++) {
      const defId = painted[i] as number;
      if (defId === NO_GROUND) continue;
      cells.push({ defId, lx: i % CHUNK_SIZE, ly: Math.floor(i / CHUNK_SIZE) });
    }
    const propRows: PlacedRowView[] = [];
    for (const row of data.placed.values()) {
      if (row.layer === GROUND_CODE) {
        cells.push({ defId: row.defId, lx: row.x - cx * CHUNK_SIZE, ly: row.y - cy * CHUNK_SIZE });
      } else {
        propRows.push(row);
      }
    }
    for (const [page, quads] of groundQuads(cells, groundFrameOf, tileSizePx)) {
      const mesh = new Mesh({
        geometry: new MeshGeometry(quads),
        texture: pageTexture(page as Texture["source"]),
      });
      mesh.x = snapToScreenPx(cx * CHUNK_SIZE * tileSizePx, ZOOM);
      mesh.y = snapToScreenPx(cy * CHUNK_SIZE * tileSizePx + offset, ZOOM);
      groundLayer.addChild(mesh);
    }
    stacks.stackFor(floor).ground.addChild(groundLayer);

    const { entries, flatEntries } = drawPropRows(propRows, floor);
    // Roofs: one stretched tile per roof rect, in the pool behind the
    // front wall's face and over what stands inside (`buildRoofDrawable`).
    // A building's roof rects are all one chunk's rows: each sorts at the
    // building's roof bottom.
    const bottoms = roofBottoms(data.roofs.values());
    for (const id of bottoms.keys()) roofedBuildings.add(id);
    for (const roof of data.roofs.values()) {
      const drawable = buildRoofDrawable(roof, WALLS_RANK, bottoms.get(roof.buildingId));
      const sprite = createSprite(cellTexture(roof.defId, 0, 0));
      sprite.width = (roof.x1 - roof.x0) * tileSizePx;
      sprite.height = (roof.y1 - roof.y0) * tileSizePx;
      positionSprite(
        sprite,
        (roof.x0 + roof.x1) / 2,
        roof.y1,
        floor,
        tileSizePx,
        storeyHeightPx,
        0,
        0,
      );
      const entry: PoolEntry = {
        drawable,
        view: sprite,
        label: `roof:${roof.defId}`,
      };
      entries.push(entry);
      poolMembersOf(floor).push(entry);
      stacks.stackFor(floor).pool.addChild(sprite);
      allVisibilityMembers.push(entry);
    }
    drawnChunks.set(key, {
      key,
      floor,
      groundLayer,
      entries,
      flatEntries,
      roofed: [...bottoms.keys()],
      stale: false,
    });
    dirtyFloors.add(floor);
    // The pool changed: the reported order is current once the floor is re-sorted.
    reportedMoved = true;
  }

  function releaseChunk(key: bigint): void {
    const drawn = drawnChunks.get(key);
    if (!drawn) return;
    drawnChunks.delete(key);
    for (const id of drawn.roofed) roofedBuildings.delete(id);
    drawn.groundLayer.destroy({ children: true });
    const pool = membersByFloor.get(drawn.floor);
    const gone = new Set<unknown>(drawn.entries);
    if (pool) {
      const kept = pool.filter((m) => !gone.has(m));
      pool.length = 0;
      pool.push(...kept);
    }
    for (let i = allVisibilityMembers.length - 1; i >= 0; i--) {
      if (gone.has(allVisibilityMembers[i])) allVisibilityMembers.splice(i, 1);
    }
    for (const entry of [...drawn.entries, ...drawn.flatEntries]) {
      liveEntries.delete(entry);
      const objectId = ownerRow(entry);
      spritesByObjectId.delete(objectId);
      drawnRects.delete(objectId);
      entry.view.destroy();
    }
    dirtyFloors.add(drawn.floor);
    reportedMoved = true;
  }

  const FLOOR_SHIFT_CELLS = storeyHeightPx / tileSizePx;
  let lastResidencyKey = "";
  let residencyDirty = true;
  store.onChunkChanged((key) => {
    const drawn = drawnChunks.get(key);
    if (drawn) drawn.stale = true;
    residencyDirty = true;
  });

  /** Draws and releases chunks for the viewport as it stands; at most
   * `maxBuilds` chunks are built (the rest wait for a later frame). */
  function updateResidency(maxBuilds: number): void {
    const view = viewportRect();
    if (!view) return;
    const key = `${view.x0},${view.y0},${view.x1},${view.y1},${walk.floor}`;
    if (key === lastResidencyKey && !residencyDirty) return;
    lastResidencyKey = key;
    residencyDirty = false;
    const band = bandOf(walk.floor);
    // Floor 0's open ground is drawn wherever the viewport reaches, rows
    // or none: its chunks are held implicitly.
    const held = new Set<bigint>(store.chunkKeys());
    if (openGroundDefId !== undefined) {
      const m = DRAW_MARGIN_CELLS;
      const cx0 = Math.floor((view.x0 - m) / CHUNK_SIZE);
      const cx1 = Math.floor((view.x1 + m) / CHUNK_SIZE);
      const cy0 = Math.floor((view.y0 - m) / CHUNK_SIZE);
      const cy1 = Math.floor((view.y1 + m) / CHUNK_SIZE);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) held.add(chunkKey(cx * CHUNK_SIZE, cy * CHUNK_SIZE, 0));
      }
    }
    const { draw, drop } = chunkResidency(
      held,
      drawnChunks.keys(),
      view,
      FLOOR_SHIFT_CELLS,
      (f) => bandOf(f) === band,
    );
    for (const k of drop) releaseChunk(k);
    let built = 0;
    for (const k of draw) {
      const have = drawnChunks.get(k);
      if (have && !have.stale) continue;
      if (built >= maxBuilds) {
        residencyDirty = true;
        break;
      }
      if (have) releaseChunk(k);
      buildChunk(k);
      built++;
    }
    if (built > 0) {
      applyVisibilityFor(lastCellX, lastCellY, walk.floor, true);
      refreshHiddenObjects();
    }
  }

  // Story 1.7: the visibility adapter, gated on the viewer's own
  // (floor, buildingId) tuple actually changing -- computed from the
  // player's own cell, never every frame -- and forced when ownership
  // itself moved.
  function applyVisibilityFor(cellX: number, cellY: number, floor: number, force: boolean): void {
    const viewer: VisibilityViewer = {
      floor,
      buildingId: ownership.ownershipAt(cellX, cellY, floor).buildingId,
      roofed: roofedBuildings,
    };

    let applied = true;
    if (force) {
      visibilityApplier.applyForce(allVisibilityMembers, viewer, windowAlpha);
    } else {
      applied = visibilityApplier.apply(allVisibilityMembers, viewer, windowAlpha);
    }
    lastOwnershipRevision = ownership.revision;

    // Keyed on the same floor-sign rule `isFloorCulled` uses: "below
    // ground" is exactly `isFloorCulled(0, floor)`.
    app.renderer.background.color = isFloorCulled(0, floor)
      ? SUBWAY_BACKGROUND
      : originalBackground;

    // Built straight from each member's own real, just-written
    // `view.visible`/`view.alpha` -- never a second, recomputed state.
    if (applied && onVisibilityChange) {
      const reportedState: Record<string, string> = {};
      const reportedAlpha: Record<string, number> = {};
      for (const member of allVisibilityMembers) {
        const id = flatIds.get(member) ?? (member as PoolEntry).drawable.stableId.toString();
        reportedState[id] = stateFromWrite({
          visible: member.view.visible,
          alpha: member.view.alpha,
        });
        reportedAlpha[id] = member.view.alpha;
      }
      onVisibilityChange(reportedState, reportedAlpha);
    }
  }
  let lastOwnershipRevision = -1;

  // Story 1.9: which objects are currently visible, rebuilt from each
  // pool member's own just-written `sprite.visible` whenever visibility is
  // re-applied (a rare event, never per frame). A click resolves through
  // this: if it cannot be seen it cannot be clicked.
  const hiddenObjectIds = new Set<bigint>();
  function refreshHiddenObjects(): void {
    const anyVisible = new Map<bigint, boolean>();
    for (const entry of liveEntries) {
      const id = ownerRow(entry);
      // A flat-pass sprite is culled with its floor's group container.
      const shown = entry.view.visible && (entry.view.parent?.visible ?? true);
      anyVisible.set(id, (anyVisible.get(id) ?? false) || shown);
    }
    hiddenObjectIds.clear();
    for (const [id, visible] of anyVisible) {
      if (!visible) hiddenObjectIds.add(id);
    }
  }

  // The page's own carrier sprites: drawn and pickable, held outside the
  // chunk store and the collision grid -- the grid is the streamed rows'
  // alone; the world index keeps a pick-only footprint for them.
  const localRows = new Map<bigint, PlacedObject>();
  const placedLocal: { objectId: bigint; x: number; y: number }[] = [];
  function placeCarrier(spec: CarrierSpec): { x: number; y: number } | undefined {
    const cell = nearestStandable(
      (x, y) => isCellStandable(worldIndex, movementConfig, x, y, walk.floor),
      walk.cellX,
      walk.cellY,
      spec.minDistance ?? 1,
    );
    if (!cell) return undefined;
    const row: PlacedObject = {
      objectId: spec.objectId,
      defId: spec.defId,
      x: cell.x,
      y: cell.y,
      floor: walk.floor,
      layer: spec.layer,
      orientation: 0,
      chunkKey: chunkKey(cell.x, cell.y, walk.floor),
    };
    placedLocal.push({ objectId: spec.objectId, x: cell.x, y: cell.y });
    localRows.set(row.objectId, row);
    worldIndex.insertPickOnly(row);
    ensureFloorPasses(row.floor);
    drawPropRows([row], row.floor);
    dirtyFloors.add(row.floor);
    reportedMoved = true;
    applyVisibilityFor(lastCellX, lastCellY, walk.floor, true);
    refreshHiddenObjects();
    return { x: cell.x, y: cell.y };
  }

  let lastCellX = walk.cellX;
  let lastCellY = walk.cellY;

  // The player's first placement is the same call every later frame makes
  // (it may load in standing on a flight).
  if (transitionsDirty) rebuildTransitions();
  playerFlightOffsetPx = placeActor(playerEntry, walk.x, walk.y, walk.floor).flightOffsetPx;
  // The first chunks are drawn before the first frame, all of them.
  updateResidency(Number.POSITIVE_INFINITY);
  reorderAll();
  onOrderChange?.(renderOrder);
  applyVisibilityFor(lastCellX, lastCellY, walk.floor, true);
  refreshHiddenObjects();

  // FR121: no masking or aperture system anywhere in the real, mounted
  // display list -- checked directly against every ground-pass container
  // and every sprite this scene actually built.
  onMasksChecked?.(
    [
      ...[...liveEntries].map((m) => m.view),
      playerEntry.view,
      ...groundContainersByFloor.values(),
      ...groundObjectsContainersByFloor.values(),
      ...groundDecalsContainersByFloor.values(),
      crowdContainer,
    ].every((view) => view.mask == null),
  );

  // Story 15.8's mount-time guard: `FloorStacks` is the one code that ever
  // attaches anything under `world`, so it owns the check of its own tree.
  stacks.assertManaged(
    new Set<unknown>([
      ...flatNamedMembers.map((n) => n.member.view),
      playerEntry.view,
      ...[...liveEntries].map((e) => e.view),
    ]) as ReadonlySet<Container>,
  );

  onPlayerMove?.(walk.x, walk.y, walk.floor);

  const { keyboard } = options;
  const detachKeyboard = attachKeyboard(keyboard);

  // FR173's affordance mark: `highlightApplier` owns every overlay sprite
  // this scene ever draws for it, and its own per-frame `refresh`
  // subscription.
  function setHighlight(objectId: bigint | undefined): void {
    if (highlightApplier.set(objectId)) onHighlightChange?.(objectId);
  }

  function setHighlightStrength(strength: number): void {
    highlightApplier.setStrength(strength);
  }

  // FR148's one pointer listener, on the canvas element itself -- no Pixi
  // `eventMode`, no `interactive`, no per-sprite `on("pointer...")`.
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
    canAct: () => options.bodyControl?.isOpen() !== false,
    onHighlightChange: setHighlight,
  });

  // Story 6.10 (FR94): the one open container view, built per open and
  // destroyed on close, bound to its object, parented to that object's
  // floor stack. An item's texture is cropped from the atlas the first time
  // a view has a row for it.
  const itemTextures = new Map<number, Texture>();
  const itemById = new Map(defs.items.map((i) => [i.id, i]));
  async function prepareItemTextures(defIds: readonly number[]): Promise<void> {
    await Promise.all(
      defIds.map(async (id) => {
        const item = itemById.get(id);
        if (!item || item.atlas === undefined || itemTextures.has(id)) return;
        itemTextures.set(id, await atlasPageLoader.itemTexture(defs, item));
      }),
    );
  }
  const itemBulk = new Map(defs.items.map((i) => [i.id, { width: i.width, height: i.height }]));
  const containerController = new ContainerViewController({
    stacks,
    ticker: app.ticker,
    tileSizePx,
    storeyHeightPx,
    textureOf: (defId) => itemTextures.get(defId),
    bulkOf: (defId) => itemBulk.get(defId),
    prepare: prepareItemTextures,
    watchRows: (containerId, onRows, onError) =>
      options.containerRows?.(containerId, onRows, onError) ?? {
        release: () => {},
      },
  });
  function placedRowOf(objectId: bigint): PlacedObject | undefined {
    const local = localRows.get(objectId);
    if (local) return local;
    for (const key of store.chunkKeys()) {
      const row = store.chunk(key)?.placed.get(objectId);
      if (row) return row;
    }
    return undefined;
  }
  function openContainer(intent: Intent): void {
    const source = objectSources.get(intent.defId);
    const grid = source?.grid;
    if (!source || !grid) return;
    const placed = placedRowOf(intent.objectId);
    if (!placed) return;
    const object = {
      objectId: intent.objectId,
      defId: intent.defId,
      anchorX: placed.x,
      anchorY: placed.y,
      floor: placed.floor,
      width: source.width,
      height: source.height,
      spriteHeightPx: source.spriteHeightPx ?? tileSizePx * source.height,
    };
    const def = {
      width: source.width,
      height: source.height,
      interactAt: source.interactAt,
    };
    containerController.open({
      object,
      grid,
      closeWhen: () =>
        shouldClose({
          object,
          def,
          subcellsPerCell: movementConfig.subcellsPerCell,
          player: { x: walk.x, y: walk.y, floor: walk.floor },
          present: options.containerPresent?.(intent.objectId) !== false,
          visible: !hiddenObjectIds.has(intent.objectId),
          bodyOpen: options.bodyControl?.isOpen() !== false,
        }),
    });
  }

  // NFR2's measurement point: the scene's own CPU work for the *whole*
  // frame. Pixi's own `Application` renders through a `TickerPlugin`
  // listener at `UPDATE_PRIORITY.LOW`; a listener at `INTERACTION` marks
  // the start, and one at `UTILITY` (after the render call returns) marks
  // the end.
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

  const l3Config = loadL3Config(defs);
  const playerBodyDials: BodyDials = {
    strideCells: l3Config.strideCells,
    walkFrames: walkFramesPerCycle(defs, "adult"),
    // Frozen bodies are staged for a screenshot: the idle row is pinned.
    idleFrames: bodiesFrozen ? 1 : (framesByAnimation(defs, "adult").idle ?? 1),
    idleFrameMilliminutes: l3Config.idleFrameMilliminutes,
  };
  function drawPlayerBody(dx: number, dy: number, drawn: number): void {
    const id = playerCharacterId?.() ?? "player";
    const t = bodiesFrozen ? 0 : (cityMilliminutes?.() ?? 0);
    poseBody(id, playerMotion, dx, dy, drawn, t, playerBodyDials, playerBodyFrame);
    setBodyFrame(playerSprite, playerFrames, playerBodyFrame);
    onPlayerBody?.(playerBodyFrame);
  }

  function tick(deltaMS: number): void {
    if (transitionsDirty) rebuildTransitions();
    const direction =
      options.bodyControl?.isOpen() === false ? { x: 0, y: 0 } : keyboard.direction();
    if (direction.x === 0 && direction.y === 0) {
      drawPlayerBody(0, 0, 0);
      // Still applied on an idle frame: a window resize does not move the
      // player, but the camera's own offset has to react to it the instant
      // the renderer's size does.
      applyCamera();
      streamStep();
      return;
    }

    const stepFrom = walk;
    walk = stepAndTransition(
      walk,
      direction,
      deltaMS,
      worldIndex,
      movementConfig,
      transitions,
      flights,
    );

    // The displacement actually made, never the input: a wall is idle.
    {
      const dx = walk.x - stepFrom.x;
      const dy = walk.y - stepFrom.y;
      drawPlayerBody(dx, dy, flights.drawnDistance(stepFrom.x, stepFrom.y, stepFrom.floor, dx, dy));
    }

    onPlayerMove?.(walk.x, walk.y, walk.floor);
    onPlayerStep?.({
      fromX: stepFrom.x,
      fromY: stepFrom.y,
      fromFloor: stepFrom.floor,
      dirX: direction.x,
      dirY: direction.y,
      deltaMs: deltaMS,
      toX: walk.x,
      toY: walk.y,
      toFloor: walk.floor,
    });

    // The shared actor placement: position through the flight offset, the
    // move between floor pools on a floor transition, and the floor marked
    // for this frame's one re-sort when the sort key moved to a new
    // sub-tile unit. The camera anchor reads the offset it applied.
    playerFlightOffsetPx = placeActor(playerEntry, walk.x, walk.y, walk.floor).flightOffsetPx;

    // Ownership is looked up only when the player's own cell actually
    // changed -- never every frame -- and visibility is re-applied only
    // when that lookup (or the floor) actually differs from last time.
    if (walk.cellX !== lastCellX || walk.cellY !== lastCellY || walk.transitioned) {
      lastCellX = walk.cellX;
      lastCellY = walk.cellY;
      applyVisibilityFor(walk.cellX, walk.cellY, walk.floor, false);
      refreshHiddenObjects();
    }

    // The hover has to follow the world, not only the mouse: movement is
    // keyboard-only, so walking into or out of an object's reach with the
    // mouse held still is the normal way a player meets the affordance.
    pointer.refresh();

    // The camera, last: a pure function of the *new* position this same
    // frame just computed, applied in the same tick as the move.
    applyCamera();
    streamStep();
  }

  /** Stands the player at `(x, y, floor)` outright (a DEV harness): the
   * same placement a start gets, then the viewport's chunks and the
   * visibility for the new cell. */
  function teleport(x: number, y: number, floor: number): void {
    ensureFloorPasses(floor);
    walk = { ...initialFloorWalkState(x, y, floor), transitioned: false };
    lastCellX = walk.cellX;
    lastCellY = walk.cellY;
    playerFlightOffsetPx = placeActor(playerEntry, walk.x, walk.y, walk.floor).flightOffsetPx;
    applyCamera();
    onPlayerMove?.(walk.x, walk.y, walk.floor);
    residencyDirty = true;
    updateResidency(Number.POSITIVE_INFINITY);
    applyVisibilityFor(lastCellX, lastCellY, walk.floor, true);
    refreshHiddenObjects();
    reorderAll();
  }

  /** The streaming half of a frame: ownership that moved re-derives
   * visibility; the viewport that moved draws and releases chunks. */
  function streamStep(): void {
    if (lastOwnershipRevision !== ownership.revision) {
      applyVisibilityFor(lastCellX, lastCellY, walk.floor, true);
      refreshHiddenObjects();
    }
    updateResidency(CHUNKS_PER_FRAME);
  }

  // A crowd, when the page asked for one (a DEV harness; L2's citizens
  // arrive with Epic 5): never part of the depth-sorted pool, drawn in its
  // own container, posed from city time alone.
  const npcWalk = npcWalkability(worldIndex);
  const streetLife = new StreetLife(l3Config, npcWalk);
  const crowdSource = crowd?.({
    standable: (x, y) => isCellStandable(worldIndex, movementConfig, x, y, walk.floor),
    start: { x: walk.cellX, y: walk.cellY },
  });
  const citizensLayer = crowdSource
    ? await mountCitizensLayer(
        crowdContainer,
        defs,
        tileSizePx,
        storeyHeightPx,
        ZOOM,
        appearanceCache,
        {
          walk: npcWalk,
          config: l3Config,
          life: streetLife,
          crowd: crowdSource,
        },
        bodiesFrozen
          ? {}
          : {
              initialZone: bodyZone(),
              initialCityMilliminutes: cityMilliminutes?.(),
            },
      )
    : undefined;
  const msPerMilliminute = l3Config.realMsPerCityMinute / 1000;

  // Story 4.4/4.9: the other players. Each is a pool member of the floor it
  // stands on, kept out of the reported order, placed by `placeActor` like
  // the local player, and a visibility member -- so what the viewer sees of
  // it is `VisibilityApplier`'s alone.
  let nextRemoteStableId = REMOTE_STABLE_ID_BASE;
  const remoteHost: ActorHost = {
    add(sprite, x, y, floor) {
      const stableId = nextRemoteStableId++;
      const drawable = buildCharacterDrawable(
        rankOf(layerCodeByName("characters")),
        x,
        y,
        floor,
        stableId,
        "remote",
      );
      const entry: PoolEntry = { drawable, view: sprite, label: "remote" };
      unreportedIds.add(stableId);
      allVisibilityMembers.push(entry);
      enterPool(entry, floor);
      placeActor(entry, x, y, floor);
      visibilityApplier.applyMember(entry, windowAlpha);
      return {
        place: (px, py, pf) => {
          placeActor(entry, px, py, pf);
        },
        remove: () => {
          const pool = membersByFloor.get(entry.drawable.floor);
          const index = pool ? pool.indexOf(entry) : -1;
          if (pool && index >= 0) pool.splice(index, 1);
          const at = allVisibilityMembers.indexOf(entry);
          if (at >= 0) allVisibilityMembers.splice(at, 1);
          unreportedIds.delete(stableId);
          entry.view.removeFromParent();
          dirtyFloors.add(entry.drawable.floor);
        },
        stackFloor: () => {
          for (const pf of stacks.floors()) {
            if (entry.view.parent === stacks.stackFor(pf).pool) return pf;
          }
          return undefined;
        },
      };
    },
  };
  const remotePlayers = remotePlayersWiring
    ? await mountRemotePlayersLayer(remoteHost, defs, appearanceCache, {
        ...remotePlayersWiring,
        cityMilliminutes: bodiesFrozen ? undefined : cityMilliminutes,
        drawnDistance: (x, y, floor, dx, dy) => flights.drawnDistance(x, y, floor, dx, dy),
      })
    : undefined;
  // Story 1.14 (NFR1): the atlas term's own end -- every texture this
  // scene loads before its first frame has resolved by this line.
  markBoot(BOOT_MARK.ATLAS_READY);

  // The ledger-driven bodies' own animation, always ticking -- unlike the
  // player's own ticker above, this must never early-return while the
  // player stands still. Still runs before the render (`NORMAL`, the
  // default, is above the render's own `LOW`), so it stays inside the
  // frame-work window the two listeners above bound.
  app.ticker.add(() => {
    if (citizensLayer && !bodiesFrozen) {
      const cityMilli = cityMilliminutes?.();
      if (cityMilli !== undefined) {
        // The L3 window: exactly the work L3 asks of the frame, nothing of
        // the render or of test plumbing.
        const l3Start = onL3Work ? performance.now() : 0;
        const zone = bodyZone();
        streetLife.solve(cityMilli, zone);
        citizensLayer.update(cityMilli, zone);
        onL3Work?.(performance.now() - l3Start);
        onCitizenBodies?.(citizensLayer.bodyBounds(), app.screen, citizensLayer.citizenCount);
      }
    }
    remotePlayers?.update();
  });

  // After every placer of the frame (the listeners above are all NORMAL),
  // before the render: each dirty floor is re-sorted once.
  app.ticker.add(flushOrder, undefined, UPDATE_PRIORITY.NORMAL - 1);

  // Story 2.7: a composite page re-uploads at most once per frame -- every
  // look's own draw this tick only marks its page dirty; this is the one
  // place `source.update()` actually runs.
  appearanceCache.flush();
  app.ticker.add(() => {
    appearanceCache.flush();
  });

  // The frame-work window's own closing bracket: below the render's own
  // `LOW` priority, so this always runs after `app.render()` has returned.
  app.ticker.add(
    () => {
      onFrameWork?.(performance.now() - frameWorkStartMs);
    },
    undefined,
    UPDATE_PRIORITY.UTILITY,
  );

  // Story 1.14 (NFR1): fires once, after the first frame has actually
  // rendered. Whether the body is the player's yet is `boot/arrival.ts`'s
  // call, made from this callback (story 4.6).
  app.ticker.addOnce(
    () => {
      const at = performance.now();
      markBoot(BOOT_MARK.FIRST_FRAME_RENDERED, at);
      onFirstFrame?.(at);
    },
    undefined,
    UPDATE_PRIORITY.UTILITY,
  );

  const emptyCitizens: CitizensLayerHandle = {
    textureIdsById: {},
    distinctTextureCount: 0,
    bodyCount: () => 0,
    citizenCount: 0,
    bodyBounds: () => [],
    update: () => {},
    l3Bodies: () => [],
    agreementAt: () => [],
    liveAt: () => [],
  };

  return {
    app,
    appearanceCache,
    playerAppearance: playerTuple,
    getRenderOrder: () => renderOrder,
    keyboard,
    citizensLayer: citizensLayer ?? emptyCitizens,
    remotePlayers,
    get distinctBoundAtlasPages() {
      return countBoundAtlasPages(app.stage, atlasPageLoader, appearanceCache);
    },
    doorways: () =>
      [...liveEntries].flatMap((entry) => {
        const d = entry.drawable;
        if (!isDefPropDrawable(d) || !(thresholdDefIds.has(d.defId) || d.liftSourcePx)) return [];
        const sprite = entry.view as Sprite;
        return [
          {
            stableId: String(d.stableId),
            textureWidth: sprite.texture.width,
            textureHeight: sprite.texture.height,
            liftPx: liftPx(d),
          },
        ];
      }),
    get allBoundTextureSources() {
      return countAllBoundTextureSources(app.stage);
    },
    l3Bodies: () => citizensLayer?.l3Bodies() ?? [],
    setRender: (on) => {
      world.renderable = on;
    },
    viewportCells: () => viewportRect(),
    l3Sweep: (frames) => {
      const start = cityMilliminutes?.();
      if (start === undefined || !citizensLayer) return [];
      const step = 1000 / 60 / msPerMilliminute;
      const out: number[] = [];
      for (let k = 0; k < frames; k++) {
        const t = start + k * step;
        const at = performance.now();
        const zone = bodyZone();
        streetLife.solve(t, zone);
        citizensLayer.update(t, zone);
        out.push(performance.now() - at);
      }
      return out;
    },
    playerDrawnPoint: () => ({ x: playerSprite.x, y: playerSprite.y }),
    teleport,
    playerScreenBounds: () => {
      const b = playerSprite.getBounds();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    },
    setHighlightStrength,
    currentFloor: () => walk.floor,
    poolDrawables: () => [
      ...[...liveEntries]
        .filter((e) => passOfLayer(e.drawable.layerCode) === "pool")
        .map((e) => e.drawable),
      playerEntry.drawable,
    ],
    orderIndexOf: (stableId) => {
      const index = renderOrder.indexOf(stableId);
      return index === -1 ? undefined : index;
    },
    collidersInCell: (floor, cellX, cellY) => worldIndex.entriesInCell(floor, cellX, cellY),
    worldObjects: (bounds) => worldIndex.objects(bounds),
    playerBody: () => bodyRect({ x: walk.x, y: walk.y }, movementConfig),
    suspendPointer: () => pointer.suspend(),
    resumePointer: () => pointer.resume(),
    openContainer,
    closeContainer: () => containerController.close(),
    containerView: () => {
      const objectId = containerController.openObjectId();
      return objectId === undefined
        ? undefined
        : { objectId, rects: containerController.drawnRects() };
    },
    stageChildCount: () => app.stage.children.length,
    drawnChunkCount: () => drawnChunks.size,
    localPropCells: () => placedLocal,
    placeCarrier,
    liveSpriteCount: () => liveEntries.size,
    ownershipAtPlayer: () => ownership.ownershipAt(walk.cellX, walk.cellY, walk.floor),
    destroy: () => {
      containerController.close();
      detachKeyboard();
      pointer.detach();
      setHighlight(undefined);
    },
  };
}

/** The most chunks one frame builds once the first frame has rendered: a
 * chunk is on the order of a thousand sprites, and a walk crosses one in
 * seconds, so one a frame keeps ahead of the player without a hitch. */
const CHUNKS_PER_FRAME = 1;

/** The page's own carrier sprite (the link offer's post): drawn in the
 * scene and pickable, but not a row of the streamed world. */
export interface CarrierSpec {
  readonly objectId: bigint;
  readonly defId: number;
  readonly layer: number;
  /** The nearest standable cell at least this many cells from the start. */
  readonly minDistance?: number;
}

/** The standable cell nearest `(cx, cy)` at least `minDistance` away, by
 * expanding Chebyshev rings; `undefined` when none lies within 8. */
export function nearestStandable(
  standable: (x: number, y: number) => boolean,
  cx: number,
  cy: number,
  minDistance: number,
): { x: number; y: number } | undefined {
  for (let r = Math.max(0, minDistance); r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (standable(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
      }
    }
  }
  return undefined;
}
