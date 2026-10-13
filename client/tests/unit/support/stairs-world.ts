// A small in-memory world for the code that walks stairs: a subway
// stairwell down to a platform on floor -1, and a footbridge flight up to a
// deck on floor 1, on otherwise open ground inside a closed ring of
// colliders. The generated district places no flights yet, so the flight
// mechanics (`world/flights.ts`, `world/transitions.ts`, `world/floor-walk.ts`)
// are proven here, at the layer they live at, against real `defs/objects`
// stair art and real colliders -- never a shared, shipped scene.
//
// Every number below is geometry of this one test world. Nothing outside
// `client/tests/` imports it.

import type { PlacedObject } from "../../../src/net/bindings/types";
import { layerCodeByName } from "../../../src/render/layer-table";
import type { ColliderSource } from "../../../src/world/collision-grid";
import {
  buildFlights,
  type FlightIndex,
  FlightIndex as FlightIndexClass,
} from "../../../src/world/flights";
import { footprintCells } from "../../../src/world/footprint";
import type { ObjectSource } from "../../../src/world/object-defs";
import { cellOf } from "../../../src/world/ownership";
import { isBodyClear, isCellStandable } from "../../../src/world/standable";
import { TransitionIndex, type TransitionSpec } from "../../../src/world/transitions";
import { WorldIndex } from "../../../src/world/world-index";
import { committedDefs, committedMovementConfig, committedObjectSources } from "./committed-defs";

export { committedDefs };

export const STREET_FLOOR = 0;
export const SUBWAY_FLOOR = -1;
export const BRIDGE_FLOOR = STREET_FLOOR + 1;

// Def ids of the stair art (`defs/objects/city-props.toml`).
export const BRIDGE_DECK_DEF_ID = 7;
export const STAIRWELL_TOP_RAILING_DEF_ID = 12;
export const STAIRWELL_TREADS_DEF_ID = 13;
export const STAIRWELL_BOTTOM_RAILING_DEF_ID = 14;
export const STAIRWELL_WELL_DEF_ID = 19;
export const PLATFORM_STAIR_FLIGHT_DEF_ID = 16;
export const PLATFORM_STAIR_RAILING_DEF_ID = 17;
export const BRIDGE_STAIRS_STREET_DEF_ID = 20;
export const BRIDGE_STAIRS_DECK_DEF_ID = 21;
export const BRIDGE_STAIRS_ABUTMENT_DEF_ID = 22;
export const BRIDGE_STAIRS_TREAD_DEF_ID = 23;
export const WALL_SEGMENT_DEF_ID = 6;

/** The stairwell's art is four objects on one 3x3 ground footprint. */
export const STAIRWELL_FOOTPRINT = { width: 3, height: 3 } as const;
const STAIRWELL_TREAD_ROW = 2;
const STAIRWELL_ROWS = [
  { row: 1, defId: STAIRWELL_TOP_RAILING_DEF_ID, layer: "objects" },
  { row: STAIRWELL_TREAD_ROW, defId: STAIRWELL_TREADS_DEF_ID, layer: "ground_objects" },
  { row: 3, defId: STAIRWELL_WELL_DEF_ID, layer: "ground_objects" },
  { row: 3, defId: STAIRWELL_BOTTOM_RAILING_DEF_ID, layer: "objects" },
] as const;

/** Walking west into the stairs. */
export const STAIRS_ENTRY_DIRECTION = { x: -1, y: 0 } as const;

const SOUTH_WALL_Y = 6;
const PAVEMENT_Y1 = 8;
export const STAIRWELL_X0 = 14;
export const STAIRWELL_Y0 = PAVEMENT_Y1 + 1;
export const STAIRS_X = STAIRWELL_X0;
export const STAIRS_Y = STAIRWELL_Y0 + STAIRWELL_TREAD_ROW;
export const SUBWAY_ENTRANCE_X0 = STAIRWELL_X0 + STAIRWELL_FOOTPRINT.width;

/** The platform, floor -1. */
const PLATFORM_X0 = 13;
const PLATFORM_X1 = 20;
const PLATFORM_Y0 = 1;
const PLATFORM_Y1 = 6;
export const PLATFORM_INTERIOR_X0 = PLATFORM_X0 + 1;
export const PLATFORM_INTERIOR_X1 = PLATFORM_X1 - 1;
export const PLATFORM_INTERIOR_Y0 = PLATFORM_Y0 + 1;
export const PLATFORM_INTERIOR_Y1 = PLATFORM_Y1 - 1;
export const PLATFORM_UP_ANCHOR_X = PLATFORM_INTERIOR_X1;
export const PLATFORM_UP_ANCHOR_Y = PLATFORM_INTERIOR_Y0;
const PLATFORM_FLIGHT_WIDTH = 2;
const PLATFORM_FLIGHT_DEPTH = 2;
const PLATFORM_FLIGHT_X0 = PLATFORM_UP_ANCHOR_X - PLATFORM_FLIGHT_WIDTH + 1;
const PLATFORM_RAILING_WIDTH = PLATFORM_FLIGHT_WIDTH + 1;
const PLATFORM_RAILING_X0 = PLATFORM_UP_ANCHOR_X - PLATFORM_RAILING_WIDTH + 1;
export const PLATFORM_LANDING_X = PLATFORM_UP_ANCHOR_X + STAIRS_ENTRY_DIRECTION.x;
export const PLATFORM_LANDING_Y = PLATFORM_UP_ANCHOR_Y + STAIRS_ENTRY_DIRECTION.y;
export const STREET_EXIT_X = STAIRS_X - STAIRS_ENTRY_DIRECTION.x;
export const STREET_EXIT_Y = STAIRS_Y - STAIRS_ENTRY_DIRECTION.y;

/** The footbridge: the deck spans the pavement one storey up. */
export const BRIDGE_DECK_Y = SOUTH_WALL_Y + 1;
export const BRIDGE_X0 = 17;
export const BRIDGE_DECK_WIDTH = 4;
export const BRIDGE_X1 = BRIDGE_X0 + BRIDGE_DECK_WIDTH - 1;
export const BRIDGE_FLIGHT_WIDTH = 2;
export const BRIDGE_FLIGHT_DEPTH = 2;
export const BRIDGE_ABUTMENT_ROWS = 3;
export const BRIDGE_FLIGHT_X0 = BRIDGE_X1 - BRIDGE_FLIGHT_WIDTH + 1;
export const BRIDGE_UP_ANCHOR_Y = BRIDGE_DECK_Y + 1;
export const BRIDGE_DOWN_ANCHOR_Y = BRIDGE_UP_ANCHOR_Y + BRIDGE_FLIGHT_DEPTH - 1;
export const BRIDGE_FOOT_Y = BRIDGE_DOWN_ANCHOR_Y + 1;

/** Where a body starts in this world: on the pavement west of the stairwell. */
export const PLAYER_START = { x: 13.5, y: 7.5, floor: STREET_FLOOR } as const;

/** The lamppost used by the defs-driven collider tests. */
export const LAMPPOST_DEF_ID = 4;
export const LAMPPOST_CELL = { x: 8, y: PAVEMENT_Y1 } as const;

/** A `floor_transition`-shaped row, anchor cell to target cell. */
export const STREET_TRANSITIONS: readonly TransitionSpec[] = [
  {
    x: STAIRS_X,
    y: STAIRS_Y,
    floor: STREET_FLOOR,
    targetX: PLATFORM_LANDING_X,
    targetY: PLATFORM_LANDING_Y,
    targetFloor: SUBWAY_FLOOR,
  },
  {
    x: PLATFORM_UP_ANCHOR_X,
    y: PLATFORM_UP_ANCHOR_Y,
    floor: SUBWAY_FLOOR,
    targetX: STREET_EXIT_X,
    targetY: STREET_EXIT_Y,
    targetFloor: STREET_FLOOR,
  },
  ...Array.from({ length: BRIDGE_FLIGHT_WIDTH }, (_, column) => BRIDGE_FLIGHT_X0 + column).flatMap(
    (x): readonly TransitionSpec[] => [
      {
        x,
        y: BRIDGE_UP_ANCHOR_Y,
        floor: STREET_FLOOR,
        targetX: x,
        targetY: BRIDGE_UP_ANCHOR_Y,
        targetFloor: BRIDGE_FLOOR,
      },
      {
        x,
        y: BRIDGE_DOWN_ANCHOR_Y,
        floor: BRIDGE_FLOOR,
        targetX: x,
        targetY: BRIDGE_DOWN_ANCHOR_Y,
        targetFloor: STREET_FLOOR,
      },
    ],
  ),
];

/** One placed def row of this world. */
export interface StairsProp {
  readonly id: bigint;
  readonly defId: number;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly layer: "objects" | "ground_objects" | "walls";
}

/** Collider-only rects (no art): the closed ring and the rails. `x`/`y` is
 * the anchor cell -- the rect's smallest x, largest y cell. */
interface Boundary {
  readonly id: bigint;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly floor: number;
  readonly collider?: { x0: number; y0: number; x1: number; y1: number };
}

const SYNTHETIC_DEF_BASE = 10_000;
const synthetic = (id: bigint): number => SYNTHETIC_DEF_BASE + Number(id);

export const STREET_PROPS: readonly StairsProp[] = [
  // The street stairwell: the railings block their own row, the tread row is
  // walkable from its east opening down to the down anchor.
  ...STAIRWELL_ROWS.map(({ row, defId, layer }, index) => ({
    id: BigInt(50 + index),
    defId,
    x: STAIRWELL_X0,
    y: STAIRWELL_Y0 + row,
    floor: STREET_FLOOR,
    layer,
  })),
  // The same flight seen from the platform, and the railing along its side.
  {
    id: 60n,
    defId: PLATFORM_STAIR_FLIGHT_DEF_ID,
    x: PLATFORM_FLIGHT_X0,
    y: PLATFORM_UP_ANCHOR_Y + PLATFORM_FLIGHT_DEPTH - 1,
    floor: SUBWAY_FLOOR,
    layer: "ground_objects",
  },
  {
    id: 61n,
    defId: PLATFORM_STAIR_RAILING_DEF_ID,
    x: PLATFORM_RAILING_X0,
    y: PLATFORM_UP_ANCHOR_Y + 1,
    floor: SUBWAY_FLOOR,
    layer: "objects",
  },
  // The deck, flat on the ground one storey up, and its parapet.
  ...Array.from({ length: BRIDGE_DECK_WIDTH }, (_, index) => ({
    id: BigInt(65 + index),
    defId: BRIDGE_DECK_DEF_ID,
    x: BRIDGE_X0 + index,
    y: BRIDGE_DECK_Y,
    floor: BRIDGE_FLOOR,
    layer: "ground_objects" as const,
  })),
  ...Array.from({ length: BRIDGE_DECK_WIDTH }, (_, index) => ({
    id: BigInt(71 + index),
    defId: WALL_SEGMENT_DEF_ID,
    x: BRIDGE_X0 + index,
    y: BRIDGE_DECK_Y - 1,
    floor: BRIDGE_FLOOR,
    layer: "walls" as const,
  })),
  // The one flight: the street's and the deck's, anchored on the bottom row.
  {
    id: 85n,
    defId: BRIDGE_STAIRS_STREET_DEF_ID,
    x: BRIDGE_FLIGHT_X0,
    y: BRIDGE_DOWN_ANCHOR_Y,
    floor: STREET_FLOOR,
    layer: "ground_objects",
  },
  {
    id: 86n,
    defId: BRIDGE_STAIRS_DECK_DEF_ID,
    x: BRIDGE_FLIGHT_X0,
    y: BRIDGE_DOWN_ANCHOR_Y,
    floor: BRIDGE_FLOOR,
    layer: "ground_objects",
  },
  ...Array.from({ length: BRIDGE_FLIGHT_DEPTH }, (_, index) => ({
    id: BigInt(90 + index),
    defId: BRIDGE_STAIRS_TREAD_DEF_ID,
    x: BRIDGE_FLIGHT_X0,
    y: BRIDGE_UP_ANCHOR_Y + index,
    floor: STREET_FLOOR,
    layer: "ground_objects" as const,
  })),
  ...Array.from({ length: BRIDGE_ABUTMENT_ROWS }, (_, index) => ({
    id: BigInt(200 + index),
    defId: BRIDGE_STAIRS_ABUTMENT_DEF_ID,
    x: BRIDGE_FLIGHT_X0,
    y: BRIDGE_UP_ANCHOR_Y - BRIDGE_ABUTMENT_ROWS + index,
    floor: STREET_FLOOR,
    layer: "objects" as const,
  })),
];

/** A post on each row of the street flight's west side, so the flight is
 * entered by its foot and the pavement beside it stays open. */
const BRIDGE_POST_COLLIDER = { x0: 5, y0: 0, x1: 12, y1: 16 } as const;

const platformWalls = (): Boundary[] => [
  {
    id: 300n,
    x: PLATFORM_X0,
    y: PLATFORM_Y0,
    width: PLATFORM_X1 - PLATFORM_X0 + 1,
    height: 1,
    floor: SUBWAY_FLOOR,
  },
  {
    id: 301n,
    x: PLATFORM_X0,
    y: PLATFORM_Y1,
    width: PLATFORM_X1 - PLATFORM_X0 + 1,
    height: 1,
    floor: SUBWAY_FLOOR,
  },
  {
    id: 302n,
    x: PLATFORM_X0,
    y: PLATFORM_INTERIOR_Y1,
    width: 1,
    height: PLATFORM_INTERIOR_Y1 - PLATFORM_INTERIOR_Y0 + 1,
    floor: SUBWAY_FLOOR,
  },
  {
    id: 303n,
    x: PLATFORM_X1,
    y: PLATFORM_INTERIOR_Y1,
    width: 1,
    height: PLATFORM_INTERIOR_Y1 - PLATFORM_INTERIOR_Y0 + 1,
    floor: SUBWAY_FLOOR,
  },
];

const BOUNDARY: readonly Boundary[] = [
  // The street's ring: north of the pavement, west, east and south.
  { id: 101n, x: 11, y: 4, width: 15, height: 1, floor: STREET_FLOOR },
  { id: 102n, x: 11, y: 5, width: 1, height: 10, floor: STREET_FLOOR },
  { id: 103n, x: 25, y: 5, width: 1, height: 10, floor: STREET_FLOOR },
  { id: 104n, x: 11, y: 14, width: 15, height: 1, floor: STREET_FLOOR },
  // The street's east edge at the flight's foot rows.
  {
    id: 106n,
    x: 21,
    y: BRIDGE_FOOT_Y,
    width: 1,
    height: BRIDGE_FOOT_Y - BRIDGE_UP_ANCHOR_Y + 1,
    floor: STREET_FLOOR,
  },
  // The pavement's own north edge, under the footbridge's abutment.
  { id: 105n, x: 11, y: SOUTH_WALL_Y - 1, width: 15, height: 1, floor: STREET_FLOOR },
  // Around the subway entrance: west of the treads and below the entrance.
  { id: 130n, x: STAIRWELL_X0 - 1, y: STAIRS_Y, width: 1, height: 1, floor: STREET_FLOOR },
  { id: 131n, x: STAIRWELL_X0 - 1, y: STAIRWELL_Y0 + 1, width: 1, height: 1, floor: STREET_FLOOR },
  // The street flight's west posts.
  ...[BRIDGE_UP_ANCHOR_Y, BRIDGE_DOWN_ANCHOR_Y].map(
    (y, index): Boundary => ({
      id: BigInt(87 + index),
      x: BRIDGE_FLIGHT_X0 - 1,
      y,
      width: 1,
      height: 1,
      floor: STREET_FLOOR,
      collider: BRIDGE_POST_COLLIDER,
    }),
  ),
  // The footbridge's own ring, one storey up: the deck and its flight are the
  // only standable things on `BRIDGE_FLOOR`.
  {
    id: 110n,
    x: BRIDGE_X0 - 1,
    y: BRIDGE_DECK_Y,
    width: BRIDGE_FLIGHT_X0 - (BRIDGE_X0 - 1),
    height: 1,
    floor: BRIDGE_FLOOR,
    collider: { x0: 0, y0: 14, x1: (BRIDGE_FLIGHT_X0 - (BRIDGE_X0 - 1)) * 16, y1: 16 },
  },
  {
    id: 134n,
    x: BRIDGE_FLIGHT_X0 - 1,
    y: BRIDGE_DOWN_ANCHOR_Y,
    width: 1,
    height: BRIDGE_FLIGHT_DEPTH,
    floor: BRIDGE_FLOOR,
    collider: { x0: 0, y0: 0, x1: BRIDGE_POST_COLLIDER.x1, y1: BRIDGE_FLIGHT_DEPTH * 16 },
  },
  {
    id: 135n,
    x: BRIDGE_X1 + 1,
    y: BRIDGE_DOWN_ANCHOR_Y,
    width: 1,
    height: BRIDGE_FLIGHT_DEPTH,
    floor: BRIDGE_FLOOR,
  },
  {
    id: 136n,
    x: BRIDGE_FLIGHT_X0,
    y: BRIDGE_FOOT_Y,
    width: BRIDGE_FLIGHT_WIDTH,
    height: 1,
    floor: BRIDGE_FLOOR,
  },
  { id: 111n, x: BRIDGE_X0 - 1, y: BRIDGE_DECK_Y, width: 1, height: 1, floor: BRIDGE_FLOOR },
  { id: 112n, x: BRIDGE_X1 + 1, y: BRIDGE_DECK_Y, width: 1, height: 1, floor: BRIDGE_FLOOR },
  { id: 113n, x: BRIDGE_X0 - 1, y: BRIDGE_DECK_Y - 1, width: 1, height: 1, floor: BRIDGE_FLOOR },
  { id: 114n, x: BRIDGE_X1 + 1, y: BRIDGE_DECK_Y - 1, width: 1, height: 1, floor: BRIDGE_FLOOR },
  ...platformWalls(),
];

/** Every def source this world indexes: the committed `defs/objects` plus
 * the colliders of the boundary rects, keyed by a synthetic def id. */
export function streetObjectSources(): ReadonlyMap<number, ObjectSource> {
  const sub = committedMovementConfig().subcellsPerCell;
  const out = new Map<number, ObjectSource>(committedObjectSources());
  for (const b of BOUNDARY) {
    const source: ColliderSource = {
      width: b.width,
      height: b.height,
      collider: b.collider ?? { x0: 0, y0: 0, x1: b.width * sub, y1: b.height * sub },
    };
    out.set(synthetic(b.id), source as ObjectSource);
  }
  return out;
}

/** Every collider-bearing placement, shaped like the `PlacedObject` binding. */
export function streetPlacedRows(): readonly PlacedObject[] {
  const rows: PlacedObject[] = [];
  const row = (
    objectId: bigint,
    defId: number,
    x: number,
    y: number,
    floor: number,
    layer: number,
  ) => rows.push({ objectId, defId, x, y, floor, layer, orientation: 0, chunkKey: 0n });
  for (const prop of STREET_PROPS) {
    row(prop.id, prop.defId, prop.x, prop.y, prop.floor, layerCodeByName(prop.layer));
  }
  for (const b of BOUNDARY) row(b.id, synthetic(b.id), b.x, b.y, b.floor, 0);
  return rows;
}

export function streetMovementConfig() {
  return committedMovementConfig();
}

export function streetWorldIndex(): WorldIndex {
  const world = new WorldIndex(committedMovementConfig().subcellsPerCell, streetObjectSources());
  for (const r of streetPlacedRows()) world.insert(r);
  return world;
}

let cachedWorld: WorldIndex | undefined;
/** Whether a body can stand in a whole cell: the predicate `buildFlights` is given. */
export function streetStandable(x: number, y: number, floor: number): boolean {
  cachedWorld ??= streetWorldIndex();
  return isCellStandable(cachedWorld, committedMovementConfig(), x, y, floor);
}

export function streetTransitionIndex(): TransitionIndex {
  const world = streetWorldIndex();
  const config = committedMovementConfig();
  return new TransitionIndex(STREET_TRANSITIONS, {
    isStandable: (x, y, floor) => isCellStandable(world, config, x, y, floor),
    entryBand: {
      subcellsPerCell: config.subcellsPerCell,
      isBodyClear: (floor, cx, feet) => isBodyClear(world, config, floor, cx, feet),
    },
  });
}

export function streetFlightList() {
  return buildFlights(
    STREET_TRANSITIONS,
    streetPlacedRows(),
    streetObjectSources(),
    committedDefs().balance.find((b) => b.key === "render.tile_size_px")?.value ?? 16,
    streetStandable,
  );
}

export function streetFlightIndex(): FlightIndex {
  return new FlightIndexClass(streetFlightList(), committedMovementConfig());
}

/** The cells a def row covers. */
export function propCells(prop: StairsProp): { x: number; y: number }[] {
  const source = streetObjectSources().get(prop.defId) ?? { width: 1, height: 1 };
  return footprintCells(prop.x, prop.y, source);
}

export { cellOf };
