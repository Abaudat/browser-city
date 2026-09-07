// Test-only observation surface for client/tests/e2e/round-trip.spec.ts
// (Quentin, story 1.1). Guarded by `import.meta.env.DEV`, a flag Vite
// inlines statically and dead-code-eliminates from a production build, so
// `window.__bc` never ships. Exists so the e2e spec reads page state
// instead of scraping console output.

import type { PingObservation } from "./observe-ping";

declare global {
  interface Window {
    __bc?: { pings: PingObservation[] };
  }
}

export function recordPingForE2e(observation: PingObservation): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.pings.push(observation);
  window.__bc = bucket;
}
