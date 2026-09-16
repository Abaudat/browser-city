import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildCollisionRects } from "../../../src/debug/collision-rects";
import { DEBUG_STYLE } from "../../../src/debug/debug-style";
import type { DebugWorldView } from "../../../src/debug/world-view";
import type { PlacedObject } from "../../../src/net/bindings/types";
import { subcellRectPx } from "../../../src/render/screen-position";
import type { ColliderSource } from "../../../src/world/collision-grid";
import type { CellBounds } from "../../../src/world/world-index";
import { WorldIndex } from "../../../src/world/world-index";

const SUBCELLS = 16;
const TILE = 16;
const STOREY = 48;

function row(overrides: Partial<PlacedObject> & { objectId: bigint }): PlacedObject {
  return {
    defId: 1,
    x: 0,
    y: 0,
    floor: 0,
    layer: 0,
    orientation: 0,
    chunkKey: 0n,
    ...overrides,
  } as PlacedObject;
}

/** A view over a real `WorldIndex` -- the same class the movement
 * resolver reads, never a stand-in for it. */
function viewOver(
  world: WorldIndex,
  bounds: CellBounds = { floor: 0, cellX0: -8, cellY0: -8, cellX1: 8, cellY1: 8 },
): DebugWorldView {
  return {
    tileSizePx: TILE,
    storeyHeightPx: STOREY,
    colliderSubcellsPerCell: SUBCELLS,
    viewerFloor: () => bounds.floor,
    viewportCells: () => bounds,
    entriesInCell: (floor, cellX, cellY) => world.entriesInCell(floor, cellX, cellY),
    objects: (b) => world.objects(b),
    pool: () => [],
    orderOf: () => undefined,
  };
}

const DEFS = new Map<number, ColliderSource>([
  // A real collider: the left half of its own cell.
  [1, { width: 1, height: 1, collider: { x0: 0, y0: 0, x1: 8, y1: 16 } }],
  // No collider at all (FR128: walkable).
  [2, { width: 2, height: 1 }],
  // A collider declared with no area.
  [3, { width: 1, height: 1, collider: { x0: 4, y0: 4, x1: 4, y1: 12 } }],
]);

function worldWith(...rows: PlacedObject[]): WorldIndex {
  const world = new WorldIndex(SUBCELLS, DEFS);
  for (const r of rows) world.insert(r);
  return world;
}

describe("buildCollisionRects", () => {
  it("draws a real collider at its true sub-cell position on its own floor (AC2)", () => {
    const world = worldWith(row({ objectId: 1n, defId: 1, x: 3, y: 2 }));
    const rects = buildCollisionRects(viewOver(world));
    expect(rects).toHaveLength(1);
    const expected = subcellRectPx(
      { x0: 3 * SUBCELLS, y0: 2 * SUBCELLS, x1: 3 * SUBCELLS + 8, y1: 3 * SUBCELLS },
      0,
      SUBCELLS,
      TILE,
      STOREY,
    );
    expect(rects[0]).toMatchObject({
      objectId: 1n,
      kind: "collider",
      ...expected,
    });
  });

  it("distinguishes no collider from a zero-size collider from a real one (AC2)", () => {
    const world = worldWith(
      row({ objectId: 1n, defId: 1, x: 0, y: 0 }),
      row({ objectId: 2n, defId: 2, x: 2, y: 0 }),
      row({ objectId: 3n, defId: 3, x: 5, y: 0 }),
    );
    const byId = new Map(buildCollisionRects(viewOver(world)).map((r) => [r.objectId, r]));
    expect(byId.get(1n)?.kind).toBe("collider");
    expect(byId.get(2n)?.kind).toBe("none");
    expect(byId.get(3n)?.kind).toBe("empty");
    // Three distinct kinds means three distinct colours: the difference
    // is decided here, never invented by whatever draws these.
    const colours = new Set([...byId.values()].map((r) => r.stroke));
    expect(colours.size).toBe(3);
  });

  it("outlines the whole footprint for an object with no collider, not one cell of it", () => {
    const world = worldWith(row({ objectId: 2n, defId: 2, x: 4, y: 1 }));
    const [rect] = buildCollisionRects(viewOver(world));
    expect(rect).toMatchObject({
      kind: "none",
      x: 4 * TILE,
      y: 1 * TILE,
      width: 2 * TILE,
      height: 1 * TILE,
      fill: "none",
    });
  });

  it("keeps a zero-area collider zero-area, and marks it so it can still be drawn", () => {
    const world = worldWith(row({ objectId: 3n, defId: 3, x: 0, y: 0 }));
    const [rect] = buildCollisionRects(viewOver(world));
    expect(rect?.kind).toBe("empty");
    expect(rect?.width).toBe(0);
    expect(rect?.height).toBe(8);
    expect(rect?.fill).toBe("none");
  });

  it("offsets by floor through the renderer's own projection (FR124)", () => {
    const world = worldWith(row({ objectId: 1n, defId: 1, x: 0, y: 0, floor: 2 }));
    const bounds = { floor: 2, cellX0: -2, cellY0: -2, cellX1: 2, cellY1: 2 };
    const [rect] = buildCollisionRects(viewOver(world, bounds));
    expect(rect?.y).toBe(subcellRectPx({ x0: 0, y0: 0, x1: 1, y1: 1 }, 2, SUBCELLS, TILE, STOREY).y);
  });

  it("draws only the viewer's own floor", () => {
    const world = worldWith(
      row({ objectId: 1n, defId: 1, x: 0, y: 0, floor: 0 }),
      row({ objectId: 2n, defId: 1, x: 0, y: 0, floor: 1 }),
    );
    expect(buildCollisionRects(viewOver(world)).map((r) => r.objectId)).toEqual([1n]);
  });

  it("emits one rect per collider, however many cells that collider spans", () => {
    const wide = new Map<number, ColliderSource>([
      [1, { width: 3, height: 1, collider: { x0: 0, y0: 0, x1: 3 * SUBCELLS, y1: SUBCELLS } }],
    ]);
    const world = new WorldIndex(SUBCELLS, wide);
    world.insert(row({ objectId: 1n, defId: 1, x: 0, y: 0 }));
    const rects = buildCollisionRects(viewOver(world));
    expect(rects).toHaveLength(1);
    expect(rects[0]?.width).toBe(3 * TILE);
  });

  it("only ever uses colours from the shared palette", () => {
    const world = worldWith(
      row({ objectId: 1n, defId: 1, x: 0, y: 0 }),
      row({ objectId: 2n, defId: 2, x: 2, y: 0 }),
      row({ objectId: 3n, defId: 3, x: 5, y: 0 }),
    );
    const palette = new Set<string>(Object.values(DEBUG_STYLE.palette));
    for (const rect of buildCollisionRects(viewOver(world))) {
      expect(palette.has(rect.stroke)).toBe(true);
    }
  });

  it("reads the live grid, so an object the grid no longer holds stops being drawn", () => {
    // The overlay must never be a second expansion of `defs/`: a tool that
    // reads its own copy of the world can confirm a bug that is not there.
    const placed = row({ objectId: 1n, defId: 1, x: 0, y: 0 });
    const world = worldWith(placed);
    expect(buildCollisionRects(viewOver(world))[0]?.kind).toBe("collider");
    world.delete(placed);
    expect(buildCollisionRects(viewOver(world))).toEqual([]);
  });

  it("costs the viewport, not the world (Quentin's counting wrapper)", () => {
    function cellReads(objectCount: number): number {
      const world = worldWith();
      for (let i = 0; i < objectCount; i++) {
        world.insert(row({ objectId: BigInt(i + 1), defId: 1, x: 100 + i * 2, y: 100 }));
      }
      let reads = 0;
      const bounds = { floor: 0, cellX0: 0, cellY0: 0, cellX1: 3, cellY1: 3 };
      const base = viewOver(world, bounds);
      const counting: DebugWorldView = {
        ...base,
        entriesInCell: (floor, cellX, cellY) => {
          reads++;
          return base.entriesInCell(floor, cellX, cellY);
        },
      };
      buildCollisionRects(counting);
      return reads;
    }
    expect(cellReads(2)).toBe(16);
    expect(cellReads(200)).toBe(16);
  });

  // The overlay shows exactly what the collision system believes, for any
  // world: an independent, from-scratch rebuild of what the grid reports
  // over the viewport must be the same multiset of rects the builder
  // emits. A dropped translation, a doubled anchor or a stale cache all
  // fail here.
  it("inv_collision_overlay_shows_exactly_the_colliders", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            objectId: fc.integer({ min: 1, max: 60 }).map((n) => BigInt(n)),
            defId: fc.constantFrom(1, 2, 3),
            x: fc.integer({ min: -6, max: 6 }),
            y: fc.integer({ min: -6, max: 6 }),
            floor: fc.constantFrom(-1, 0, 1),
          }),
          { maxLength: 25 },
        ),
        fc.constantFrom(-1, 0, 1),
        (placements, viewerFloor) => {
          const world = new WorldIndex(SUBCELLS, DEFS);
          const live = new Map<bigint, PlacedObject>();
          for (const p of placements) {
            const next = row(p);
            const existing = live.get(next.objectId);
            if (existing) world.update(existing, next);
            else world.insert(next);
            live.set(next.objectId, next);
          }
          const bounds = { floor: viewerFloor, cellX0: -8, cellY0: -8, cellX1: 8, cellY1: 8 };
          const rects = buildCollisionRects(viewOver(world, bounds));

          // The independent rebuild: whatever the grid reports over the
          // same window, deduplicated by object, plus the objects the
          // grid has nothing to say about at all.
          const fromGrid = new Map<bigint, { x0: number; y0: number; x1: number; y1: number }>();
          for (let cy = bounds.cellY0; cy <= bounds.cellY1; cy++) {
            for (let cx = bounds.cellX0; cx <= bounds.cellX1; cx++) {
              for (const entry of world.entriesInCell(viewerFloor, cx, cy)) {
                fromGrid.set(entry.objectId, entry.rect);
              }
            }
          }
          const withoutCollider = new Set<bigint>();
          for (const object of world.objects(bounds)) {
            if (!object.collider) withoutCollider.add(object.objectId);
          }

          expect(new Set(rects.map((r) => r.objectId))).toEqual(
            new Set([...fromGrid.keys(), ...withoutCollider]),
          );
          for (const rect of rects) {
            if (rect.kind === "none") {
              expect(withoutCollider.has(rect.objectId)).toBe(true);
              continue;
            }
            const gridRect = fromGrid.get(rect.objectId);
            expect(gridRect).toBeDefined();
            if (!gridRect) continue;
            const expected = subcellRectPx(gridRect, viewerFloor, SUBCELLS, TILE, STOREY);
            expect({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }).toEqual(
              expected,
            );
            const hasArea = gridRect.x1 > gridRect.x0 && gridRect.y1 > gridRect.y0;
            expect(rect.kind).toBe(hasArea ? "collider" : "empty");
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
