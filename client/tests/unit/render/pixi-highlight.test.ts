// `render/pixi-highlight.ts`'s own unit tests (Tim's direction, story
// 1.15), against a real Pixi `Container`/`Sprite` -- the same idiom
// `pixi-visibility.test.ts` and `pixi-order.test.ts` use.

import { Container, Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { HighlightApplier } from "../../../src/render/pixi-highlight";
import { applyDepthOrder, type OrderedMember } from "../../../src/render/pixi-order";
import type { Drawable } from "../../../src/render/sort-key";

const CEILING = 0.18;

function textureNamed(name: string): Texture {
  const texture = new Texture({ source: Texture.EMPTY.source });
  texture.label = name;
  return texture;
}

describe("HighlightApplier", () => {
  it("marking an object builds one overlay per source sprite, inserted directly above its own source", () => {
    const parent = new Container();
    const a = new Sprite(Texture.EMPTY);
    const b = new Sprite(Texture.EMPTY);
    parent.addChild(a, b);
    const applier = new HighlightApplier(new Map([[1n, [a, b]]]), CEILING, 100);

    expect(applier.set(1n)).toBe(true);

    expect(parent.children).toHaveLength(4);
    expect(parent.getChildIndex(a)).toBe(0);
    expect(parent.children[1]).not.toBe(a);
    expect(parent.children[1]).not.toBe(b);
    // Every overlay sits immediately above its own source, not bundled at
    // the end -- inheriting the source's own FR123 sort slot.
    const overlayOfA = parent.children[parent.getChildIndex(a) + 1];
    const overlayOfB = parent.children[parent.getChildIndex(b) + 1];
    expect(overlayOfA).not.toBe(overlayOfB);
  });

  it("marking nothing (undefined) builds no overlays", () => {
    const parent = new Container();
    const a = new Sprite(Texture.EMPTY);
    parent.addChild(a);
    const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 100);

    applier.set(undefined);
    expect(parent.children).toHaveLength(1);
    expect(applier.current()).toBeUndefined();
  });

  it("un-marking destroys every overlay and leaves the container back at its original membership", () => {
    const parent = new Container();
    const a = new Sprite(Texture.EMPTY);
    parent.addChild(a);
    const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 100);

    applier.set(1n);
    expect(parent.children).toHaveLength(2);
    applier.set(undefined);
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).toBe(a);
  });

  it("a source sprite with no parent is skipped, never throwing and never leaving an orphan overlay", () => {
    const orphan = new Sprite(Texture.EMPTY);
    const applier = new HighlightApplier(new Map([[1n, [orphan]]]), CEILING, 100);
    expect(() => applier.set(1n)).not.toThrow();
    expect(applier.current()).toBe(1n);
  });

  it("switching from one object to another tears down the first object's overlays and builds the second's", () => {
    const parent = new Container();
    const a = new Sprite(Texture.EMPTY);
    const b = new Sprite(Texture.EMPTY);
    parent.addChild(a, b);
    const applier = new HighlightApplier(
      new Map([
        [1n, [a]],
        [2n, [b]],
      ]),
      CEILING,
      100,
    );

    applier.set(1n);
    expect(parent.children).toHaveLength(3);
    applier.set(2n);
    // Still exactly one overlay live (b's), not two.
    expect(parent.children).toHaveLength(3);
    expect(parent.children.filter((c) => c === a || c === b)).toHaveLength(2);
  });

  describe("setHighlight with an unchanged id is a genuine no-op", () => {
    it("no teardown, no rebuild: the same overlay instance survives repeated set() calls with the same id", () => {
      const parent = new Container();
      const a = new Sprite(Texture.EMPTY);
      parent.addChild(a);
      const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 100);

      expect(applier.set(1n)).toBe(true);
      const overlayFirst = parent.children[parent.getChildIndex(a) + 1];
      expect(applier.set(1n)).toBe(false);
      expect(applier.set(1n)).toBe(false);
      const overlayAfter = parent.children[parent.getChildIndex(a) + 1];
      expect(overlayAfter).toBe(overlayFirst);
      expect(parent.children).toHaveLength(2);
    });

    it("set(undefined) repeatedly while nothing is marked is also a no-op", () => {
      const applier = new HighlightApplier(new Map(), CEILING, 100);
      expect(applier.set(undefined)).toBe(false);
      expect(applier.set(undefined)).toBe(false);
    });
  });

  it("setStrength re-applies live to the current mark without rebuilding (same overlay instance, no duplication)", () => {
    const parent = new Container();
    const a = new Sprite(Texture.EMPTY);
    a.alpha = 1;
    parent.addChild(a);
    const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 60);

    applier.set(1n);
    const overlay = parent.children[parent.getChildIndex(a) + 1] as Sprite;
    const alphaAt60 = overlay.alpha;

    applier.setStrength(100);
    expect(parent.children).toHaveLength(2); // no duplicate overlay
    expect(parent.children[parent.getChildIndex(a) + 1]).toBe(overlay); // same instance
    expect(overlay.alpha).toBeGreaterThan(alphaAt60);
    expect(overlay.alpha).toBeCloseTo(CEILING, 10);
  });

  describe("refresh() tracks a live source, never a snapshot (Artie's direction)", () => {
    it("mirrors a moved/rescaled/retextured source onto the same overlay instance", () => {
      const parent = new Container();
      const a = new Sprite(Texture.EMPTY);
      a.x = 10;
      a.y = 20;
      parent.addChild(a);
      const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 100);
      applier.set(1n);
      const overlay = parent.children[parent.getChildIndex(a) + 1] as Sprite;

      const newTexture = textureNamed("swapped");
      a.x = 99;
      a.y = 42;
      a.scale.set(2, 3);
      a.texture = newTexture;

      applier.refresh();

      expect(parent.children[parent.getChildIndex(a) + 1]).toBe(overlay); // no rebuild
      expect(overlay.x).toBe(99);
      expect(overlay.y).toBe(42);
      expect(overlay.scale.x).toBe(2);
      expect(overlay.scale.y).toBe(3);
      expect(overlay.texture).toBe(newTexture);
    });

    it("a source that goes invisible mid-hover loses its overlay in the same refresh, and regains it when visible again", () => {
      const parent = new Container();
      const a = new Sprite(Texture.EMPTY);
      parent.addChild(a);
      const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 100);
      applier.set(1n);
      expect(parent.children).toHaveLength(2);

      a.visible = false;
      applier.refresh();
      expect(parent.children).toHaveLength(1);

      a.visible = true;
      applier.refresh();
      expect(parent.children).toHaveLength(2);
    });

    it("is a no-op the instant nothing is marked", () => {
      const parent = new Container();
      const a = new Sprite(Texture.EMPTY);
      parent.addChild(a);
      const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 100);
      applier.refresh();
      expect(parent.children).toHaveLength(1);
    });
  });

  describe("reapply() after a real removeChildren-and-refill", () => {
    it("restores exactly one overlay per visible source sprite, and zero for an invisible one", () => {
      const container = new Container();
      const a = new Sprite(Texture.EMPTY);
      const b = new Sprite(Texture.EMPTY);
      b.visible = false;
      container.addChild(a, b);

      const applier = new HighlightApplier(new Map([[1n, [a, b]]]), CEILING, 100);
      applier.set(1n);
      expect(container.children).toHaveLength(3); // a, a's overlay, b (no overlay: hidden)

      // The real sequence `test-street/scene.ts`'s `reorderFloor` runs:
      // `applyDepthOrder` calls `removeChildren()` then re-adds only the
      // members it owns -- dropping every overlay along with anything
      // else it does not itself own.
      const members: OrderedMember[] = [
        { drawable: drawableOf(1n, 0), view: a },
        { drawable: drawableOf(2n, 1), view: b },
      ];
      const order: bigint[] = [];
      applyDepthOrder(container, members, order);
      expect(container.children).toHaveLength(2); // overlay dropped by removeChildren

      applier.reapply();
      expect(container.children).toHaveLength(3); // exactly one overlay restored, for a only
      expect(container.children.includes(a)).toBe(true);
      expect(container.children.includes(b)).toBe(true);
    });

    it("is a no-op while nothing is marked", () => {
      const container = new Container();
      const applier = new HighlightApplier(new Map(), CEILING, 100);
      applier.reapply();
      expect(container.children).toHaveLength(0);
    });
  });

  describe("lifecycle hammering: hover/un-hover cycles, strength changes and a visibility change interleaved", () => {
    it("ends with the same container child count and the same number of live sprites, before and after destroy()", () => {
      const parent = new Container();
      const sprites = Array.from({ length: 5 }, () => {
        const s = new Sprite(Texture.EMPTY);
        parent.addChild(s);
        return s;
      });
      const spritesByObjectId = new Map<bigint, Sprite[]>(
        sprites.map((s, i) => [BigInt(i + 1), [s]]),
      );
      const applier = new HighlightApplier(spritesByObjectId, CEILING, 60);
      const baselineCount = parent.children.length;

      for (let i = 0; i < 200; i++) {
        const objectId = BigInt((i % 5) + 1);
        applier.set(objectId);
        applier.setStrength(20 + (i % 80));
        if (i % 7 === 0) {
          const target = sprites[i % 5];
          if (target) target.visible = i % 14 !== 0;
        }
        applier.refresh();
        if (i % 11 === 0) applier.set(undefined);
      }
      applier.set(undefined);

      expect(parent.children.length).toBe(baselineCount);
      expect(parent.children.every((c) => c instanceof Sprite)).toBe(true);

      applier.destroy();
      expect(parent.children.length).toBe(baselineCount);
    });
  });
});

function drawableOf(stableId: bigint, y: number): Drawable {
  return { x: 0, y, rank: 0, stableId, floor: 0 };
}
