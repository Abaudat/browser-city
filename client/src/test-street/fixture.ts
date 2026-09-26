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

/** The layers a street prop can be on (FR123): the five pool layers plus
 * `ground_objects`, the flat pass for anything lying on the ground -- the
 * ladder itself lives in `sim::codes::layer`/`render/layer-table.ts`;
 * this is just which one each street prop is on. */
export type StreetLayer =
  | "ground_objects"
  | "furniture"
  | "objects"
  | "walls"
  | "wall_decals"
  | "characters";

/** A prop wide/tall enough to need FR125 decomposition. Orientation
 * (`PlacedObject.orientation`) is a later story's concern; this fixture
 * simply states the already-oriented extent a real world generator would
 * have resolved before calling `decomposeFootprint`. */
export interface StreetFootprint {
  readonly width: number;
  readonly height: number;
}

/** Every field a placed prop carries regardless of where its art comes
 * from. `x`/`y` are the anchor cell (world tile coordinates).
 *
 * Collision comes from one of two places, never a hand-typed sub-cell
 * rect: `defId` names a real `defs/objects` entry and uses that entry's
 * own `collider`; `solid` is street-only geometry (the shops' plain walls,
 * which are not `defs/` objects) blocking the prop's whole footprint. */
interface StreetPropBase {
  readonly id: bigint;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly layer: StreetLayer;
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

/** A prop placed by a real `defs/objects` id (story 2.13): its texture
 * identity is the def id alone, resolved only through
 * `render/atlas-pages.ts`'s `AtlasPageLoader.objectCellTexture`.
 * Never carries `assetKey`/`sourceCol`/`sourceRow` -- a `defId` row that
 * could still name a raw asset is exactly the shortcut this story
 * retires. Never carries `footprint` either (Tim's direction, cycle 2):
 * its extent comes only from the placed object's own `object_def` --
 * `buildPropDrawables` reads `width`/`height` straight off the resolved
 * def, so a def that changes its own width (`shop_window`, story 2.13)
 * can never leave a hand-restated footprint quietly out of step with it
 * again. */
export interface StreetPropByDef extends StreetPropBase {
  readonly defId: number;
}

/** A prop placed by a hand-picked asset key into `scene.ts`'s own raw
 * `ModernTileset/` texture table -- street-only harness geometry with no
 * real `defs/objects` entry behind it (ground tiles, the shops' plain
 * wall runs, the poster, loose furniture). Never carries `defId`. Only
 * this variant may declare its own `footprint`: there is no `object_def`
 * for `buildPropDrawables` to read one from instead. */
export interface StreetPropByAsset extends StreetPropBase {
  readonly assetKey: string;
  readonly footprint?: StreetFootprint;
  /** Sub-cell collider rects for a `solid` asset-placed prop, shaped to
   * its art (`COLLIDER_SUBCELLS_PER_CELL` per cell, relative to the
   * footprint's own north-west sub-cell origin). Absent means the whole
   * footprint blocks. The first rect is the prop's own grid entry; each
   * further rect is fed as a collider part (`streetColliderPartId`) with
   * the same anchor and footprint. */
  readonly colliders?: readonly StreetColliderRect[];
}

/** A half-open sub-cell rect, the same shape as a `defs/objects`
 * `collider`. */
export interface StreetColliderRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** One placed prop in the street scene -- a discriminated union (Tim's/
 * Quentin's direction, story 2.13): a `defId` row has no `assetKey` field
 * at all, and an `assetKey` row has no `defId`, so the seam this story
 * retires cannot regress without a type error. */
export type StreetProp = StreetPropByDef | StreetPropByAsset;

/** Narrows a [`StreetProp`] to its `defId` variant -- the one place this
 * module's own discriminant check lives, never repeated as a bare
 * `"defId" in prop` at each call site. */
export function isDefStreetProp(prop: StreetProp): prop is StreetPropByDef {
  return "defId" in prop;
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

const STREET_COLLIDER_PART_ID_BASE = 10_000n;
const STREET_COLLIDER_PARTS_PER_PROP = 16n;

/** The object id of an asset prop's `index`-th collider rect (index >= 1;
 * rect 0 is the prop's own row). */
export function streetColliderPartId(propId: bigint, index: number): bigint {
  return STREET_COLLIDER_PART_ID_BASE + propId * STREET_COLLIDER_PARTS_PER_PROP + BigInt(index);
}

/** The `STREET_PROPS` id whose collider an object id belongs to: the id
 * itself for a prop's own row, the owning prop for a collider part. */
export function streetColliderOwnerId(objectId: bigint): bigint {
  if (objectId < STREET_COLLIDER_PART_ID_BASE) return objectId;
  return (objectId - STREET_COLLIDER_PART_ID_BASE) / STREET_COLLIDER_PARTS_PER_PROP;
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
// it). Every front run is door, then a window (`shop_window`'s own def
// `width`, story 2.13: three cells, read by `buildPropDrawables` straight
// off the def, never restated here), then a full-height wall pier at the
// far corner (Artie's cycle-2 direction: a window must never run straight
// into the corner with no wall pier between it and the next building, or
// the two shopfronts blur into one continuous glazed strip) --
// `DOOR_X_A`/`DOOR_X_B` are the only two numbers hand-picked below;
// everything else (window position, pier position, `PLAYER_START`,
// `LAMPPOST_CELL`) is derived from them, never a second hand-patched
// literal.
const WEST_WALL_X = 3;
const PARTY_WALL_X = 8;
const INTERIOR_X0_A = 4;
const DOOR_X_A = WEST_WALL_X + 1;
const WINDOW_X_A = DOOR_X_A + 1;

// Shop B: starts immediately east of the party wall, its own four
// interior columns, its own east wall.
const INTERIOR_X0_B = 9;
export const EAST_WALL_X_B = 13;
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

/** The anchor cell of the lamppost, out on the pavement -- a real collider
 * read from `defs/objects/city-props.toml`. Story 2.13 (Artie's
 * direction): `x` is `PARTY_WALL_X`, in front of the pier between the two
 * shops, not `DOOR_X_A` -- a 64px-tall lamp at the door's own column would
 * draw through the awning and across the doorway, and nobody plants a
 * lamp in front of a door. `y` is unchanged, so everything keyed on its
 * row (`STAIRS_Y`, `lamppostRestY()`) is untouched. */
export const LAMPPOST_CELL = { x: PARTY_WALL_X, y: 8 } as const;

/** A bollard's own real base, read off its art
 * (`Pedestrian_Barrier_Post_1.png`: six sub-cells wide, centred, the
 * whole cell tall). */
export const BOLLARD_COLLIDER = { x0: 5, y0: 0, x1: 11, y1: 16 } as const;

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

/** Both subway stairwells' own art (`Stairs_Complete_2`, 48x64px):
 * three cells wide, four tall -- the declared footprint is the whole
 * drawn rect. */
export const STAIRWELL_FOOTPRINT = { width: 3, height: 4 } as const;

/** The footprint row (from its north edge) the art draws the treads on;
 * the rows above are the stairwell's back and top railing, the row below
 * its bottom railing. */
const STAIRWELL_TREAD_ROW = 2;

/** Every drawn railing row of a stairwell is solid; the tread row is the
 * only walkable one. */
export const STAIRWELL_COLLIDERS: readonly StreetColliderRect[] = [
  { x0: 0, y0: 0, x1: 48, y1: 32 },
  { x0: 0, y0: 48, x1: 48, y1: 64 },
];

/** The demo's own reported entry: walking left (west) into the stairs
 * (issue #310). `world/transitions.ts`'s `checkTransitionPairSymmetry`
 * records this same axis as the pairing's own `d`. */
export const STAIRS_ENTRY_DIRECTION = { x: -1, y: 0 } as const;

/** The street stairwell sits in the pavement's own south edge, east of
 * shop B: footprint columns `STAIRWELL_X0..+2`, rows
 * `PAVEMENT_Y1 + 1..+4`. Its opening is the tread row's east end; the
 * down anchor is the deepest tread, at the west end. */
const PAVEMENT_Y1 = LAMPPOST_CELL.y;
export const STAIRWELL_X0 = EAST_WALL_X_B + 1;
const STAIRWELL_Y0 = PAVEMENT_Y1 + 1;
export const STAIRS_X = STAIRWELL_X0;
export const STAIRS_Y = STAIRWELL_Y0 + STAIRWELL_TREAD_ROW;

/** The open cells in front of the stairwell's opening: two columns east
 * of it, from the pavement down to the tread row. */
export const SUBWAY_ENTRANCE_X0 = STAIRWELL_X0 + STAIRWELL_FOOTPRINT.width;
const SUBWAY_ENTRANCE_X1 = SUBWAY_ENTRANCE_X0 + 1;

/** The row just outside shop A's own door. */
export const SHOPFRONT_EXIT_Y = SOUTH_WALL_Y + 1;

/** The platform's own footprint, floor -1. */
const PLATFORM_X0 = 13;
const PLATFORM_X1 = 20;
const PLATFORM_Y0 = 1;
const PLATFORM_Y1 = 6;
const PLATFORM_INTERIOR_X0 = PLATFORM_X0 + 1;
const PLATFORM_INTERIOR_X1 = PLATFORM_X1 - 1;
const PLATFORM_INTERIOR_Y0 = PLATFORM_Y0 + 1;
const PLATFORM_INTERIOR_Y1 = PLATFORM_Y1 - 1;

/** The platform's up-stairs fill the interior's east end, against the
 * east wall: its opening is the tread row's west end, and the up anchor
 * is the tread against the wall. */
const PLATFORM_STAIRWELL_X0 = PLATFORM_INTERIOR_X1 - STAIRWELL_FOOTPRINT.width + 1;
export const PLATFORM_UP_ANCHOR_X = PLATFORM_INTERIOR_X1;
export const PLATFORM_UP_ANCHOR_Y = PLATFORM_INTERIOR_Y0 + STAIRWELL_TREAD_ROW;

/** Where walking down lands: the up anchor's own neighbour one step
 * further along `STAIRS_ENTRY_DIRECTION` (the pairing's mirror rule). */
export const PLATFORM_LANDING_X = PLATFORM_UP_ANCHOR_X + STAIRS_ENTRY_DIRECTION.x;
export const PLATFORM_LANDING_Y = PLATFORM_UP_ANCHOR_Y + STAIRS_ENTRY_DIRECTION.y;

/** Where climbing back up lands: the down anchor's own neighbour one step
 * back against `STAIRS_ENTRY_DIRECTION`, on the street treads. */
export const STREET_EXIT_X = STAIRS_X - STAIRS_ENTRY_DIRECTION.x;
export const STREET_EXIT_Y = STAIRS_Y - STAIRS_ENTRY_DIRECTION.y;

// --- the footbridge (story 1.13) ---------------------------------------
//
// Two floors at one `(x, y)`: the deck spans the pavement one storey up,
// so `(BRIDGE_X0..BRIDGE_X1, BRIDGE_DECK_Y)` is open pavement on floor 0
// and walkable deck on floor 1 (FR117).

export const BRIDGE_FLOOR = STREET_FLOOR + 1;
/** The deck's own row: the first pavement row south of the terrace. */
export const BRIDGE_DECK_Y = SOUTH_WALL_Y + 1;
export const BRIDGE_X0 = 17;
/** Four cells of `bridge_deck`, the def's own declared width. */
export const BRIDGE_DECK_WIDTH = 4;
export const BRIDGE_X1 = BRIDGE_X0 + BRIDGE_DECK_WIDTH - 1;

/** The column just west of the deck, where the scripted walk turns north
 * onto the underpass row against a bollard at its north end. */
export const BRIDGE_UNDER_CURB_X = BRIDGE_X0 - 1;
/** The understructure's own support pillar, a real bollard: the
 * underpass checkpoint's column rest. */
export const BRIDGE_UNDER_PILLAR_X = BRIDGE_X0 + 1;
/** The row south of the underpass. */
export const BRIDGE_UNDER_EXIT_Y = BRIDGE_DECK_Y + 1;

/** Where the street-level stairs stand: the pavement row south of the
 * deck's own east end. Entering this cell climbs onto the deck. */
export const BRIDGE_UP_ANCHOR_X = BRIDGE_X1;
export const BRIDGE_UP_ANCHOR_Y = BRIDGE_DECK_Y + 1;

/** Where the deck's own down-stairs stand: one cell west of the
 * up-stairs' own landing. */
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
      y: PLATFORM_INTERIOR_Y1,
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
      y: PLATFORM_INTERIOR_Y1,
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
  // true`, three cells wide starting right after the door -- its own def
  // art (story 2.13: `ME_Singles_Office_16x16_Window_1_
  // Middle_Modular.png`, 48x32px, the def's own `width = 3`) is exactly
  // that many tiles wide, and `buildPropDrawables` reads that width
  // straight off the def (Tim's direction, cycle 2), so the footprint can
  // never fall out of step with the art again -- never overhanging over
  // the door (Artie's direction). It stops one cell short of the party
  // wall -- id 40 below is that last cell, a full wall pier, so the
  // window never runs straight into the corner (Artie's cycle-2
  // direction). Its collider comes from `defs/`, so it is placed by
  // `defId` like the lamppost, never `solid: true`.
  {
    id: 6n,
    x: WINDOW_X_A,
    y: SOUTH_WALL_Y,
    floor: 0,
    layer: "walls",
    defId: WINDOW_DEF_ID,
  },
  // West wall: the near/far occlusion worked example -- decomposed
  // toward the camera (width 1, height 4).
  {
    id: 4n,
    assetKey: "wallTile",
    x: WEST_WALL_X,
    y: INTERIOR_Y1,
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
    y: INTERIOR_Y1,
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
  // 3 tiles wide -- `buildPropDrawables` reads that width straight off
  // the def, never a hand-restated `footprint` (Tim's direction, cycle
  // 2). Story 1.9: placed by `defId` rather than `solid`, so both its
  // collider and its FR148 reach rect come from `defs/` -- the wide
  // interaction target, reachable only from the customer side.
  {
    id: 8n,
    x: INTERIOR_X0_A,
    y: INTERIOR_Y0,
    floor: 0,
    layer: "furniture",
    defId: SHOP_COUNTER_DEF_ID,
  },

  // A table with a glass on it, right behind the window (Artie's
  // direction: visible from the pavement through the glass). Its
  // footprint and collider are the art's own 32x32px (the bottom pixel
  // row is transparent).
  {
    id: 9n,
    assetKey: "table",
    x: WINDOW_X_A,
    y: INTERIOR_Y1,
    floor: 0,
    layer: "furniture",
    footprint: { width: 2, height: 2 },
    solid: true,
    colliders: [{ x0: 0, y0: 0, x1: 32, y1: 31 }],
  },
  { id: 10n, assetKey: "glass", x: WINDOW_X_A, y: INTERIOR_Y1, floor: 0, layer: "objects" },

  // The awning: no collider (FR128's worked example), on the pavement
  // south of the door.
  { id: 11n, assetKey: "awning", x: DOOR_X_A, y: SOUTH_WALL_Y + 1, floor: 0, layer: "objects" },

  // Story 1.9's small interaction target (FR148): a real bin on the
  // pavement, directly south of shop A's own door (story 15.2, cycle 2,
  // Quentin's finding 3: this column is also where the scripted walk's
  // own first segment now rests -- its real, art-backed collider replaces
  // the old, undrawn `SHOPFRONT_EXIT_REST_COLLIDER`, immune to release
  // lag the same way that invisible rect always was, `shopfrontExitRestY`'s
  // own doc comment says so). Its collider and its `interact_at` both come
  // from `defs/objects`'s own `trash_bin`. Story 2.13: the def's own
  // sprite now names the street's own bin (`Small_Closed_Trash_Can.png`,
  // Artie's direction), so this row draws through the atlas, never a
  // `ModernTileset/` import of its own.
  {
    id: 15n,
    x: DOOR_X_A,
    y: SOUTH_WALL_Y + 1,
    floor: 0,
    layer: "objects",
    defId: TRASH_BIN_DEF_ID,
  },

  // The street lamp (story 1.8's known-solid rest point the scripted walk
  // -- `streetWalkRoute` below -- and `drawables.test.ts` walk the player
  // into): story 2.13 retargets this row to draw the def's own real
  // `Street_Lamp_5` art (Artie's direction -- the def always named this
  // sprite; the street itself was the one borrowing a picnic table over
  // its pole collider) instead of borrowing `"table"`.
  {
    id: 14n,
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
    x: WINDOW_X_B,
    y: SOUTH_WALL_Y,
    floor: 0,
    layer: "walls",
    defId: WINDOW_DEF_ID,
  },
  {
    id: 34n,
    assetKey: "wallTile",
    x: EAST_WALL_X_B,
    y: INTERIOR_Y1,
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
  // right behind its own window. The shelf stands against the north wall;
  // its collider is the art's own bottom row (`Grocery_Store_Singles_113`,
  // x 6..26px). The basket is decoration.
  {
    id: 35n,
    assetKey: "shelf",
    x: INTERIOR_X0_B,
    y: INTERIOR_Y0,
    floor: 0,
    layer: "furniture",
    footprint: { width: 2, height: 1 },
    solid: true,
    colliders: [{ x0: 6, y0: 0, x1: 26, y1: 16 }],
  },
  { id: 36n, assetKey: "basket", x: WINDOW_X_B, y: INTERIOR_Y1, floor: 0, layer: "furniture" },

  // --- The subway ---------------------------------------------------------
  // The street stairwell (a real descending stairwell with railings,
  // Artie's direction): its whole drawn 3x4 rect is its footprint, every
  // railing row is solid (`STAIRWELL_COLLIDERS`), and the tread row is
  // walkable from its east opening down to the down anchor.
  {
    id: 50n,
    assetKey: "subwayStairsDown",
    x: STAIRWELL_X0,
    y: STAIRWELL_Y0 + STAIRWELL_FOOTPRINT.height - 1,
    floor: STREET_FLOOR,
    layer: "objects",
    footprint: STAIRWELL_FOOTPRINT,
    solid: true,
    colliders: STAIRWELL_COLLIDERS,
  },
  // The same flight seen from the platform: unflipped, so the treads rise
  // toward the up anchor at the east wall; its opening faces west.
  {
    id: 51n,
    assetKey: "subwayStairsUp",
    x: PLATFORM_STAIRWELL_X0,
    y: PLATFORM_INTERIOR_Y0 + STAIRWELL_FOOTPRINT.height - 1,
    floor: SUBWAY_FLOOR,
    layer: "objects",
    footprint: STAIRWELL_FOOTPRINT,
    solid: true,
    colliders: STAIRWELL_COLLIDERS,
  },
  ...platformWalls(),
  // The way-out sign on the platform's north wall face, above the
  // up-stairs' anchor column.
  {
    id: 52n,
    assetKey: "subwayArrowUp",
    x: PLATFORM_UP_ANCHOR_X,
    y: PLATFORM_Y0,
    floor: SUBWAY_FLOOR,
    layer: "wall_decals",
  },
  // At the platform's own west end, clear of the up-stairs sprite's own
  // overhang (Artie's cycle-2 direction: the stairs, anchored at
  // `PLATFORM_UP_ANCHOR_X`, were covering the bench almost completely
  // when the two sat one cell apart).
  // --- The footbridge (story 1.13) -------------------------------------
  // The deck itself: story 2.13 (Tim's direction) -- `bridge_deck` is a
  // one-cell def (a real 16x16 pavement tile, the same city sidewalk tile
  // the street below it is paved with), not a four-cell def with a
  // `repeat` axis, so the deck is `BRIDGE_DECK_WIDTH` separate `defId`
  // placements, one per column, the same shape the parapet just below
  // already uses. Its "no collider at all" still comes from `defs/objects`
  // rather than from this fixture choosing not to give it one.
  ...Array.from({ length: BRIDGE_DECK_WIDTH }, (_, index) => ({
    id: BigInt(65 + index),
    x: BRIDGE_X0 + index,
    y: BRIDGE_DECK_Y,
    floor: BRIDGE_FLOOR,
    layer: "objects" as const,
    defId: BRIDGE_DECK_DEF_ID,
  })),
  // The parapet along the deck's own north edge: real `wall_segment`
  // cells, one per deck column. Owned by no building, so they are never
  // retracted however close the player stands (FR120 is keyed on
  // ownership, never proximity).
  ...Array.from({ length: BRIDGE_DECK_WIDTH }, (_, index) => ({
    id: BigInt(71 + index),
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
    x: BRIDGE_UP_ANCHOR_X,
    y: BRIDGE_UP_ANCHOR_Y,
    floor: STREET_FLOOR,
    layer: "objects",
    defId: FOOT_STAIRS_DEF_ID,
  },
  {
    id: 81n,
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

  // --- Street furniture ----------------------------------------------------
  // A doormat and manhole covers are underfoot decoration (no collider); a
  // bollard is a real post, collided by its own base (`BOLLARD_COLLIDER`).
  {
    id: 120n,
    assetKey: "doormat",
    x: DOOR_X_A,
    y: SOUTH_WALL_Y + 1,
    floor: STREET_FLOOR,
    layer: "ground_objects",
  },
  // A bollard on the pavement, west of the shopfront, off every scripted
  // walk's path.
  {
    id: 121n,
    assetKey: "bollard",
    x: WEST_WALL_X - 1,
    y: SOUTH_WALL_Y + 1,
    floor: STREET_FLOOR,
    layer: "objects",
    solid: true,
    colliders: [BOLLARD_COLLIDER],
  },
  // A manhole cover on the pavement crossing -- decoration only.
  {
    id: 116n,
    assetKey: "manhole",
    x: BRIDGE_UNDER_CURB_X,
    y: LAMPPOST_CELL.y,
    floor: STREET_FLOOR,
    layer: "ground_objects",
  },
  // A bollard at the underpass column's north end, on the pavement's
  // north strip: the underpass checkpoint's row rest.
  {
    id: 122n,
    assetKey: "bollard",
    x: BRIDGE_UNDER_CURB_X,
    y: SOUTH_WALL_Y,
    floor: STREET_FLOOR,
    layer: "objects",
    solid: true,
    colliders: [BOLLARD_COLLIDER],
  },
  // A manhole cover on the underpass row (decoration), and the support
  // pillar under the deck, a real bollard: the checkpoint's column rest.
  {
    id: 117n,
    assetKey: "manhole",
    x: BRIDGE_UNDER_CURB_X,
    y: BRIDGE_DECK_Y,
    floor: STREET_FLOOR,
    layer: "ground_objects",
  },
  {
    id: 118n,
    assetKey: "bollard",
    x: BRIDGE_UNDER_PILLAR_X,
    y: BRIDGE_DECK_Y,
    floor: STREET_FLOOR,
    layer: "objects",
    solid: true,
    colliders: [BOLLARD_COLLIDER],
  },
  // A second manhole cover, one row south, for leaving the underpass
  // again -- decoration only.
  {
    id: 119n,
    assetKey: "manhole",
    x: BRIDGE_UNDER_PILLAR_X,
    y: BRIDGE_UNDER_EXIT_Y,
    floor: STREET_FLOOR,
    layer: "ground_objects",
  },
] as const;

/** A collider-only rect, in whole cells, with no sprite and no place in
 * the depth-sorted pool. `x`/`y` is the anchor cell -- the rect's
 * smallest x, largest y cell (the object-def anchor convention every
 * `PlacedObject` shares), not its top-left: it extends east and north
 * from there. */
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
  /** A sub-cell collider (`COLLIDER_SUBCELLS_PER_CELL` per cell,
   * relative to the anchor cell's top-left); defaults to the whole rect.
   * Only the footbridge's south rail (id 110) declares one: a walker
   * pressed against a whole-cell rail would rest exactly on the deck row's
   * southern boundary, which reads as the row past it. */
  readonly collider?: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
}

/** The edge of the drawn world (FR137 has no world-boundary concept yet):
 * a closed ring of solid, undrawn cells around every street ground pass,
 * so the avatar can never walk off the ground into the void. Every cell
 * of it lies outside every drawn ground pass on its floor. The shops'
 * walls and the stairwell's railings close the rest of the ring;
 * `drawables.test.ts` proves it closed by walking the real resolver
 * against it. The platform (floor -1) is closed by its own walls. */
export const STREET_BOUNDARY: readonly StreetBoundaryRect[] = [
  // West and east of the pavement (anchored at the span's south end).
  { id: 101n, x: 0, y: PAVEMENT_Y1 + 1, width: 1, height: 4 },
  { id: 102n, x: 21, y: PAVEMENT_Y1 + 1, width: 1, height: 4 },
  // South of the pavement, west of the stairwell.
  { id: 103n, x: 0, y: STAIRWELL_Y0, width: STAIRWELL_X0, height: 1 },
  // North of the pavement, either side of the terrace.
  { id: 104n, x: 1, y: SOUTH_WALL_Y - 1, width: WEST_WALL_X - 1, height: 1 },
  {
    id: 105n,
    x: EAST_WALL_X_B + 1,
    y: SOUTH_WALL_Y - 1,
    width: 21 - (EAST_WALL_X_B + 1),
    height: 1,
  },
  // Around the subway entrance: west of the treads, east of and below the
  // entrance cells, and the pavement's south edge east of them.
  { id: 130n, x: STAIRWELL_X0 - 1, y: STAIRS_Y, width: 1, height: 1 },
  {
    id: 131n,
    x: SUBWAY_ENTRANCE_X1 + 1,
    y: STAIRWELL_Y0,
    width: 21 - (SUBWAY_ENTRANCE_X1 + 1),
    height: 1,
  },
  {
    id: 132n,
    x: SUBWAY_ENTRANCE_X1 + 1,
    y: STAIRS_Y,
    width: 1,
    height: STAIRS_Y - STAIRWELL_Y0,
  },
  {
    id: 133n,
    x: SUBWAY_ENTRANCE_X0,
    y: STAIRS_Y + 1,
    width: SUBWAY_ENTRANCE_X1 - SUBWAY_ENTRANCE_X0 + 1,
    height: 1,
  },
  // The footbridge's own ring, one storey up: the deck is the only
  // standable thing on `BRIDGE_FLOOR`. Its north side is the parapet.
  // The south rail is solid across its last two sub-cells only, so a
  // walker leaning on it stays inside the deck's own row (see
  // `collider` above).
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

/** The pavement: every standable street row south of the terrace. */
export const SIDEWALK_TILES: StreetGroundTiles = {
  assetKey: "sidewalk",
  floor: STREET_FLOOR,
  x0: 1,
  y0: SOUTH_WALL_Y,
  x1: 21,
  y1: PAVEMENT_Y1 + 1,
};

/** The subway entrance: the paving under the stairwell down to its tread
 * row, and the entrance cells east of it. */
export const SUBWAY_ENTRANCE_TILES: StreetGroundTiles = {
  assetKey: "sidewalk",
  floor: STREET_FLOOR,
  x0: STAIRWELL_X0,
  y0: STAIRWELL_Y0,
  x1: SUBWAY_ENTRANCE_X1 + 1,
  y1: STAIRS_Y + 1,
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
  SUBWAY_ENTRANCE_TILES,
  PLATFORM_FLOOR_TILES,
  PLATFORM_EDGE_TILES,
];

/** Every collider rect a solid asset prop contributes, paired with the
 * object id it is fed under: rect 0 under the prop's own id, each further
 * rect under its own `streetColliderPartId`. */
function streetAssetColliders(
  prop: StreetPropByAsset,
  subcellsPerCell: number,
): readonly { readonly objectId: bigint; readonly rect: StreetColliderRect }[] {
  const { width, height } = prop.footprint ?? { width: 1, height: 1 };
  const rects = prop.colliders ?? [
    { x0: 0, y0: 0, x1: width * subcellsPerCell, y1: height * subcellsPerCell },
  ];
  return rects.map((rect, index) => ({
    objectId: index === 0 ? prop.id : streetColliderPartId(prop.id, index),
    rect,
  }));
}

/** The street's own collider sources, keyed by the synthetic def id
 * `streetDefId` mints: every solid asset prop's collider rects (one
 * source per rect, all with the prop's own footprint) and the world
 * boundary. Anything placed by `defId` is read from `defs/` instead.
 * `subcellsPerCell` comes from the scene, which reads it from `defs/`. */
export function streetColliderSources(
  subcellsPerCell: number,
): ReadonlyMap<number, ColliderSource> {
  const sources = new Map<number, ColliderSource>();
  for (const prop of STREET_PROPS) {
    if (isDefStreetProp(prop) || !prop.solid) continue;
    const { width, height } = prop.footprint ?? { width: 1, height: 1 };
    for (const { objectId, rect } of streetAssetColliders(prop, subcellsPerCell)) {
      sources.set(streetDefId(objectId), { width, height, collider: rect });
    }
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
 * `solid` (plus one row per further collider part, at the prop's own
 * anchor, on layer 0 so a pick never prefers it over the prop itself),
 * and the undrawn boundary ring. */
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
    // The real layer code: story 1.9's footprint index resolves an FR123
    // rank from it, which decides which of two objects sharing a cell a
    // click lands on.
    const layer = layerCodeByName(prop.layer);
    if (isDefStreetProp(prop)) {
      row(prop.id, prop.defId, prop.x, prop.y, prop.floor, layer);
      continue;
    }
    if (!prop.solid) continue;
    // Parts only need their own ids; the rect lives in their source.
    for (const { objectId } of streetAssetColliders(prop, 1)) {
      const partLayer = objectId === prop.id ? layer : 0;
      row(objectId, streetDefId(objectId), prop.x, prop.y, prop.floor, partLayer);
    }
  }
  for (const rect of STREET_BOUNDARY) {
    row(rect.id, streetDefId(rect.id), rect.x, rect.y, rect.floor ?? STREET_FLOOR, 0);
  }
  return rows;
}

/** A `StreetProp`'s own width, whichever variant it is (story 2.13, Tim's
 * direction, cycle 2): a `defId` row's own width is read from the
 * resolved def, never a hand-restated `footprint` it cannot carry;
 * `objectDefs` is the same shape `buildPropDrawables` already takes
 * (`world/object-defs.ts`'s `objectDefsById`, or the committed
 * `defs.json` in a test). Throws naming the def when `objectDefs` has no
 * entry for it. */
function streetPropWidth(
  prop: StreetProp,
  objectDefs: ReadonlyMap<number, { readonly width: number; readonly height: number }>,
): number {
  if (!isDefStreetProp(prop)) return prop.footprint?.width ?? 1;
  const source = objectDefs.get(prop.defId);
  if (!source) {
    throw new Error(`streetPropWidth: objectDefs has no entry for defId ${prop.defId}`);
  }
  return source.width;
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
 * here rather than only looking wrong on screen. `objectDefs` resolves
 * both the window's and a `defId`-placed furniture prop's (the counter)
 * own real width -- see [`streetPropWidth`]. */
export function furnitureBehindWindows(
  objectDefs: ReadonlyMap<number, { readonly width: number; readonly height: number }>,
): readonly bigint[] {
  const windows = STREET_PROPS.filter(
    (prop) => isDefStreetProp(prop) && prop.defId === WINDOW_DEF_ID,
  );
  const ids = new Set<bigint>();
  for (const prop of STREET_PROPS) {
    if (prop.layer !== "furniture") continue;
    const propWidth = streetPropWidth(prop, objectDefs);
    for (const window of windows) {
      if (prop.floor !== window.floor) continue;
      if (prop.y >= window.y) continue;
      const windowWidth = streetPropWidth(window, objectDefs);
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
  | { readonly kind: "floor"; readonly value: number }
  /** Arrival at a specific cell, never a coordinate threshold (story
   * 15.2, Quentin's finding 3): "tests never shape the world" -- a segment
   * whose own rest collider was an undrawn boundary rect (removed this
   * story) releases on reaching the real open cell instead, the same way
   * a real player just walking normally would notice they arrived,
   * rather than leaning on a phantom collider nobody drew. Never as
   * precise as a real collider rest (the exact sub-cell position within
   * the cell is whatever the approach happened to land on), which is
   * exactly why a segment that still has a real collider to rest against
   * keeps using one instead. */
  | { readonly kind: "cell"; readonly x: number; readonly y: number };

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
    case "cell":
      return Math.floor(x) === until.x && Math.floor(y) === until.y;
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

export interface StreetWalkInputs {
  /** The top face of the trash bin's own base collider, directly south of
   * shop A's door. */
  readonly shopfrontExitRestY: number;
  /** The first column whose body overlaps the lamppost's own base
   * collider -- a waypoint, leaving the whole overlap window for release
   * lag. */
  readonly lamppostApproachX: number;
  /** The top face of the lamppost's own base collider. */
  readonly lamppostRestY: number;
  /** The first column whose body overlaps the underpass bollard's own
   * collider -- a waypoint, leaving the whole overlap window for release
   * lag. */
  readonly underpassTurnX: number;
  /** Against the underpass bollard's own south face: the deck's row. */
  readonly onUnderpassRowY: number;
  /** Against the support pillar's own west face (`BOLLARD_COLLIDER`). */
  readonly bridgeUnderRestX: number;
  /** The first `y` in `BRIDGE_UNDER_EXIT_Y` whose body clears the
   * pillar's own row. */
  readonly bridgeUnderExitClearY: number;
  /** The first `y` in the stairwell's tread row whose body clears its
   * upper railing -- the row a walker can walk west along into the
   * stairs. */
  readonly subwayTreadRowY: number;
}

/** Out of shop A's door, onto the pavement and past the lamppost: the
 * opening every scripted route shares. */
function shopToPastTheLamppost(inputs: StreetWalkInputs): readonly StreetWalkSegment[] {
  return [
    // Out of the door, onto the pavement, resting on the bin.
    {
      label: "outside-the-shopfront",
      key: "ArrowDown",
      until: { kind: "y-at-least", value: inputs.shopfrontExitRestY },
    },
    // East to a waypoint overlapping the lamppost's own collider.
    {
      label: "east-to-the-lamppost",
      key: "ArrowRight",
      until: { kind: "x-at-least", value: inputs.lamppostApproachX },
    },
    // Into the lamppost, resting on its own base collider part-way into
    // its cell.
    {
      label: "part-way-through-the-lamppost",
      key: "ArrowDown",
      until: { kind: "y-at-least", value: inputs.lamppostRestY },
    },
    // East, clear of the lamppost's own collider.
    {
      label: "past-the-lamppost",
      key: "ArrowRight",
      until: { kind: "x-at-least", value: LAMPPOST_CELL.x + 1 },
    },
  ];
}

/**
 * The scripted walk, in order. It leaves shop A by its door (the
 * enclosure case), rests part-way through the lamppost (the
 * pass-partly-through case: inside the footprint, outside the collider),
 * crosses *under* the bridge deck (the two-floors-at-one-`(x, y)` case),
 * climbs onto the deck by its stairs (the transition case), walks the
 * deck's own multi-cell span, and comes back down to the street.
 *
 * Every release is a collider rest, a cell arrival, a floor, or a
 * threshold whose next segment tolerates the crossing tick plus one more
 * at the resolver's own delta clamp (the e2e walkers release in the page).
 */
export function streetWalkRoute(inputs: StreetWalkInputs): readonly StreetWalkSegment[] {
  return [
    ...shopToPastTheLamppost(inputs),
    // East along the lamppost's row to a waypoint overlapping the
    // underpass bollard's own collider.
    {
      label: "east-along-the-crossing",
      key: "ArrowRight",
      until: { kind: "x-at-least", value: inputs.underpassTurnX },
    },
    // North onto the row the bridge deck spans, resting on that bollard.
    {
      label: "on-the-underpass-row",
      key: "ArrowUp",
      until: { kind: "y-at-most", value: inputs.onUnderpassRowY },
    },
    // East under the deck, resting on the support pillar: strictly inside
    // the deck's own span, beneath the drawn deck.
    {
      label: "under-the-bridge",
      key: "ArrowRight",
      until: { kind: "x-at-least", value: inputs.bridgeUnderRestX },
    },
    // South off the underpass row, clear of the pillar's own row.
    {
      label: "leaving-the-underpass",
      key: "ArrowDown",
      until: { kind: "y-at-least", value: inputs.bridgeUnderExitClearY },
    },
    // East across the up-stairs' own anchor, which climbs onto the deck;
    // the deck's east edge stops the walker past the threshold.
    {
      label: "east-of-the-bridge",
      key: "ArrowRight",
      until: { kind: "x-at-least", value: BRIDGE_X1 + 0.4 },
    },
    // Already on the deck in the ordinary case; held only until it is.
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

/** From shop A to the subway platform, the demo's own way in: past the
 * lamppost, into the subway entrance, then left (west) down the treads. */
export function streetSubwayApproachRoute(inputs: StreetWalkInputs): readonly StreetWalkSegment[] {
  return [
    ...shopToPastTheLamppost(inputs),
    // East into the entrance's own columns, the body clear of both sides.
    {
      label: "east-to-the-subway-entrance",
      key: "ArrowRight",
      until: { kind: "x-at-least", value: SUBWAY_ENTRANCE_X0 + 0.5 },
    },
    // South to the tread row.
    {
      label: "onto-the-subway-treads-row",
      key: "ArrowDown",
      until: { kind: "y-at-least", value: inputs.subwayTreadRowY },
    },
    // West down the treads to the down anchor.
    {
      label: "down-the-subway-stairs",
      key: "ArrowLeft",
      until: { kind: "floor", value: SUBWAY_FLOOR },
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
 * A held key is released over a round trip to the page, so how far past
 * its own threshold a walker travels is a property of the machine, not
 * of the route -- every segment ends either against a real collider or
 * a floor transition, immune to that (walking further into a wall
 * changes nothing, and a transition fires on entering a whole cell), so
 * a lap that only uses those is the same lap on a fast machine and a
 * slow one.
 */
export function streetBridgeLapRoute(): readonly StreetWalkSegment[] {
  return [
    // North until the pavement's own northern edge stops the walker.
    {
      label: "lap-north-of-the-bridge",
      key: "ArrowUp",
      until: { kind: "y-at-most", value: BRIDGE_DECK_Y - 0.4 },
    },
    // West along the terrace, short of the underpass bollard.
    {
      label: "lap-west-along-the-terrace",
      key: "ArrowLeft",
      until: { kind: "x-at-most", value: BRIDGE_UNDER_CURB_X + 1.5 },
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
