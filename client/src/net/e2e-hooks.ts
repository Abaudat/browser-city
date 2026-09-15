// Test-only observation surface for client/tests/e2e/round-trip.spec.ts
// (Quentin, story 1.1). Guarded by `import.meta.env.DEV`, a flag Vite
// inlines statically and dead-code-eliminates from a production build, so
// `window.__bc` never ships. Exists so the e2e spec reads page state
// instead of scraping console output.

import type { AppearanceTuple, UniformOverride } from "../render/appearance/composite";
import type { PixelSnapshot } from "../render/appearance/pixel-snapshot";
import type { PingObservation } from "./observe-ping";

declare global {
  interface Window {
    __bc?: {
      pings: PingObservation[];
      renderOrder?: string[];
      playerPosition?: { x: number; y: number };
      /** Story 1.13: the floor the player is standing on right now --
       * recorded with the position, from the same `FloorWalkResult`, so a
       * reader can never see one without the other. */
      playerFloor?: number;
      /** Story 1.13 (NFR2): per-frame *work* time in ms -- how long the
       * scene's own ticker callback took, never a rAF interval (headless
       * CI has no vsync or GPU, so wall-clock FPS there is noise).
       * Recording is off until `__bcStartFrameTimings` turns it on, so a
       * functional spec never pays for it. */
      frameTimings?: number[];
      startFrameTimings?: () => void;
      stopFrameTimings?: () => number[];
      visibility?: Record<string, string>;
      visibilityAlpha?: Record<string, number>;
      masksAllNull?: boolean;
      intents?: { objectId: string; defId: number }[];
      ignoredIntents?: string[];
      viewTransform?: { zoom: number; offsetX: number; offsetY: number };
      highlightedObjectId?: string | null;
      /** Story 1.10: one opaque texture-identity id per mounted citizen
       * id -- citizens sharing a tuple+override share an id (AC5). */
      appearanceTextureIds?: Record<string, number>;
      appearanceDistinctTextureCount?: number;
      /** Story 1.13: the player's own five stored part indices (FR61),
       * recorded once at mount. Unlike `appearanceTextureIds` -- opaque
       * per-session identity counters, assigned in texture-load order and
       * meaningless across a reload -- this is the tuple itself, so "the
       * same five parts after a walk and after a reload" is a thing a
       * spec can actually assert. */
      playerAppearance?: {
        body: number;
        eyes: number;
        outfit: number;
        hairstyle: number;
        accessory: number;
      };
      /** Story 1.10: the real, mounted pipeline's own pixel output vs.
       * an independent five/six-sprite stack, for one `(tuple, override,
       * animation, direction, frame)`. */
      appearanceCompare?: (
        tuple: AppearanceTuple,
        override: UniformOverride | null,
        animation: string,
        direction: string,
        frame: number,
      ) => Promise<{ pipeline: PixelSnapshot; stack: PixelSnapshot }>;
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
 * list (Quentin's direction): the street scene's current depth order,
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
 * client-side, with no round trip (FR137): the street scene's current
 * continuous player position, read every frame -- `movement.spec.ts` is
 * the only reader. */
export function recordPlayerPositionForE2e(x: number, y: number, floor: number): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.playerPosition = { x, y };
  bucket.playerFloor = floor;
  window.__bc = bucket;
}

/** Story 1.13 (NFR2): the frame-work recorder the perf spec drives. The
 * scene reports how long its own ticker callback took, every frame, and
 * this keeps the samples only while a caller has asked for them -- a
 * functional run records nothing and allocates nothing. */
export function recordFrameWorkForE2e(ms: number): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  if (bucket.frameTimings) bucket.frameTimings.push(ms);
  if (bucket.startFrameTimings) return;
  bucket.startFrameTimings = () => {
    const current = window.__bc;
    if (current) current.frameTimings = [];
  };
  bucket.stopFrameTimings = () => {
    const current = window.__bc;
    const samples = current?.frameTimings ?? [];
    if (current) current.frameTimings = undefined;
    return samples;
  };
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
 * every intent the street scene emitted, in order, with `bigint` ids as
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

/** Story 1.9: the street scene's own camera transform, recorded once at
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

/** Story 1.10 (AC5): the mounted street crowd's own texture identities,
 * once, right after mount -- `appearance.spec.ts`'s only reader for the
 * "one composite per unique key" proof. */
export function recordAppearanceTextureIdsForE2e(
  idsById: Readonly<Record<string, number>>,
  distinctCount: number,
): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.appearanceTextureIds = { ...idsById };
  bucket.appearanceDistinctTextureCount = distinctCount;
  window.__bc = bucket;
}

/** Story 1.13: the player's own appearance tuple, as the real, mounted
 * scene composited it -- read once at mount and never again. */
export function recordPlayerAppearanceForE2e(tuple: {
  readonly body: number;
  readonly eyes: number;
  readonly outfit: number;
  readonly hairstyle: number;
  readonly accessory: number;
}): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.playerAppearance = { ...tuple };
  window.__bc = bucket;
}

/** Story 1.10: exposes the real, mounted crowd's own pixel-diff proof as
 * a callable -- `appearance.spec.ts` invokes it with fixed tuples through
 * `page.evaluate`, never a value recorded once at mount (each call needs
 * its own tuple/cell arguments). */
export function exposeAppearanceCompareForE2e(
  compare: NonNullable<NonNullable<Window["__bc"]>["appearanceCompare"]>,
): void {
  if (!import.meta.env.DEV) return;
  const bucket = window.__bc ?? { pings: [] };
  bucket.appearanceCompare = compare;
  window.__bc = bucket;
}
