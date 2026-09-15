// The committed, deterministic story 1.6/1.7 street scene (Artie's
// direction): fixed layout, fixed seed, no randomisation, real LimeZu
// sprites only -- no coloured rectangles. Pure data, zero PixiJS: shared
// by the real adapter (`scene.ts`, mounted from `main.ts`) and
// `client/tests/unit/test-street/drawables.test.ts`'s ordering check, so the
// comparator and the adapter can never silently disagree about what this
// scene should look like (Quentin's direction), and by
// `client/tests/e2e/render-order.spec.ts`/`enclosure.spec.ts`, which read
// the same order and visibility state back out of a real mounted display
// list through `window.__bc`.
//
// This scene and its asset choices are throwaway harness code (Artie's
// own framing, and why it lives under `src/test-street/` rather than
// `src/render/`) -- the sort key, the rank ladder, the storey constant and
// (story 1.7) the visibility rules are the permanent things these stories
// add, not this file.
//
// Story 1.7 (FR120/FR121/FR122) pays off the shortcut story 1.6 took: the
// old `wallTileShort` front-wall stub is gone -- near-side retraction now
// exists, so the street shows it, not a permanently short wall. The terrace
// is two shops, A and B, sharing one party wall at `PARTY_WALL_X`, each
// with its own door, its own front window (a real `defs/objects` `window
// = true` tile, never a `wall_decals` overlay) and its own furniture. A
// subway stairwell on the pavement leads down to a small platform on
// floor -1, whose own front wall retracts the same ownership-keyed way a
// shop's does while the player stands on it.
//
// Near-side-ness (FR120) is never hand-authored here: `test-street/drawables.ts`
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
 * just which one each street prop is on. */
export type StreetLayer = "furniture" | "objects" | "walls" | "wall_decals" | "characters";

/** A prop wide/tall enough to need FR125 decomposition. Orientation
 * (`PlacedObject.orientation`) is a later story's concern; this fixture
 * simply states the already-oriented extent a real world generator would
 * have resolved before calling `decomposeFootprint`. */
export interface StreetFootprint {
  readonly width: number;
  readonly height: number;
}

/** One placed prop in the street scene. `x`/`y` are the anchor cell (world
 * tile coordinates); `assetKey` names an entry in `scene.ts`'s asset
 * table -- this module knows nothing about textures or PixiJS.
 *
 * Collision comes from one of two places, never a hand-typed sub-cell
 * rect: `defId` names a real `defs/objects` entry and uses that entry's
 * own `collider`; `solid` is street-only geometry (the shops' plain walls,
 * which are not `defs/` objects) blocking the prop's whole footprint. */
export interface StreetProp {
  readonly id: bigint;
  readonly assetKey: string;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly layer: StreetLayer;
  readonly footprint?: StreetFootprint;
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

/** `defs/objects/city-props.toml`'s own `lamppost` id -- the street places
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
 * 1.7): a real `[[object]] window = true` entry, never a street-only flag --
 * every shopfront window places it by id, the same way the lamppost
 * does. */
export const WINDOW_DEF_ID = 5;
/** `defs/objects/city-props.toml`'s own `wall_segment` id (story 1.13):
 * one plain solid wall cell -- the bridge's own parapet is laid from
 * these, one cell at a time. */
export const WALL_SEGMENT_DEF_ID = 6;
/** `defs/objects/city-props.toml`'s own `bridge_deck` id (story 1.13): a
 * four-cell walkable span with no collider at all, so the street below
 * it is unobstructed (FR117/FR128). */
export const BRIDGE_DECK_DEF_ID = 7;
/** `defs/objects/city-props.toml`'s own `foot_stairs` id (story 1.13): a
 * walkable flight of steps. Which floors it joins is a `floor_transition`
 * row anchored on its cell, never a field on the prop. */
export const FOOT_STAIRS_DEF_ID = 8;

/** Synthetic def ids for street-only geometry (walls, world boundary),
 * offset far past any real `defs/objects` id so the two never collide in
 * the one `defId -> collider` map the grid is built from. */
const STREET_DEF_ID_BASE = 10_000;

export function streetDefId(id: bigint): number {
  return STREET_DEF_ID_BASE + Number(id);
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

// --- the subway (declared before STREET_BUILDING_AREAS, which references
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

// --- the footbridge (story 1.13) ---------------------------------------
//
// The AC2 case no other part of this street carries: two floors at one
// `(x, y)`. The deck spans the pavement one storey up, so the cells
// `(BRIDGE_X0..BRIDGE_X1, BRIDGE_DECK_Y)` exist twice over -- open
// pavement on floor 0, walkable deck on floor 1 -- and neither floor's
// collision ever reaches the other (FR117). Walking east along the
// pavement passes *under* it; the stairs at its east end lead up onto it.

export const BRIDGE_FLOOR = STREET_FLOOR + 1;
/** The deck's own row: the first pavement row south of the terrace, so
 * the underpass is the same row the walk east already uses. */
export const BRIDGE_DECK_Y = SOUTH_WALL_Y + 1;
export const BRIDGE_X0 = 17;
/** Four cells of `bridge_deck`, the def's own declared width. */
export const BRIDGE_DECK_WIDTH = 4;
export const BRIDGE_X1 = BRIDGE_X0 + BRIDGE_DECK_WIDTH - 1;

/** Where the street-level stairs stand: the pavement row south of the
 * deck's own east end. Entering this cell climbs onto the deck. */
export const BRIDGE_UP_ANCHOR_X = BRIDGE_X1;
export const BRIDGE_UP_ANCHOR_Y = BRIDGE_DECK_Y + 1;

/** Where the deck's own down-stairs stand: one cell west of the
 * up-stairs' own landing. A walker still holding its direction key when
 * it lands keeps moving, and how far it travels before the key is
 * released is not something the walker controls -- so where it lands has
 * to be far enough from every *other* transition anchor that an
 * overshoot can never fall into one. From here that is the subway
 * stairwell, `STAIRS_X - BRIDGE_DOWN_ANCHOR_X` cells west, which
 * `street-conformance.test.ts` walks with a deliberately exaggerated
 * release lag to prove. */
export const BRIDGE_DOWN_ANCHOR_X = BRIDGE_X1 - 1;
export const BRIDGE_DOWN_ANCHOR_Y = BRIDGE_DECK_Y;

/** The floor transition data (Tim's `world/transitions.ts` port): entering
 * the stairwell cell on the street lands on the platform; entering the
 * up-stairs' own anchor cell returns to the street, one cell beside the
 * stairwell. The footbridge's own two rows are the same shape, one storey
 * up. Never a boolean on the stairs prop -- a `floor_transition`-shaped
 * row, anchor cell to target cell, exactly like the server's own
 * model. */
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
  {
    x: BRIDGE_UP_ANCHOR_X,
    y: BRIDGE_UP_ANCHOR_Y,
    floor: STREET_FLOOR,
    targetX: BRIDGE_X1,
    targetY: BRIDGE_DECK_Y,
    targetFloor: BRIDGE_FLOOR,
  },
  {
    x: BRIDGE_DOWN_ANCHOR_X,
    y: BRIDGE_DOWN_ANCHOR_Y,
    floor: BRIDGE_FLOOR,
    targetX: BRIDGE_DOWN_ANCHOR_X,
    targetY: BRIDGE_DECK_Y + 1,
    targetFloor: STREET_FLOOR,
  },
];

/** The ownership areas the street's own `OwnershipIndex` is built from
 * (mirrors `building_area` rows): each shop's whole footprint, walls
 * included, on the floor(s) it actually occupies, and the platform's own
 * footprint on floor -1, which is what lets its own front wall retract
 * the same way a shop's does. Room ownership is not used this story
 * (Tim's direction). No shop owns an upper storey here: `isStoreyAboveCulled`
 * is proven directly, against synthetic drawables, in
 * `visibility.test.ts` -- it does not need this fixture to carry one. */
export const STREET_BUILDING_AREAS: readonly OwnershipArea[] = [
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

export const STREET_ROOM_AREAS: readonly OwnershipArea[] = [];

/** The platform's own boundary wall ring -- a real, solid, drawn wall
 * built from the subway pack's own tiled wall art (Artie's direction),
 * near-side exactly where `render/visibility.ts`'s `isNearSideWall`
 * predicate says it is (the front/south run) -- no special-casing here. */
function platformWalls(): readonly StreetProp[] {
  const walls: StreetProp[] = [
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
export const STREET_PROPS: readonly StreetProp[] = [
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
  // (Artie's cycle-2 direction). Owned by shop A (`STREET_BUILDING_AREAS`'s
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
  // --- The footbridge (story 1.13) -------------------------------------
  // The deck itself: one multi-cell prop, placed by its real `defs/`
  // id, so its "no collider at all" comes from `defs/objects` rather
  // than from this fixture choosing not to give it one.
  {
    id: 70n,
    assetKey: "bridgeDeck",
    x: BRIDGE_X0,
    y: BRIDGE_DECK_Y,
    floor: BRIDGE_FLOOR,
    layer: "objects",
    footprint: { width: BRIDGE_DECK_WIDTH, height: 1 },
    defId: BRIDGE_DECK_DEF_ID,
  },
  // The parapet along the deck's own north edge: real `wall_segment`
  // cells, one per deck column. Owned by no building, so they are never
  // retracted however close the player stands (FR120 is keyed on
  // ownership, never proximity).
  ...Array.from({ length: BRIDGE_DECK_WIDTH }, (_, index) => ({
    id: BigInt(71 + index),
    assetKey: "wallTile",
    x: BRIDGE_X0 + index,
    y: BRIDGE_DECK_Y - 1,
    floor: BRIDGE_FLOOR,
    layer: "walls" as const,
    defId: WALL_SEGMENT_DEF_ID,
    wallOrientation: "vertical" as const,
  })),
  // The stairs at each end: walkable props (no collider in `defs/`),
  // each the physical thing a `floor_transition` row is anchored on.
  {
    id: 80n,
    assetKey: "bridgeStairs",
    x: BRIDGE_UP_ANCHOR_X,
    y: BRIDGE_UP_ANCHOR_Y,
    floor: STREET_FLOOR,
    layer: "objects",
    defId: FOOT_STAIRS_DEF_ID,
  },
  {
    id: 81n,
    assetKey: "bridgeStairs",
    x: BRIDGE_DOWN_ANCHOR_X,
    y: BRIDGE_DOWN_ANCHOR_Y,
    floor: BRIDGE_FLOOR,
    layer: "objects",
    defId: FOOT_STAIRS_DEF_ID,
  },

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
export interface StreetBoundaryRect {
  readonly id: bigint;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Which floor this stretch of edge closes. Defaults to the street
   * (`STREET_FLOOR`); the footbridge's own deck needs its own ring one
   * storey up, since a floor's collision never reaches another (FR117). */
  readonly floor?: number;
  /** An optional sub-cell collider (`COLLIDER_SUBCELLS_PER_CELL` per
   * cell, relative to the anchor cell's top-left), for an edge that is
   * not a whole cell of solid. Defaults to the whole rect.
   *
   * The bridge's own south rail needs one. A walker holding a direction
   * key into a whole-cell edge comes to rest exactly on the cell
   * boundary, and a position exactly on a boundary belongs to the cell
   * *past* it -- so a walker pressed against a whole-cell rail south of
   * the deck would report standing one row south of the deck, where the
   * stairs down are not, and could never take them. A rail whose solid
   * part reaches a little way back into the deck's own row stops the
   * walker strictly inside that row instead. */
  readonly collider?: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
}

/** The edge of the drawn world (FR137 has no world-boundary concept yet,
 * and the pavement simply stops): a closed ring of solid, undrawn cells
 * around everything `INTERIOR_FLOOR_TILES`/`INTERIOR_FLOOR_TILES_B` and
 * `SIDEWALK_TILES` paint, so the avatar can never walk off the ground
 * into the void. The shops' own walls close the rest of the ring.
 * `drawables.test.ts` proves the ring is closed by walking the real
 * resolver against it. The platform (floor -1) needs no separate entry
 * here: its own four walls (`platformWalls`) already close it. */
export const STREET_BOUNDARY: readonly StreetBoundaryRect[] = [
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
  // The footbridge's own ring, one storey up: the deck is the only
  // standable thing on `BRIDGE_FLOOR`, so everything around it is closed
  // off. Its north side needs no entry -- the parapet (real
  // `wall_segment` cells) already closes it.
  //
  // The south side is the rail along the deck's own edge: anchored on the
  // deck row itself, solid only across its last two sub-cells, so a
  // walker leaning on it stops strictly inside the deck's row rather
  // than exactly on its southern boundary (see `collider` above).
  {
    id: 110n,
    x: BRIDGE_X0 - 1,
    y: BRIDGE_DECK_Y,
    width: BRIDGE_DECK_WIDTH + 2,
    height: 1,
    floor: BRIDGE_FLOOR,
    collider: { x0: 0, y0: 14, x1: (BRIDGE_DECK_WIDTH + 2) * 16, y1: 16 },
  },
  { id: 111n, x: BRIDGE_X0 - 1, y: BRIDGE_DECK_Y, width: 1, height: 1, floor: BRIDGE_FLOOR },
  { id: 112n, x: BRIDGE_X1 + 1, y: BRIDGE_DECK_Y, width: 1, height: 1, floor: BRIDGE_FLOOR },
  { id: 113n, x: BRIDGE_X0 - 1, y: BRIDGE_DECK_Y - 1, width: 1, height: 1, floor: BRIDGE_FLOOR },
  { id: 114n, x: BRIDGE_X1 + 1, y: BRIDGE_DECK_Y - 1, width: 1, height: 1, floor: BRIDGE_FLOOR },
] as const;

/** One flat-pass ground tile group (FR123: three flat passes before the
 * sorted pool) -- never depth-sorted, painted once in a fixed grid. Story
 * 1.7: carries its own `floor` so `scene.ts` can cull it the same way
 * every other drawable is culled (FR122), through `render/pixi-
 * visibility.ts`'s `VisibilityApplier`, never a second, ad hoc rule. */
export interface StreetGroundTiles {
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
export const INTERIOR_FLOOR_TILES: StreetGroundTiles = {
  assetKey: "floor",
  floor: STREET_FLOOR,
  x0: WEST_WALL_X,
  y0: NORTH_WALL_Y,
  x1: PARTY_WALL_X + 1,
  y1: SOUTH_WALL_Y,
};

export const INTERIOR_FLOOR_TILES_B: StreetGroundTiles = {
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
export const SIDEWALK_TILES: StreetGroundTiles = {
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
export const PLATFORM_FLOOR_TILES: StreetGroundTiles = {
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
export const PLATFORM_EDGE_TILES: StreetGroundTiles = {
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
export const STREET_GROUND_TILES: readonly StreetGroundTiles[] = [
  INTERIOR_FLOOR_TILES,
  INTERIOR_FLOOR_TILES_B,
  SIDEWALK_TILES,
  PLATFORM_FLOOR_TILES,
  PLATFORM_EDGE_TILES,
];

/** The street's own collider sources, keyed by the synthetic def id
 * `streetDefId` mints: the shops' plain walls (solid across their whole
 * footprint) and the world boundary. Anything that exists in `defs/`
 * (the window, the lamppost) is absent here and read from `defs/`
 * instead. `subcellsPerCell` comes from the scene, which reads it from
 * `defs/`'s generated `COLLIDER_SUBCELLS_PER_CELL` -- this module never
 * states it. */
export function streetColliderSources(
  subcellsPerCell: number,
): ReadonlyMap<number, ColliderSource> {
  const sources = new Map<number, ColliderSource>();
  for (const prop of STREET_PROPS) {
    if (!prop.solid) continue;
    const { width, height } = prop.footprint ?? { width: 1, height: 1 };
    sources.set(streetDefId(prop.id), {
      width,
      height,
      collider: { x0: 0, y0: 0, x1: width * subcellsPerCell, y1: height * subcellsPerCell },
    });
  }
  for (const rect of STREET_BOUNDARY) {
    sources.set(streetDefId(rect.id), {
      width: rect.width,
      height: rect.height,
      collider: rect.collider ?? {
        x0: 0,
        y0: 0,
        x1: rect.width * subcellsPerCell,
        y1: rect.height * subcellsPerCell,
      },
    });
  }
  return sources;
}

/** Every collider-bearing placement the street feeds the grid, shaped like
 * the generated `PlacedObject` binding: the props that declare `defId` or
 * `solid`, plus the undrawn boundary ring. A later chunk-streaming story
 * replaces this with a real subscription; the grid's own API does not
 * change. */
export function streetPlacedRows(): readonly PlacedObject[] {
  const rows: PlacedObject[] = [];
  for (const prop of STREET_PROPS) {
    const defId = prop.defId ?? (prop.solid ? streetDefId(prop.id) : undefined);
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
  for (const rect of STREET_BOUNDARY) {
    rows.push({
      objectId: rect.id,
      defId: streetDefId(rect.id),
      x: rect.x,
      y: rect.y,
      floor: rect.floor ?? STREET_FLOOR,
      layer: 0,
      orientation: 0,
      chunkKey: 0n,
    });
  }
  return rows;
}

/** Every `furniture` prop that sits directly behind some window wall tile
 * (a real `defs/objects` entry with `window = true`, placed by
 * `WINDOW_DEF_ID`): the same floor, strictly north of that window's own
 * row, and horizontally overlapping its footprint width. This is the
 * exact geometric fact FR121's "furniture is visible through a
 * translucent window" rests on -- computed once from the real prop list,
 * never a hand-typed id list and never every floor-0 furniture prop
 * regardless of whether a window is actually in front of it, so this set
 * can never pass vacuously and a re-laid street that drops the case fails
 * here rather than only looking wrong on screen. */
export function furnitureBehindWindows(): readonly bigint[] {
  const windows = STREET_PROPS.filter((prop) => prop.defId === WINDOW_DEF_ID);
  const ids = new Set<bigint>();
  for (const prop of STREET_PROPS) {
    if (prop.layer !== "furniture") continue;
    const propWidth = prop.footprint?.width ?? 1;
    for (const window of windows) {
      if (prop.floor !== window.floor) continue;
      if (prop.y >= window.y) continue;
      const windowWidth = window.footprint?.width ?? 1;
      const overlaps = prop.x < window.x + windowWidth && window.x < prop.x + propWidth;
      if (overlaps) {
        ids.add(prop.id);
        break;
      }
    }
  }
  return [...ids];
}

// --- the scripted walk (story 1.13) -------------------------------------
//
// One route, declared once, here with the geometry it walks (Quentin's
// direction): `tests/unit/test-street/street-conformance.test.ts` walks it
// against the real `world/floor-walk.ts` resolver to prove it is
// collision-feasible at all, and `tests/e2e/test-street.spec.ts` walks the
// identical list through real `page.keyboard` input. Neither restates a
// coordinate, so Epic 3 swapping this street's data keeps both.

/** One held movement key, in the same `KeyboardEvent.code`-shaped names
 * the default bindings use -- never a raw direction vector, because the
 * e2e walk must go through the real keybindings, not around them. */
export type StreetWalkKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** When to let a held key go. Declarative on purpose: the same value is
 * evaluated in node (against a simulated step) and inside the page
 * (against `window.__bc.playerPosition`/`playerFloor`), so neither side
 * needs a fixed wait. */
export type StreetWalkUntil =
  | { readonly kind: "x-at-least"; readonly value: number }
  | { readonly kind: "x-at-most"; readonly value: number }
  | { readonly kind: "y-at-least"; readonly value: number }
  | { readonly kind: "y-at-most"; readonly value: number }
  | { readonly kind: "floor"; readonly value: number };

export interface StreetWalkSegment {
  /** The checkpoint this segment ends at -- what the e2e spec asserts
   * against by name, so a reordered route can never silently assert the
   * wrong thing at the wrong place. */
  readonly label: string;
  readonly key: StreetWalkKey;
  readonly until: StreetWalkUntil;
}

/** Whether a held key's own release condition is met, for a walker at
 * `(x, y)` on `floor`. The one rule both the simulated and the real walk
 * use. */
export function streetWalkUntilMet(
  until: StreetWalkUntil,
  x: number,
  y: number,
  floor: number,
): boolean {
  switch (until.kind) {
    case "x-at-least":
      return x >= until.value;
    case "x-at-most":
      return x <= until.value;
    case "y-at-least":
      return y >= until.value;
    case "y-at-most":
      return y <= until.value;
    case "floor":
      return floor === until.value;
  }
}

/** The direction a held key walks in -- the same mapping the default
 * keybindings produce, restated here only so the *simulated* walk can run
 * without a DOM (`input/keyboard.ts` needs real key events). */
export const STREET_WALK_DIRECTIONS: Readonly<Record<StreetWalkKey, { x: number; y: number }>> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

/** What the route needs from `defs/` -- the one rest position that is a
 * real collider face rather than a cell coordinate, supplied by the
 * caller so this module stays free of `defs/` (and of any filesystem or
 * fetch). */
export interface StreetWalkInputs {
  /** Where a walk straight south out of shop A's door comes to rest: the
   * top face of the lamppost's own base collider. */
  readonly lamppostRestY: number;
}

/**
 * The scripted walk, in order. It leaves shop A by its door (the
 * enclosure case), rests part-way through the lamppost (the
 * pass-partly-through case: inside the footprint, outside the collider),
 * walks east along the pavement, turns up onto the underpass row and
 * crosses *under* the bridge deck (the two-floors-at-one-`(x, y)` case),
 * climbs onto the deck by its stairs (the transition case), walks the
 * deck's own multi-cell span, and comes back down to the street.
 */
export function streetWalkRoute(inputs: StreetWalkInputs): readonly StreetWalkSegment[] {
  return [
    // Out of the door, onto the pavement: the building's own near-side
    // walls come back the moment the player is no longer inside it.
    {
      label: "outside-the-shopfront",
      key: "ArrowDown",
      until: { kind: "y-at-least", value: SOUTH_WALL_Y + 1 },
    },
    // Into the lamppost, coming to rest against its own small base
    // collider part-way into its cell.
    {
      label: "part-way-through-the-lamppost",
      key: "ArrowDown",
      until: { kind: "y-at-least", value: inputs.lamppostRestY - 0.01 },
    },
    // East along the pavement, turning north at the terrace's own east
    // end -- several cells short of the subway stairwell's anchor cell,
    // because a held key is released over a round trip and the walker
    // keeps moving meanwhile. A threshold half a cell from that anchor
    // would send a slow enough machine underground instead.
    {
      label: "east-along-the-pavement",
      key: "ArrowRight",
      until: { kind: "x-at-least", value: EAST_WALL_X_B - 0.5 },
    },
    // North onto the row the bridge deck spans.
    {
      label: "on-the-underpass-row",
      key: "ArrowUp",
      until: { kind: "y-at-most", value: BRIDGE_DECK_Y + 0.6 },
    },
    // Under the deck, the whole span: from here east, every cell walked
    // has a drawable one floor above it at the same `(x, y)`.
    {
      label: "under-the-bridge",
      key: "ArrowRight",
      until: { kind: "x-at-least", value: BRIDGE_X1 + 0.4 },
    },
    // South onto the stairs at the deck's east end -- the transition
    // cell, which lands the player on the deck one storey up.
    {
      label: "on-the-bridge-deck",
      key: "ArrowDown",
      until: { kind: "floor", value: BRIDGE_FLOOR },
    },
    // West along the deck, over the street, down the far stairs.
    {
      label: "back-on-the-street",
      key: "ArrowLeft",
      until: { kind: "floor", value: STREET_FLOOR },
    },
  ];
}

/**
 * The lap the NFR2 perf harness walks, over and over: north of the
 * bridge, west along the terrace, back east, up onto the deck and down
 * again. It starts and ends at exactly the position
 * [`streetWalkRoute`]'s own last segment leaves the walker in, so laps
 * chain with nothing to reset between them.
 *
 * Every segment ends either against a real collider or on a floor
 * transition, and never on a bare coordinate threshold. That is
 * deliberate: a held key is released over a round trip to the page, so
 * how far past its own threshold a walker travels is a property of the
 * machine, not of the route. A collider rest and a transition are both
 * immune to that -- walking further into a wall changes nothing, and a
 * transition fires on entering a whole cell -- so a lap that only uses
 * those is the same lap on a fast machine and a slow one.
 */
export function streetBridgeLapRoute(): readonly StreetWalkSegment[] {
  return [
    // North until the pavement's own northern edge stops the walker.
    {
      label: "lap-north-of-the-bridge",
      key: "ArrowUp",
      until: { kind: "y-at-most", value: BRIDGE_DECK_Y - 0.4 },
    },
    // West until the terrace's own east wall stops it.
    {
      label: "lap-west-along-the-terrace",
      key: "ArrowLeft",
      until: { kind: "x-at-most", value: EAST_WALL_X_B + 1.5 },
    },
    // East until the world's own eastern edge stops it.
    {
      label: "lap-east-to-the-bridge",
      key: "ArrowRight",
      until: { kind: "x-at-least", value: BRIDGE_X1 + 0.4 },
    },
    // Down onto the stairs, which are the transition itself.
    {
      label: "lap-up-onto-the-deck",
      key: "ArrowDown",
      until: { kind: "floor", value: BRIDGE_FLOOR },
    },
    // West along the deck, down the far stairs, back where the lap began.
    {
      label: "lap-down-to-the-street",
      key: "ArrowLeft",
      until: { kind: "floor", value: STREET_FLOOR },
    },
  ];
}
