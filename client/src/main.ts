import { Application } from "pixi.js";
import { fetchDefs } from "./defs/load";
import type { Defs } from "./defs/types";
import { mountDemoScene } from "./demo/scene";
import { connect } from "./net/connection";
import { recordPingForE2e, recordRenderOrderForE2e } from "./net/e2e-hooks";
import type { PingObservation } from "./net/observe-ping";
import { bootstrapRenderer } from "./render/bootstrap";
import { buildLayerRankTable, resolveRank } from "./render/layer-ranks";
import { LAYER_TABLE } from "./render/layer-table";

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
    await startDemoScene();
  } catch (error: unknown) {
    // NFR42: the demo scene degrades to not-drawing, never takes the ping
    // round trip down with it.
    console.error("[main] demo scene failed to start", error);
  }
}

/**
 * Story 1.6's demo scene: a second, independent Pixi application from the
 * ping demo above. Never blocks `main()` on failure (NFR42) -- a broken
 * demo mount must never take the ping round trip down with it.
 *
 * The rank table comes from `render/layer-table.ts` -- the one
 * client-side mirror of `sim::codes::layer`, guarded against drift by
 * `scripts/ci/check-layer-table-current.sh` -- never a second
 * hand-maintained copy here. There is still no live `layer_code`
 * subscription in this story (Tim's scope call); wiring one is later
 * work.
 */
async function startDemoScene(): Promise<void> {
  const mount = document.getElementById("demo-scene");
  if (!mount) {
    console.error("[main] #demo-scene is missing from index.html");
    return;
  }

  const defs = await fetchDefs("/defs/defs.json");
  const tileSizePx = getBalance(defs, "render.tile_size_px");
  const storeyHeightPx = getBalance(defs, "render.storey_height_px");

  const rankTable = buildLayerRankTable(LAYER_TABLE.map(({ code, rank }) => ({ code, rank })));

  const app = new Application();
  await app.init({ preference: "webgpu", background: "#284028" });
  mount.appendChild(app.canvas);

  // The render path's own resort event drives this hook directly
  // (Quentin's direction) -- never a ticker polling `getRenderOrder()`
  // every frame to see whether it changed.
  await mountDemoScene(app, {
    tileSizePx,
    storeyHeightPx,
    rankOf: (code) => resolveRank(rankTable, code),
    onOrderChange: recordRenderOrderForE2e,
  });
}

function getBalance(defs: Defs, key: string): number {
  const entry = defs.balance.find((b) => b.key === key);
  if (!entry) throw new Error(`getBalance: no balance entry for '${key}'`);
  return entry.value;
}

main().catch((error: unknown) => {
  console.error("[main] failed to start", error);
});
