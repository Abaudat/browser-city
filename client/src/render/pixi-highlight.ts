// The one Pixi-touching highlight adapter (Tim's direction, story 1.15):
// the sole place `highlight.ts`'s pure spec turns into a real overlay
// `Sprite`, mirroring `pixi-visibility.ts`'s role for FR120/FR121/FR122.
// Overlays are built on the first hover transition and torn down on the
// transition back to `undefined` -- a scene at rest carries none of them
// (D17: the hovered id is never state the world holds).
//
// Every overlay is inserted as a sibling directly above its own source
// sprite in the pool container -- never a pool member, never a separate
// top layer, which would draw the mark over a citizen walking in front of
// the counter. Sitting directly above the source means it inherits the
// object's own FR123 sort for free; the cost is that `applyDepthOrder`'s
// `removeChildren()` orphans every overlay along with everything else it
// does not itself own (the overlay's own `.parent` becomes `null`, its
// source's does not, since the source is a real pool member re-added by
// that same call). `refresh()` is what re-attaches an orphaned overlay to
// its source's own new position -- re-using the same `Sprite` instance
// rather than destroying and rebuilding it, so a re-sort while something
// is marked allocates nothing -- and `test-street/scene.ts`'s `reorderFloor`
// (the one wrapper that calls `applyDepthOrder`) is the only call site
// that ever calls it for that reason; every other caller reaches it
// through the ticker below.
//
// `refresh()` is also the answer to Artie's "the overlay is not a
// snapshot" finding: an animated prop, an appearance swap, or a source
// that streams out of visibility while hovered must never leave a stale
// copy behind. It is cheap to call every frame -- a plain field mirror
// per live overlay, an id-existence check per source, and a single
// comparison the instant nothing is marked -- so this class owns
// subscribing it to a caller-injected ticker itself (Quentin's direction:
// the permanent guarantee belongs in the permanent module, not in
// `test-street/scene.ts`, which is outside the coverage bar and which
// Epic 3 deletes). The subscription exists only while something is
// actually marked -- added on the first real transition to a real id,
// removed on the transition back to `undefined` -- so a street with
// nothing hovered, the overwhelming majority of every session, pays not
// even one extra callback dispatch per frame for it.

import { Sprite } from "pixi.js";
import { highlightOverlaySpec } from "./highlight";

/** One source sprite this applier may highlight, keyed by the stable id
 * of the object it belongs to -- built once at mount from the same
 * `spritesByObjectId` map `test-street/scene.ts` already computes for
 * picking's own drawn-rect index, never a second lookup. */
export type HighlightSpritesByObjectId = ReadonlyMap<bigint, readonly Sprite[]>;

/** The minimal shape this class needs from a ticker to subscribe and
 * unsubscribe its own `refresh` -- structural over Pixi's real `Ticker`
 * (`app.ticker` satisfies this with no adapter), so a unit test can hand
 * it a plain fake that records calls instead of mounting a real
 * `Application`. */
export interface HighlightTicker {
  add(fn: () => void): void;
  remove(fn: () => void): void;
}

function sourceViewOf(source: Sprite) {
  return {
    texture: source.texture,
    alpha: source.alpha,
    anchorX: source.anchor.x,
    anchorY: source.anchor.y,
    x: source.x,
    y: source.y,
    scaleX: source.scale.x,
    scaleY: source.scale.y,
  };
}

/**
 * Owns every overlay sprite this scene ever draws for FR173, and its own
 * per-frame `refresh` subscription. `set`/`setStrength`/`refresh` are the
 * whole surface `test-street/scene.ts` wires: the map, the handle's own
 * `setHighlightStrength` forwarding, and `reorderFloor`'s own call after
 * every re-sort. There is no separate `destroy()`: `set(undefined)` is
 * the one teardown path (`test-street/scene.ts`'s own `destroy()` already
 * routes through `setHighlight(undefined)`), so it is also what
 * unsubscribes the ticker -- a second, unused teardown method is not
 * public surface a permanent module carries.
 */
export class HighlightApplier {
  private readonly overlaysBySource = new Map<Sprite, Sprite>();
  private highlightedObjectId: bigint | undefined;
  private strength: number;
  private ticking = false;
  private readonly onTick = (): void => this.refresh();

  constructor(
    private readonly spritesByObjectId: HighlightSpritesByObjectId,
    /** `render.highlight_alpha`'s resolved balance value, already divided
     * down to a plain `(0, 1)` fraction -- never a literal here or in
     * `highlight.ts`. */
    private readonly ceilingAlpha: number,
    initialStrength: number,
    private readonly ticker: HighlightTicker,
  ) {
    this.strength = initialStrength;
  }

  /** The object currently marked, or `undefined` -- read back by
   * `test-street/scene.ts`'s own wiring to decide whether `onHighlightChange`
   * actually fires, never a second, separately-tracked id. */
  current(): bigint | undefined {
    return this.highlightedObjectId;
  }

  /** Marks `objectId`, or clears the mark for `undefined`. A genuine
   * no-op when `objectId` already matches what is marked -- no teardown,
   * no rebuild, no ticker subscription change -- because the hover is
   * re-resolved on every player move and every visibility change, not
   * only on `pointermove`, and a rebuild-per-frame here would be
   * invisible functionally and lethal to NFR2. Returns whether anything
   * actually changed, so the caller can gate its own `onHighlightChange`
   * on real change alone. */
  set(objectId: bigint | undefined): boolean {
    if (this.highlightedObjectId === objectId) return false;
    this.destroyOverlays();
    this.highlightedObjectId = objectId;
    this.sync();
    this.setTicking(objectId !== undefined);
    return true;
  }

  /** Live-updates the U1 dial and re-applies immediately to whatever is
   * marked right now -- a drag never needs a close/reopen hover to be
   * visible. */
  setStrength(strength: number): void {
    this.strength = strength;
    this.sync();
  }

  /** Mirrors every live overlay's texture/anchor/position/scale/alpha
   * from its own source sprite, re-attaching one that a re-sort orphaned
   * (reusing the same instance, never destroying and rebuilding it), and
   * reconciles which sources currently have one at all: a source that has
   * gone invisible loses its overlay in this same call, and one that has
   * become visible again gains one back -- never a snapshot frozen at
   * hover start (Artie's direction). A no-op the instant nothing is
   * marked. Called by the ticker every frame something is marked, and
   * directly by `test-street/scene.ts`'s `reorderFloor` after every
   * re-sort (see the module doc for why that one extra call site exists). */
  refresh(): void {
    this.sync();
  }

  private setTicking(active: boolean): void {
    if (active === this.ticking) return;
    this.ticking = active;
    if (active) this.ticker.add(this.onTick);
    else this.ticker.remove(this.onTick);
  }

  private sync(): void {
    const objectId = this.highlightedObjectId;
    if (objectId === undefined) return;

    for (const source of this.spritesByObjectId.get(objectId) ?? []) {
      const parent = source.parent;
      const existing = this.overlaysBySource.get(source);

      if (!parent || !source.visible) {
        if (existing) {
          existing.parent?.removeChild(existing);
          existing.destroy();
          this.overlaysBySource.delete(source);
        }
        continue;
      }

      const spec = highlightOverlaySpec(sourceViewOf(source), this.ceilingAlpha, this.strength);
      const overlay = existing ?? new Sprite(spec.texture);
      overlay.texture = spec.texture;
      overlay.alpha = spec.alpha;
      overlay.anchor.set(spec.anchorX, spec.anchorY);
      overlay.x = spec.x;
      overlay.y = spec.y;
      overlay.scale.set(spec.scaleX, spec.scaleY);
      overlay.blendMode = spec.blendMode;

      const desiredIndex = parent.getChildIndex(source) + 1;
      if (!existing) {
        parent.addChildAt(overlay, desiredIndex);
        this.overlaysBySource.set(source, overlay);
      } else if (overlay.parent !== parent || parent.getChildIndex(overlay) !== desiredIndex) {
        // Orphaned by a `removeChildren`-and-refill (a re-sort) -- or, in
        // principle, moved to a different parent -- so re-attach the same
        // instance rather than allocate a new one. `addChildAt` on an
        // already-parented child detaches it from its old parent first
        // (Pixi's own behaviour), so this is correct even if `overlay`
        // somehow still had one.
        parent.addChildAt(overlay, desiredIndex);
      }
    }
  }

  private destroyOverlays(): void {
    for (const overlay of this.overlaysBySource.values()) {
      overlay.parent?.removeChild(overlay);
      overlay.destroy();
    }
    this.overlaysBySource.clear();
  }
}
