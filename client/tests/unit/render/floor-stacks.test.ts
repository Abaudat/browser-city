// Story 1.13 (Tim's direction): two storeys whose screen rects overlap --
// a bridge deck over the street it spans -- are separated by giving each
// floor its own four-pass stack and drawing the stacks in ascending floor
// order. Floor never enters the sort key (FR124 stays as written); this is
// the one place floor decides anything about draw order, and it decides it
// between whole stacks, never between two pool members.
import { Container, Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { FloorStacks } from "../../../src/render/floor-stacks";

function childIndexOf(parent: Container, child: Container): number {
  return parent.children.indexOf(child);
}

describe("FloorStacks", () => {
  it("gives each floor its own four passes, in the fixed FR123 order", () => {
    const world = new Container();
    const stacks = new FloorStacks(world);
    const stack = stacks.stackFor(0);

    expect(stack.root.children).toEqual([
      stack.ground,
      stack.groundDecals,
      stack.groundObjects,
      stack.pool,
    ]);
    expect(stack.pool.sortableChildren).toBe(false);
  });

  it("returns the same stack for a floor it has already created", () => {
    const stacks = new FloorStacks(new Container());
    expect(stacks.stackFor(-1)).toBe(stacks.stackFor(-1));
  });

  it("draws floors in ascending order however the floors were first asked for", () => {
    const world = new Container();
    const stacks = new FloorStacks(world);
    const above = stacks.stackFor(1);
    const below = stacks.stackFor(-1);
    const street = stacks.stackFor(0);

    expect(childIndexOf(world, below.root)).toBeLessThan(childIndexOf(world, street.root));
    expect(childIndexOf(world, street.root)).toBeLessThan(childIndexOf(world, above.root));
    expect(stacks.floors()).toEqual([-1, 0, 1]);
  });

  it("draws everything on a higher floor after everything on a lower one, whatever their sort keys", () => {
    // The bridge case: a deck on floor 1 sorts *earlier* than the street
    // below it by the FR123 key (same y, lower rank), yet it must still be
    // drawn over it. Only the per-floor stack decides that.
    const world = new Container();
    const stacks = new FloorStacks(world);
    const street = stacks.stackFor(0);
    const deck = stacks.stackFor(1);
    const streetSprite = new Sprite(Texture.EMPTY);
    const deckSprite = new Sprite(Texture.EMPTY);
    street.pool.addChild(streetSprite);
    deck.pool.addChild(deckSprite);

    const drawn: Container[] = [];
    const walk = (node: Container): void => {
      if (node instanceof Sprite) drawn.push(node);
      for (const child of node.children) walk(child as Container);
    };
    walk(world);

    expect(drawn.indexOf(streetSprite)).toBeLessThan(drawn.indexOf(deckSprite));
  });
});
