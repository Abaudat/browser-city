import { Application } from "pixi.js";
import { fetchDefs } from "./defs/load";
import type { Defs } from "./defs/types";
import { connect } from "./net/connection";
import { recordPingForE2e, recordRenderOrderForE2e } from "./net/e2e-hooks";
import type { PingObservation } from "./net/observe-ping";
import { buildLayerRankTable, resolveRank } from "./render/layer-ranks";
import { mountDemoScene } from "./render/pixi-scene";
import { bootstrapRenderer } from "./render/bootstrap";

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
 * The layer ranks below mirror `server/sim/tests/goldens/codes_v1.golden`
 * exactly (never a second hand-maintained *value*, only a second
 * hand-maintained transport: this story defines no `layer_code`
 * subscription wiring, so the demo's own rank source is this fixed table,
 * the same one `client/tests/unit/render/demo-scene.test.ts` uses --
 * still resolved through `layer-ranks.ts`, never inlined into the sort
 * key). Wiring this scene to a live subscription is later work.
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

  const rankTable = buildLayerRankTable([
    { code: 0, rank: 0 },
    { code: 1, rank: 1 },
    { code: 2, rank: 10 },
    { code: 3, rank: 20 },
    { code: 4, rank: 30 },
    { code: 5, rank: 40 },
    { code: 6, rank: 50 },
  ]);

  const app = new Application();
  await app.init({ preference: "webgpu", background: "#284028", width: 480, height: 360 });
  mount.appendChild(app.canvas);

  const scene = await mountDemoScene(app, {
    tileSizePx,
    storeyHeightPx,
    rankOf: (code) => resolveRank(rankTable, code),
  });

  recordRenderOrderForE2e(scene.getRenderOrder());
  let lastRecorded = scene.getRenderOrder();
  app.ticker.add(() => {
    const order = scene.getRenderOrder();
    if (order.length !== lastRecorded.length || order.some((id, i) => id !== lastRecorded[i])) {
      lastRecorded = order;
      recordRenderOrderForE2e(order);
    }
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
