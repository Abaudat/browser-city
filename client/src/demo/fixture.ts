// The committed, deterministic story 1.6/1.7 demo scene (Artie's
// direction): fixed layout, fixed seed, no randomisation, real LimeZu
// sprites only -- no coloured rectangles. Pure data, zero PixiJS: shared
// by the real adapter (`scene.ts`, mounted from `main.ts`) and
// `client/tests/unit/demo/drawables.test.ts`'s ordering check, so the
// comparator and the adapter can never silently disagree about what this
// scene should look like (Quentin's direction), and by
// `client/tests/e2e/render-order.spec.ts`/`enclosure.spec.ts`, which read
// the same order and visibility state back out of a real mounted display
// list through `window.__bc`.
//
// This scene and its asset choices are throwaway harness code (Artie's
// own framing, and why it lives under `src/demo/` rather than
// `src/render/`) -- the sort key, the rank ladder, the storey constant and
// (story 1.7) the visibility rules are the permanent things these stories
// add, not this file.
//
// Story 1.7 (FR120/FR121/FR122) pays off the shortcut story 1.6 took: the
// old `wallTileShort` front-wall stub is gone -- near-side retraction now
// exists, so the demo shows it, not a permanently short wall. The terrace
// is two shops, A and B, sharing one party wall at `PARTY_WALL_X`, each
// with its own door, its own front window (a real `defs/objects` `window
// = true` tile, never a `wall_decals` overlay) and its own furniture. A
// subway stairwell on the pavement leads down to a small platform on
// floor -1, whose own front wall retracts the same ownership-keyed way a
// shop's does while the player stands on it.
//
// Near-side-ness (FR120) is never hand-authored here: `demo/drawables.ts`
// resolves it per cell from `render/visibility.ts`'s `isNearSideWall`, a
// pure predicate over ownership and cell coordinates. This fixture only
// states geometry and ownership areas; which walls end up near-side falls
// out of that shape.

import type { PlacedObject } from "../net/bindings/types";
import { layerCodeByName } from "../render/layer-table";
import type { ColliderSource } from "../world/collision-grid";
import type { OwnershipArea } from "../world/ownership";
import type { TransitionSpec } from "../world/transitions";

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
 * own `collider`; `solid` is demo-only geometry (the shops' plain walls,
 * which are not `defs/` objects) blocking the prop's whole footprint. */
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
  /** For a `wallTile`/`wallStub` prop only: which run this wall segment
   * belongs to -- a north/south (front/back) run is `"horizontal"`, an
   * east/west (side/party) run is `"vertical"`. A real generator always
   * knows this when it places a wall segment (the same fact
   * `PlacedObject.orientation` would carry); it is never re-derived from
   * a decomposed cell's own footprint aspect ratio, which cannot tell a
   * one-cell-wide *front* wall pier from a one-cell side wall (Artie's
   * cycle-2 finding: that is exactly the bug that dropped shop B's front
   * wall to a flush side-wall tile). Unused, and meaningless, for every
   * other layer. */
  readonly wallOrientation?: "horizontal" | "vertical";
}

/** `defs/objects/city-props.toml`'s own `lamppost` id -- the demo places
 * it by id so its collider is read from `defs/`, never restated here. */
export const LAMPPOST_DEF_ID = 4;
/** `defs/objects/city-props.toml`'s own `trash_bin` id (story 1.9,
 * FR148): the small interaction target, out on the pavement. Its
 * `interact_at` reach comes from `defs/` like everything else. */
export const TRASH_BIN_DEF_ID = 1;
/** `defs/objects/city-props.toml`'s own `shop_counter` id (story 1.9,
 * FR148): the wide interaction target -- three cells of counter, reachable
 * only from the customer side. */
export const SHOP_COUNTER_DEF_ID = 3;
/** `defs/objects/city-props.toml`'s own `shop_window` id (FR121, story
 * 1.7): a real `[[object]] window = true` entry, never a demo-only flag --
 * every shopfront window places it by id, the same way the lamppost
 * does. */
export const WINDOW_DEF_ID = 5;

/** Synthetic def ids for demo-only geometry (walls, world boundary),
 * offset far past any real `defs/objects` id so the two never collide in
 * the one `defId -> collider` map the grid is built from. */
const DEMO_DEF_ID_BASE = 10_000;

export function demoDefId(id: bigint): number {
  return DEMO_DEF_ID_BASE + Number(id);
}

// Shared storey shape for both ground-floor shops: north (back) wall,
// four interior rows, south (front) wall.
const NORTH_WALL_Y = 1;
const SOUTH_WALL_Y = 6;
const INTERIOR_Y0 = 2;
const INTERIOR_Y1 = 5;

// Shop A: west wall, four interior columns, then the party wall it shares
// with shop B (Artie's direction: the shared wall line has no gap and no
// doubled wall -- shop B declares no west wall of its own; this column is
// it). Every front run is door, then a `WINDOW_WIDTH`-wide window, then a
// full-height wall pier at the far corner (Artie's cycle-2 direction: a
// window must never run straight into the corner with no wall pier
// between it and the next building, or the two shopfronts blur into one
// continuous glazed strip) -- `DOOR_X_A`/`DOOR_X_B` are the only two
// numbers hand-picked below; everything else (window position, pier
// position, `PLAYER_START`, `LAMPPOST_CELL`) is derived from them, never
// a second hand-patched literal.
const WEST_WALL_X = 3;
const PARTY_WALL_X = 8;
const INTERIOR_X0_A = 4;
const DOOR_X_A = WEST_WALL_X + 1;
const WINDOW_X_A = DOOR_X_A + 1;
const WINDOW_WIDTH = 3;

// Shop B: starts immediately east of the party wall, its own four
// interior columns, its own east wall.
const INTERIOR_X0_B = 9;
const EAST_WALL_X_B = 13;
const DOOR_X_B = PARTY_WALL_X + 1;
const WINDOW_X_B = DOOR_X_B + 1;

/** The player's starting position -- continuous world coordinates
 * (Artie's direction: a character's sort anchor is its continuous feet
 * position, never a snapped cell), moved by keyboard input in
 * `scene.ts`. Inside shop A, one tile off the west wall so walking
 * north/south naturally crosses several of that wall's decomposed
 * cells -- the near/far occlusion worked example. `x` is `DOOR_X_A + 0.5`
 * (the door column's own centre): the player has a real body width, so it
 * must be centred in the one-cell-wide door gap. */
export const PLAYER_START = { x: DOOR_X_A + 0.5, y: 4, floor: 0 } as const;
export const PLAYER_STABLE_ID = 1000n;

/** The anchor cell of the lamppost the player walks into when leaving
 * shop A by its door: the same column as `DOOR_X_A`, out on the pavement.
 * A real collider read from `defs/objects/city-props.toml`. */
export const LAMPPOST_CELL = { x: DOOR_X_A, y: 8 } as const;

/** Story 1.7 ownership ids (Tim's direction): the enclosure key is
 * `buildingId`, resolved from the ownership index -- never hand-typed on
 * a per-prop basis. `NO_OWNER` (0n) is `world/ownership.ts`'s own
 * sentinel; these start at 1 like a real `#[auto_inc]` id would. */
export const SHOP_A_BUILDING_ID = 1n;
export const SHOP_B_BUILDING_ID = 2n;
/** The subway platform's own ownership id (Artie's direction): its front
 * wall retracts the same ownership-keyed way a shop's does, while the
 * player stands on it -- otherwise the platform's own front wall would
 * permanently hide whoever just walked onto it. */
export const PLATFORM_BUILDING_ID = 3n;

// --- the subway (declared before DEMO_BUILDING_AREAS, which references
// the platform's own footprint) -----------------------------------------

export const STREET_FLOOR = 0;
export const SUBWAY_FLOOR = -1;

/** The stairwell's own anchor cell, on the pavement -- a physical prop
 * (Artie's direction: never a teleport tile), east of both shops and
 * clear of shop B's own door. Shares `LAMPPOST_CELL`'s own row: a
 * deterministic, collider-anchored rest point (`lamppostRestY()`) sits on
 * the same row as the stairwell, so a keyboard-driven e2e walk can reach
 * it by holding one direction at a time, never two at once. */
export const STAIRS_X = 16;
export const STAIRS_Y = LAMPPOST_CELL.y;

/** The platform's own footprint, floor -1, positioned so the stairs land
 * directly below the street entrance (Artie's direction: where you come
 * out must physically match where you went in). */
const PLATFORM_X0 = 13;
const PLATFORM_X1 = 20;
const PLATFORM_Y0 = 1;
const PLATFORM_Y1 = 6;
const PLATFORM_INTERIOR_X0 = PLATFORM_X0 + 1;
const PLATFORM_INTERIOR_X1 = PLATFORM_X1 - 1;
const PLATFORM_INTERIOR_Y0 = PLATFORM_Y0 + 1;
const PLATFORM_INTERIOR_Y1 = PLATFORM_Y1 - 1;

/** Where the stairs land on the platform, directly under `STAIRS_X`. */
export const PLATFORM_LANDING_X = STAIRS_X;
export const PLATFORM_LANDING_Y = PLATFORM_INTERIOR_Y0 + 1;

/** The up-stairs' own anchor, one cell north of the landing (never the
 * identical cell): a continuous walk down and back up must not bounce
 * between the two transitions on consecutive frames just because holding
 * the same direction key kept the player inside the landing cell for a
 * second frame -- one cell of separation is what a caller's continued
 * momentum naturally clears (`world/floor-walk.ts` now also gates every
 * transition lookup on the cell actually changing by walking, so this is
 * belt and braces, not the only thing preventing a bounce). */
export const PLATFORM_UP_ANCHOR_X = PLATFORM_LANDING_X;
export const PLATFORM_UP_ANCHOR_Y = PLATFORM_LANDING_Y - 1;

/** Where climbing back up lands on the street: one cell east of the
 * stairwell's own anchor (`STAIRS_X`/`STAIRS_Y`), never that identical
 * cell -- the same "never the anchor cell" rule `PLATFORM_UP_ANCHOR_X/Y`
 * applies below ground applies here too. Still immediately beside the
 * stairwell prop (Artie's "where you come out must physically match
 * where you went in"), just not the single tile that triggers the
 * descent. */
export const STREET_EXIT_X = STAIRS_X + 1;
export const STREET_EXIT_Y = STAIRS_Y;

/** The floor transition data (Tim's `world/transitions.ts` port): entering
 * the stairwell cell on the street lands on the platform; entering the
 * up-stairs' own anchor cell returns to the street, one cell beside the
 * stairwell. Never a boolean on the stairs prop -- a `floor_transition`-
 * shaped row, anchor cell to target cell, exactly like the server's own
 * model. */
export const DEMO_TRANSITIONS: readonly TransitionSpec[] = [
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
];

/** The ownership areas the demo's own `OwnershipIndex` is built from
 * (mirrors `building_area` rows): each shop's whole footprint, walls
 * included, on the floor(s) it actually occupies, and the platform's own
 * footprint on floor -1, which is what lets its own front wall retract
 * the same way a shop's does. Room ownership is not used this story
 * (Tim's direction). No shop owns an upper storey here: `isStoreyAboveCulled`
 * is proven directly, against synthetic drawables, in
 * `visibility.test.ts` -- it does not need this fixture to carry one. */
export const DEMO_BUILDING_AREAS: readonly OwnershipArea[] = [
  {
    ownerId: SHOP_A_BUILDING_ID,
    floor: 0,
    rect: { x0: WEST_WALL_X, y0: NORTH_WALL_Y, x1: PARTY_WALL_X + 1, y1: SOUTH_WALL_Y + 1 },
  },
  {
    ownerId: SHOP_B_BUILDING_ID,
    floor: 0,
    rect: { x0: PARTY_WALL_X + 1, y0: NORTH_WALL_Y, x1: EAST_WALL_X_B + 1, y1: SOUTH_WALL_Y + 1 },
  },
  {
    ownerId: PLATFORM_BUILDING_ID,
    floor: SUBWAY_FLOOR,
    rect: { x0: PLATFORM_X0, y0: PLATFORM_Y0, x1: PLATFORM_X1 + 1, y1: PLATFORM_Y1 + 1 },
  },
];

export const DEMO_ROOM_AREAS: readonly OwnershipArea[] = [];

/** The platform's own boundary wall ring -- a real, solid, drawn wall
 * built from the subway pack's own tiled wall art (Artie's direction),
 * near-side exactly where `render/visibility.ts`'s `isNearSideWall`
 * predicate says it is (the front/south run) -- no special-casing here. */
function platformWalls(): readonly DemoProp[] {
  const walls: DemoProp[] = [
    {
      id: 60n,
      assetKey: "subwayWall",
      x: PLATFORM_X0,
      y: PLATFORM_Y0,
      floor: SUBWAY_FLOOR,
      layer: "walls",
      footprint: { width: PLATFORM_X1 - PLATFORM_X0 + 1, height: 1 },
      solid: true,
      wallOrientation: "horizontal",
    },
    {
      id: 61n,
      assetKey: "subwayWall",
      x: PLATFORM_X0,
      y: PLATFORM_Y1,
      floor: SUBWAY_FLOOR,
      layer: "walls",
      footprint: { width: PLATFORM_X1 - PLATFORM_X0 + 1, height: 1 },
      solid: true,
      wallOrientation: "horizontal",
    },
    {
      id: 62n,
      assetKey: "subwayWall",
      x: PLATFORM_X0,
      y: PLATFORM_INTERIOR_Y0,
      floor: SUBWAY_FLOOR,
      layer: "walls",
      footprint: { width: 1, height: PLATFORM_INTERIOR_Y1 - PLATFORM_INTERIOR_Y0 + 1 },
      solid: true,
      wallOrientation: "vertical",
    },
    {
      id: 63n,
      assetKey: "subwayWall",
      x: PLATFORM_X1,
      y: PLATFORM_INTERIOR_Y0,
      floor: SUBWAY_FLOOR,
      layer: "walls",
      footprint: { width: 1, height: PLATFORM_INTERIOR_Y1 - PLATFORM_INTERIOR_Y0 + 1 },
      solid: true,
      wallOrientation: "vertical",
    },
  ];
  return walls;
}

/** Every non-player prop in the fixture, fixed and hand-placed. Ids are
 * small and sequential -- this is fixture data, not a live `object_id`
 * sequence. */
export const DEMO_PROPS: readonly DemoProp[] = [
  // --- Shop A ----------------------------------------------------------
  // North (back) wall: full width, never near-side (nothing owned by
  // shop A sits south of it -- it is the interior itself).
  {
    id: 1n,
    assetKey: "wallTile",
    x: WEST_WALL_X,
    y: NORTH_WALL_Y,
    floor: 0,
    layer: "walls",
    footprint: { width: PARTY_WALL_X - WEST_WALL_X + 1, height: 1 },
    solid: true,
    wallOrientation: "horizontal",
  },
  // South (front) wall, west of the door -- also the SW corner pier where
  // the west wall (id 4) meets the front run: full-height wall now
  // (Artie's direction -- retraction exists, so the front facade is a
  // full wall from outside, not a permanently short stub).
  {
    id: 2n,
    assetKey: "wallTile",
    x: WEST_WALL_X,
    y: SOUTH_WALL_Y,
    floor: 0,
    layer: "walls",
    footprint: { width: DOOR_X_A - WEST_WALL_X, height: 1 },
    solid: true,
    wallOrientation: "horizontal",
  },
  // The shop window (FR121): a real `defs/objects` wall tile, `window =
  // true`, `WINDOW_WIDTH` cells wide starting right after the door --
  // its own art (`ME_Singles_Office_16x16_Window_1_Middle_Modular.png`,
  // 48x32px) is exactly that many tiles wide, so the footprint matches
  // the art exactly and `sliceTexture` slices it cleanly, never
  // overhanging over the door (Artie's direction). It stops one cell
  // short of the party wall -- id 40 below is that last cell, a full
  // wall pier, so the window never runs straight into the corner (Artie's
  // cycle-2 direction). Its collider comes from `defs/`, so it is placed
  // by `defId` like the lamppost, never `solid: true`.
  {
    id: 6n,
    assetKey: "window",
    x: WINDOW_X_A,
    y: SOUTH_WALL_Y,
    floor: 0,
    layer: "walls",
    footprint: { width: WINDOW_WIDTH, height: 1 },
    defId: WINDOW_DEF_ID,
  },
  // West wall: the near/far occlusion worked example -- decomposed
  // toward the camera (width 1, height 4).
  {
    id: 4n,
    assetKey: "wallTile",
    x: WEST_WALL_X,
    y: INTERIOR_Y0,
    floor: 0,
    layer: "walls",
    footprint: { width: 1, height: INTERIOR_Y1 - INTERIOR_Y0 + 1 },
    solid: true,
    wallOrientation: "vertical",
  },
  // The party wall shop A and shop B share, one cell thick (Artie's
  // direction: no gap, no doubled wall) -- a side wall, so it is never
  // near-side and never retracts for either shop.
  {
    id: 5n,
    assetKey: "wallTile",
    x: PARTY_WALL_X,
    y: INTERIOR_Y0,
    floor: 0,
    layer: "walls",
    footprint: { width: 1, height: INTERIOR_Y1 - INTERIOR_Y0 + 1 },
    solid: true,
    wallOrientation: "vertical",
  },
  // Shop A's own front-wall pier at the party-wall corner: the window
  // (id 6) stops one cell short of it, so a full-height wall pier always
  // separates the two shopfronts' glass, never a continuous glazed strip
  // (Artie's cycle-2 direction). Owned by shop A (`DEMO_BUILDING_AREAS`'s
  // rect includes this column), so it retracts with the rest of shop A's
  // front while the player is inside -- the same corner id 4/id 2 already
  // form on the west side, just party-wall side.
  {
    id: 40n,
    assetKey: "wallTile",
    x: PARTY_WALL_X,
    y: SOUTH_WALL_Y,
    floor: 0,
    layer: "walls",
    footprint: { width: 1, height: 1 },
    solid: true,
    wallOrientation: "horizontal",
  },

  // A poster mounted flat on the north wall face (wall_decals, FR123's
  // tens rank above `walls`).
  {
    id: 7n,
    assetKey: "poster",
    x: PARTY_WALL_X - 1,
    y: NORTH_WALL_Y,
    floor: 0,
    layer: "wall_decals",
  },

  // The counter (FR125's worked example): real art is 48x64px, exactly
  // 3 tiles wide. Story 1.9: placed by `defId` rather than `solid`, so
  // both its collider and its FR148 reach rect come from `defs/` -- the
  // wide interaction target, reachable only from the customer side.
  {
    id: 8n,
    assetKey: "counter",
    x: INTERIOR_X0_A,
    y: INTERIOR_Y0,
    floor: 0,
    layer: "furniture",
    footprint: { width: 3, height: 1 },
    defId: SHOP_COUNTER_DEF_ID,
  },

  // A table with a glass on it, right behind the window (Artie's
  // direction: visible from the pavement through the glass).
  { id: 9n, assetKey: "table", x: WINDOW_X_A, y: INTERIOR_Y1, floor: 0, layer: "furniture" },
  { id: 10n, assetKey: "glass", x: WINDOW_X_A, y: INTERIOR_Y1, floor: 0, layer: "objects" },

  // The awning: no collider (FR128's worked example), on the pavement
  // south of the door.
  { id: 11n, assetKey: "awning", x: DOOR_X_A, y: SOUTH_WALL_Y + 1, floor: 0, layer: "objects" },

  // Story 1.9's small interaction target (FR148): a real bin on the
  // pavement, two cells east of shop A's door, so walking out of the door
  // and along the pavement crosses its reach boundary. Its collider and
  // its `interact_at` both come from `defs/objects`'s own `trash_bin`.
  {
    id: 15n,
    assetKey: "trashBin",
    x: DOOR_X_A + 2,
    y: SOUTH_WALL_Y + 1,
    floor: 0,
    layer: "objects",
    defId: TRASH_BIN_DEF_ID,
  },

  // A solid obstacle straight south of shop A's door, on the pavement
  // (story 1.8): the known-solid rest point `render-order.spec.ts` and
  // `drawables.test.ts` walk the player into.
  {
    id: 14n,
    assetKey: "table",
    x: LAMPPOST_CELL.x,
    y: LAMPPOST_CELL.y,
    floor: 0,
    layer: "objects",
    defId: LAMPPOST_DEF_ID,
  },

  // --- Shop B: a different business, different furniture (Artie's
  // "grounded city" direction -- two copies of the same shop breaks it):
  // a grocer, not a second tiki bar. No west wall prop of its own on
  // either row: the party wall (id 5) closes its interior rows, id 40
  // (above) closes its front row -- shop B's own door sits immediately
  // east of that pier, so there is nothing left for a separate "west
  // segment" prop to cover (cycle-2: `DOOR_X_B` moved from one cell east
  // of `INTERIOR_X0_B` to the party-wall pier's own neighbour). ---
  {
    id: 30n,
    assetKey: "wallTile",
    x: INTERIOR_X0_B,
    y: NORTH_WALL_Y,
    floor: 0,
    layer: "walls",
    footprint: { width: EAST_WALL_X_B - INTERIOR_X0_B + 1, height: 1 },
    solid: true,
    wallOrientation: "horizontal",
  },
  // The window stops one cell short of the east wall -- id 41 below is
  // that last cell, the same full-height corner pier shop A's own party
  // wall side gets (id 40).
  {
    id: 32n,
    assetKey: "window",
    x: WINDOW_X_B,
    y: SOUTH_WALL_Y,
    floor: 0,
    layer: "walls",
    footprint: { width: WINDOW_WIDTH, height: 1 },
    defId: WINDOW_DEF_ID,
  },
  {
    id: 34n,
    assetKey: "wallTile",
    x: EAST_WALL_X_B,
    y: INTERIOR_Y0,
    floor: 0,
    layer: "walls",
    footprint: { width: 1, height: INTERIOR_Y1 - INTERIOR_Y0 + 1 },
    solid: true,
    wallOrientation: "vertical",
  },
  // Shop B's own front-wall pier at its east corner, the mirror of shop
  // A's own id 40 (Artie's cycle-2 direction).
  {
    id: 41n,
    assetKey: "wallTile",
    x: EAST_WALL_X_B,
    y: SOUTH_WALL_Y,
    floor: 0,
    layer: "walls",
    footprint: { width: 1, height: 1 },
    solid: true,
    wallOrientation: "horizontal",
  },
  // Shop B's own shelving (a grocery-store display, not a bar counter)
  // and a produce basket -- different interior furniture from shop A's,
  // right behind its own window.
  { id: 35n, assetKey: "shelf", x: INTERIOR_X0_B, y: INTERIOR_Y0, floor: 0, layer: "furniture" },
  { id: 36n, assetKey: "basket", x: WINDOW_X_B, y: INTERIOR_Y1, floor: 0, layer: "furniture" },

  // --- The subway ---------------------------------------------------------
  // The stairwell entrance: a physical prop, walkable (no collider) --
  // never a teleport tile. A real descending stairwell with railings
  // (Artie's direction), never the flat tread strip a footprint-1 prop
  // reused for both directions would read as.
  {
    id: 50n,
    assetKey: "subwayStairsDown",
    x: STAIRS_X,
    y: STAIRS_Y,
    floor: STREET_FLOOR,
    layer: "objects",
  },
  // The matching up-stairs on the platform, one cell north of the
  // landing (`PLATFORM_UP_ANCHOR_X/Y`'s own doc comment) -- a distinct
  // sprite from the street's own down stairwell (Artie's direction: one
  // sprite never plays both roles).
  {
    id: 51n,
    assetKey: "subwayStairsUp",
    x: PLATFORM_UP_ANCHOR_X,
    y: PLATFORM_UP_ANCHOR_Y,
    floor: SUBWAY_FLOOR,
    layer: "objects",
  },
  ...platformWalls(),
  // At the platform's own west end, clear of the up-stairs sprite's own
  // overhang (Artie's cycle-2 direction: the stairs, anchored at
  // `PLATFORM_UP_ANCHOR_X`, were covering the bench almost completely
  // when the two sat one cell apart).
  {
    id: 64n,
    assetKey: "subwayBench",
    x: PLATFORM_INTERIOR_X0,
    y: PLATFORM_INTERIOR_Y0,
    floor: SUBWAY_FLOOR,
    layer: "furniture",
    footprint: { width: 2, height: 1 },
    solid: true,
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
 * around everything `INTERIOR_FLOOR_TILES`/`INTERIOR_FLOOR_TILES_B` and
 * `SIDEWALK_TILES` paint, so the avatar can never walk off the ground
 * into the void. The shops' own walls close the rest of the ring.
 * `drawables.test.ts` proves the ring is closed by walking the real
 * resolver against it. The platform (floor -1) needs no separate entry
 * here: its own four walls (`platformWalls`) already close it. */
export const DEMO_BOUNDARY: readonly DemoBoundaryRect[] = [
  // West and east of the pavement.
  { id: 101n, x: 0, y: SOUTH_WALL_Y, width: 1, height: 4 },
  { id: 102n, x: 21, y: SOUTH_WALL_Y, width: 1, height: 4 },
  // South of the pavement.
  { id: 103n, x: 0, y: 9, width: 21, height: 1 },
  // North of the pavement, either side of the terrace's own footprint --
  // the two stretches of pavement edge no wall already closes.
  { id: 104n, x: 1, y: SOUTH_WALL_Y - 1, width: WEST_WALL_X - 1, height: 1 },
  {
    id: 105n,
    x: EAST_WALL_X_B + 1,
    y: SOUTH_WALL_Y - 1,
    width: 21 - (EAST_WALL_X_B + 1),
    height: 1,
  },
] as const;

/** One flat-pass ground tile group (FR123: three flat passes before the
 * sorted pool) -- never depth-sorted, painted once in a fixed grid. Story
 * 1.7: carries its own `floor` so `scene.ts` can cull it the same way
 * every other drawable is culled (FR122), through `render/pixi-
 * visibility.ts`'s `VisibilityApplier`, never a second, ad hoc rule. */
export interface DemoGroundTiles {
  readonly assetKey: string;
  readonly floor: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Interior floor and exterior pavement are two distinct textures
 * (Artie's direction: there must be an inside); the platform's own floor
 * and edge strip are two more, from the subway pack, never the shops'
 * `floor` crop (Artie's direction: it must read as somewhere new). */
export const INTERIOR_FLOOR_TILES: DemoGroundTiles = {
  assetKey: "floor",
  floor: STREET_FLOOR,
  x0: WEST_WALL_X,
  y0: NORTH_WALL_Y,
  x1: PARTY_WALL_X + 1,
  y1: SOUTH_WALL_Y,
};

export const INTERIOR_FLOOR_TILES_B: DemoGroundTiles = {
  assetKey: "floor",
  floor: STREET_FLOOR,
  x0: PARTY_WALL_X + 1,
  y0: NORTH_WALL_Y,
  x1: EAST_WALL_X_B + 1,
  y1: SOUTH_WALL_Y,
};

// One row deeper than the terrace needs, because a bottom-anchored sprite
// paints a row lower than the cell its body occupies: the player resting
// against the lamppost must still be drawn over pavement, not past its
// last painted row. Widened east to cover both shops and the subway
// stairwell.
export const SIDEWALK_TILES: DemoGroundTiles = {
  assetKey: "sidewalk",
  floor: STREET_FLOOR,
  x0: 1,
  y0: SOUTH_WALL_Y,
  x1: 21,
  y1: 10,
};

/** The platform's own floor pass, floor -1 -- Artie's direction: what
 * surrounds it is plain black (nothing drawn), never a texture, so this
 * pass paints only the interior the walls enclose, one row short of the
 * front wall to leave room for the edge strip below. */
export const PLATFORM_FLOOR_TILES: DemoGroundTiles = {
  assetKey: "subwayFloor",
  floor: SUBWAY_FLOOR,
  x0: PLATFORM_INTERIOR_X0,
  y0: PLATFORM_INTERIOR_Y0,
  x1: PLATFORM_INTERIOR_X1 + 1,
  y1: PLATFORM_INTERIOR_Y1,
};

/** The platform's own hazard-striped edge, one row along its front wall
 * (Artie's "a platform edge strip") -- from the subway pack, distinct
 * from the plain floor tile either side of it. */
export const PLATFORM_EDGE_TILES: DemoGroundTiles = {
  assetKey: "subwayEdge",
  floor: SUBWAY_FLOOR,
  x0: PLATFORM_INTERIOR_X0,
  y0: PLATFORM_INTERIOR_Y1,
  x1: PLATFORM_INTERIOR_X1 + 1,
  y1: PLATFORM_INTERIOR_Y1 + 1,
};

/** Every ground tile group `scene.ts` paints, in pass order -- the one
 * list both the mount code and any future ground-visibility test walk,
 * so a new group is never forgotten in one place. */
export const DEMO_GROUND_TILES: readonly DemoGroundTiles[] = [
  INTERIOR_FLOOR_TILES,
  INTERIOR_FLOOR_TILES_B,
  SIDEWALK_TILES,
  PLATFORM_FLOOR_TILES,
  PLATFORM_EDGE_TILES,
];

/** The demo's own collider sources, keyed by the synthetic def id
 * `demoDefId` mints: the shops' plain walls (solid across their whole
 * footprint) and the world boundary. Anything that exists in `defs/`
 * (the window, the lamppost) is absent here and read from `defs/`
 * instead. `subcellsPerCell` comes from the scene, which reads it from
 * `defs/`'s generated `COLLIDER_SUBCELLS_PER_CELL` -- this module never
 * states it. */
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
      // The real layer code, not a placeholder: story 1.9's footprint
      // index resolves an FR123 rank from it, which is what decides
      // which of two objects sharing a cell a click lands on.
      layer: layerCodeByName(prop.layer),
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
