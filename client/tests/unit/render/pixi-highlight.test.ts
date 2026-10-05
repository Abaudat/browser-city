// `render/pixi-highlight.ts`'s own unit tests (Tim's direction, story
// 1.15), against a real Pixi `Container`/`Sprite` -- the same idiom
// `pixi-visibility.test.ts` and `pixi-order.test.ts` use. The ticker
// itself is a plain fake (Quentin's direction): the permanent
// subscribe/unsubscribe guarantee lives in this class now, so it is
// proven here against a fake ticker rather than through a real Pixi
// `Application`.

import { Container, Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { HighlightApplier, type HighlightTicker } from "../../../src/render/pixi-highlight";
import { applyDepthOrder, type OrderedMember } from "../../../src/render/pixi-order";
import type { Drawable } from "../../../src/render/sort-key";

const CEILING = 0.18;

function textureNamed(name: string): Texture {
  const texture = new Texture({ source: Texture.EMPTY.source });
  texture.label = name;
  return texture;
}

/** A minimal, plain fake for `HighlightTicker` -- records every
 * subscribed callback in a `Set` (so a double-`add` of the same function
 * is never counted twice, matching what a real Pixi `Ticker` does), and
 * exposes `tick()` to invoke everything currently subscribed, plus
 * `listenerCount()` so a test can assert on the subscription itself, not
 * only on its effect. */
function fakeTicker(): HighlightTicker & { tick(): void; listenerCount(): number } {
  const listeners = new Set<() => void>();
  return {
    add: (fn) => {
      listeners.add(fn);
    },
    remove: (fn) => {
      listeners.delete(fn);
    },
    tick: () => {
      for (const fn of [...listeners]) fn();
    },
    listenerCount: () => listeners.size,
  };
}

describe("HighlightApplier", () => {
  it("marking an object builds one overlay per source sprite, inserted directly above its own source", () => {
    const parent = new Container();
    const a = new Sprite(Texture.EMPTY);
    const b = new Sprite(Texture.EMPTY);
    parent.addChild(a, b);
    const applier = new HighlightApplier(new Map([[1n, [a, b]]]), CEILING, 100, fakeTicker());

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
    const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 100, fakeTicker());

    applier.set(undefined);
    expect(parent.children).toHaveLength(1);
    expect(applier.current()).toBeUndefined();
  });

  it("un-marking destroys every overlay and leaves the container back at its original membership", () => {
    const parent = new Container();
    const a = new Sprite(Texture.EMPTY);
    parent.addChild(a);
    const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 100, fakeTicker());

    applier.set(1n);
    expect(parent.children).toHaveLength(2);
    applier.set(undefined);
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).toBe(a);
  });

  it("a source sprite with no parent is skipped, never throwing and never leaving an orphan overlay", () => {
    const orphan = new Sprite(Texture.EMPTY);
    const applier = new HighlightApplier(new Map([[1n, [orphan]]]), CEILING, 100, fakeTicker());
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
      fakeTicker(),
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
      const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 100, fakeTicker());

      expect(applier.set(1n)).toBe(true);
      const overlayFirst = parent.children[parent.getChildIndex(a) + 1];
      expect(applier.set(1n)).toBe(false);
      expect(applier.set(1n)).toBe(false);
      const overlayAfter = parent.children[parent.getChildIndex(a) + 1];
      expect(overlayAfter).toBe(overlayFirst);
      expect(parent.children).toHaveLength(2);
    });

    it("set(undefined) repeatedly while nothing is marked is also a no-op", () => {
      const applier = new HighlightApplier(new Map(), CEILING, 100, fakeTicker());
      expect(applier.set(undefined)).toBe(false);
      expect(applier.set(undefined)).toBe(false);
    });
  });

  it("setStrength re-applies live to the current mark without rebuilding (same overlay instance, no duplication)", () => {
    const parent = new Container();
    const a = new Sprite(Texture.EMPTY);
    a.alpha = 1;
    parent.addChild(a);
    const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 60, fakeTicker());

    applier.set(1n);
    const overlay = parent.children[parent.getChildIndex(a) + 1] as Sprite;
    const alphaAt60 = overlay.alpha;

    applier.setStrength(100);
    expect(parent.children).toHaveLength(2); // no duplicate overlay
    expect(parent.children[parent.getChildIndex(a) + 1]).toBe(overlay); // same instance
    expect(overlay.alpha).toBeGreaterThan(alphaAt60);
    expect(overlay.alpha).toBeCloseTo(CEILING, 10);
  });

  describe("the refresh ticker subscription (Quentin's direction)", () => {
    it("subscribes on the first real mark, unsubscribes on the transition back to undefined", () => {
      const parent = new Container();
      const a = new Sprite(Texture.EMPTY);
      parent.addChild(a);
      const ticker = fakeTicker();
      const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 100, ticker);

      expect(ticker.listenerCount()).toBe(0);
      applier.set(1n);
      expect(ticker.listenerCount()).toBe(1);
      applier.set(undefined);
      expect(ticker.listenerCount()).toBe(0);
    });

    it("never double-subscribes across a hammered hover sequence", () => {
      const parent = new Container();
      const a = new Sprite(Texture.EMPTY);
      const b = new Sprite(Texture.EMPTY);
      parent.addChild(a, b);
      const ticker = fakeTicker();
      const applier = new HighlightApplier(
        new Map([
          [1n, [a]],
          [2n, [b]],
        ]),
        CEILING,
        100,
        ticker,
      );

      for (let i = 0; i < 50; i++) {
        applier.set(BigInt((i % 2) + 1)); // 1n, 2n, 1n, 2n, ... always a real transition
        expect(ticker.listenerCount()).toBe(1);
      }
      applier.set(undefined);
      expect(ticker.listenerCount()).toBe(0);
    });

    it("set(undefined) is the one teardown path, and it unsubscribes even mid-hammering (no separate destroy())", () => {
      const parent = new Container();
      const a = new Sprite(Texture.EMPTY);
      parent.addChild(a);
      const ticker = fakeTicker();
      const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 100, ticker);

      applier.set(1n);
      expect(ticker.listenerCount()).toBe(1);
      applier.set(undefined);
      expect(ticker.listenerCount()).toBe(0);
      // Idempotent: tearing down twice never double-unsubscribes or throws.
      expect(() => applier.set(undefined)).not.toThrow();
      expect(ticker.listenerCount()).toBe(0);
    });

    it("ticking the subscribed callback runs a real refresh -- moving the source moves the overlay with no caller-driven refresh() call", () => {
      const parent = new Container();
      const a = new Sprite(Texture.EMPTY);
      a.x = 1;
      parent.addChild(a);
      const ticker = fakeTicker();
      const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 100, ticker);
      applier.set(1n);
      const overlay = parent.children[parent.getChildIndex(a) + 1] as Sprite;

      a.x = 77;
      ticker.tick();
      expect(overlay.x).toBe(77);
    });
  });

  describe("refresh() tracks a live source, never a snapshot (Artie's direction)", () => {
    it("mirrors a moved/rescaled/retextured source onto the same overlay instance", () => {
      const parent = new Container();
      const a = new Sprite(Texture.EMPTY);
      a.x = 10;
      a.y = 20;
      parent.addChild(a);
      const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 100, fakeTicker());
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
      const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 100, fakeTicker());
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
      const applier = new HighlightApplier(new Map([[1n, [a]]]), CEILING, 100, fakeTicker());
      applier.refresh();
      expect(parent.children).toHaveLength(1);
    });
  });

  describe("refresh() after a real removeChildren-and-refill (a re-sort)", () => {
    it("re-attaches the same overlay instances -- one per visible source sprite, zero for an invisible one -- allocating no new Sprite", () => {
      const container = new Container();
      const a = new Sprite(Texture.EMPTY);
      const b = new Sprite(Texture.EMPTY);
      b.visible = false;
      container.addChild(a, b);

      const applier = new HighlightApplier(new Map([[1n, [a, b]]]), CEILING, 100, fakeTicker());
      applier.set(1n);
      expect(container.children).toHaveLength(3); // a, a's overlay, b (no overlay: hidden)
      const overlayOfA = container.children.find((c) => c !== a && c !== b) as Sprite;

      // The real sequence `test-street/scene.ts`'s `reorderFloor` runs:
      // `applyDepthOrder` calls `removeChildren()` then re-adds only the
      // members it owns -- orphaning every overlay along with anything
      // else it does not itself own (their own `.parent` becomes `null`;
      // `overlayOfA` itself is untouched otherwise, still the same object).
      const members: OrderedMember[] = [
        { drawable: drawableOf(1n, 0), view: a },
        { drawable: drawableOf(2n, 1), view: b },
      ];
      const order: bigint[] = [];
      applyDepthOrder(container, members, order);
      expect(container.children).toHaveLength(2); // overlay dropped by removeChildren
      expect(overlayOfA.parent).toBeNull();

      applier.refresh();
      expect(container.children).toHaveLength(3); // exactly one overlay restored, for a only
      expect(container.children.includes(a)).toBe(true);
      expect(container.children.includes(b)).toBe(true);
      // The re-attached overlay is the very same instance, not a rebuild.
      expect(container.children.includes(overlayOfA)).toBe(true);
      expect(container.children[container.getChildIndex(a) + 1]).toBe(overlayOfA);
    });

    it("is a no-op while nothing is marked", () => {
      const container = new Container();
      const applier = new HighlightApplier(new Map(), CEILING, 100, fakeTicker());
      applier.refresh();
      expect(container.children).toHaveLength(0);
    });
  });

  describe("lifecycle hammering: hover/un-hover cycles, strength changes and a visibility change interleaved", () => {
    it("ends with the same container child count and the same number of live sprites, before and after the final set(undefined)", () => {
      const parent = new Container();
      const sprites = Array.from({ length: 5 }, () => {
        const s = new Sprite(Texture.EMPTY);
        parent.addChild(s);
        return s;
      });
      const spritesByObjectId = new Map<bigint, Sprite[]>(
        sprites.map((s, i) => [BigInt(i + 1), [s]]),
      );
      const ticker = fakeTicker();
      const applier = new HighlightApplier(spritesByObjectId, CEILING, 60, ticker);
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
        ticker.tick(); // the same subscribed path a real per-frame session drives
        if (i % 11 === 0) applier.set(undefined);
      }
      applier.set(undefined);

      expect(parent.children.length).toBe(baselineCount);
      expect(parent.children.every((c) => c instanceof Sprite)).toBe(true);
      expect(ticker.listenerCount()).toBe(0);
    });
  });
});

function drawableOf(stableId: bigint, y: number): Drawable {
  return { x: 0, y, rank: 20, stableId, floor: 0 };
}
