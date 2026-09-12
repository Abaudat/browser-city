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
 * table -- this module knows nothing about textures or PixiJS. */
export interface DemoProp {
  readonly id: bigint;
  readonly assetKey: string;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly layer: DemoLayer;
  readonly footprint?: DemoFootprint;
}

/** The player's starting position -- continuous world coordinates
 * (Artie's direction: a character's sort anchor is its continuous feet
 * position, never a snapped cell), moved by keyboard input in
 * `scene.ts`. Inside the room, one tile off the west wall so walking
 * north/south naturally crosses several of that wall's decomposed
 * cells -- the near/far occlusion worked example. */
export const PLAYER_START = { x: 5, y: 4, floor: 0 } as const;
export const PLAYER_STABLE_ID = 1000n;
export const PLAYER_BOUNDS = { x0: 4.2, x1: 6.8, y0: 2.2, y1: 5.8 } as const;

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
  },
  {
    id: 3n,
    assetKey: "wallTileShort",
    x: DOOR_X + 1,
    y: SOUTH_WALL_Y,
    floor: 0,
    layer: "walls",
    footprint: { width: EAST_WALL_X - DOOR_X, height: 1 },
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
  },

  // A table with a glass on it: same anchor cell, `furniture` under
  // `objects` -- FR123's rank tiebreak is what keeps the glass drawn on
  // top of the table it shares a footprint with (`scene.ts` gives the
  // glass a small screen-only Y nudge so it visually sits on the
  // tabletop rather than beside the table's leg -- cosmetic only, never
  // applied to its sort position).
  { id: 9n, assetKey: "table", x: INTERIOR_X0, y: INTERIOR_Y1, floor: 0, layer: "furniture" },
  { id: 10n, assetKey: "glass", x: INTERIOR_X0, y: INTERIOR_Y1, floor: 0, layer: "objects" },

  // The awning: anchored at the door lintel it hangs off (Artie's
  // direction), overhanging the sidewalk cells south of the door that it
  // does not itself stand on.
  { id: 11n, assetKey: "awning", x: DOOR_X, y: SOUTH_WALL_Y, floor: 0, layer: "objects" },

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

export const SIDEWALK_TILES = {
  assetKey: "sidewalk",
  x0: 1,
  y0: SOUTH_WALL_Y,
  x1: 10,
  y1: 9,
} as const;
