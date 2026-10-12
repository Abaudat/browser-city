// Story 6.10: the container view's Pixi half, against real Pixi containers.
// The lifecycle claim (Quentin): opened and closed 50 times it ends at the
// baseline child count, with the ticker unsubscribed while closed, and a
// view is bound to its object and destroyed on close -- which is what keeps
// it from being a HUD.

import { Container, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { FloorStacks } from "../../../src/render/floor-stacks";
import {
  ContainerViewController,
  type ContainerViewTicker,
  PixiContainerView,
} from "../../../src/render/pixi-container-view";
import type { CellRect, HeldRow } from "../../../src/world/container-view";

function fakeTicker(): ContainerViewTicker & { listenerCount(): number; fire(): void } {
  const listeners = new Set<() => void>();
  return {
    add: (fn) => {
      listeners.add(fn);
    },
    remove: (fn) => {
      listeners.delete(fn);
    },
    listenerCount: () => listeners.size,
    fire: () => {
      for (const fn of [...listeners]) fn();
    },
  };
}

const rect = (instanceId: bigint, x: number, y: number, w: number, h: number, q = 0): CellRect => ({
  instanceId,
  defId: 9,
  x,
  y,
  w,
  h,
  quarterTurns: q,
});

function build(parent = new Container()) {
  const world = parent;
  const stacks = new FloorStacks(world);
  stacks.stackFor(0);
  return { world, stacks };
}

describe("PixiContainerView", () => {
  it("draws one backing, edge and grid lines, and one sprite per rect at its cell position", () => {
    const { stacks } = build();
    const view = new PixiContainerView({
      stacks,
      objectId: 82n,
      floor: 0,
      grid: { width: 4, height: 3 },
      tileSizePx: 16,
      originPx: { x: 144, y: 0 },
      floorOffsetPx: 0,
      textureOf: () => Texture.EMPTY,
    });
    expect(stacks.transientCount()).toBe(1);
    view.setRects([rect(1n, 1, 0, 3, 2)]);
    const root = view.root;
    expect(root.x).toBe(144);
    expect(root.y).toBe(0);
    const sprites = view.itemSprites();
    expect(sprites).toHaveLength(1);
    // A 3x2 item at slot (1,0): its centre is at (1 + 1.5, 0 + 1) tiles.
    expect(sprites[0].x).toBe((1 + 1.5) * 16);
    expect(sprites[0].y).toBe(1 * 16);
    view.destroy();
    expect(stacks.transientCount()).toBe(0);
  });

  it("a rotated item is turned in quarter turns, not resized", () => {
    const { stacks } = build();
    const view = new PixiContainerView({
      stacks,
      objectId: 82n,
      floor: 0,
      grid: { width: 4, height: 3 },
      tileSizePx: 16,
      originPx: { x: 0, y: 0 },
      floorOffsetPx: 0,
      textureOf: () => Texture.EMPTY,
    });
    // A 3x2 item turned once covers 2 wide by 3 tall.
    view.setRects([rect(1n, 0, 0, 2, 3, 1)]);
    const [s] = view.itemSprites();
    expect(s.rotation).toBeCloseTo(Math.PI / 2);
    expect(s.x).toBe(1 * 16);
    expect(s.y).toBe(1.5 * 16);
    view.destroy();
  });

  it("an item whose texture is unknown is not drawn", () => {
    const { stacks } = build();
    const view = new PixiContainerView({
      stacks,
      objectId: 1n,
      floor: 0,
      grid: { width: 2, height: 2 },
      tileSizePx: 16,
      originPx: { x: 0, y: 0 },
      floorOffsetPx: 0,
      textureOf: () => undefined,
    });
    view.setRects([rect(1n, 0, 0, 1, 1)]);
    expect(view.itemSprites()).toHaveLength(0);
    view.destroy();
  });
});

describe("ContainerViewController lifecycle", () => {
  function controller() {
    const { world, stacks } = build();
    const ticker = fakeTicker();
    const released: bigint[] = [];
    const rowsFor = new Map<bigint, (rows: readonly HeldRow[]) => void>();
    const errorFor = new Map<bigint, () => void>();
    const c = new ContainerViewController({
      stacks,
      ticker,
      tileSizePx: 16,
      storeyHeightPx: 64,
      textureOf: () => Texture.EMPTY,
      bulkOf: () => ({ width: 1, height: 1 }),
      watchRows: (containerId, onRows, onError) => {
        rowsFor.set(containerId, onRows);
        errorFor.set(containerId, onError);
        return {
          release: () => {
            released.push(containerId);
          },
        };
      },
    });
    return { world, stacks, ticker, released, rowsFor, errorFor, c };
  }

  const object = {
    objectId: 82n,
    defId: 71,
    anchorX: 10,
    anchorY: 5,
    floor: 0,
    width: 2,
    height: 1,
    spriteHeightPx: 32,
  };

  it("opened and closed 50 times it ends at the baseline, ticker unsubscribed while closed", () => {
    const { world, stacks, ticker, released, c } = controller();
    const baselineStage = world.children.length;
    const baselineRoot = stacks.stackFor(0).root.children.length;
    expect(ticker.listenerCount()).toBe(0);
    for (let i = 0; i < 50; i++) {
      c.open({ object, grid: { width: 4, height: 3 } });
      expect(ticker.listenerCount()).toBe(1);
      expect(c.isOpen()).toBe(true);
      c.close();
      expect(ticker.listenerCount()).toBe(0);
      expect(c.isOpen()).toBe(false);
    }
    expect(world.children.length).toBe(baselineStage);
    expect(stacks.stackFor(0).root.children.length).toBe(baselineRoot);
    expect(stacks.transientCount()).toBe(0);
    expect(released).toHaveLength(50);
  });

  it("opening another container replaces the first: one view at a time", () => {
    const { stacks, released, c } = controller();
    c.open({ object, grid: { width: 4, height: 3 } });
    c.open({ object: { ...object, objectId: 83n }, grid: { width: 3, height: 2 } });
    expect(stacks.transientCount()).toBe(1);
    expect(released).toEqual([82n]);
    expect(c.openObjectId()).toBe(83n);
    c.close();
  });

  it("the view takes its object at construction and is destroyed on close", () => {
    const { c, stacks } = controller();
    c.open({ object, grid: { width: 4, height: 3 } });
    expect(c.openObjectId()).toBe(82n);
    const root = stacks.stackFor(0).root;
    const before = root.children.length;
    c.close();
    expect(root.children.length).toBe(before - 1);
  });

  it("rows arriving after close change nothing", () => {
    const { c, rowsFor, stacks } = controller();
    c.open({ object, grid: { width: 4, height: 3 } });
    const push = rowsFor.get(82n);
    c.close();
    push?.([{ instanceId: 1n, defId: 9, slotX: 0, slotY: 0, orientation: 0 }]);
    expect(stacks.transientCount()).toBe(0);
  });

  it("draws the rows it is given and redraws when they change", () => {
    const { c, rowsFor } = controller();
    c.open({ object, grid: { width: 4, height: 3 } });
    rowsFor.get(82n)?.([
      { instanceId: 1n, defId: 9, slotX: 0, slotY: 0, orientation: 0 },
      { instanceId: 2n, defId: 9, slotX: 2, slotY: 1, orientation: 1 },
    ]);
    expect(c.drawnRects()).toHaveLength(2);
    rowsFor.get(82n)?.([{ instanceId: 2n, defId: 9, slotX: 2, slotY: 1, orientation: 1 }]);
    expect(c.drawnRects()).toHaveLength(1);
    c.close();
    expect(c.drawnRects()).toEqual([]);
  });

  it("a failed subscription closes the view", () => {
    const { c, errorFor, released } = controller();
    c.open({ object, grid: { width: 4, height: 3 } });
    errorFor.get(82n)?.();
    expect(c.isOpen()).toBe(false);
    expect(released).toEqual([82n]);
  });

  it("closes itself on the frame the close rule says so", () => {
    const { c, ticker } = controller();
    let leave = false;
    c.open({ object, grid: { width: 4, height: 3 }, closeWhen: () => leave });
    expect(c.isOpen()).toBe(true);
    leave = true;
    ticker.fire();
    expect(c.isOpen()).toBe(false);
    expect(ticker.listenerCount()).toBe(0);
  });

  it("skips rows outside the grid and crops textures only when rows arrive", async () => {
    const prepared: number[][] = [];
    const { world, stacks } = build();
    const rowsFor: ((rows: readonly HeldRow[]) => void)[] = [];
    const c = new ContainerViewController({
      stacks,
      ticker: fakeTicker(),
      tileSizePx: 16,
      storeyHeightPx: 64,
      textureOf: () => Texture.EMPTY,
      prepare: async (ids) => {
        prepared.push([...ids]);
      },
      bulkOf: () => ({ width: 1, height: 1 }),
      watchRows: (_id, onRows) => {
        rowsFor.push(onRows);
        return { release: () => {} };
      },
    });
    expect(prepared).toEqual([]);
    c.open({ object, grid: { width: 2, height: 2 } });
    rowsFor[0]([
      { instanceId: 1n, defId: 9, slotX: 0, slotY: 0, orientation: 0 },
      { instanceId: 2n, defId: 9, slotX: 5, slotY: 0, orientation: 0 },
    ]);
    await Promise.resolve();
    expect(c.drawnRects().map((r) => r.instanceId)).toEqual([1n]);
    expect(prepared).toEqual([[9]]);
    expect(world.children.length).toBe(1);
    c.close();
  });
});
