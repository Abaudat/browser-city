// The single committed, deterministic story 1.6 demo scene (Artie's
// direction): fixed layout, fixed seed, no randomisation, real LimeZu
// sprites only -- no coloured rectangles. Pure data, zero PixiJS: shared
// by the real adapter (`pixi-scene.ts`, mounted from `main.ts`) and
// `client/tests/unit/render/demo-fixture.test.ts`'s ordering check, so
// the comparator and the adapter can never silently disagree about what
// this scene should look like (Quentin's direction), and by
// `client/tests/e2e/render-order.spec.ts`, which reads the same order
// back out of a real mounted display list through `window.__bc`.
//
// This scene and its asset choices are throwaway harness code (Artie's
// own framing) -- the sort key, the rank ladder and the storey constant
// are the permanent things this story adds, not this file.

/** The five pool layers (FR123), in ascending rank order -- the ladder
 * itself lives in `sim::codes::layer`/`layer-ranks.ts`; this is just
 * which one each demo prop is on. */
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
 * tile coordinates); `assetKey` names an entry in `pixi-scene.ts`'s asset
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
 * `pixi-scene.ts`. */
export const PLAYER_START = { x: 5, y: 3, floor: 0 } as const;
export const PLAYER_STABLE_ID = 1000n;

/** Every non-player prop in the scene, fixed and hand-placed. Ids are
 * small and sequential -- this is fixture data, not a live `object_id`
 * sequence. */
export const DEMO_PROPS: readonly DemoProp[] = [
  // The back (north) wall of the one-room shop, 8 cells wide -- FR125
  // decomposition showcased a second way (the counter below is the
  // primary worked example), each cell reading its own vertical slice of
  // the wall texture.
  {
    id: 1n,
    assetKey: "wall",
    x: 2,
    y: 1,
    floor: 0,
    layer: "walls",
    footprint: { width: 8, height: 1 },
  },

  // A window and a poster mounted flat on that same wall face
  // (wall_decals, FR123's tens rank above `walls`) -- same anchor row,
  // never sliced across a pass or a sort position.
  { id: 2n, assetKey: "window", x: 4, y: 1, floor: 0, layer: "wall_decals" },
  { id: 3n, assetKey: "poster", x: 7, y: 1, floor: 0, layer: "wall_decals" },

  // The long counter (FR125's worked example): a real, oriented, 3-cell
  // prop running toward the camera (width=1, height=3) so that walking
  // beside it shows the near cell occluding the player while the far
  // cell is occluded by them -- the AC a footprint running parallel to
  // the camera could never demonstrate.
  {
    id: 4n,
    assetKey: "counter",
    x: 6,
    y: 2,
    floor: 0,
    layer: "furniture",
    footprint: { width: 1, height: 3 },
  },

  // A table with a glass on it: same anchor cell, `furniture` under
  // `objects` -- FR123's rank tiebreak is what keeps the glass drawn on
  // top of the table it shares a footprint with.
  { id: 5n, assetKey: "table", x: 3, y: 4, floor: 0, layer: "furniture" },
  { id: 6n, assetKey: "glass", x: 3, y: 4, floor: 0, layer: "objects" },

  // The awning: anchored at the wall cell it hangs off (Artie's
  // direction), overhanging the sidewalk cells in front of the shop that
  // it does not itself stand on.
  { id: 7n, assetKey: "awning", x: 5, y: 5, floor: 0, layer: "objects" },

  // The second storey, directly above the shop: its own wall and a piece
  // of furniture, on `floor: 1`. FR124's floor offset places these above
  // the ground floor on screen; nothing about their sort position may
  // depend on that (`inv_floor_never_affects_depth_order`).
  {
    id: 8n,
    assetKey: "wall",
    x: 2,
    y: 1,
    floor: 1,
    layer: "walls",
    footprint: { width: 8, height: 1 },
  },
  { id: 9n, assetKey: "table", x: 6, y: 3, floor: 1, layer: "furniture" },
] as const;

/** Flat-pass ground tiles (FR123: three flat passes before the sorted
 * pool) -- never depth-sorted, painted once in a fixed grid. Interior
 * floor and exterior sidewalk share one texture for this demo. */
export const GROUND_TILES = {
  assetKey: "ground",
  x0: 1,
  y0: 1,
  x1: 11,
  y1: 8,
} as const;
