// Quentin's direction: the Pixi adapter gets one narrow test that it
// preserves the order it was given -- not a screenshot, not a pixel
// diff, just a real `Container`'s real children ending up in exactly the
// order `compareDrawables` demands. Pixi's `Container`/`Sprite`/`Texture`
// are plain scene-graph objects that work with no canvas or GPU
// (confirmed: this file runs in vitest's `node` environment, not jsdom),
// so this stays exactly as fast as every other unit test here.
import { Container, Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { applyDepthOrder, type OrderedMember } from "../../../src/render/pixi-order";
import type { Drawable } from "../../../src/render/sort-key";

function member(stableId: bigint, y: number, rank: number, x = 0): OrderedMember {
  const drawable: Drawable = { x, y, rank, stableId, floor: 0 };
  return { drawable, view: new Sprite(Texture.EMPTY) };
}

describe("applyDepthOrder", () => {
  it("orders the container's real children by the comparator, regardless of the order they were given in", () => {
    const container = new Container();
    const third = member(3n, 30, 0);
    const first = member(1n, 10, 0);
    const second = member(2n, 20, 0);
    // `applyDepthOrder` sorts its `members` array argument in place, so
    // these views are captured before the call -- indexing back into
    // `members` afterwards would read post-sort positions.
    const members = [third, first, second];
    for (const m of members) container.addChild(m.view);
    const order: bigint[] = [];

    applyDepthOrder(container, members, order);

    expect(order).toEqual([1n, 2n, 3n]);
    expect(container.children[0]).toBe(first.view);
    expect(container.children[1]).toBe(second.view);
    expect(container.children[2]).toBe(third.view);
  });

  it("never sets sortableChildren -- the comparator is the sole ordering authority", () => {
    const container = new Container();
    expect(container.sortableChildren).toBe(false);
    applyDepthOrder(container, [member(1n, 0, 0)], []);
    expect(container.sortableChildren).toBe(false);
  });

  it("never duplicates or drops a child across repeated re-sorts", () => {
    const container = new Container();
    const members = [member(1n, 10, 0), member(2n, 20, 0), member(3n, 5, 0)];
    for (const m of members) container.addChild(m.view);
    const order: bigint[] = [];

    applyDepthOrder(container, members, order);
    expect(container.children).toHaveLength(3);

    // Move the player-equivalent (id 3) past the others and re-sort again
    // -- the exact "member changes position, container re-attaches"
    // sequence the demo's per-frame path exercises.
    const moved = members.find((m) => m.drawable.stableId === 3n);
    if (!moved) throw new Error("unreachable");
    (moved as { drawable: Drawable }).drawable = { ...moved.drawable, y: 40 };

    applyDepthOrder(container, members, order);
    expect(container.children).toHaveLength(3);
    expect(order).toEqual([1n, 2n, 3n]);
  });

  it("reuses the caller-owned output array rather than allocating a new one", () => {
    const container = new Container();
    const members = [member(1n, 10, 0), member(2n, 20, 0)];
    for (const m of members) container.addChild(m.view);
    const order: bigint[] = [];

    applyDepthOrder(container, members, order);
    const sameArray = order;
    applyDepthOrder(container, members, order);

    expect(order).toBe(sameArray);
  });
});
