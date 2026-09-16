import { Application } from "pixi.js";
import { BOOT_MARK, markBoot } from "./boot/boot-marks";
import type { DebugWorldView } from "./debug/world-view";
import { fetchDefs } from "./defs/load";
import type { Defs } from "./defs/types";
import { loadBindings, resolveStorage, saveBindings } from "./input/keybindings-storage";
import { KeyboardState } from "./input/keyboard";
import { connect } from "./net/connection";
import {
  exposeAppearanceCompareForE2e,
  recordAppearanceTextureIdsForE2e,
  recordFrameWorkForE2e,
  recordHighlightForE2e,
  recordIgnoredIntentForE2e,
  recordIntentForE2e,
  recordMasksCheckedForE2e,
  recordPingForE2e,
  recordPlayerAppearanceForE2e,
  recordPlayerPositionForE2e,
  recordRenderOrderForE2e,
  recordViewTransformForE2e,
  recordVisibilityForE2e,
} from "./net/e2e-hooks";
import type { PingObservation } from "./net/observe-ping";
import { buildLayerRankTable, resolveRank } from "./render/layer-ranks";
import { LAYER_TABLE } from "./render/layer-table";
import { worldCellFromScreenPx } from "./render/screen-position";
import { loadAudioSettings, saveAudioSettings } from "./settings/audio-settings";
import { loadDisplaySettings, saveDisplaySettings } from "./settings/display-settings";
import { mountStreetScene, type StreetSceneHandle } from "./test-street/scene";
import { mountConnectionNotice } from "./ui/connection-notice";
import { mountOptionsMenu } from "./ui/options-menu";
import { loadMovementConfig } from "./world/movement-config";
import { objectDefsById, windowDefIds } from "./world/object-defs";
import type { CellBounds } from "./world/world-index";

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

  connect(onPing, (status) => notice.setStatus(status));

  try {
    await startStreetScene();
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
 */
async function startStreetScene(): Promise<void> {
  const mount = document.getElementById("test-street");
  if (!mount) {
    console.error("[main] #test-street is missing from index.html");
    return;
  }

  // Never a hard-coded leading-slash literal (client/tests/e2e/
  // deploy-smoke.spec.ts caught exactly this: it 404s under GitHub
  // Pages' own /browser-city/ base). `import.meta.env.BASE_URL` is
  // Vite's own base-aware constant -- always the build's `base` value,
  // with a trailing slash, so `/` locally and `/browser-city/` in
  // production resolve to the same relative asset either way.
  const defs = await fetchDefs(`${import.meta.env.BASE_URL}defs/defs.json`);
  const tileSizePx = getBalance(defs, "render.tile_size_px");
  const storeyHeightPx = getBalance(defs, "render.storey_height_px");
  // Story 1.7 (FR121): `render.window_alpha` is a percent integer (1-99,
  // an `i64` balance key cannot carry a fraction), divided down to the
  // plain `(0, 1)` fraction `render/pixi-visibility.ts` applies as
  // `sprite.alpha` -- never a literal window alpha anywhere in this
  // client.
  const windowAlpha = getBalance(defs, "render.window_alpha") / 100;
  const movementConfig = loadMovementConfig(defs);

  const rankTable = buildLayerRankTable(LAYER_TABLE.map(({ code, rank }) => ({ code, rank })));

  const app = new Application();
  await app.init({ preference: "webgpu", background: "#284028" });
  mount.appendChild(app.canvas);

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
      if (open) keyboard.suspend();
      else keyboard.resume();
    },
    initialAudio: audio,
    onAudioChange: (next) => saveAudioSettings(storage, next),
    initialDisplay: display,
    onDisplayChange: (next) => {
      saveDisplaySettings(storage, next);
      sceneHandle?.setHighlightStrength(next.highlightStrength);
    },
  });

  // DEV-only, like every other `window.__bc`-adjacent test aid: a
  // `toHaveScreenshot` check needs the street crowd's own walk cycle to
  // never advance, or which frame of which citizen's animation happens to
  // be on screen would depend on real wall-clock timing and no baseline
  // could ever be stable (`test-street.spec.ts`'s own header). Absent
  // means the crowd walks normally, exactly as it always has.
  const freezeCrowdForE2e =
    import.meta.env.DEV && new URLSearchParams(window.location.search).has("freezeCrowd");

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
    tileSizePx,
    storeyHeightPx,
    rankOf: (code) => resolveRank(rankTable, code),
    windowAlpha,
    movementConfig,
    objectDefs: objectDefsById(defs),
    windowDefIds: windowDefIds(defs),
    startWithCrowdFrozen: freezeCrowdForE2e,
    highlightStrength: display.highlightStrength,
    onOrderChange: (order) => {
      recordRenderOrderForE2e(order);
      debugOverlays?.redraw();
    },
    onPlayerMove: (x, y, floor) => {
      recordPlayerPositionForE2e(x, y, floor);
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
    onIntent: recordIntentForE2e,
    onIgnored: recordIgnoredIntentForE2e,
    onViewTransform: (zoom, offsetX, offsetY) => {
      recordViewTransformForE2e(zoom, offsetX, offsetY);
      lastViewTransform = { zoom, offsetX, offsetY };
      debugOverlays?.setViewTransform(zoom, offsetX, offsetY);
    },
    onHighlightChange: recordHighlightForE2e,
  });
  sceneHandle = handle;

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
      storeyHeightPx,
      colliderSubcellsPerCell: movementConfig.subcellsPerCell,
      viewerFloor: () => handle.currentFloor(),
      viewportCells: () =>
        visibleCells(
          app.renderer.width,
          app.renderer.height,
          lastViewTransform ?? { zoom: 1, offsetX: 0, offsetY: 0 },
          handle.currentFloor(),
          tileSizePx,
          storeyHeightPx,
        ),
      entriesInCell: (floor, cellX, cellY) => handle.collidersInCell(floor, cellX, cellY),
      objects: (bounds) => handle.worldObjects(bounds),
      pool: () => handle.poolDrawables(),
      orderOf: (stableId) => handle.orderIndexOf(stableId),
    };
    debugOverlays = mountDebugOverlays({
      mount,
      viewBoxWidth: app.renderer.width,
      viewBoxHeight: app.renderer.height,
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

/**
 * Story 1.12: the cells currently on screen, on `floor` -- the window
 * every debug overlay's cost is bounded by.
 *
 * Built from the camera the scene *reported* (`onViewTransform`) and
 * `render/screen-position.ts`'s own inverse projection, never by reaching
 * into the Pixi display list for a container's scale: the debug side
 * consumes the scene's own declared events, exactly as the overlays
 * consume `DebugWorldView` rather than the street.
 */
function visibleCells(
  rendererWidth: number,
  rendererHeight: number,
  camera: { readonly zoom: number; readonly offsetX: number; readonly offsetY: number },
  floor: number,
  tileSizePx: number,
  storeyHeightPx: number,
): CellBounds {
  const { zoom, offsetX, offsetY } = camera;
  const topLeft = worldCellFromScreenPx(
    -offsetX / zoom,
    -offsetY / zoom,
    floor,
    tileSizePx,
    storeyHeightPx,
  );
  const bottomRight = worldCellFromScreenPx(
    (rendererWidth - offsetX) / zoom,
    (rendererHeight - offsetY) / zoom,
    floor,
    tileSizePx,
    storeyHeightPx,
  );
  return {
    floor,
    cellX0: topLeft.cellX,
    cellY0: topLeft.cellY,
    cellX1: bottomRight.cellX,
    cellY1: bottomRight.cellY,
  };
}

function getBalance(defs: Defs, key: string): number {
  const entry = defs.balance.find((b) => b.key === key);
  if (!entry) throw new Error(`getBalance: no balance entry for '${key}'`);
  return entry.value;
}

main().catch((error: unknown) => {
  console.error("[main] failed to start", error);
});
