import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildCollisionRects } from "../../../src/debug/collision-rects";
import { DEBUG_STYLE } from "../../../src/debug/debug-style";
import type { DebugWorldView } from "../../../src/debug/world-view";
import type { PlacedObject } from "../../../src/net/bindings/types";
import { subcellRectPx } from "../../../src/render/screen-position";
import type { ColliderSource } from "../../../src/world/collision-grid";
import { type CellBounds, emptyCellBounds, WorldIndex } from "../../../src/world/world-index";

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
  // A collider declared with no area, at a sub-cell offset: the grid
  // happens to rasterise this one into a single cell.
  [3, { width: 1, height: 1, collider: { x0: 4, y0: 4, x1: 4, y1: 12 } }],
  // A collider declared with no area, *cell-aligned*: `cellsForRange`
  // returns an empty range whenever a zero-width value is a multiple of
  // the sub-cell count, so the collision grid holds nothing at all for
  // this one. It is the reason `empty` is decided from the definition
  // rather than from the grid (Tim's direction, cycle 2).
  [4, { width: 1, height: 1, collider: { x0: 0, y0: 0, x1: 0, y1: 16 } }],
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

  // Tim's direction, cycle 2. `CollisionGrid` rasterises through
  // `cellsForRange(min, max, s)` = `[floor(min/s), ceil(max/s) - 1]`,
  // which for `min === max` is an *empty* range whenever the value is a
  // multiple of `s`. So a cell-aligned zero-area collider is in no cell of
  // the grid at all: an overlay that decided `empty` from the grid would
  // draw this object nothing whatsoever -- exactly the "nothing drawn is
  // indistinguishable from the overlay being broken" failure AC2 exists
  // to prevent. The definition is the only source that always knows.
  it("draws a cell-aligned zero-area collider, which the grid holds nothing for", () => {
    const world = worldWith(row({ objectId: 4n, defId: 4, x: 3, y: 2 }));
    // The premise: the grid really does report nothing, anywhere.
    for (let cy = 0; cy <= 4; cy++) {
      for (let cx = 0; cx <= 5; cx++) {
        expect(world.entriesInCell(0, cx, cy)).toEqual([]);
      }
    }
    const rects = buildCollisionRects(viewOver(world));
    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({
      objectId: 4n,
      kind: "empty",
      // At its own declared origin, translated by the anchor cell.
      x: 3 * TILE,
      y: 2 * TILE,
      width: 0,
      height: TILE,
    });
  });

  it("never draws a zero-area collider twice, whether or not the grid also holds it", () => {
    const world = worldWith(
      row({ objectId: 3n, defId: 3, x: 0, y: 0 }),
      row({ objectId: 4n, defId: 4, x: 2, y: 0 }),
    );
    const rects = buildCollisionRects(viewOver(world));
    expect(rects.map((r) => r.objectId).sort()).toEqual([3n, 4n]);
    expect(rects.every((r) => r.kind === "empty")).toBe(true);
  });

  it("draws nothing at all for an empty viewport window, and reads nothing either", () => {
    // A camera that describes no rectangle (`visibleCellBounds`) must not
    // send either pass looping.
    const world = worldWith(row({ objectId: 1n, defId: 1, x: 0, y: 0 }));
    let reads = 0;
    const base = viewOver(world, emptyCellBounds(0));
    const counting: DebugWorldView = {
      ...base,
      entriesInCell: (f, x, y) => {
        reads++;
        return base.entriesInCell(f, x, y);
      },
      objects: (b) => {
        reads++;
        return base.objects(b);
      },
    };
    expect(buildCollisionRects(counting)).toEqual([]);
    expect(reads).toBe(0);
  });

  it("draws nothing for an object whose footprint is in view but whose collider is not", () => {
    // The footprint index reaches into the window, so `objects()` yields
    // it; the grid does not report its collider there, so there is no
    // collider on screen to draw. Not an error, and not a `none` either --
    // it does declare one.
    const reaching = new Map<number, ColliderSource>([
      // A 3-wide prop whose collider is confined to its own last cell.
      [
        1,
        {
          width: 3,
          height: 1,
          collider: { x0: 2 * SUBCELLS, y0: 0, x1: 3 * SUBCELLS, y1: SUBCELLS },
        },
      ],
    ]);
    const world = new WorldIndex(SUBCELLS, reaching);
    world.insert(row({ objectId: 1n, defId: 1, x: 0, y: 0 }));
    // A window over the prop's first cell only: footprint yes, collider no.
    const bounds = { floor: 0, cellX0: 0, cellY0: 0, cellX1: 0, cellY1: 0 };
    expect([...world.objects(bounds)].map((o) => o.objectId)).toEqual([1n]);
    expect(world.entriesInCell(0, 0, 0)).toEqual([]);
    expect(buildCollisionRects(viewOver(world, bounds))).toEqual([]);
  });

  it("offsets by floor through the renderer's own projection (FR124)", () => {
    const world = worldWith(row({ objectId: 1n, defId: 1, x: 0, y: 0, floor: 2 }));
    const bounds = { floor: 2, cellX0: -2, cellY0: -2, cellX1: 2, cellY1: 2 };
    const [rect] = buildCollisionRects(viewOver(world, bounds));
    expect(rect?.y).toBe(
      subcellRectPx({ x0: 0, y0: 0, x1: 1, y1: 1 }, 2, SUBCELLS, TILE, STOREY).y,
    );
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

  // Story 2.2 cycle 1 (Tim's direction): a 3-wide, 2-tall def is the only
  // shape that can tell the footprint's north-west sub-cell origin apart
  // from its south-west anchor cell -- every def in `DEFS` above is one
  // cell tall, which reads identically either way.
  it("draws a multi-row footprint's outline and collider from its north-west origin, not its anchor cell", () => {
    const tall = new Map<number, ColliderSource>([
      [1, { width: 3, height: 2, collider: { x0: 0, y0: 0, x1: 3 * SUBCELLS, y1: SUBCELLS } }],
    ]);
    const world = new WorldIndex(SUBCELLS, tall);
    // Anchor at (2, 3): the footprint's north-west origin is (2, 2).
    world.insert(row({ objectId: 1n, defId: 1, x: 2, y: 3 }));
    const rects = buildCollisionRects(viewOver(world));
    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({
      kind: "collider",
      x: 2 * TILE,
      y: 2 * TILE,
      width: 3 * TILE,
      // The collider's own declared height is 1 cell (y1 - y0 = SUBCELLS),
      // not the footprint's full 2-cell height.
      height: 1 * TILE,
    });
  });

  it("draws a multi-row footprint's outline from its north-west origin when it has no collider", () => {
    const tall = new Map<number, ColliderSource>([[1, { width: 3, height: 2 }]]);
    const world = new WorldIndex(SUBCELLS, tall);
    world.insert(row({ objectId: 1n, defId: 1, x: 2, y: 3 }));
    const [rect] = buildCollisionRects(viewOver(world));
    expect(rect).toMatchObject({
      kind: "none",
      x: 2 * TILE,
      y: 2 * TILE,
      width: 3 * TILE,
      height: 2 * TILE,
    });
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
  // world -- against an independent, from-scratch rebuild, never a
  // restatement of the implementation. Every object in the window gets
  // exactly one rect, and which of the three states it gets is decided
  // from the source that can actually know it (Tim's direction, cycle 2):
  //
  //   - `collider`: the live grid's own entry, which is what a step
  //     actually resolves against, at the grid's own rect;
  //   - `empty` and `none`: the *definition*, because the grid cannot
  //     represent either -- a cell-aligned zero-area collider is in no
  //     cell of it at all, and an absent collider is absent by design
  //     (FR128).
  //
  // A dropped translation, a doubled anchor, a state read from the wrong
  // source or an object drawn twice all fail here.
  it("inv_collision_overlay_shows_exactly_the_colliders", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            objectId: fc.integer({ min: 1, max: 60 }).map((n) => BigInt(n)),
            defId: fc.constantFrom(1, 2, 3, 4),
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

          // Rebuild (a): what the live grid reports over the same window,
          // deduplicated by object, area-having entries only.
          const fromGrid = new Map<bigint, { x0: number; y0: number; x1: number; y1: number }>();
          for (let cy = bounds.cellY0; cy <= bounds.cellY1; cy++) {
            for (let cx = bounds.cellX0; cx <= bounds.cellX1; cx++) {
              for (const entry of world.entriesInCell(viewerFloor, cx, cy)) {
                if (entry.rect.x1 > entry.rect.x0 && entry.rect.y1 > entry.rect.y0) {
                  fromGrid.set(entry.objectId, entry.rect);
                }
              }
            }
          }
          // Rebuild (b): what each object's own definition declares.
          const declaredEmpty = new Map<
            bigint,
            { x0: number; y0: number; x1: number; y1: number }
          >();
          const declaredNone = new Map<
            bigint,
            { x0: number; y0: number; x1: number; y1: number }
          >();
          for (const object of world.objects(bounds)) {
            const anchorXSub = object.anchorX * SUBCELLS;
            const anchorYSub = object.anchorY * SUBCELLS;
            if (!object.collider) {
              declaredNone.set(object.objectId, {
                x0: anchorXSub,
                y0: anchorYSub,
                x1: anchorXSub + object.width * SUBCELLS,
                y1: anchorYSub + object.height * SUBCELLS,
              });
              continue;
            }
            const c = object.collider;
            if (c.x1 === c.x0 || c.y1 === c.y0) {
              declaredEmpty.set(object.objectId, {
                x0: anchorXSub + c.x0,
                y0: anchorYSub + c.y0,
                x1: anchorXSub + c.x1,
                y1: anchorYSub + c.y1,
              });
            }
          }

          // Every object in the window is drawn exactly once, and nothing
          // else is drawn at all.
          const drawn = rects.map((r) => r.objectId);
          expect(new Set(drawn).size).toBe(drawn.length);
          expect(new Set(drawn)).toEqual(
            new Set([...fromGrid.keys(), ...declaredEmpty.keys(), ...declaredNone.keys()]),
          );

          for (const rect of rects) {
            const actual = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            const expectedFrom = (r: { x0: number; y0: number; x1: number; y1: number }) =>
              subcellRectPx(r, viewerFloor, SUBCELLS, TILE, STOREY);
            if (rect.kind === "collider") {
              const gridRect = fromGrid.get(rect.objectId);
              expect(
                gridRect,
                `${rect.objectId} drawn as a collider the grid does not hold`,
              ).toBeDefined();
              if (gridRect) expect(actual).toEqual(expectedFrom(gridRect));
            } else if (rect.kind === "empty") {
              const declared = declaredEmpty.get(rect.objectId);
              expect(
                declared,
                `${rect.objectId} drawn as empty without declaring one`,
              ).toBeDefined();
              if (declared) expect(actual).toEqual(expectedFrom(declared));
              // A zero-area collider stays zero-area: it must never be
              // widened into something that reads as blocking.
              expect(rect.width === 0 || rect.height === 0).toBe(true);
            } else {
              const declared = declaredNone.get(rect.objectId);
              expect(
                declared,
                `${rect.objectId} drawn as having no collider while declaring one`,
              ).toBeDefined();
              if (declared) expect(actual).toEqual(expectedFrom(declared));
            }
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
