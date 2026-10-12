// D-L3: the walkability mirror answers exactly as the live grid does, for
// every cell, after any run of inserts and deletes -- the property the solver
// on the other thread rests on.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ColliderSource, CollisionGrid } from "../../../src/world/collision-grid";
import { npcWalkability } from "../../../src/world/npc-walkable";
import { WalkFeed, WalkMirror } from "../../../src/world/walk-mirror";

const DEF: ColliderSource = { width: 1, height: 1, collider: { x0: 0, y0: 0, x1: 16, y1: 16 } };

function row(objectId: bigint, x: number, y: number, floor = 0) {
  return { objectId, defId: 1, x, y, floor, layer: 0, orientation: 0, chunkKey: 0n };
}

function sync(feed: WalkFeed, mirror: WalkMirror): void {
  for (const c of feed.collect()) mirror.setChunk(c.floor, c.cx, c.cy, c.blocked);
}

describe("CollisionGrid.drainChangedChunks", () => {
  it("names each touched chunk once, then forgets it", () => {
    const grid = new CollisionGrid(16, new Map([[1, DEF]]));
    grid.insert(row(1n, 3, 3));
    grid.insert(row(2n, 4, 3));
    grid.insert(row(3n, 40, -5));
    const seen: string[] = [];
    grid.drainChangedChunks((f, cx, cy) => seen.push(`${f},${cx},${cy}`));
    expect(seen.sort()).toEqual(["0,0,0", "0,1,-1"]);
    const again: string[] = [];
    grid.drainChangedChunks((f, cx, cy) => again.push(`${f},${cx},${cy}`));
    expect(again).toEqual([]);
    grid.delete(row(1n, 3, 3));
    grid.drainChangedChunks((f, cx, cy) => again.push(`${f},${cx},${cy}`));
    expect(again).toEqual(["0,0,0"]);
  });
});

describe("WalkMirror", () => {
  it("reads an unsent chunk as walkable and moves its revision on every chunk", () => {
    const m = new WalkMirror();
    expect(m.walkable(0, 5, 5)).toBe(true);
    const r = m.revision();
    m.setChunk(0, 0, 0, new Uint8Array(32 * 32).fill(1));
    expect(m.walkable(0, 5, 5)).toBe(false);
    expect(m.walkable(1, 5, 5)).toBe(true);
    expect(m.revision()).toBeGreaterThan(r);
    m.setChunk(0, 0, 0, null);
    expect(m.walkable(0, 5, 5)).toBe(true);
  });

  it("answers as the live walkability does, through any run of inserts and deletes", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            insert: fc.boolean(),
            id: fc.integer({ min: 0, max: 12 }),
            x: fc.integer({ min: -40, max: 70 }),
            y: fc.integer({ min: -40, max: 70 }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        (ops) => {
          const grid = new CollisionGrid(16, new Map([[1, DEF]]));
          const live = npcWalkability(grid);
          const mirror = new WalkMirror();
          const feed = new WalkFeed(live, grid);
          const placed = new Map<number, ReturnType<typeof row>>();
          for (const op of ops) {
            const existing = placed.get(op.id);
            if (op.insert && !existing) {
              const r = row(BigInt(op.id), op.x, op.y);
              placed.set(op.id, r);
              grid.insert(r);
            } else if (!op.insert && existing) {
              placed.delete(op.id);
              grid.delete(existing);
            }
            sync(feed, mirror);
          }
          for (let y = -64; y < 100; y++) {
            for (let x = -64; x < 100; x++) {
              if (mirror.walkable(0, x, y) !== live.walkable(0, x, y)) return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 25 },
    );
  });

  it("sends the seeded chunks once, whatever the source says", () => {
    const grid = new CollisionGrid(16, new Map());
    const walk = {
      revision: () => 0,
      walkable: (_f: number, x: number, y: number) => !(x === 40 && y === 3),
    };
    const feed = new WalkFeed(walk, grid, [{ x0: 40, y0: 3, x1: 41, y1: 3, floor: 0 }]);
    const mirror = new WalkMirror();
    sync(feed, mirror);
    expect(mirror.walkable(0, 40, 3)).toBe(false);
    expect(mirror.walkable(0, 41, 3)).toBe(true);
    expect(feed.collect()).toEqual([]);
  });
});
