import { Application } from "pixi.js";
import { DEFAULT_HANDSHAKE_TIMEOUT_MS } from "./boot/boot-gate";
import { BOOT_MARK, markBoot } from "./boot/boot-marks";
import { runBootSequence } from "./boot/boot-sequence";
import type { VerifiedDefs } from "./boot/handshake";
import { createHandshakeLatch, type HandshakeLatch } from "./boot/handshake-latch";
import type { PostMountGuard } from "./boot/post-mount-guard";
import { readReloadedFor, writeReloadedFor } from "./boot/reloaded-for-storage";
import type { DebugWorldView } from "./debug/world-view";
import { fetchDefs } from "./defs/load";
import type { Defs } from "./defs/types";
import { guardedCreateCharacter } from "./identity/create-guard";
import { carrierDefId, offerDue, readOfferRules } from "./identity/link-offer";
import { decideOffer } from "./identity/link-offer-gate";
import { loadLastShownDay, saveLastShownDay } from "./identity/link-prompt";
import { offerLink, resumeLinkIfPending } from "./identity/link-session";
import type { Intent } from "./input/intent";
import { loadBindings, resolveStorage, saveBindings } from "./input/keybindings-storage";
import { KeyboardState } from "./input/keyboard";
import { OIDC_CONFIG } from "./net/config";
import { type CharacterReport, connect, type IdentityReport } from "./net/connection";
import {
  exposeAppearanceCompareForE2e,
  exposeCityTimeForE2e,
  exposeCommuterDrawnForE2e,
  exposeIdentityActionsForE2e,
  exposePlayerScreenBoundsForE2e,
  exposeRegionForE2e,
  exposeRemotePlayersForE2e,
  exposeWorldTransformForE2e,
  recordAllBoundTextureSourcesForE2e,
  recordAppearanceTextureIdsForE2e,
  recordCharacterForE2e,
  recordDistinctBoundAtlasPagesForE2e,
  recordFrameWorkForE2e,
  recordHighlightForE2e,
  recordIdentityForE2e,
  recordIgnoredIntentForE2e,
  recordIntentForE2e,
  recordLinkOfferForE2e,
  recordMasksCheckedForE2e,
  recordPingForE2e,
  recordPlayerAppearanceForE2e,
  recordPlayerPositionForE2e,
  recordRegionRowForE2e,
  recordRemotePlayersForE2e,
  recordRemoteSampleForE2e,
  recordRenderOrderForE2e,
  recordViewTransformForE2e,
  recordVisibilityForE2e,
  recordWorldClockForE2e,
  sceneRegionFeed,
} from "./net/e2e-hooks";
import { beginLink, completeLinkWithIdToken, newLinkCode } from "./net/link";
import type { PingObservation } from "./net/observe-ping";
import { type PositionSender, startPositionSender } from "./net/position-sender";
import { PROTOCOL_VERSION } from "./net/protocol-version";
import { cachedChunkKeys, RegionController } from "./net/region-subscription";
import { ZOOM } from "./render/camera";
import { buildLayerRankTable, resolveRank } from "./render/layer-ranks";
import { LAYER_TABLE } from "./render/layer-table";
import { visibleCellBounds } from "./render/screen-position";
import { loadAudioSettings, saveAudioSettings } from "./settings/audio-settings";
import { loadDisplaySettings, saveDisplaySettings } from "./settings/display-settings";
import { resolveStorage as resolveSessionStorage } from "./settings/settings-storage";
import { PLAYER_START } from "./test-street/fixture";
import { placeLinkCarrier } from "./test-street/link-carrier";
import type { RemotePlayersWiring } from "./test-street/remote-players-layer";
import { mountStreetScene, type StreetSceneHandle } from "./test-street/scene";
import { CityClock } from "./time/city-clock";
import { ServerClock } from "./time/server-clock";
import { mountConnectionNotice } from "./ui/connection-notice";
import { mountOptionsMenu } from "./ui/options-menu";
import { loadMovementConfig } from "./world/movement-config";
import { objectDefsById, windowDefIds } from "./world/object-defs";
import { dequantise } from "./world/position-codec";
import { loadPositionConfig, type PositionConfig } from "./world/position-config";
import { handleId } from "./world/region";
import { REMOTE_MAX_SAMPLES, REMOTE_SNAP_CELLS, RemoteMotion } from "./world/remote-motion";

/** Story 1.12: the camera a debug overlay sees before the scene has
 * reported its own. It describes no rectangle, so
 * `visibleCellBounds` yields an empty window rather than guessing -- an
 * overlay drawn against a made-up camera would be drawn in the wrong
 * place, which is worse than not yet drawn. */
const NO_CAMERA_YET = { zoom: 0, offsetX: 0, offsetY: 0 } as const;

/** Story 4.5: the link offer's two touch points with the street scene. */
interface OfferWiring {
  readonly beforeMount: (defs: VerifiedDefs, handshakeSettled: boolean) => Promise<void>;
  readonly onIntent: (intent: Intent) => void;
}

/** Story 4.4: the street scene's touch points with the other players and
 * the position sender. */
interface PlayersWiring {
  /** Once the defs are verified: what the scene draws remote players from,
   * or none when this page draws no remote players. */
  readonly setUp: (defs: Defs) => RemotePlayersWiring | undefined;
  readonly onPlayerMove: (x: number, y: number, floor: number) => void;
  readonly onMounted: () => void;
}

async function main(): Promise<void> {
  // Story 1.14 (NFR1): the bundle term's own end -- module top-level
  // evaluation is already done the moment this line runs, so everything
  // before it is fetch/parse/eval (Resource Timing owns that half) and
  // everything after is the app's own boot work.
  markBoot(BOOT_MARK.MAIN_START);

  // FR151's connection notice -- mounted before `connect()` so `onStatus`'s
  // very first, synchronous "connecting" call always has somewhere to go.
  // Nothing here ever touches the Pixi Application, the scene, its ticker
  // or any pool (story 1.11, Tim's direction): the notice is the
  // disconnect's only consumer, which is what makes "the world keeps
  // rendering its last known state" hold by construction.
  const notice = mountConnectionNotice({ container: document.body });

  function onPing(observation: PingObservation): void {
    recordPingForE2e(observation);
  }

  // Story 2.8 (FR147): `net/connection.ts`'s own callbacks start firing
  // the instant `connect()` returns, well before `startStreetScene`'s own
  // `runBootSequence` has registered anything -- `latch` is the replay
  // buffer that makes that race safe (`boot/handshake-latch.ts`).
  // `onStatus`
  // resolves the latch as unreachable only on the *first* not-connected
  // report and only before it has already settled another way -- a later
  // drop, after the handshake already arrived, is a no-op here (the
  // latch has already settled).
  //
  // Cycle 1 review (Quentin's finding 1 / Tim's finding 3): the handshake
  // does not stop mattering once `latch` has settled -- every later
  // `onHandshake` call (a tab left open across a deploy, or the late
  // arrival after an `unreachable` mount) is also fed to
  // `postMountGuard`, set once `startStreetScene` has something mounted
  // to compare against. Before that, it is `undefined` and the call is a
  // no-op here -- the boot gate's own `latch` is what covers everything
  // up to and including the first settlement.
  let postMountGuard: PostMountGuard | undefined;
  const latch = createHandshakeLatch();
  // Story 4.1: in-city time is derived on demand from the epoch row and a
  // server-reconciled clock (never `Date.now()`); the rate joins once the
  // defs are verified.
  const serverClock = new ServerClock(() => performance.now());
  const cityClock = new CityClock(serverClock);
  // Story 4.5 (FR143): what the link offer is decided from, kept as the
  // connection reports it.
  let latestIdentity: IdentityReport | null = null;
  let latestCharacter: CharacterReport | null = null;
  let latestClock: { epochMicros: bigint; speed: number } | null = null;
  const identityStorage = resolveSessionStorage(() => window.localStorage);
  exposeCityTimeForE2e(() => cityClock.now());
  // Story 4.3: the interest region. It holds nothing until the defs give
  // it a floor range and the scene gives it a position.
  const region = new RegionController();
  // Story 4.4 (FR138): the other players. A DEV build draws none unless the
  // page asks (`?remotePlayers`), so a spec's pixels never depend on whoever
  // else is in the shared instance; a production build always does.
  const remotePlayersOn =
    !import.meta.env.DEV || new URLSearchParams(window.location.search).has("remotePlayers");
  let positionConfig: PositionConfig | undefined;
  let motion: RemoteMotion | undefined;
  let playerPosition: { x: number; y: number; floor: number } | undefined;
  let sceneMounted = false;
  let positionSender: PositionSender | undefined;
  // The sender starts once the caller has a character and the scene a
  // position; never before, and only once per page. Its first send is the
  // scene's own position, which overwrites the durable row: the scene must
  // adopt the stored row before this sender starts (story 4.7) the day
  // anything reads that row. It stops for good when the connection leaves
  // `connected` (a call on a dead connection is queued by the SDK, unbounded).
  const maybeStartPositionSender = (): void => {
    if (positionSender || !sceneMounted || !latestCharacter || !positionConfig) return;
    positionSender = startPositionSender({
      conn,
      position: () => playerPosition,
      periodMs: positionConfig.periodMs,
      unitsPerCell: positionConfig.unitsPerCell,
    });
  };
  const moveRegion = (x: number, y: number, floor: number): void => region.moveTo(x, y, floor);
  const conn = connect({
    onPing,
    onStatus: (status) => {
      notice.setStatus(status);
      if (status !== "connected") positionSender?.stop();
      if (status === "disconnected") latch.resolveUnreachable();
    },
    onHandshake: (version) => {
      latch.resolveHandshake(version);
      postMountGuard?.onHandshake(version);
    },
    clock: {
      serverClock,
      visibility: document,
      onClock: ({ epochMicros, speed }, kind) => {
        cityClock.setClock(epochMicros, speed);
        latestClock = { epochMicros, speed };
        if (performance.getEntriesByName(BOOT_MARK.CITY_CLOCK_KNOWN).length === 0) {
          markBoot(BOOT_MARK.CITY_CLOCK_KNOWN);
        }
        recordWorldClockForE2e(epochMicros, kind);
      },
    },
    storage: identityStorage,
    onIdentity: (identity) => {
      latestIdentity = identity;
      recordIdentityForE2e(identity);
    },
    onCharacter: (character) => {
      latestCharacter = character;
      recordCharacterForE2e(character);
      maybeStartPositionSender();
    },
    region: {
      controller: region,
      rows: {
        onInsert: (table, row) => recordRegionRowForE2e("inserts", table, row),
        onUpdate: (table, _old, row) => recordRegionRowForE2e("updates", table, row),
        onDelete: (table, row) => recordRegionRowForE2e("deletes", table, row),
      },
      remotePlayers: remotePlayersOn,
      players: {
        onUpsert: (row) => {
          const p = positionConfig;
          if (!motion || !p) return;
          const at = dequantise(row, p.unitsPerCell);
          motion.upsert(row.characterId, { tMs: row.tMs, ...at });
          recordRemoteSampleForE2e(row.characterId, { tMs: row.tMs, x: at.x, y: at.y });
        },
        onRemove: (id) => motion?.remove(id),
      },
    },
  });
  exposeRegionForE2e({
    held: () => region.subscriptions()?.heldKeys().map(handleId) ?? [],
    liveHandles: () => region.subscriptions()?.liveHandleCount() ?? 0,
    applied: () => region.subscriptions()?.appliedKeys().map(handleId) ?? [],
    cachedChunkKeys: (table) => cachedChunkKeys(conn, table),
    moveTo: moveRegion,
  });

  // Story 4.5 (FR143): linking. The OIDC library is a dynamic import,
  // reached only when a link starts or the page boots back from the
  // provider; a boot with nothing pending loads none of it.
  const redirectUri = `${window.location.origin}${window.location.pathname}`;
  const loadLinkFlow = () => import("./identity/link-flow");
  void resumeLinkIfPending({
    config: OIDC_CONFIG,
    search: window.location.search,
    href: window.location.href,
    redirectUri,
    loadFlow: loadLinkFlow,
    completeLink: completeLinkWithIdToken,
    replaceUrl: (url) => window.history.replaceState(null, "", url),
  });
  exposeIdentityActionsForE2e({
    // The guard sits on the create path itself: nothing creates a character
    // for an identity whose token could not be kept.
    createCharacter: guardedCreateCharacter(
      () => latestIdentity?.persisted === true,
      () => conn.reducers.createCharacter({}),
    ),
    startLink: () =>
      offerLink({
        config: OIDC_CONFIG,
        redirectUri,
        loadFlow: loadLinkFlow,
        newCode: newLinkCode,
        beginLink: (code) => beginLink(conn, code),
      }),
  });

  const startOffer = () =>
    offerLink({
      config: OIDC_CONFIG,
      redirectUri,
      loadFlow: loadLinkFlow,
      newCode: newLinkCode,
      beginLink: (code) => beginLink(conn, code),
    });
  let carrierDef: number | undefined;
  // Evaluated once per session, as the scene is about to mount, never
  // mid-session. Showing the offer records the city day, so declining is
  // simply not taking it.
  const offer: OfferWiring = {
    beforeMount: async (defs, handshakeSettled) => {
      const carrier = carrierDefId(defs);
      if (carrier === undefined || OIDC_CONFIG === null) {
        recordLinkOfferForE2e(false);
        return;
      }
      let shownOn: number | undefined;
      const due = await decideOffer({
        hasCarrier: true,
        configured: true,
        handshakeSettled,
        today: () => cityClock.now()?.day,
        firstClockSample: serverClock.whenSampled(),
        timeout: () => new Promise((resolve) => setTimeout(resolve, DEFAULT_HANDSHAKE_TIMEOUT_MS)),
        due: (today) => {
          shownOn = today;
          return offerDue({
            character: latestCharacter,
            identity: latestIdentity,
            configured: true,
            clock: latestClock,
            realMsPerCityMinute: defs.realMsPerCityMinute,
            today,
            lastShownDay: loadLastShownDay(identityStorage),
            rules: readOfferRules(defs),
          });
        },
      });
      if (due && shownOn !== undefined) {
        placeLinkCarrier(carrier);
        carrierDef = carrier;
        saveLastShownDay(identityStorage, shownOn);
      }
      recordLinkOfferForE2e(due);
    },
    onIntent: (intent) => {
      if (carrierDef === undefined || intent.defId !== carrierDef) return;
      startOffer().catch((error: unknown) => {
        console.error("[identity] the link offer could not start", error);
      });
    },
  };

  try {
    await startStreetScene(
      latch,
      () => notice.setStatus("updating"),
      (guard) => {
        postMountGuard = guard;
      },
      (rate) => cityClock.setRate(rate),
      () => cityClock.nowMilliminutes(),
      offer,
      region,
      sceneRegionFeed(moveRegion),
      {
        setUp: (defs) => {
          positionConfig = loadPositionConfig(defs);
          motion = new RemoteMotion({
            periodMs: positionConfig.periodMs,
            delayMs: positionConfig.delayMs,
            snapCells: REMOTE_SNAP_CELLS,
            maxSamples: REMOTE_MAX_SAMPLES,
          });
          if (!remotePlayersOn) return undefined;
          return {
            motion,
            serverNowMs: () => {
              const micros = serverClock.nowMicros();
              return micros === undefined ? undefined : Number(micros / 1000n);
            },
            skip: () => latestCharacter?.characterId.toString(),
            onFrame: import.meta.env.DEV ? recordRemotePlayersForE2e : undefined,
          };
        },
        onPlayerMove: (x, y, floor) => {
          playerPosition = { x, y, floor };
        },
        onMounted: () => {
          sceneMounted = true;
          maybeStartPositionSender();
        },
      },
    );
  } catch (error: unknown) {
    // NFR42: the street scene degrades to not-drawing, never takes the ping
    // round trip down with it.
    console.error("[main] street scene failed to start", error);
  }
}

/**
 * The street scene: the page's one and only Pixi `Application` (Tim's
 * direction, story 1.13). Never blocks `main()` on failure (NFR42) -- a
 * broken street mount must never take the ping round trip down with it.
 *
 * The rank table comes from `render/layer-table.ts` -- the one
 * client-side mirror of `sim::codes::layer`, guarded against drift by
 * `scripts/ci/check-layer-table-current.sh` -- never a second
 * hand-maintained copy here. There is still no live `layer_code`
 * subscription in this story (Tim's scope call); wiring one is later
 * work.
 *
 * Story 2.8 (FR147): the scene is never mounted before `runBootSequence`
 * resolves a `VerifiedDefs` -- "never draws a stale frame" is structural
 * (`test-street/scene.ts`'s own `MountStreetSceneOptions.defs` type), not
 * a convention. `connect()` and the first, unversioned `fetchDefs` still
 * start in parallel exactly as before (`latch` is what `connect()`
 * already started feeding by the time this runs).
 *
 * Cycle 2 review (Quentin's finding 1): `setPostMountGuard` is called the
 * instant `runBootSequence` resolves, with no `await` in between -- in
 * particular, *before* `Application.init()`'s own await, which used to
 * leave a real async gap where a handshake landed nowhere. Pixi's own
 * init still runs concurrently with the boot sequence (only the scene
 * mount itself waits on it), it is just no longer between the sequence
 * resolving and the guard being wired.
 *
 * Cycle 3 review (Quentin's and Tim's converging findings): `app.init()`'s
 * own promise is also passed *into* `runBootSequence` (as
 * `appInitPromise`), which awaits it internally and replays the
 * handshake a second time once it resolves -- a version that changes
 * while WebGPU adapter/device creation is still in flight is caught
 * there, before a renderer exists to stop, rather than mounting the
 * scene anyway once `Application.init()` finally does resolve. `app.
 * ticker` does not exist until then either, so `stopDrawing` is
 * null-safe.
 */
async function startStreetScene(
  latch: HandshakeLatch,
  onDegrade: () => void,
  setPostMountGuard: (guard: PostMountGuard) => void,
  setCityRate: (realMsPerCityMinute: number) => void,
  cityMilliminutes: () => number | undefined,
  offer: OfferWiring,
  region: RegionController,
  followScene: (x: number, y: number, floor: number) => void,
  players: PlayersWiring,
): Promise<void> {
  const mount = document.getElementById("test-street");
  if (!mount) {
    console.error("[main] #test-street is missing from index.html");
    return;
  }

  const app = new Application();
  // The camera/viewport story (Quentin's direction): the renderer's own
  // size is the window's, always -- Pixi's own `ResizePlugin` is what
  // owns this (`resizeTo: window`), applied once, synchronously, right
  // here, and again only from its own `window` `resize` listener (a
  // `requestAnimationFrame`-debounced call to `renderer.resize`, never
  // the ticker). `resolution`/`autoDensity` stay at their defaults (1,
  // `false`): the canvas's own CSS box is exactly `renderer.width x
  // renderer.height`, so a `deviceScaleFactor` above 1 changes nothing
  // about how big the canvas reads in the page.
  const appInitPromise = app.init({
    preference: "webgpu",
    background: "#284028",
    resizeTo: window,
  });

  const sessionStorage = resolveSessionStorage(() => window.sessionStorage);
  const sequenceResult = await runBootSequence({
    fetchDefs,
    // Never a hard-coded leading-slash literal (client/tests/e2e/
    // deploy-smoke.spec.ts caught exactly this: it 404s under GitHub
    // Pages' own /browser-city/ base). `import.meta.env.BASE_URL` is
    // Vite's own base-aware constant -- always the build's `base` value,
    // with a trailing slash, so `/` locally and `/browser-city/` in
    // production resolve to the same relative asset either way.
    defsPath: `${import.meta.env.BASE_URL}defs/defs.json`,
    clientProtocolVersion: PROTOCOL_VERSION,
    handshake: latch,
    readReloadedFor: () => readReloadedFor(sessionStorage),
    writeReloadedFor: (version) => writeReloadedFor(sessionStorage, version),
    // Cycle 3 review: `app.ticker` does not exist until `Application.
    // init()` has run its own `TickerPlugin.init` -- a mismatch found by
    // `runBootSequence`'s first replay (before `appInitPromise` is even
    // awaited) can call this before that. Optional-chained, so it is a
    // safe no-op rather than a `TypeError` either way.
    stopDrawing: () => app.ticker?.stop(),
    reload: () => window.location.reload(),
    onDegrade,
    appInitPromise,
  });
  if (sequenceResult) setPostMountGuard(sequenceResult.guard);

  await appInitPromise;
  mount.appendChild(app.canvas);

  if (!sequenceResult) {
    // NFR42: the sequence already handled the outcome (a reload is under
    // way, or the connection notice now shows "updating") -- nothing left
    // to render this session.
    return;
  }
  const defs: VerifiedDefs = sequenceResult.defs;
  setCityRate(defs.realMsPerCityMinute);
  // Story 4.5 (FR143): decided once, as the scene is about to mount.
  // The gate's own outcome: a handshake arrived, or the server was unreachable
  // and the fetched defs are mounted as they are.
  await offer.beforeMount(defs, latch.latest() !== undefined);
  // Story 4.3: the floor range is the defs', and the scene's spawn is where
  // the initial region is requested around; from here on the scene's own
  // position drives it (`onPlayerMove`), edge-triggered.
  const remotePlayers = players.setUp(defs);
  region.configure({ minFloor: defs.minFloor, maxFloor: defs.maxFloor });
  followScene(PLAYER_START.x, PLAYER_START.y, PLAYER_START.floor);

  const tileSizePx = getBalance(defs, "render.tile_size_px");
  const storeyHeightPx = getBalance(defs, "render.storey_height_px");
  // Story 1.7 (FR121): `render.window_alpha` is a percent integer (1-99,
  // an `i64` balance key cannot carry a fraction), divided down to the
  // plain `(0, 1)` fraction `render/pixi-visibility.ts` applies as
  // `sprite.alpha` -- never a literal window alpha anywhere in this
  // client.
  const windowAlpha = getBalance(defs, "render.window_alpha") / 100;
  // FR173: `render.highlight_alpha` is the same idiom -- a percent integer
  // divided down to a plain `(0, 1)` fraction, threaded into the scene as
  // the ceiling `render/highlight.ts`'s `highlightOverlayAlpha` scales by
  // the U1 display-strength dial. Never a literal in `render/highlight.ts`.
  const highlightAlpha = getBalance(defs, "render.highlight_alpha") / 100;
  const movementConfig = loadMovementConfig(defs);

  const rankTable = buildLayerRankTable(LAYER_TABLE.map(({ code, rank }) => ({ code, rank })));

  // FR149: the player's own bindings, or the defaults if storage is
  // empty, blocked or unreadable -- never an error the player has to see
  // or a game that will not start. Read exactly once, so the keyboard and
  // the menu can never start out disagreeing about what is bound. Audio
  // and Display settings are read the same way, once, through the same
  // injected `Storage` (`settings/settings-storage.ts`'s shared idiom).
  const storage = resolveStorage(() => window.localStorage);
  const bindings = loadBindings(storage);
  const audio = loadAudioSettings(storage);
  const display = loadDisplaySettings(storage);
  const keyboard = new KeyboardState(bindings);

  // Set once the street scene below finishes mounting -- `onDisplayChange`
  // can fire before then (the menu is interactive immediately), so a
  // change that arrives first is still persisted, just not pushed live
  // until the scene handle exists (it reads the persisted value as its
  // own initial `highlightStrength` either way).
  let sceneHandle: StreetSceneHandle | undefined;

  // FR151's options menu. It takes the keyboard while it is open, so a
  // key pressed to rebind never also walks the avatar; the world behind
  // it keeps running, because the city never pauses.
  mountOptionsMenu({
    container: document.body,
    initialBindings: bindings,
    onBindingsChange: (bindings) => {
      keyboard.setBindings(bindings);
      saveBindings(storage, bindings);
    },
    onOpenChange: (open) => {
      if (open) {
        keyboard.suspend();
        // Derek's direction: the menu opening does not make the pointer's
        // own position or the player's own reach any less true -- an
        // already-lit prop stays lit under the backdrop (the menu is a
        // DOM panel drawn over the canvas, so a stationary mouse never
        // fires `pointerleave` on it). Suspending only ignores *new*
        // pointer events -- no new hovers, no clicks -- until the menu
        // closes.
        sceneHandle?.suspendPointer();
      } else {
        keyboard.resume();
        sceneHandle?.resumePointer();
      }
    },
    initialAudio: audio,
    onAudioChange: (next) => saveAudioSettings(storage, next),
    initialDisplay: display,
    onDisplayChange: (next) => {
      saveDisplaySettings(storage, next);
      sceneHandle?.setHighlightStrength(next.highlightStrength);
    },
    // Derek's direction: a drag of the highlight slider is visible as a
    // drag, live, before it commits -- never persisted by a preview alone.
    onDisplayPreview: (next) => sceneHandle?.setHighlightStrength(next.highlightStrength),
  });

  // DEV-only, like every other `window.__bc`-adjacent test aid: a
  // `toHaveScreenshot` check needs the street crowd's own walk cycle to
  // never advance, or which frame of which citizen's animation happens to
  // be on screen would depend on real wall-clock timing and no baseline
  // could ever be stable (`test-street.spec.ts`'s own header). Absent
  // means the crowd walks normally, exactly as it always has.
  const freezeCrowdForE2e =
    import.meta.env.DEV && new URLSearchParams(window.location.search).has("freezeCrowd");

  // Story 2.7 (Quentin's direction): `appearance.spec.ts`'s own
  // "different people cost about as much as identical ones" comparison
  // mounts this same page twice, once with the crowd's own normal
  // distinct tuples and once with this flag set, and compares
  // `allBoundTextureSources` (and, as a secondary check, the atlas-page
  // count `distinctBoundAtlasPages`) -- never a second crowd fixture
  // module.
  const identicalCrowdForE2e =
    import.meta.env.DEV && new URLSearchParams(window.location.search).has("identicalCrowd");

  // Story 1.12 (FR165/FR168): set only inside the DEV branch below, and
  // only after the scene has mounted. Every callback that notifies it is
  // a no-op until then, and in a production build there is nothing for it
  // ever to hold.
  let debugOverlays:
    | { setViewTransform(z: number, x: number, y: number): void; redraw(): void }
    | undefined;
  let lastViewTransform: { zoom: number; offsetX: number; offsetY: number } | undefined;
  let lastPlayerCell = "";

  // The render path's own resort event drives this hook directly
  // (Quentin's direction) -- never a ticker polling `getRenderOrder()`
  // every frame to see whether it changed.
  const handle = await mountStreetScene(app, {
    defs,
    atlasBaseUrl: `${import.meta.env.BASE_URL}atlas/`,
    tileSizePx,
    storeyHeightPx,
    rankOf: (code) => resolveRank(rankTable, code),
    windowAlpha,
    highlightAlpha,
    movementConfig,
    objectDefs: objectDefsById(defs),
    windowDefIds: windowDefIds(defs),
    startWithCrowdFrozen: freezeCrowdForE2e,
    cityMilliminutes,
    crowdIdenticalTuples: identicalCrowdForE2e,
    highlightStrength: display.highlightStrength,
    onOrderChange: (order) => {
      recordRenderOrderForE2e(order);
      debugOverlays?.redraw();
    },
    remotePlayers,
    onPlayerMove: (x, y, floor) => {
      recordPlayerPositionForE2e(x, y, floor);
      players.onPlayerMove(x, y, floor);
      followScene(x, y, floor);
      // Story 1.12: `onPlayerMove` is the one callback here that really
      // does fire every frame, so the overlays are redrawn on the *cell*
      // or floor actually changing -- what moves the viewport or the
      // viewer's own floor -- and never on the per-frame path. The
      // player's own continuously-changing sort key is covered by
      // `onOrderChange` above, which the scene fires exactly when that
      // key changes.
      const cell = `${Math.floor(x)},${Math.floor(y)},${floor}`;
      if (cell === lastPlayerCell) return;
      lastPlayerCell = cell;
      debugOverlays?.redraw();
    },
    onFrameWork: recordFrameWorkForE2e,
    onVisibilityChange: recordVisibilityForE2e,
    onMasksChecked: recordMasksCheckedForE2e,
    keyboard,
    // FR148: the intent sink. Nothing consumes an intent yet -- the
    // procedure interaction model is Epic 8's, deliberately unresolved --
    // so the only consumer today is the e2e observation hook. Swapping
    // this function is the whole of what Epic 8 has to do here.
    onIntent: (intent) => {
      recordIntentForE2e(intent);
      offer.onIntent(intent);
    },
    onIgnored: recordIgnoredIntentForE2e,
    onViewTransform: (zoom, offsetX, offsetY) => {
      recordViewTransformForE2e(zoom, offsetX, offsetY);
      lastViewTransform = { zoom, offsetX, offsetY };
      debugOverlays?.setViewTransform(zoom, offsetX, offsetY);
    },
    // Cycle 2 (Quentin's direction, finding 2): exposed the instant
    // `world` exists inside `mountStreetScene`, not once its own promise
    // resolves -- `window.__bc.worldTransform` must be observable for
    // every frame of the load, the same way `onViewTransform` above is
    // meant to be, not only after every asset has already loaded.
    onWorldReady: (worldTransform) => exposeWorldTransformForE2e(worldTransform),
    onHighlightChange: recordHighlightForE2e,
  });
  sceneHandle = handle;
  players.onMounted();
  exposeRemotePlayersForE2e();

  // Story 1.10: the street crowd's own e2e observation surface, wired
  // here rather than threaded through `MountStreetSceneOptions` as another
  // callback -- both values are already sitting on the real, mounted
  // handle `mountStreetScene` just returned, with nothing left to compute.
  recordAppearanceTextureIdsForE2e(
    handle.citizensLayer.textureIdsById,
    handle.citizensLayer.distinctTextureCount,
  );
  exposeAppearanceCompareForE2e(handle.citizensLayer.compareForE2e);
  recordPlayerAppearanceForE2e(handle.playerAppearance);
  recordDistinctBoundAtlasPagesForE2e(handle.distinctBoundAtlasPages);
  recordAllBoundTextureSourcesForE2e(handle.allBoundTextureSources);
  exposePlayerScreenBoundsForE2e(handle.playerScreenBounds);
  exposeCommuterDrawnForE2e(handle.commuterDrawn);

  // Story 1.12 (FR165/FR168): the whole of the debug tooling's gate, and
  // the only import of `client/src/debug/` that exists (enforced by
  // `client/biome.json`'s override and
  // `scripts/ci/check-debug-boundary.sh`).
  //
  // A dynamic import inside a branch Vite statically evaluates to `false`
  // is one Rollup never emits a chunk for: a production build does not
  // contain the overlays switched off, it does not contain them at all,
  // so there is no code for any input, query string or console call to
  // activate (AC1). `ci.yml`'s `client-build` job greps the real built
  // assets for the debug sentinels to keep that true.
  if (import.meta.env.DEV) {
    const { mountDebugOverlays } = await import("./debug/overlays");
    const view: DebugWorldView = {
      tileSizePx,
      zoom: ZOOM,
      storeyHeightPx,
      colliderSubcellsPerCell: movementConfig.subcellsPerCell,
      viewerFloor: () => handle.currentFloor(),
      // The camera the scene itself reported (`onViewTransform`), never a
      // container's scale read back off the Pixi display list; the
      // projection is `render/screen-position.ts`'s, never restated here.
      viewportCells: () =>
        visibleCellBounds(
          app.renderer.width,
          app.renderer.height,
          lastViewTransform ?? NO_CAMERA_YET,
          handle.currentFloor(),
          tileSizePx,
          storeyHeightPx,
        ),
      entriesInCell: (floor, cellX, cellY) => handle.collidersInCell(floor, cellX, cellY),
      objects: (bounds) => handle.worldObjects(bounds),
      pool: () => handle.poolDrawables(),
      orderOf: (stableId) => handle.orderIndexOf(stableId),
      viewerBody: () => handle.playerBody(),
      l3Bodies: () => handle.l3Bodies(),
    };
    debugOverlays = mountDebugOverlays({
      mount,
      // Read on every redraw, never captured: a resize must not leave
      // the overlay projecting into a box the scene no longer draws in.
      rendererSize: () => ({ width: app.renderer.width, height: app.renderer.height }),
      view,
      search: window.location.search,
      exposeOn: window,
    });
    if (lastViewTransform) {
      const { zoom, offsetX, offsetY } = lastViewTransform;
      debugOverlays.setViewTransform(zoom, offsetX, offsetY);
    }
  }
}

function getBalance(defs: Defs, key: string): number {
  const entry = defs.balance.find((b) => b.key === key);
  if (!entry) throw new Error(`getBalance: no balance entry for '${key}'`);
  return entry.value;
}

main().catch((error: unknown) => {
  console.error("[main] failed to start", error);
});
