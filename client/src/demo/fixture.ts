// The single committed, deterministic story 1.6 demo scene (Artie's
// direction): fixed layout, fixed seed, no randomisation, real LimeZu
// sprites only -- no coloured rectangles. Pure data, zero PixiJS: shared
// by the real adapter (`scene.ts`, mounted from `main.ts`) and
// `client/tests/unit/demo/drawables.test.ts`'s ordering check, so the
// comparator and the adapter can never silently disagree about what this
// scene should look like (Quentin's direction), and by
// `client/tests/e2e/render-order.spec.ts`, which reads the same order
// back out of a real mounted display list through `window.__bc`.
//
// This scene and its asset choices are throwaway harness code (Artie's
// own framing, and why it lives under `src/demo/` rather than
// `src/render/`) -- the sort key, the rank ladder and the storey
// constant are the permanent things this story adds, not this file.
//
// A one-room shop, four real walls, a door gap in the front wall, an
// interior floor distinct from the exterior pavement, a shop counter
// along the back wall, a table with a glass on it, an awning over the
// doorway, and an identical room shell one storey up. Every wall cell
// and every counter cell reads a real, whole-tile-aligned sub-rect of an
// existing sprite (`scene.ts`'s `sliceTexture` refuses, at mount, any
// prop whose declared footprint does not match its art's real pixel
// size) -- there is no stretched or fractional slice anywhere in this
// fixture.

import type { PlacedObject } from "../net/bindings/types";
import type { ColliderSource } from "../world/collision-grid";

/** The five pool layers (FR123), in ascending rank order -- the ladder
 * itself lives in `sim::codes::layer`/`render/layer-table.ts`; this is
 * just which one each demo prop is on. */
export type DemoLayer = "furniture" | "objects" | "walls" | "wall_decals" | "characters";

/** A prop wide/tall enough to need FR125 decomposition. Orientation
 * (`PlacedObject.orientation`) is a later story's concern; this fixture
 * simply states the already-oriented extent a real world generator would
 * have resolved before calling `decomposeFootprint`. */
export interface DemoFootprint {
  readonly width: number;
  readonly height: number;
}

/** One placed prop in the demo scene. `x`/`y` are the anchor cell (world
 * tile coordinates); `assetKey` names an entry in `scene.ts`'s asset
 * table -- this module knows nothing about textures or PixiJS.
 *
 * Collision comes from one of two places, never a hand-typed sub-cell
 * rect: `defId` names a real `defs/objects` entry and uses that entry's
 * own `collider`; `solid` is demo-only geometry (the shop's walls, which
 * are not `defs/` objects yet) blocking the prop's whole footprint. */
export interface DemoProp {
  readonly id: bigint;
  readonly assetKey: string;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly layer: DemoLayer;
  readonly footprint?: DemoFootprint;
  readonly defId?: number;
  readonly solid?: true;
}

/** `defs/objects/city-props.toml`'s own `lamppost` id -- the demo places
 * it by id so its collider is read from `defs/`, never restated here. */
export const LAMPPOST_DEF_ID = 4;

/** Synthetic def ids for demo-only geometry (walls, world boundary),
 * offset far past any real `defs/objects` id so the two never collide in
 * the one `defId -> collider` map the grid is built from. */
const DEMO_DEF_ID_BASE = 10_000;

export function demoDefId(id: bigint): number {
  return DEMO_DEF_ID_BASE + Number(id);
}

/** The player's starting position -- continuous world coordinates
 * (Artie's direction: a character's sort anchor is its continuous feet
 * position, never a snapped cell), moved by keyboard input in
 * `scene.ts`. Inside the room, one tile off the west wall so walking
 * north/south naturally crosses several of that wall's decomposed
 * cells -- the near/far occlusion worked example. `x` is `DOOR_X + 0.5`
 * (the door column's own centre, not its left edge): story 1.8's player
 * has a real body width, so it must be centred in the one-cell-wide door
 * gap, not flush with its edge, or it would clip the south wall standing
 * still. */
export const PLAYER_START = { x: 5.5, y: 4, floor: 0 } as const;
export const PLAYER_STABLE_ID = 1000n;

/** The anchor cell of the lamppost the player walks into when leaving by
 * the door: the same column as `DOOR_X`, out on the pavement. Walking
 * straight south from `PLAYER_START` rests against its base collider --
 * a real collider read from `defs/objects/city-props.toml`, so the rest
 * point is deterministic regardless of key-hold timing (the one property
 * the old `PLAYER_BOUNDS` clamp existed for), and derived from `defs/`
 * by every consumer rather than restated as a number here. */
export const LAMPPOST_CELL = { x: 5, y: 8 } as const;

// The building footprint: x = 3..8 (west wall, 4 interior columns, east
// wall), y = 1..6 (north wall, 4 interior rows, south/door wall).
const NORTH_WALL_Y = 1;
const SOUTH_WALL_Y = 6;
const WEST_WALL_X = 3;
const EAST_WALL_X = 8;
const DOOR_X = 5;
const INTERIOR_X0 = 4;
const INTERIOR_Y0 = 2;
const INTERIOR_Y1 = 5;

/** Every non-player prop in the fixture, fixed and hand-placed. Ids are
 * small and sequential -- this is fixture data, not a live `object_id`
 * sequence. */
export const DEMO_PROPS: readonly DemoProp[] = [
  // North (back) wall: one row, full width.
  {
    id: 1n,
    assetKey: "wallTile",
    x: WEST_WALL_X,
    y: NORTH_WALL_Y,
    floor: 0,
    layer: "walls",
    footprint: { width: EAST_WALL_X - WEST_WALL_X + 1, height: 1 },
    solid: true,
  },
  // South (front) wall, split around the door gap at DOOR_X. A short,
  // one-tile-tall module (`wallTileShort`, unlike the north wall's
  // three-tile `wallTile`) -- Artie's direction: a full-height front
  // wall covers the room's own contents from the camera, and near-side
  // wall retraction (FR120) is a later story's job, not this one's.
  {
    id: 2n,
    assetKey: "wallTileShort",
    x: WEST_WALL_X,
    y: SOUTH_WALL_Y,
    floor: 0,
    layer: "walls",
    footprint: { width: DOOR_X - WEST_WALL_X, height: 1 },
    solid: true,
  },
  {
    id: 3n,
    assetKey: "wallTileShort",
    x: DOOR_X + 1,
    y: SOUTH_WALL_Y,
    floor: 0,
    layer: "walls",
    footprint: { width: EAST_WALL_X - DOOR_X, height: 1 },
    solid: true,
  },
  // West wall: the near/far occlusion worked example -- decomposed
  // toward the camera (width 1, height 4), so walking past it shows the
  // near cell occluding the player while the far cell is occluded by
  // them.
  {
    id: 4n,
    assetKey: "wallTile",
    x: WEST_WALL_X,
    y: INTERIOR_Y0,
    floor: 0,
    layer: "walls",
    footprint: { width: 1, height: INTERIOR_Y1 - INTERIOR_Y0 + 1 },
    solid: true,
  },
  // East wall, same shape, mirrored.
  {
    id: 5n,
    assetKey: "wallTile",
    x: EAST_WALL_X,
    y: INTERIOR_Y0,
    floor: 0,
    layer: "walls",
    footprint: { width: 1, height: INTERIOR_Y1 - INTERIOR_Y0 + 1 },
    solid: true,
  },

  // A window and a poster mounted flat on the north wall face
  // (wall_decals, FR123's tens rank above `walls`) -- same anchor row,
  // never sliced across a pass or a sort position.
  { id: 6n, assetKey: "window", x: 5, y: NORTH_WALL_Y, floor: 0, layer: "wall_decals" },
  { id: 7n, assetKey: "poster", x: 7, y: NORTH_WALL_Y, floor: 0, layer: "wall_decals" },

  // The counter (FR125's worked example): real art is 48x64px, exactly
  // 3 tiles wide -- the footprint matches it exactly (width 3, height
  // 1), so slicing is a whole-pixel, integer division (16px per column),
  // never a fractional or horizontally-overhung one.
  {
    id: 8n,
    assetKey: "counter",
    x: INTERIOR_X0,
    y: INTERIOR_Y0,
    floor: 0,
    layer: "furniture",
    footprint: { width: 3, height: 1 },
    solid: true,
  },

  // A table with a glass on it: same anchor cell, `furniture` under
  // `objects` -- FR123's rank tiebreak is what keeps the glass drawn on
  // top of the table it shares a footprint with (`scene.ts` gives the
  // glass a small screen-only Y nudge so it visually sits on the
  // tabletop rather than beside the table's leg -- cosmetic only, never
  // applied to its sort position).
  { id: 9n, assetKey: "table", x: INTERIOR_X0, y: INTERIOR_Y1, floor: 0, layer: "furniture" },
  { id: 10n, assetKey: "glass", x: INTERIOR_X0, y: INTERIOR_Y1, floor: 0, layer: "objects" },

  // The awning: no collider (FR128's worked example -- absence of a
  // collider is walkability, `render-order.spec.ts`'s "does not stop at a
  // known collider-less prop" check). Anchored one cell south of the
  // door, on the pavement --
  // never at the wall/lintel row itself (Artie's cycle-3 direction: a
  // bottom-anchored sprite only ever overhangs *upward*, so anchoring it
  // at the door would hang the canopy back into the shop instead of out
  // over the street). From here its 2-tile overhang reaches only as far
  // north as the door threshold, never into the room, so a player walks
  // behind it while inside, is never fully hidden passing through the
  // door, and ends up in front of it once they are out on the pavement.
  { id: 11n, assetKey: "awning", x: DOOR_X, y: SOUTH_WALL_Y + 1, floor: 0, layer: "objects" },

  // The second storey, directly above the shop: its own north wall and a
  // piece of furniture, on `floor: 1`. A visually distinct wall variant
  // from its ground-floor counterpart (`scene.ts`'s `wallTileUpperH`) --
  // both real, whole-tile sub-rects of the same source sheet -- is what
  // makes the storey seam legible in a screenshot; the storey height
  // itself is still `render.storey_height_px`, not a second constant.
  // FR124's floor offset places these above the ground floor on screen;
  // nothing about their sort position may depend on that
  // (`inv_floor_never_affects_depth_order`).
  {
    id: 12n,
    assetKey: "wallTileUpper",
    x: WEST_WALL_X,
    y: NORTH_WALL_Y,
    floor: 1,
    layer: "walls",
    footprint: { width: EAST_WALL_X - WEST_WALL_X + 1, height: 1 },
  },
  // Positioned away from the ground-floor counter's (x=4..6, y=2) own
  // screen footprint -- Artie's direction: two storeys stacked onto the
  // same screen space read as one pile, not as two legible floors.
  {
    id: 13n,
    assetKey: "table",
    x: INTERIOR_X0 + 3,
    y: INTERIOR_Y0 + 2,
    floor: 1,
    layer: "furniture",
  },

  // A solid obstacle straight south of the door, on the pavement (story
  // 1.8): the known-solid rest point `render-order.spec.ts` and
  // `drawables.test.ts` walk the player into -- a real physical collider,
  // replacing the old artificial `PLAYER_BOUNDS` clamp. `PLAYER_START.x`
  // is the same column as `DOOR_X`, so walking straight south passes
  // through the open doorway and stops here deterministically, regardless
  // of exact key-hold timing.
  {
    id: 14n,
    assetKey: "table",
    x: LAMPPOST_CELL.x,
    y: LAMPPOST_CELL.y,
    floor: 0,
    layer: "objects",
    defId: LAMPPOST_DEF_ID,
  },
] as const;

/** A collider-only rect, in whole cells, with no sprite and no place in
 * the depth-sorted pool. */
export interface DemoBoundaryRect {
  readonly id: bigint;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The edge of the drawn world (FR137 has no world-boundary concept yet,
 * and the pavement simply stops): a closed ring of solid, undrawn cells
 * around everything `INTERIOR_FLOOR_TILES` and `SIDEWALK_TILES` paint, so
 * the avatar can never walk off the ground into the void. The shop's own
 * walls close the rest of the ring. `drawables.test.ts` proves the ring
 * is closed by walking the real resolver against it, rather than trusting
 * this list by eye. */
// A sprite is drawn bottom-centre-anchored (`render/screen-position.ts`),
// so a body at world `(x, y)` paints at `((x + 0.5) * tile, (y + 1) *
// tile)`. The ring below is placed for that convention, one half-cell in
// from the painted edge where the offset needs it, so a body pinned
// against it is still drawn over ground -- `drawables.test.ts` checks
// exactly that, through `screenPositionPx`, rather than by eye.
export const DEMO_BOUNDARY: readonly DemoBoundaryRect[] = [
  // West and east of the pavement.
  { id: 101n, x: 0, y: SOUTH_WALL_Y, width: 1, height: 4 },
  { id: 102n, x: 9, y: SOUTH_WALL_Y, width: 1, height: 4 },
  // South of the pavement.
  { id: 103n, x: 0, y: 9, width: 10, height: 1 },
  // North of the pavement, either side of the shop's own footprint --
  // the two stretches of pavement edge no wall already closes.
  { id: 104n, x: 1, y: SOUTH_WALL_Y - 1, width: WEST_WALL_X - 1, height: 1 },
  { id: 105n, x: EAST_WALL_X + 1, y: SOUTH_WALL_Y - 1, width: 1, height: 1 },
] as const;

/** Flat-pass ground tiles (FR123: three flat passes before the sorted
 * pool) -- never depth-sorted, painted once in fixed grids. Interior
 * floor and exterior pavement are two distinct textures (Artie's
 * direction: there must be an inside). */
export const INTERIOR_FLOOR_TILES = {
  assetKey: "floor",
  x0: WEST_WALL_X,
  y0: NORTH_WALL_Y,
  x1: EAST_WALL_X + 1,
  y1: SOUTH_WALL_Y,
} as const;

// One row deeper than the shop needs, because a bottom-anchored sprite
// paints a row lower than the cell its body occupies: the player resting
// against the lamppost must still be drawn over pavement, not past its
// last painted row.
export const SIDEWALK_TILES = {
  assetKey: "sidewalk",
  x0: 1,
  y0: SOUTH_WALL_Y,
  x1: 10,
  y1: 10,
} as const;

/** The demo's own collider sources, keyed by the synthetic def id
 * `demoDefId` mints: the shop's walls (solid across their whole
 * footprint) and the world boundary. Anything that exists in `defs/` is
 * absent here and read from `defs/` instead. `subcellsPerCell` comes from
 * the scene, which reads it from `defs/`'s generated
 * `COLLIDER_SUBCELLS_PER_CELL` -- this module never states it. */
export function demoColliderSources(subcellsPerCell: number): ReadonlyMap<number, ColliderSource> {
  const sources = new Map<number, ColliderSource>();
  for (const prop of DEMO_PROPS) {
    if (!prop.solid) continue;
    const { width, height } = prop.footprint ?? { width: 1, height: 1 };
    sources.set(demoDefId(prop.id), {
      width,
      height,
      collider: { x0: 0, y0: 0, x1: width * subcellsPerCell, y1: height * subcellsPerCell },
    });
  }
  for (const rect of DEMO_BOUNDARY) {
    sources.set(demoDefId(rect.id), {
      width: rect.width,
      height: rect.height,
      collider: {
        x0: 0,
        y0: 0,
        x1: rect.width * subcellsPerCell,
        y1: rect.height * subcellsPerCell,
      },
    });
  }
  return sources;
}

/** Every collider-bearing placement the demo feeds the grid, shaped like
 * the generated `PlacedObject` binding: the props that declare `defId` or
 * `solid`, plus the undrawn boundary ring. A later chunk-streaming story
 * replaces this with a real subscription; the grid's own API does not
 * change. */
export function demoPlacedRows(): readonly PlacedObject[] {
  const rows: PlacedObject[] = [];
  for (const prop of DEMO_PROPS) {
    const defId = prop.defId ?? (prop.solid ? demoDefId(prop.id) : undefined);
    if (defId === undefined) continue;
    rows.push({
      objectId: prop.id,
      defId,
      x: prop.x,
      y: prop.y,
      floor: prop.floor,
      layer: 0,
      orientation: 0,
      chunkKey: 0n,
    });
  }
  for (const rect of DEMO_BOUNDARY) {
    rows.push({
      objectId: rect.id,
      defId: demoDefId(rect.id),
      x: rect.x,
      y: rect.y,
      floor: PLAYER_START.floor,
      layer: 0,
      orientation: 0,
      chunkKey: 0n,
    });
  }
  return rows;
}
