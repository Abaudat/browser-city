// Story 3.16: a page-owned object (the link offer's carrier) is pickable but
// is never in the collision grid -- the grid is the streamed rows' alone.
import { describe, expect, it } from "vitest";
import { chunkKey } from "../../../src/world/chunk";
import type { ColliderSource } from "../../../src/world/collision-grid";
import { WorldIndex } from "../../../src/world/world-index";

const POST = 90;
const defs = new Map<number, ColliderSource>([
  [
    POST,
    {
      width: 1,
      height: 1,
      collider: { x0: 0, y0: 0, x1: 16, y1: 16 },
    },
  ],
]);
const row = (objectId: bigint, x: number, y: number) => ({
  objectId,
  defId: POST,
  x,
  y,
  floor: 0,
  layer: 3,
  orientation: 0,
  chunkKey: chunkKey(x, y, 0),
});

describe("WorldIndex.insertPickOnly", () => {
  it("is found by a pick at its cell and blocks nothing", () => {
    const world = new WorldIndex(16, defs);
    world.insertPickOnly(row(7n, 5, 5));
    expect(world.objectsAt(0, 5, 5).map((e) => e.objectId)).toEqual([7n]);
    expect(world.entriesInCell(0, 5, 5)).toEqual([]);
    expect(world.revision).toBe(0);
  });

  it("sits beside a streamed row on the same cell without replacing it", () => {
    const world = new WorldIndex(16, defs);
    world.insert(row(1n, 5, 5));
    world.insertPickOnly(row(7n, 5, 5));
    expect(
      world
        .objectsAt(0, 5, 5)
        .map((e) => e.objectId)
        .sort(),
    ).toEqual([1n, 7n]);
    expect(world.entriesInCell(0, 5, 5).length).toBeGreaterThan(0);
  });
});
