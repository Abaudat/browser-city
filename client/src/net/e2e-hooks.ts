// Test-only observation surface for client/tests/e2e/round-trip.spec.ts
// (Quentin, story 1.1). Guarded by `import.meta.env.DEV`, a flag Vite
// inlines statically and dead-code-eliminates from a production build, so
// `window.__bc` never ships. Exists so the e2e spec reads page state
// instead of scraping console output.

import type { AppearanceTuple, UniformOverride } from "../render/appearance/composite";
import type { PixelSnapshot } from "../render/appearance/pixel-snapshot";
import type { CityTime } from "../time/city-time";
import type { PlayerStep } from "../world/floor-walk";
import type { PingObservation } from "./observe-ping";
import type { RegionTableName } from "./region-subscription";

declare global {
  interface Window {
    __bc?: {
      pings: PingObservation[];
      /** Story 4.5: who this device is. Never the token. */
      identity?: { identityHex: string; persisted: boolean };
      /** Story 4.5: whether the link offer's carrier was placed this
       * session, set once the scene is about to mount. */
      linkOffer?: { placed: boolean };
      createCharacter?: () => Promise<void>;
      startLink?: () => Promise<void>;
      /** Story 4.5: the character this identity reaches, once the
       * `my_character` view delivers it. */
      character?: { characterId: string; createdAtMicros: string; linked: boolean };
      renderOrder?: string[];
      /** Story 4.8: the reconnect supervisor. `live` is how many SDK
       * connections are open (never more than one); `drop` closes the
       * current one from the client, as a socket loss would. */
      connection?: { live: () => number; drop: () => void };
      playerPosition?: { x: number; y: number };
      /** Story 1.13: the floor the player is standing on right now --
       * recorded with the position, from the same `FloorWalkResult`, so a
       * reader can never see one without the other. */
      playerFloor?: number;
      /** Story 15.21: every resolved walk step of the player, kept only
       * while a spec has set this to an array (an unset one records
       * nothing), so a spec can replay each step with its own frame time. */
      playerSteps?: PlayerStep[];
      /** Story 1.13 (NFR2): per-frame *work* time in ms -- how long the
       * scene's own ticker callback took, never a rAF interval (headless
       * CI has no vsync or GPU, so wall-clock FPS there is noise).
       * Recording is off until `__bcStartFrameTimings` turns it on, so a
       * functional spec never pays for it. */
      frameTimings?: number[];
      startFrameTimings?: () => void;
      stopFrameTimings?: () => number[];
      /** Story 5.4 (NFR11): per-frame L3 window in ms, same pattern as
       * `frameTimings`; recorded only between start and stop. */
      l3Timings?: number[];
      startL3Timings?: () => void;
      stopL3Timings?: () => number[];
      /** Story 5.4: every drawn L3 body as the debug overlay reads it. */
      l3Bodies?: () => readonly {
        id: string;
        moving: boolean;
        fallbacks: number;
        avoidance?: { offsetCells: number; capped: boolean; blocked: boolean };
        activity?: string;
      }[];
      /** Story 5.4: draws nothing while off; L3 and every ticker listener
       * keep running. */
      setRender?: (on: boolean) => void;
      /** Story 5.4: times `frames` render-free L3 frames (NFR11). */
      l3Sweep?: (frames: number) => number[];
      /** Story 5.4: how many bodies are drawn right now. */
      bodyCount?: () => number;
      /** Story 2.8 (FR147): how many ticker frames the mounted street
       * scene has drawn, ever -- unlike `frameTimings`, never gated
       * behind `startFrameTimings`, so `defs-handshake.spec.ts` can prove
       * it stays 0 for the whole stale-defs window before the scene
       * mounts at all. */
      frameCount?: number;
      /** Story 5.3: what the local player's body is drawing now. */
      playerBody?: { animation: string; direction: string; frameIndex: number };
      /** Story 5.3 (FR58): what the citizen bodies have done since
       * `reset`, recorded per drawn frame in the page. */
      bodyWatch?: {
        /** Starts over, counting every body now drawn as already seen. */
        reset: () => void;
        /** Ids whose first drawn frame since `reset` intersected the canvas. */
        poppedIn: () => string[];
        /** The fewest and most bodies drawn at once since `reset`. */
        minBodies: () => number;
        maxBodies: () => number;
        /** Citizens the street has. */
        citizens: () => number;
        /** Spawns of an id that had already had a body since `reset`. */
        respawns: () => number;
        /** Ids that went from not drawn to drawn since `reset`. */
        spawns: () => number;
        /** Bodies drawn now. */
        drawn: () => number;
      };
      /** Story 4.4 (FR138): the other players as this page draws them. */
      remotePlayers?: {
        /** Where each drawn remote player is, by character id, now. */
        poses: () => Record<string, { x: number; y: number; floor: number }>;
        /** Records every frame's poses until `stopTrace` returns them. */
        startTrace: () => void;
        /** What was drawn each frame, and the samples received meanwhile. */
        stopTrace: () => {
          frames: Record<string, { t: number; x: number; y: number; floor: number }[]>;
          samples: Record<string, { tMs: number; x: number; y: number }[]>;
        };
      };
      /** Story 4.3 (FR136): the interest region as the client holds it. */
      region?: {
        /** Ids (`cx,cy,band`) of the handles currently wanted. */
        held: () => string[];
        liveHandles: () => number;
        /** Ids of the handles whose initial apply has landed. */
        applied: () => string[];
        /** `chunkKey` of every row of `table` in the SDK client cache. */
        cachedChunkKeys: (table: RegionTableName) => string[];
        /** Drives the region as the scene's own position does. */
        moveTo: (x: number, y: number, floor: number) => void;
        /** Insert/delete callbacks seen per `<table>:<primary key>`. */
        inserts: Record<string, number>;
        deletes: Record<string, number>;
        updates: Record<string, number>;
      };
      visibility?: Record<string, string>;
      visibilityAlpha?: Record<string, number>;
      masksAllNull?: boolean;
      intents?: { objectId: string; defId: number }[];
      ignoredIntents?: string[];
      viewTransform?: { zoom: number; offsetX: number; offsetY: number };
      highlightedObjectId?: string | null;
      /** Story 1.10: one opaque texture-identity id per mounted citizen
       * id -- citizens sharing a tuple+override share an id (AC5). */
      appearanceTextureIds?: Record<string, number>;
      appearanceDistinctTextureCount?: number;
      /** Story 2.6 (NFR12): how many distinct atlas pages the mounted
       * street actually resolved a texture from -- `AtlasPageLoader.
       * boundPageCount()` at mount time. */
      distinctBoundAtlasPages?: number;
      /** Story 2.14: each mounted doorway sprite (a threshold and its
       * wall-top band) -- its resolved texture size and how far above its
       * sort anchor it is drawn. */
      doorways?: readonly {
        readonly stableId: string;
        readonly textureWidth: number;
        readonly textureHeight: number;
        readonly liftPx: number;
      }[];
      /** Story 2.7 (NFR12): every distinct `TextureSource` reachable from
       * the mounted display list, *unfiltered* -- see
       * `recordAllBoundTextureSourcesForE2e`. */
      allBoundTextureSources?: number;
      /** Story 1.13: the player's own five stored part indices (FR61),
       * recorded once at mount. Unlike `appearanceTextureIds` -- opaque
       * per-session identity counters, assigned in texture-load order and
       * meaningless across a reload -- this is the tuple itself, so "the
       * same five parts after a walk and after a reload" is a thing a
       * spec can actually assert. */
      playerAppearance?: {
        body: number;
        eyes: number;
        outfit: number;
        hairstyle: number;
        accessory: number;
      };
      /** Story 1.10: the real, mounted pipeline's own pixel output vs.
       * an independent five/six-sprite stack, for one `(tuple, override,
       * animation, direction, frame)`. */
      appearanceCompare?: (
        tuple: AppearanceTuple,
        override: UniformOverride | null,
        animation: string,
        direction: string,
        frame: number,
      ) => Promise<{ pipeline: PixelSnapshot; stack: PixelSnapshot }>;
      /** Story 4.1: the in-city time this client currently derives --
       * a callable, read fresh every call, `undefined` until the epoch
       * row, the defs and a first server sample are all in. */
      cityTime?: () => CityTime | undefined;
      /** Story 4.1: the subscribed `world_clock` row -- its `epoch_at`
       * (microseconds, as a decimal string) and how many inserts and
       * updates the client has been sent for it, so a spec can prove no
       * per-tick broadcast exists. */
      worldClock?: { epochMicros: string; inserts: number; updates: number };
      /** The camera/viewport story (Quentin's direction): the player
       * sprite's own real, live global screen bounds -- a callable, read
       * fresh every call from the real, mounted `Sprite.getBounds()`,
       * never a value recorded once. `camera-viewport.spec.ts` is the
       * only reader; it must never be recomputed from `viewTransform`,
       * which is the thing under test. */
      playerScreenBounds?: () => { x: number; y: number; width: number; height: number };
      /** Story 5.2: every street citizen's agreed L3 state at a given city
       * time, computed from scratch -- never read from what was drawn. */
      l3Agreement?: (cityMilli: number) => readonly {
        id: string;
        x: number;
        y: number;
        activity: string;
        frameIndex: number;
        facing: string;
        offsetX: number;
        offsetY: number;
        look: string;
      }[];
      /** Story 5.4: the L3 state of the bodies this client holds, at a
       * given city time -- what differs between two bubbles. */
      l3Live?: (cityMilli: number) => {
        /** The viewport in floor-0 cells. */
        viewport: { x0: number; y0: number; x1: number; y1: number } | undefined;
        bodies: readonly {
          id: string;
          x: number;
          y: number;
          activity: string;
          frameIndex: number;
          facing: string;
          offsetX: number;
          offsetY: number;
          agreed: boolean;
        }[];
      };
      /** Story 5.1: the L3 commuter as last drawn -- a callable read fresh
       * each call, `undefined` while it is not on screen. */
      commuterDrawn?: () =>
        | {
            cityMilli: number;
            legKey: number;
            departAt: number;
            arriveAt: number;
            distance: number;
            x: number;
            y: number;
            floor: number;
            orderIndex: number;
            lamppostOrderIndex: number;
            screenX: number;
            screenY: number;
            animation: string;
            direction: string;
            frameIndex: number;
          }
        | undefined;
      /** Cycle 2 (Quentin's direction, finding 2): the world container's
       * own real, live `scale`/`position` -- a callable, read fresh every
       * call from the real, mounted `Container`, never a value recorded
       * once and never recomputed from `viewTransform`. `camera-viewport.
       * spec.ts`'s AC4 load spec is the only reader. */
      worldTransform?: () => { scaleX: number; scaleY: number; x: number; y: number };
    };
  }
}

export function recordPingForE2e(observation: PingObservation): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.pings.push(observation);
  window.__bc = bucket;
}

/** Story 1.6's proof that the real adapter is wired to the real display
 * list (Quentin's direction): the street scene's current depth order,
 * `bigint`s as decimal strings since `window.__bc` crosses into
 * Playwright's own serialisation. `client/tests/e2e/render-order.spec.ts`
 * is the only reader. */
export function recordRenderOrderForE2e(order: readonly bigint[]): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.renderOrder = order.map((id) => id.toString());
  window.__bc = bucket;
}

/** Story 15.21: every resolved player step, recorded only while a spec has
 * set `__bc.playerSteps`; the footbridge spec in `enclosure.spec.ts` reads it. */
export function recordPlayerStepForE2e(step: PlayerStep): void {
  if (!import.meta.env.DEV) return;
  window.__bc?.playerSteps?.push(step);
}

/** Story 1.8's proof that a held direction key moves the avatar
 * client-side, with no round trip (FR137): the street scene's current
 * continuous player position, read every frame -- `movement.spec.ts` is
 * the only reader. */
export function recordPlayerPositionForE2e(x: number, y: number, floor: number): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.playerPosition = { x, y };
  bucket.playerFloor = floor;
  window.__bc = bucket;
}

/** Story 1.13 (NFR2): the frame-work recorder the perf spec drives. The
 * scene reports how long its own ticker callback took, every frame, and
 * this keeps the samples only while a caller has asked for them -- a
 * functional run records nothing and allocates nothing. */
export function recordFrameWorkForE2e(ms: number): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.frameCount = (bucket.frameCount ?? 0) + 1;
  if (bucket.frameTimings) bucket.frameTimings.push(ms);
  if (bucket.startFrameTimings) return;
  bucket.startFrameTimings = () => {
    const current = window.__bc;
    if (current) current.frameTimings = [];
  };
  bucket.stopFrameTimings = () => {
    const current = window.__bc;
    const samples = current?.frameTimings ?? [];
    if (current) current.frameTimings = undefined;
    return samples;
  };
  window.__bc = bucket;
}

/** Story 5.4 (NFR11): the L3 window recorder the budget spec drives, the
 * same idiom as `recordFrameWorkForE2e`: nothing is kept, and nothing
 * allocated, unless a caller has started it. */
export function recordL3WorkForE2e(ms: number): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  if (bucket.l3Timings) bucket.l3Timings.push(ms);
  if (bucket.startL3Timings) return;
  bucket.startL3Timings = () => {
    const current = window.__bc;
    if (current) current.l3Timings = [];
  };
  bucket.stopL3Timings = () => {
    const current = window.__bc;
    const samples = current?.l3Timings ?? [];
    if (current) current.l3Timings = undefined;
    return samples;
  };
  window.__bc = bucket;
}

/** Story 5.4: the L3 bodies and the body count, read fresh each call. */
export function exposeL3BodiesForE2e(
  bodies: NonNullable<NonNullable<Window["__bc"]>["l3Bodies"]>,
  count: NonNullable<NonNullable<Window["__bc"]>["bodyCount"]>,
  live: NonNullable<NonNullable<Window["__bc"]>["l3Live"]>,
  sweep: NonNullable<NonNullable<Window["__bc"]>["l3Sweep"]>,
  setRender: NonNullable<NonNullable<Window["__bc"]>["setRender"]>,
): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.l3Bodies = bodies;
  bucket.bodyCount = count;
  bucket.l3Live = live;
  bucket.l3Sweep = sweep;
  bucket.setRender = setRender;
  window.__bc = bucket;
}

/** Story 1.7's proof that the real, mounted adapter reaches the same
 * FR120/FR121/FR122 states the pure `computeVisibility` function
 * predicts (Quentin's direction): a map from decimal `stableId` string to
 * its current visibility state ("hidden"/"translucent"/"normal"), plus
 * the exact `alpha` each member's own sprite carries right now -- both
 * read straight off `sprite.visible`/`sprite.alpha` after `VisibilityApplier`
 * writes them (never recomputed), updated every time it actually
 * re-applies (never polled every frame). `client/tests/e2e/
 * enclosure.spec.ts` is the only reader; the alpha map is what lets it
 * assert a translucent sprite's alpha equals `render.window_alpha / 100`
 * directly, not merely that its state is "translucent". */
export function recordVisibilityForE2e(
  state: Readonly<Record<string, string>>,
  alpha: Readonly<Record<string, number>>,
): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.visibility = { ...state };
  bucket.visibilityAlpha = { ...alpha };
  window.__bc = bucket;
}

/** FR121's "no masking or aperture system" acceptance criterion (Tim's
 * direction), proven against the real, mounted display list rather than
 * only by `scripts/ci/check-no-masks.sh` never finding the word `mask` in
 * the source -- recorded once, after mount. */
export function recordMasksCheckedForE2e(allNull: boolean): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.masksAllNull = allNull;
  window.__bc = bucket;
}

/** Story 1.9's proof that a real click on a real canvas becomes exactly
 * one intent, carrying the instance the player actually clicked (FR148):
 * every intent the street scene emitted, in order, with `bigint` ids as
 * decimal strings since `window.__bc` crosses into Playwright's own
 * serialisation. `client/tests/e2e/intents.spec.ts` is the only reader. */
export function recordIntentForE2e(intent: { objectId: bigint; defId: number }): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.intents = [
    ...(bucket.intents ?? []),
    { objectId: intent.objectId.toString(), defId: intent.defId },
  ];
  window.__bc = bucket;
}

/** The other half of the same proof (AC2): the objects whose clicks were
 * refused for being out of reach. A click that emits an intent must never
 * also appear here, and vice versa. */
export function recordIgnoredIntentForE2e(objectId: bigint): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.ignoredIntents = [...(bucket.ignoredIntents ?? []), objectId.toString()];
  window.__bc = bucket;
}

/** Story 1.9: the street scene's own camera transform, recorded once at
 * mount. `intents.spec.ts` needs it to turn a world pixel -- computed
 * from the real `worldPointPx`/`cellBottomCentre` and the real fixture
 * cell -- into the canvas offset to click at, rather than hard-coding a
 * pixel that would silently stop meaning anything the moment the camera
 * moves. */
export function recordViewTransformForE2e(zoom: number, offsetX: number, offsetY: number): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.viewTransform = { zoom, offsetX, offsetY };
  window.__bc = bucket;
}

/** FR173's affordance mark, as the real scene applied it: which object is
 * marked right now, or `null` when none is. `intents.spec.ts` reads this
 * to prove the mark follows the *player* -- walking into reach with the
 * mouse held still must light the object up, which no pointer event
 * would ever report. */
export function recordHighlightForE2e(objectId: bigint | undefined): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.highlightedObjectId = objectId === undefined ? null : objectId.toString();
  window.__bc = bucket;
}

/** Story 1.10 (AC5): the mounted street crowd's own texture identities,
 * once, right after mount -- `appearance.spec.ts`'s only reader for the
 * "one composite per unique key" proof. */
export function recordAppearanceTextureIdsForE2e(
  idsById: Readonly<Record<string, number>>,
  distinctCount: number,
): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.appearanceTextureIds = { ...idsById };
  bucket.appearanceDistinctTextureCount = distinctCount;
  window.__bc = bucket;
}

/** Story 2.6 (NFR12): how many distinct atlas pages the mounted street
 * actually resolved a texture from -- read once at mount and never
 * again, the same idiom `recordAppearanceTextureIdsForE2e` uses. */
export function recordDistinctBoundAtlasPagesForE2e(count: number): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.distinctBoundAtlasPages = count;
  window.__bc = bucket;
}

/** Story 2.14: the mounted doorway sprites, read once at mount. */
export function recordDoorwaysForE2e(
  doorways: NonNullable<NonNullable<typeof window.__bc>["doorways"]>,
): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.doorways = doorways;
  window.__bc = bucket;
}

/** Story 2.7 (NFR12, Quentin's direction cycle 1): every distinct
 * `TextureSource` reachable from the mounted display list, *unfiltered*
 * -- unlike `distinctBoundAtlasPages`, never narrowed to a known-page
 * set, so `appearance.spec.ts`'s crowd-cost proof can catch a regression
 * back to one standalone texture per composited look. Read once at
 * mount, the same idiom every other one-shot hook here uses. */
export function recordAllBoundTextureSourcesForE2e(count: number): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.allBoundTextureSources = count;
  window.__bc = bucket;
}

/** Story 1.13: the player's own appearance tuple, as the real, mounted
 * scene composited it -- read once at mount and never again. */
export function recordPlayerAppearanceForE2e(tuple: {
  readonly body: number;
  readonly eyes: number;
  readonly outfit: number;
  readonly hairstyle: number;
  readonly accessory: number;
}): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.playerAppearance = { ...tuple };
  window.__bc = bucket;
}

/** Story 1.10: exposes the real, mounted crowd's own pixel-diff proof as
 * a callable -- `appearance.spec.ts` invokes it with fixed tuples through
 * `page.evaluate`, never a value recorded once at mount (each call needs
 * its own tuple/cell arguments). */
export function exposeAppearanceCompareForE2e(
  compare: NonNullable<NonNullable<Window["__bc"]>["appearanceCompare"]>,
): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.appearanceCompare = compare;
  window.__bc = bucket;
}

/** The camera/viewport story: exposes the real, mounted scene's own
 * `playerScreenBounds` getter directly -- a callable, the same idiom
 * [`exposeAppearanceCompareForE2e`] uses, so every call reads the real
 * sprite's bounds at that instant rather than a value frozen at mount. */
export function exposePlayerScreenBoundsForE2e(
  getter: NonNullable<NonNullable<Window["__bc"]>["playerScreenBounds"]>,
): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.playerScreenBounds = getter;
  window.__bc = bucket;
}

/** Story 5.2: the same idiom, for the L3 agreement sample. */
export function exposeL3AgreementForE2e(
  getter: NonNullable<NonNullable<Window["__bc"]>["l3Agreement"]>,
): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.l3Agreement = getter;
  window.__bc = bucket;
}

/** Story 5.1: the same idiom, for the L3 commuter's last drawn state. */
export function exposeCommuterDrawnForE2e(
  getter: NonNullable<NonNullable<Window["__bc"]>["commuterDrawn"]>,
): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.commuterDrawn = getter;
  window.__bc = bucket;
}

/** Cycle 2 (Quentin's direction, finding 2): the same idiom, for the
 * world container's own real, live `scale`/`position`. */
export function exposeWorldTransformForE2e(
  getter: NonNullable<NonNullable<Window["__bc"]>["worldTransform"]>,
): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.worldTransform = getter;
  window.__bc = bucket;
}

/** Story 4.1: the `world_clock` row as the client received it, counting
 * every insert and update -- `city-clock.spec.ts` asserts exactly one
 * insert and zero updates over three in-city minutes. */
export function recordWorldClockForE2e(epochMicros: bigint, kind: "insert" | "update"): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  const prev = bucket.worldClock ?? { epochMicros: "", inserts: 0, updates: 0 };
  bucket.worldClock = {
    epochMicros: epochMicros.toString(),
    inserts: prev.inserts + (kind === "insert" ? 1 : 0),
    updates: prev.updates + (kind === "update" ? 1 : 0),
  };
  window.__bc = bucket;
}

/** Story 4.5: this device's identity (public) and the character it
 * reaches, never the token -- the repository is public and Playwright
 * reports are uploaded (`scripts/ci/check-identity-token-confined.sh`). */
export function recordIdentityForE2e(identity: { identityHex: string; persisted: boolean }): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.identity = { identityHex: identity.identityHex, persisted: identity.persisted };
  window.__bc = bucket;
}

export function recordCharacterForE2e(character: {
  characterId: bigint;
  createdAtMicros: bigint;
  linked: boolean;
}): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.character = {
    characterId: character.characterId.toString(),
    createdAtMicros: character.createdAtMicros.toString(),
    linked: character.linked,
  };
  window.__bc = bucket;
}

export function recordLinkOfferForE2e(placed: boolean): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.linkOffer = { placed };
  window.__bc = bucket;
}

/** Story 4.5: the acts a player will have in-world (naming a character in
 * 4.6, the link offer's carrier), callable by a spec until they do. No
 * argument accepts a token. */
export function exposeIdentityActionsForE2e(actions: {
  createCharacter: () => Promise<void>;
  startLink: () => Promise<void>;
}): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.createCharacter = actions.createCharacter;
  bucket.startLink = actions.startLink;
  window.__bc = bucket;
}

/** Story 4.1: exposes the client's derived in-city time as a callable. */
export function exposeCityTimeForE2e(getter: () => CityTime | undefined): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.cityTime = getter;
  window.__bc = bucket;
}

/** Story 4.8: exposes the connection supervisor (see `Window.__bc.connection`). */
export function exposeConnectionForE2e(connection: { live: () => number; drop: () => void }): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.connection = connection;
  window.__bc = bucket;
}

/** Set once a spec drives the region itself through the hook's `moveTo`:
 * from then on the scene's own position no longer feeds it. */
let regionDrivenByE2e = false;

/** Story 4.3: wraps the function the scene reports its position through,
 * so a spec that drives the region is not fought by the scene's own
 * per-frame reports. Always forwards in a production build, where the
 * hook below is never exposed. */
export function sceneRegionFeed(
  feed: (x: number, y: number, floor: number) => void,
): (x: number, y: number, floor: number) => void {
  return (x, y, floor) => {
    if (!regionDrivenByE2e) feed(x, y, floor);
  };
}

/** Story 4.3: exposes the interest region (see `Window.__bc.region`). */
export function exposeRegionForE2e(
  region: Omit<
    NonNullable<NonNullable<Window["__bc"]>["region"]>,
    "inserts" | "deletes" | "updates"
  >,
): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  const prev = bucket.region;
  bucket.region = {
    ...region,
    moveTo: (x, y, floor) => {
      regionDrivenByE2e = true;
      region.moveTo(x, y, floor);
    },
    inserts: prev?.inserts ?? {},
    deletes: prev?.deletes ?? {},
    updates: prev?.updates ?? {},
  };
  window.__bc = bucket;
}

/** Story 4.3: counts every streamed row callback by table and primary key
 * (the first column of every region table). Safe to call before
 * [`exposeRegionForE2e`]: the counters are carried over. */
export function recordRegionRowForE2e(
  kind: "inserts" | "deletes" | "updates",
  table: string,
  row: object,
): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  const region = bucket.region ?? {
    held: () => [],
    liveHandles: () => 0,
    applied: () => [],
    cachedChunkKeys: () => [],
    moveTo: () => {},
    inserts: {},
    deletes: {},
    updates: {},
  };
  bucket.region = region;
  const id = `${table}:${String(Object.values(row)[0])}`;
  region[kind][id] = (region[kind][id] ?? 0) + 1;
  window.__bc = bucket;
}

/** Story 5.3 (FR58): per-frame bookkeeping of the citizen bodies, in the
 * page: a body whose first drawn frame is inside the canvas is a pop. */
const bodyEverSeen = new Set<string>();
const bodyPopped = new Set<string>();
let bodyDrawnNow = new Set<string>();
let bodyMin = 0;
let bodyMax = 0;
let bodyCitizens = 0;
let bodyRespawns = 0;
let bodySpawns = 0;

export function recordCitizenBodiesForE2e(
  bodies: readonly { id: string; x0: number; y0: number; x1: number; y1: number }[],
  screen: { readonly width: number; readonly height: number },
  citizenCount: number,
): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.bodyWatch ??= {
    reset: () => {
      bodyEverSeen.clear();
      bodyPopped.clear();
      for (const id of bodyDrawnNow) bodyEverSeen.add(id);
      bodyMin = bodyDrawnNow.size;
      bodyMax = bodyDrawnNow.size;
      bodyRespawns = 0;
      bodySpawns = 0;
    },
    poppedIn: () => [...bodyPopped],
    minBodies: () => bodyMin,
    maxBodies: () => bodyMax,
    citizens: () => bodyCitizens,
    respawns: () => bodyRespawns,
    spawns: () => bodySpawns,
    drawn: () => bodyDrawnNow.size,
  };
  bodyCitizens = citizenCount;
  const now = new Set<string>();
  for (const b of bodies) {
    now.add(b.id);
    if (bodyDrawnNow.has(b.id)) continue;
    // Every frame an id goes from not drawn to drawn, first spawn or respawn,
    // is checked for being on the canvas.
    bodySpawns++;
    if (bodyEverSeen.has(b.id)) bodyRespawns++;
    const inView = b.x1 > 0 && b.y1 > 0 && b.x0 < screen.width && b.y0 < screen.height;
    if (inView) bodyPopped.add(b.id);
    bodyEverSeen.add(b.id);
  }
  bodyDrawnNow = now;
  bodyMin = bodyMin === 0 && bodyMax === 0 ? now.size : Math.min(bodyMin, now.size);
  bodyMax = Math.max(bodyMax, now.size);
  window.__bc = bucket;
}

/** Story 5.3: the local player's body frame, written from the scene's own
 * ticker. */
export function recordPlayerBodyForE2e(frame: {
  readonly animation: string;
  readonly direction: string;
  readonly frameIndex: number;
}): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.playerBody = {
    animation: frame.animation,
    direction: frame.direction,
    frameIndex: frame.frameIndex,
  };
  window.__bc = bucket;
}

/** Story 4.4: the remote players' per-frame poses, from the scene's own
 * ticker -- recorded in the page, never polled from the test runner. */
let remoteTrace: Record<string, { t: number; x: number; y: number; floor: number }[]> | undefined;
let remoteSamples: Record<string, { tMs: number; x: number; y: number }[]> = {};
let remotePoses: Record<string, { x: number; y: number; floor: number }> = {};

export function recordRemotePlayersForE2e(
  poses: Readonly<Record<string, { x: number; y: number; floor: number }>>,
): void {
  if (!import.meta.env.DEV) return;
  remotePoses = { ...poses };
  if (!remoteTrace) return;
  const t = performance.now();
  for (const [id, p] of Object.entries(poses)) {
    const list = remoteTrace[id] ?? [];
    list.push({ t, x: p.x, y: p.y, floor: p.floor });
    remoteTrace[id] = list;
  }
}

/** Story 4.4: a sample as received, recorded while a trace runs. */
export function recordRemoteSampleForE2e(
  id: string,
  sample: { tMs: number; x: number; y: number },
): void {
  if (!import.meta.env.DEV || !remoteTrace) return;
  const list = remoteSamples[id] ?? [];
  list.push(sample);
  remoteSamples[id] = list;
}

export function exposeRemotePlayersForE2e(): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.remotePlayers = {
    poses: () => remotePoses,
    startTrace: () => {
      remoteTrace = {};
      remoteSamples = {};
    },
    stopTrace: () => {
      const out = { frames: remoteTrace ?? {}, samples: remoteSamples };
      remoteTrace = undefined;
      remoteSamples = {};
      return out;
    },
  };
  window.__bc = bucket;
}
