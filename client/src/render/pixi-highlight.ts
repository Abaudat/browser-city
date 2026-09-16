// The one Pixi-touching highlight adapter (Tim's direction, story 1.15):
// the sole place `highlight.ts`'s pure spec turns into a real overlay
// `Sprite`, mirroring `pixi-visibility.ts`'s role for FR120/FR121/FR122.
// Overlays are built and destroyed on every hover transition, on every
// strength change and on every re-sort (`reapply`) -- a scene at rest
// carries none of them (D17: the hovered id is never state the world
// holds).
//
// Every overlay is inserted as a sibling directly above its own source
// sprite in the pool container -- never a pool member, never a separate
// top layer, which would draw the mark over a citizen walking in front of
// the counter. Sitting directly above the source means it inherits the
// object's own FR123 sort for free; the cost is that `applyDepthOrder`'s
// `removeChildren()` drops every overlay along with everything else it
// does not itself own, so `reapply()` must run from the one wrapper that
// calls `applyDepthOrder` (`test-street/scene.ts`'s `reorderFloor`), never
// a second call site.
//
// `refresh()` is the answer to Artie's "the overlay is not a snapshot"
// finding: an animated prop, an appearance swap, or a source that streams
// out of visibility while hovered must never leave a stale copy behind.
// It is cheap to call every frame -- a plain field mirror per live
// overlay, an id-existence check per source, and a single comparison the
// instant nothing is marked -- so `test-street/scene.ts` calls it from its
// own per-frame ticker callback, never gated on player movement the way
// `pointer.refresh()` is. That callback is itself only ever registered
// while something is actually marked (added on `set()`'s first real
// transition to a real id, removed on its transition back to `undefined`)
// -- a street with nothing hovered, the overwhelming majority of every
// session, pays not even one extra callback dispatch per frame for it.

import { Sprite } from "pixi.js";
import { highlightOverlaySpec } from "./highlight";

/** One source sprite this applier may highlight, keyed by the stable id
 * of the object it belongs to -- built once at mount from the same
 * `spritesByObjectId` map `test-street/scene.ts` already computes for
 * picking's own drawn-rect index, never a second lookup. */
export type HighlightSpritesByObjectId = ReadonlyMap<bigint, readonly Sprite[]>;

function sourceViewOf(source: Sprite) {
  return {
    texture: source.texture,
    visible: source.visible,
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
 * Owns every overlay sprite this scene ever draws for FR173. `set`/
 * `setStrength`/`reapply`/`refresh`/`destroy` are the whole surface
 * `test-street/scene.ts` wires: the map, the handle's own
 * `setHighlightStrength` forwarding, and the calls into this applier.
 */
export class HighlightApplier {
  private readonly overlaysBySource = new Map<Sprite, Sprite>();
  private highlightedObjectId: bigint | undefined;
  private strength: number;

  constructor(
    private readonly spritesByObjectId: HighlightSpritesByObjectId,
    /** `render.highlight_alpha`'s resolved balance value, already divided
     * down to a plain `(0, 1)` fraction -- never a literal here or in
     * `highlight.ts`. */
    private readonly ceilingAlpha: number,
    initialStrength: number,
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
   * no rebuild -- because the hover is re-resolved on every player move
   * and every visibility change, not only on `pointermove`, and a
   * rebuild-per-frame here would be invisible functionally and lethal to
   * NFR2. Returns whether anything actually changed, so the caller can
   * gate its own `onHighlightChange` on real change alone. */
  set(objectId: bigint | undefined): boolean {
    if (this.highlightedObjectId === objectId) return false;
    this.destroyOverlays();
    this.highlightedObjectId = objectId;
    this.sync();
    return true;
  }

  /** Live-updates the U1 dial and re-applies immediately to whatever is
   * marked right now -- a drag never needs a close/reopen hover to be
   * visible. */
  setStrength(strength: number): void {
    this.strength = strength;
    this.sync();
  }

  /** Re-attaches every overlay directly above its own source, for when
   * something rebuilt the pool container's children (`applyDepthOrder`
   * drops every child it does not own, including every overlay). The
   * previous overlay sprites are already detached (or gone entirely, if
   * their own source's object streamed out); destroying and forgetting
   * them before rebuilding is what keeps this from leaking one generation
   * of overlays per re-sort. */
  reapply(): void {
    if (this.highlightedObjectId === undefined) return;
    this.destroyOverlays();
    this.sync();
  }

  /** Mirrors every live overlay's texture/anchor/position/scale/alpha
   * from its own source sprite, and reconciles which sources currently
   * have one at all: a source that has gone invisible loses its overlay
   * in this same call, and one that has become visible again gains one
   * back -- never a snapshot frozen at hover start (Artie's direction). A
   * no-op the instant nothing is marked. */
  refresh(): void {
    this.sync();
  }

  /** Removes every overlay this applier owns -- `test-street/scene.ts`'s
   * `destroy()` calls this so a torn-down scene leaves nothing behind. */
  destroy(): void {
    this.destroyOverlays();
    this.highlightedObjectId = undefined;
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
      if (!existing) {
        parent.addChildAt(overlay, parent.getChildIndex(source) + 1);
        this.overlaysBySource.set(source, overlay);
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
