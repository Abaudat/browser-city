import { describe, expect, it } from "vitest";
import { CollisionGrid } from "../../../src/world/collision-grid";
import { npcWalkability } from "../../../src/world/npc-walkable";

const SUBCELLS = 16;
const defs = new Map([
  [1, { width: 1, height: 1, collider: { x0: 14, y0: 14, x1: 16, y1: 16 } }],
  [2, { width: 1, height: 1 }],
]);

function row(objectId: bigint, defId: number, x: number, y: number) {
  return { objectId, defId, x, y, floor: 0, layer: 0, orientation: 0, chunkKey: 0n };
}

describe("npcWalkability", () => {
  it("a tile any collider touches, however slightly, is not walkable", () => {
    const grid = new CollisionGrid(SUBCELLS, defs);
    grid.insert(row(1n, 1, 3, 3));
    const walk = npcWalkability(grid);
    expect(walk.walkable(0, 3, 3)).toBe(false);
    expect(walk.walkable(0, 4, 3)).toBe(true);
    expect(walk.walkable(1, 3, 3)).toBe(true);
  });

  it("a colliderless object and an unstreamed chunk read as walkable", () => {
    const grid = new CollisionGrid(SUBCELLS, defs);
    grid.insert(row(2n, 2, 3, 3));
    const walk = npcWalkability(grid);
    expect(walk.walkable(0, 3, 3)).toBe(true);
    expect(walk.walkable(0, 9999, -9999)).toBe(true);
  });

  it("the revision moves on every change to the grid and only then", () => {
    const grid = new CollisionGrid(SUBCELLS, defs);
    const walk = npcWalkability(grid);
    const r0 = walk.revision();
    expect(walk.revision()).toBe(r0);
    grid.insert(row(1n, 1, 3, 3));
    const r1 = walk.revision();
    expect(r1).toBeGreaterThan(r0);
    grid.insert(row(2n, 2, 5, 5)); // no collider: nothing changed
    expect(walk.revision()).toBe(r1);
    grid.update(row(1n, 1, 3, 3), row(1n, 1, 6, 6));
    expect(walk.revision()).toBeGreaterThan(r1);
    const r2 = walk.revision();
    grid.delete(row(1n, 1, 6, 6));
    expect(walk.revision()).toBeGreaterThan(r2);
  });
});
