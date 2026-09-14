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
      visibility?: Record<string, string>;
      visibilityAlpha?: Record<string, number>;
      masksAllNull?: boolean;
      intents?: { objectId: string; defId: number }[];
      ignoredIntents?: string[];
      viewTransform?: { zoom: number; offsetX: number; offsetY: number };
      highlightedObjectId?: string | null;
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
 * every intent the demo scene emitted, in order, with `bigint` ids as
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

/** Story 1.9: the demo scene's own camera transform, recorded once at
 * mount. `intents.spec.ts` needs it to turn a world pixel -- computed
 * from the real `screenPositionPx` and the real fixture cell -- into the
 * canvas offset to click at, rather than hard-coding a pixel that would
 * silently stop meaning anything the moment the camera moves. */
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
