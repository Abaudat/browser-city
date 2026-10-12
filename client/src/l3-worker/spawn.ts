// Starts the L3 worker: Vite's native module-worker form, so the build emits
// the worker as its own chunk with no dependency.

import type { FromWorker, Port, ToWorker } from "./protocol";

export function spawnL3Worker(): Port<FromWorker, ToWorker> {
  return new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as Port<FromWorker, ToWorker>;
}
