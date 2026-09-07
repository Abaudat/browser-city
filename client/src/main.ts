import { connect } from "./net/connection";
import { recordPingForE2e } from "./net/e2e-hooks";
import type { PingObservation } from "./net/observe-ping";
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
}

main().catch((error: unknown) => {
  console.error("[main] failed to start", error);
});
