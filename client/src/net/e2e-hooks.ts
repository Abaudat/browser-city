// Test-only observation surface for client/tests/e2e/round-trip.spec.ts
// (Quentin, story 1.1). Guarded by `import.meta.env.DEV`, a flag Vite
// inlines statically and dead-code-eliminates from a production build, so
// `window.__bc` never ships. Exists so the e2e spec reads page state
// instead of scraping console output.

import type { PingObservation } from "./observe-ping";

declare global {
  interface Window {
    __bc?: {
      pings: PingObservation[];
      renderOrder?: string[];
      playerPosition?: { x: number; y: number };
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
 * list (Quentin's direction): the demo scene's current depth order,
 * `bigint`s as decimal strings since `window.__bc` crosses into
 * Playwright's own serialisation. `client/tests/e2e/render-order.spec.ts`
 * is the only reader. */
export function recordRenderOrderForE2e(order: readonly bigint[]): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.renderOrder = order.map((id) => id.toString());
  window.__bc = bucket;
}

/** Story 1.8's proof that a held direction key moves the avatar
 * client-side, with no round trip (FR137): the demo scene's current
 * continuous player position, read every frame -- `movement.spec.ts` is
 * the only reader. */
export function recordPlayerPositionForE2e(x: number, y: number): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.playerPosition = { x, y };
  window.__bc = bucket;
}
