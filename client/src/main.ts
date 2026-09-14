import { Application } from "pixi.js";
import { fetchDefs } from "./defs/load";
import type { Defs } from "./defs/types";
import { mountStreetScene } from "./test-street/scene";
import { loadBindings, resolveStorage, saveBindings } from "./input/keybindings-storage";
import { KeyboardState } from "./input/keyboard";
import { connect } from "./net/connection";
import {
  exposeAppearanceCompareForE2e,
  recordAppearanceTextureIdsForE2e,
  recordHighlightForE2e,
  recordIgnoredIntentForE2e,
  recordIntentForE2e,
  recordMasksCheckedForE2e,
  recordFrameWorkForE2e,
  recordPingForE2e,
  recordPlayerAppearanceForE2e,
  recordPlayerPositionForE2e,
  recordRenderOrderForE2e,
  recordViewTransformForE2e,
  recordVisibilityForE2e,
} from "./net/e2e-hooks";
import type { PingObservation } from "./net/observe-ping";
import { bootstrapRenderer } from "./render/bootstrap";
import { buildLayerRankTable, resolveRank } from "./render/layer-ranks";
import { LAYER_TABLE } from "./render/layer-table";
import { mountOptionsMenu } from "./ui/options-menu";
import { loadMovementConfig } from "./world/movement-config";
import { objectDefsById, windowDefIds } from "./world/object-defs";

async function main(): Promise<void> {
  const mount = document.getElementById("app");
  if (!mount) {
    // NFR42: degrade to not-drawing, never crash.
    console.error("[main] #app is missing from index.html");
    return;
  }

  const renderer = await bootstrapRenderer(mount);

  function onPing(observation: PingObservation): void {
    renderer.showPing(observation);
    recordPingForE2e(observation);
  }

  connect(onPing);

  try {
    await startStreetScene();
  } catch (error: unknown) {
    // NFR42: the street scene degrades to not-drawing, never takes the ping
    // round trip down with it.
    console.error("[main] street scene failed to start", error);
  }
}

/**
 * Story 1.6's street scene: a second, independent Pixi application from the
 * ping demo above. Never blocks `main()` on failure (NFR42) -- a broken
 * street mount must never take the ping round trip down with it.
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

  const defs = await fetchDefs("/defs/defs.json");
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
  // the menu can never start out disagreeing about what is bound.
  const storage = resolveStorage(() => window.localStorage);
  const bindings = loadBindings(storage);
  const keyboard = new KeyboardState(bindings);

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
  });

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
    onOrderChange: recordRenderOrderForE2e,
    onPlayerMove: recordPlayerPositionForE2e,
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
    onViewTransform: recordViewTransformForE2e,
    onHighlightChange: recordHighlightForE2e,
  });

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
}

function getBalance(defs: Defs, key: string): number {
  const entry = defs.balance.find((b) => b.key === key);
  if (!entry) throw new Error(`getBalance: no balance entry for '${key}'`);
  return entry.value;
}

main().catch((error: unknown) => {
  console.error("[main] failed to start", error);
});
