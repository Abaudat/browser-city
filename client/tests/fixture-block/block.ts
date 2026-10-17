// The e2e fixture block: a small hand-laid block of the world the generator
// does not make yet -- a subway stairwell down to a platform, a footbridge
// flight up to a deck, a cupboard that holds items -- as `placed_object`,
// `floor_transition` and `ground_area` rows built from the real
// `defs/objects` and nothing else. `spacetime-harness.mjs` restores it into
// the e2e world before the district is generated and clears the district's
// own rows under it afterwards, so the block stands alone at these
// coordinates, in the one streamed world every spec shares.
//
// It is the in-memory stairs world (`unit/support/stairs-world.ts`) as rows:
// a collider-only rect there is a wall segment per cell here.
//
// It lives under `client/tests/` and is never shipped: `deploy.yml`
// publishes no module that can place it, and the generator never sees it.
// `fixtures/fixture-block.v1.json` is this file's output
// (`regen-block.ts`); `block-current.test.ts` fails when it moved.

import { chunkKey } from "../../src/world/chunk";
import { committedMovementConfig } from "../unit/support/committed-defs";
import {
  committedDefs,
  STREET_FLOOR,
  STREET_TRANSITIONS,
  SUBWAY_FLOOR,
  streetObjectSources,
  streetPlacedRows,
} from "../unit/support/stairs-world";

/** The def every collider-only rect of the in-memory world becomes. */
const WALL_SEGMENT_DEF_ID = 6;
const CUPBOARD_DEF_ID = 71;
const SIDEWALK_DEF_ID = 10;
const FLOOR_DEF_ID = 24;
/** The in-memory world's collider-only rects carry def ids from here up. */
const SYNTHETIC_DEF_BASE = 10_000;

/** Where the cupboard stands and what it holds (`defs/items`). */
export const BLOCK_CUPBOARD = {
  x: 23,
  y: 12,
  items: [
    { defId: 9, slotX: 0, slotY: 0, orientation: 0 },
    { defId: 10, slotX: 1, slotY: 0, orientation: 0 },
    { defId: 12, slotX: 3, slotY: 0, orientation: 0 },
    { defId: 12, slotX: 0, slotY: 1, orientation: 1 },
    { defId: 13, slotX: 2, slotY: 1, orientation: 0 },
  ],
} as const;

/** The floor-0 chunk columns the district's rows are cleared from. */
export const BLOCK_CHUNKS = { cx0: 0, cy0: 0, cx1: 0, cy1: 0 } as const;

type Row8 = readonly [number, number, number, number, number, number, number, string];

export interface BlockDump {
  readonly version: 1;
  readonly chunks: typeof BLOCK_CHUNKS;
  /** The highest id any block row carries: the clear spares ids at or
   * below it. */
  readonly maxId: number;
  /** `[id, def, x, y, floor, layer, orientation, chunkKey]` */
  readonly placed: readonly Row8[];
  /** `[id, x, y, floor, targetX, targetY, targetFloor, chunkKey]` */
  readonly transitions: readonly Row8[];
  /** `[id, def, x0, y0, x1, y1, floor, chunkKey]` */
  readonly ground: readonly Row8[];
  readonly cupboard: {
    readonly objectId: number;
    readonly x: number;
    readonly y: number;
    readonly items: typeof BLOCK_CUPBOARD.items;
  };
}

/** The block, as rows. Ids are 1..N in a fixed order. */
export function buildBlock(): BlockDump {
  const defs = committedDefs();
  const sub = committedMovementConfig().subcellsPerCell;
  const sources = streetObjectSources();
  const layerOf = (defId: number): number => {
    const def = defs.objects.find((o) => o.id === defId);
    if (!def) throw new Error(`the block names def ${defId}, which defs/ lacks`);
    return def.layer;
  };
  const placed: Row8[] = [];
  const push = (defId: number, x: number, y: number, floor: number): number => {
    const id = placed.length + 1;
    placed.push([id, defId, x, y, floor, layerOf(defId), 0, chunkKey(x, y, floor).toString()]);
    return id;
  };
  for (const row of streetPlacedRows()) {
    if (row.defId < SYNTHETIC_DEF_BASE) {
      push(row.defId, row.x, row.y, row.floor);
      continue;
    }
    // A collider-only rect: `x`/`y` is its smallest x and largest y cell. One
    // that fills its cells is a wall segment per cell; a rail or post that
    // fills only part of them has no def to stand as (a wall would close the
    // cells it only edges), so the block leaves it out.
    const size = sources.get(row.defId);
    if (!size) throw new Error(`no size for collider rect def ${row.defId}`);
    if (!fillsItsCells(size, sub)) continue;
    for (let dy = 0; dy < size.height; dy++) {
      for (let dx = 0; dx < size.width; dx++) {
        push(WALL_SEGMENT_DEF_ID, row.x + dx, row.y - dy, row.floor);
      }
    }
  }
  const cupboardId = push(CUPBOARD_DEF_ID, BLOCK_CUPBOARD.x, BLOCK_CUPBOARD.y, STREET_FLOOR);

  const transitions: Row8[] = STREET_TRANSITIONS.map((t, index) => [
    index + 1,
    t.x,
    t.y,
    t.floor,
    t.targetX,
    t.targetY,
    t.targetFloor,
    chunkKey(t.x, t.y, t.floor).toString(),
  ]);

  const rect = (
    id: number,
    def: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    floor: number,
  ): Row8 => [id, def, x0, y0, x1, y1, floor, chunkKey(x0, y0, floor).toString()];
  const ground: Row8[] = [
    rect(1, SIDEWALK_DEF_ID, 12, 5, 25, 14, STREET_FLOOR),
    rect(2, FLOOR_DEF_ID, 14, 2, 20, 6, SUBWAY_FLOOR),
  ];

  return {
    version: 1,
    chunks: BLOCK_CHUNKS,
    maxId: Math.max(placed.length, transitions.length, ground.length),
    placed,
    transitions,
    ground,
    cupboard: {
      objectId: cupboardId,
      x: BLOCK_CUPBOARD.x,
      y: BLOCK_CUPBOARD.y,
      items: BLOCK_CUPBOARD.items,
    },
  };
}

/** Whether a collider-only rect's collider is the whole of its cells. */
function fillsItsCells(
  source: {
    readonly width: number;
    readonly height: number;
    readonly collider?: { x0: number; y0: number; x1: number; y1: number };
  },
  sub: number,
): boolean {
  const c = source.collider;
  if (!c) return true;
  return c.x0 === 0 && c.y0 === 0 && c.x1 === source.width * sub && c.y1 === source.height * sub;
}
