// Quentin's direction: the Pixi adapter gets one narrow test that it
// preserves the order it was given -- not a screenshot, not a pixel
// diff, just a real `Container`'s real children ending up in exactly the
// order `compareDrawables` demands. Pixi's `Container`/`Sprite`/`Texture`
// are plain scene-graph objects that work with no canvas or GPU
// (confirmed: this file runs in vitest's `node` environment, not jsdom),
// so this stays exactly as fast as every other unit test here.
import { Container, Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { PropDrawable } from "../../../src/render/demo-scene-drawables";
import { applyDepthOrder, type PoolMember } from "../../../src/render/pixi-scene";

function member(stableId: bigint, y: number, rank: number, x = 0): PoolMember {
  const drawable: PropDrawable = {
    x,
    y,
    rank,
    stableId,
    floor: 0,
    assetKey: "test",
    sourceCol: 0,
    sourceRow: 0,
    footprintWidth: 1,
    footprintHeight: 1,
  };
  return { drawable, sprite: new Sprite(Texture.EMPTY) };
}

describe("applyDepthOrder", () => {
  it("orders the container's real children by the comparator, regardless of the order they were given in", () => {
    const container = new Container();
    const third = member(3n, 30, 0);
    const first = member(1n, 10, 0);
    const second = member(2n, 20, 0);
    // `applyDepthOrder` sorts its `members` array argument in place, so
    // these sprite references are captured before the call -- indexing
    // back into `members` afterwards would read post-sort positions.
    const members = [third, first, second];
    for (const m of members) container.addChild(m.sprite);

    const order = applyDepthOrder(container, members);

    expect(order).toEqual([1n, 2n, 3n]);
    expect(container.children[0]).toBe(first.sprite);
    expect(container.children[1]).toBe(second.sprite);
    expect(container.children[2]).toBe(third.sprite);
  });

  it("never leaves sortableChildren set on the pool container -- the comparator is the sole ordering authority", () => {
    const container = new Container();
    expect(container.sortableChildren).toBe(false);
    applyDepthOrder(container, [member(1n, 0, 0)]);
    expect(container.sortableChildren).toBe(false);
  });

  it("moves an already-attached child rather than duplicating it", () => {
    const container = new Container();
    const members = [member(1n, 10, 0), member(2n, 20, 0)];
    for (const m of members) container.addChild(m.sprite);

    applyDepthOrder(container, members);
    applyDepthOrder(container, members);

    expect(container.children).toHaveLength(2);
  });
});
