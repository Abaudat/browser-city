// The one fake world every `debug/` DOM test mounts against -- a real
// `WorldIndex` (never a stand-in for the collision grid) carrying all
// three collider states, plus a small pool. Shared so that the
// conformance suite and the mount's own tests can never disagree about
// what a conformant overlay was given to draw; an overlay added later
// grows this fixture rather than bringing its own.

import type { DebugWorldView } from "../../../src/debug/world-view";
import type { PlacedObject } from "../../../src/net/bindings/types";
import type { Drawable } from "../../../src/render/sort-key";
import { toSortUnits } from "../../../src/render/sort-units";
import type { ColliderSource } from "../../../src/world/collision-grid";
import { WorldIndex } from "../../../src/world/world-index";

export const SUBCELLS = 16;
export const TILE = 16;
export const STOREY = 48;

export const DEFS = new Map<number, ColliderSource>([
  [1, { width: 1, height: 1, collider: { x0: 0, y0: 0, x1: SUBCELLS, y1: SUBCELLS } }],
  [2, { width: 2, height: 1 }],
  // A zero-area collider at a sub-cell offset -- one the collision grid
  // does happen to rasterise into a cell.
  [3, { width: 1, height: 1, collider: { x0: 8, y0: 0, x1: 8, y1: SUBCELLS } }],
  // A *cell-aligned* zero-area collider, which the grid holds nothing for
  // at all (Tim's direction, cycle 2). Carried in the shared fixture so
  // every DOM-level test -- the mount's own and the conformance suite's --
  // draws the case that would silently disappear if `empty` were ever
  // read from the grid again.
  [4, { width: 1, height: 1, collider: { x0: 0, y0: 0, x1: 0, y1: SUBCELLS } }],
]);

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

const POOL: readonly Drawable[] = [
  { stableId: 1n, x: toSortUnits(0), y: toSortUnits(0), rank: 20, floor: 0 },
  { stableId: 2n, x: toSortUnits(2), y: toSortUnits(0), rank: 30, floor: 0 },
];

/** A world holding one real collider, one object with no collider and two
 * zero-area colliders -- the three states AC2 requires be distinguishable,
 * with the zero-area one present in both its grid-visible and its
 * grid-invisible (cell-aligned) form. */
export function conformanceView(): DebugWorldView {
  const world = new WorldIndex(SUBCELLS, DEFS);
  world.insert(row({ objectId: 1n, defId: 1, x: 0, y: 0 }));
  world.insert(row({ objectId: 2n, defId: 2, x: 2, y: 0 }));
  world.insert(row({ objectId: 3n, defId: 3, x: 5, y: 0 }));
  world.insert(row({ objectId: 4n, defId: 4, x: 7, y: 0 }));
  const bounds = { floor: 0, cellX0: -4, cellY0: -4, cellX1: 8, cellY1: 8 };
  return {
    tileSizePx: TILE,
    storeyHeightPx: STOREY,
    colliderSubcellsPerCell: SUBCELLS,
    viewerFloor: () => 0,
    viewportCells: () => bounds,
    entriesInCell: (floor, cellX, cellY) => world.entriesInCell(floor, cellX, cellY),
    objects: (b) => world.objects(b),
    pool: () => POOL,
    orderOf: (id) => POOL.findIndex((d) => d.stableId === id),
  };
}

/** The same view, counting every read an overlay makes of it -- what
 * proves "every overlay off means no work at all". */
export function countingView(inner: DebugWorldView): {
  view: DebugWorldView;
  reads: () => number;
} {
  let reads = 0;
  return {
    reads: () => reads,
    view: {
      ...inner,
      viewerFloor: () => {
        reads++;
        return inner.viewerFloor();
      },
      viewportCells: () => {
        reads++;
        return inner.viewportCells();
      },
      entriesInCell: (floor, cellX, cellY) => {
        reads++;
        return inner.entriesInCell(floor, cellX, cellY);
      },
      objects: (bounds) => {
        reads++;
        return inner.objects(bounds);
      },
      pool: () => {
        reads++;
        return inner.pool();
      },
      orderOf: (id) => {
        reads++;
        return inner.orderOf(id);
      },
    },
  };
}
