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
  /** A sub-cell collider override for a `solid` asset-placed prop
   * (`COLLIDER_SUBCELLS_PER_CELL` per cell, relative to the footprint's
   * own north-west sub-cell origin) -- absent means the whole footprint
   * blocks, the historical default every plain wall run still relies on.
   * Story 15.2 (Quentin's direction): every rest a scripted walk needs is
   * a real, drawn prop's own collider, never an undrawn boundary rect
   * shaped only to stop a test at a convenient sub-cell face -- this is
   * what lets a small, real streetscape prop (a bollard, a manhole, a
   * doorstep) carry a collider narrower than its own cell, the same way a
   * `defs/objects` entry's `collider` can. */
  readonly collider?: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
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

/** A bollard's own real base, read off its committed art (story 15.2,
 * cycle 2, Quentin's finding 3: "the bollard's collider is a 2-sub-cell
 * strip spanning the full cell height while the post is drawn on a few
 * pixels at the bottom" -- checked against the real
 * `ME_Singles_City_Props_16x16_Pedestrian_Barrier_Post_1.png` alpha
 * directly, which draws the post nearly the whole cell tall, six
 * sub-cells wide, centred; never a strip reaching wider than that just
 * because a rest needed the extra margin). Reused by every bollard this
 * street places -- the lamppost's own approach rest, the bridge
 * understructure's own support pillar -- so a real post's own collider is
 * one shape, not a different guess each time one is placed -- the
 * lamppost's own approach bollard is real, solid street furniture either
 * way, even though its own real shape (unlike the old, invisible
 * approach rest it replaces) sits too far west of the lamppost's own
 * collider for the scripted walk to lean on directly any more
 * (`shopfrontClearY`'s own doc comment says how the walk clears it
 * instead). */
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

/** The stairwell's own anchor cell, on the pavement -- a physical prop
 * (Artie's direction: never a teleport tile), east of both shops and
 * clear of shop B's own door. Shares `LAMPPOST_CELL`'s own row: a
 * deterministic, collider-anchored rest point (`lamppostRestY()`) sits on
 * the same row as the stairwell, so a keyboard-driven e2e walk can reach
 * it by holding one direction at a time, never two at once. */
export const STAIRS_X = 16;
export const STAIRS_Y = LAMPPOST_CELL.y;

/** The subway stairwell's own real art is 48x64px -- three cells wide,
 * four tall -- not the 16x16px a bare 1x1 footprint let it silently
 * overhang both ways (AC, story 15.2, Quentin's finding 2: "the
 * stairwell's drawn silhouette and its collider do not agree at all").
 * `STAIRS_X` names the *opening* -- the centre column, the only walkable
 * (and collider-free) cell -- so the prop's own anchor (its west-most
 * column, the convention every footprint uses) sits one cell further
 * west. */
const STAIRS_ANCHOR_X = STAIRS_X - 1;
const STAIRS_FOOTPRINT = { width: 3, height: 1 } as const;

/** The demo's own reported entry: walking left (west) into the stairs
 * (issue #310's own text), approaching from the stairwell's own east
 * flank -- so `STAIRS_X + 1` is this pair's one open side, and every
 * other neighbour of the anchor is real, drawn geometry that refuses a
 * step into it (Quentin's finding 1: "a stairwell has one top and one
 * bottom, so the anchor must be enterable from exactly one side").
 * `world/transitions.ts`'s `checkTransitionPairSymmetry` records this
 * same axis as the pairing's own `d`; this constant is what the fixture
 * itself is built from, so the two can never quietly disagree. */
export const STAIRS_ENTRY_DIRECTION = { x: -1, y: 0 } as const;

/** The stairwell's own "upper rows" collider (Quentin's finding 2):
 * solid only across the top eighth of the cell it is placed on, not the
 * whole cell -- narrow enough that a body approaching from further north
 * still gets stopped at this row's own north face (`Math.floor` reads
 * that as the row *before* this one, never this one, so a walker can
 * never be considered to have arrived here at all), while a real,
 * already-scripted walk crossing this same column on a *different* row
 * (the underpass crossing, the NFR2 perf lap) -- whose own Y sits well
 * south of this thin band -- passes under it untouched. */
export const STAIRS_UPPER_ROW_COLLIDER = { x0: 0, y0: 0, x1: 16, y1: 2 } as const;

/** The row just outside shop A's own door (story 15.2, cycle 2, Quentin's
 * finding 3): where the walk's own first segment (`outside-the-
 * shopfront`) releases, now that the doormat it used to rest against
 * carries no collider at all. Exported so a real e2e spec can wait for
 * this row by name rather than a second, hand-typed `SOUTH_WALL_Y + 1`. */
export const SHOPFRONT_EXIT_Y = SOUTH_WALL_Y + 1;

/** The pavement's own south edge (`STREET_BOUNDARY`'s id 103, below) --
 * exported so the scripted walk (story 1.13, cycle 3) can rest against
 * it by name rather than a second, hand-typed `9`. The stairwell shares
 * `STAIRS_Y`'s row with the lamppost (this constant's own doc comment
 * above), which a real e2e spec already walks straight across
 * (`enclosure.spec.ts`'s own subway-entry test): nothing may ever sit on
 * that row between the lamppost and `STAIRS_X`, so the walk's own east
 * leg detours one row further south, onto this real, always-open edge,
 * before it turns east at all. */
export const PAVEMENT_SOUTH_EDGE_Y = STAIRS_Y + 1;

/** Where the walk's own east leg on the pavement's south edge stops
 * (story 1.13, cycle 3; story 15.2, cycle 2 -- Quentin's finding 3): one
 * column east of the corner pier shop B's own frontage ends on.
 * `STAIRS_X` is close enough east of here that release lag alone can
 * carry a threshold-based walk straight into its own row while still
 * crossing it (found the hard way, walking north from an overshot
 * landing on this same row briefly re-enters `STAIRS_X`'s own column at
 * `STAIRS_Y`, round-tripping through the subway and back before the walk
 * ever reaches the bridge) -- a real cell-arrival release, at the exact
 * `(PAVEMENT_CROSSING_REST_X, PAVEMENT_SOUTH_EDGE_Y)` cell
 * (`streetWalkRoute`'s own `east-along-the-crossing` segment), removes
 * that risk at its source without leaning on an undrawn collider nobody
 * drew (this used to be a rest against exactly that, `STREET_BOUNDARY`'s
 * own former id 116). */
export const PAVEMENT_CROSSING_REST_X = EAST_WALL_X_B + 1;

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

/** The up-stairs' own anchor (story 15.2 fix, Quentin's direction, cycle
 * 2: re-derived against the issue's own literal report -- "descended by
 * walking left" -- rather than against `world/transitions.ts`'s own `d`
 * in the abstract): the landing cell's own neighbour one cell *east*,
 * matching `STAIRS_ENTRY_DIRECTION` (west) mirrored, so
 * `checkTransitionPairSymmetry` pairs the two on `d = STAIRS_ENTRY_
 * DIRECTION` exactly. A continuous walk down and back up must not bounce
 * between the two transitions on consecutive frames just because holding
 * the same direction key kept the player inside the landing cell for a
 * second frame (`world/floor-walk.ts` also gates every transition lookup
 * on the cell actually changing by walking, so this is belt and braces,
 * not the only thing preventing a bounce) -- never the identical cell as
 * the landing either way. */
export const PLATFORM_UP_ANCHOR_X = PLATFORM_LANDING_X - STAIRS_ENTRY_DIRECTION.x;
export const PLATFORM_UP_ANCHOR_Y = PLATFORM_LANDING_Y - STAIRS_ENTRY_DIRECTION.y;

/** Where climbing back up lands on the street (story 15.2 fix, cycle 2):
 * the down anchor's own neighbour one cell *east* -- `PLATFORM_UP_
 * ANCHOR_X/Y`'s own doc comment says why. Walking down (west, "left",
 * into `(STAIRS_X, STAIRS_Y)`, matching the demo) then immediately back
 * with the reverse input (right/east) retraces the same axis and lands
 * here, one cell short of the stairwell itself -- the exact "reverse
 * input returns you to the matching cell, no detour through an unrelated
 * direction" the acceptance criteria ask for. This is also this pair's
 * one open approach to the down anchor (`STAIRS_ENTRY_DIRECTION`'s own
 * doc comment): the same cell serves both roles, which is exactly what
 * makes the round trip land a walker back where it started. Never the
 * identical cell as the down anchor either way. */
export const STREET_EXIT_X = STAIRS_X - STAIRS_ENTRY_DIRECTION.x;
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

/** The underpass checkpoint's own two rest colliders (story 1.13, cycle
 * 3): a low curb fixes the row, a support pillar fixes the column. The
 * pillar sits strictly inside `[BRIDGE_X0, BRIDGE_X1]`, west of
 * `BRIDGE_DOWN_ANCHOR_X`/`BRIDGE_UP_ANCHOR_X` (below) so it never sits on
 * a transition column. */
/** Where the curb itself sits (story 1.13, cycle 3): `PAVEMENT_CROSSING_
 * REST_X`'s own column, not the bridge's own span -- that constant's own
 * doc comment says why the approach leg needs a rest of its own, and
 * sharing its column is what lets the checkpoint's own north turn start
 * from a rest rather than a threshold too: nothing east of this column,
 * all the way to the pillar, ever risks a transition, so the whole
 * stretch between the two rests is free to be as wide as it needs to be.
 * Story 15.2, cycle 2 (Quentin's finding 3): the drawn curb prop itself
 * is decoration only now (a real kerb is underfoot, not something a
 * player walks into), but the walk's own north turn onto this row
 * (`on-the-underpass-row`) still needs a real rest here, so
 * `STREET_BOUNDARY`'s own id 107 carries the identical collider shape the
 * curb always did instead (`BRIDGE_UNDER_CURB_COLLIDER`'s own doc comment
 * says why that shape, not a shallower one, matters). */
export const BRIDGE_UNDER_CURB_X = PAVEMENT_CROSSING_REST_X;
/** The underpass checkpoint's own row-fixing collider (story 1.13, cycle
 * 3), now carried by `STREET_BOUNDARY`'s own id 107 instead of the curb
 * prop itself (`BRIDGE_UNDER_CURB_X`'s own doc comment says why): solid
 * across `BRIDGE_DECK_Y`'s own top quarter, so a body approaching from
 * the south stops with its own top there, `bodyHeight` short of
 * `STAIRS_UPPER_ROW_COLLIDER`'s own thin band further east on this same
 * row and clear of the subway stairwell's own base collider one row
 * south -- both real, `bodyHeight`-plus margin at once, the same shape a
 * shallower band (level with `STAIRS_UPPER_ROW_COLLIDER`'s own thinness)
 * cannot give. */
export const BRIDGE_UNDER_CURB_COLLIDER = { x0: 0, y0: 0, x1: 16, y1: 4 } as const;
/** The understructure's own real support pillar -- a real bridge's own
 * pillar, not only a test aid, and still a real rest (`BOLLARD_COLLIDER`'s
 * own doc comment says why a bollard's own art gives this reliably,
 * whatever row within `BRIDGE_DECK_Y` the walker approaches from). */
export const BRIDGE_UNDER_PILLAR_X = BRIDGE_X0 + 1;

// A low kerb, one row south of the checkpoint (decoration only, same
// cycle): the drawn kerb prop is decoration only (story 15.2, cycle 2,
// Quentin's finding 3), but the walk's own south turn off the checkpoint
// still needs a real rest here, so `STREET_BOUNDARY`'s own id 108 carries
// the identical collider shape the kerb always did instead
// (`BRIDGE_UNDER_EXIT_COLLIDER`'s own doc comment says why).
export const BRIDGE_UNDER_EXIT_Y = BRIDGE_DECK_Y + 1;
/** The underpass checkpoint's own exit-row collider (story 1.13, cycle
 * 3), now carried by `STREET_BOUNDARY`'s own id 108 instead of the kerb
 * prop itself (`BRIDGE_UNDER_EXIT_Y`'s own doc comment says why): solid
 * across `BRIDGE_UNDER_EXIT_Y`'s own middle two eighths, so a body
 * approaching from the north (leaving the underpass) stops with its own
 * feet there -- still inside `BRIDGE_UNDER_EXIT_Y` itself, never pushed
 * a whole row further south into the pavement's own south edge, which
 * would carry the walk straight past the up-transition's own anchor row
 * without ever crossing it. */
export const BRIDGE_UNDER_EXIT_COLLIDER = { x0: 0, y0: 8, x1: 16, y1: 12 } as const;

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
  // direction: visible from the pavement through the glass).
  { id: 9n, assetKey: "table", x: WINDOW_X_A, y: INTERIOR_Y1, floor: 0, layer: "furniture" },
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
  // right behind its own window.
  { id: 35n, assetKey: "shelf", x: INTERIOR_X0_B, y: INTERIOR_Y0, floor: 0, layer: "furniture" },
  { id: 36n, assetKey: "basket", x: WINDOW_X_B, y: INTERIOR_Y1, floor: 0, layer: "furniture" },

  // --- The subway ---------------------------------------------------------
  // The stairwell entrance (story 15.2, Quentin's findings 1/2): a real
  // descending stairwell with railings (Artie's direction), never the
  // flat tread strip a footprint-1 prop reused for both directions would
  // read as -- and, since this story, a footprint that actually matches
  // the art's own 48x64px (three cells wide) rather than the 16x16px a
  // bare 1x1 footprint silently claimed. `x` is `STAIRS_ANCHOR_X`
  // (`STAIRS_X`'s own west neighbour, the footprint's own anchor
  // convention), so the three decomposed cells are, west to east: the
  // blocked flank, the walkable opening (`STAIRS_X` itself), and the one
  // open approach (`STAIRS_ENTRY_DIRECTION`'s own doc comment). The
  // collider covers only the first (west) of those three cells -- a
  // single rect cannot carve out a ring, so the opening and the approach
  // stay open by the collider simply not reaching them; the north
  // neighbour (the "upper rows" the art recedes into) is blocked
  // separately, just below.
  {
    id: 50n,
    assetKey: "subwayStairsDown",
    x: STAIRS_ANCHOR_X,
    y: STAIRS_Y,
    floor: STREET_FLOOR,
    layer: "objects",
    footprint: STAIRS_FOOTPRINT,
    solid: true,
    collider: { x0: 0, y0: 0, x1: 16, y1: 16 },
  },
  // The stairwell's own back, receding one row north of the opening --
  // real, drawn geometry (Quentin's finding 2: "rows 6 and 7 ... report
  // nothing"), and the mechanism that refuses a north approach to the
  // anchor at all (finding 1): a walker moving south is stopped at this
  // cell's own north face -- one whole row short of `STAIRS_Y`, never
  // close enough for `Math.floor` to read it as having arrived. Solid
  // only across its own top eighth, not the whole cell: `STAIRS_Y - 1` is
  // the exact row the underpass crossing walks along (`BRIDGE_DECK_Y`),
  // comfortably south of this thin band -- a full-cell block here would
  // wall off a real, already-scripted walk that has nothing to do with
  // the stairwell.
  //
  // `STAIRS_Y - 2` would be the *second* upper row finding 2 also names,
  // but that row is the NFR2 perf lap's own thoroughfare, and the lap's
  // threshold-based (not collider-rested) approach can genuinely rest
  // anywhere from this row's own south edge up to its middle under slow-
  // machine lag (`street-conformance.test.ts`'s own "survives a slow
  // machine" pin found this the hard way) -- no band here is narrow
  // enough to both collide something and stay clear of it. Left uncollided
  // rather than breaking a real walk for one extra row of "the whole
  // stairwell is drawn" fidelity; `docs/trace-matrix.md` records this as
  // the explicit, disclosed gap it is.
  {
    id: 54n,
    assetKey: "wallTile",
    x: STAIRS_X,
    y: STAIRS_Y - 1,
    floor: STREET_FLOOR,
    layer: "walls",
    wallOrientation: "vertical",
    solid: true,
    collider: STAIRS_UPPER_ROW_COLLIDER,
  },
  // The matching up-stairs on the platform (Artie's direction: a distinct
  // sprite from the street's own down stairwell, one sprite never plays
  // both roles), the same real footprint. `x` is one west of
  // `PLATFORM_UP_ANCHOR_X` (its own west neighbour, the landing itself),
  // so the three decomposed cells are, west to east: the landing (already
  // open, and this pair's own approach), the walkable opening
  // (`PLATFORM_UP_ANCHOR_X`), and the blocked east flank -- the collider
  // covers only that last cell.
  {
    id: 51n,
    assetKey: "subwayStairsUp",
    x: PLATFORM_UP_ANCHOR_X - 1,
    y: PLATFORM_UP_ANCHOR_Y,
    floor: SUBWAY_FLOOR,
    layer: "objects",
    footprint: STAIRS_FOOTPRINT,
    solid: true,
    collider: { x0: 32, y0: 0, x1: 48, y1: 16 },
  },
  // The up-stairs' own remaining two non-entry sides (finding 1): north
  // and south of its own anchor, real drawn subway-tile geometry, the
  // same mechanism as the down stairwell's own north block above.
  {
    id: 56n,
    assetKey: "subwayWall",
    x: PLATFORM_UP_ANCHOR_X,
    y: PLATFORM_UP_ANCHOR_Y - 1,
    floor: SUBWAY_FLOOR,
    layer: "walls",
    solid: true,
  },
  {
    id: 57n,
    assetKey: "subwayWall",
    x: PLATFORM_UP_ANCHOR_X,
    y: PLATFORM_UP_ANCHOR_Y + 1,
    floor: SUBWAY_FLOOR,
    layer: "walls",
    solid: true,
  },
  ...platformWalls(),
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

  // --- Real street furniture near the scripted walk (story 15.2, cycle
  // 2, Quentin's finding 3) ------------------------------------------------
  //
  // Every rest the scripted walk once leaned on lived here as an undrawn
  // boundary rect (`STREET_BOUNDARY`'s own former ids 116-121); cycle 1's
  // own fix re-skinned each one as a real prop but kept its exact
  // undrawn-collider shape, which is the same "looks open, is blocked"
  // defect this story exists to remove -- a manhole is `underfoot`
  // (`defs/`'s own rule, `a_manhole_absent_from_the_underfoot_tag_is_
  // named`), and a doormat is not furniture a player expects to be
  // solid. Both are decoration only now, no `solid` and no `collider`:
  // `streetWalkRoute`'s own segments that rested against them now release
  // on a real cell-arrival `until` instead (`street-world.ts`'s own doc
  // comments say which). Only the bollard -- a real post, which really
  // does block -- keeps a collider, reshaped to `BOLLARD_COLLIDER`'s own
  // real alpha-inspected shape rather than a strip wider than the art.
  {
    id: 120n,
    assetKey: "doormat",
    x: DOOR_X_A,
    y: SOUTH_WALL_Y + 1,
    floor: STREET_FLOOR,
    layer: "objects",
  },
  // A bollard on the pavement, west of the shopfront -- a real post,
  // still a real rest (Quentin's finding 3: "a bollard is fine as a rest
  // but its collider is the post's own base, shaped to the art"), but not
  // a rest anything scripted leans on: `camera-viewport.spec.ts`'s own
  // follow cases hold a direction from the shopfront's own exit for a
  // full `MIN_TRAVELLED_CELLS`, in *every* direction including back
  // toward the lamppost, and `streetWalkRoute`'s own approach to the
  // lamppost (`lamppostApproachX`'s own doc comment says why) needs its
  // whole row clear too -- there is no column near the lamppost this
  // could sit on without blocking one or the other. West of the building
  // entirely, on a column nothing here ever walks through.
  {
    id: 121n,
    assetKey: "bollard",
    x: WEST_WALL_X - 1,
    y: SOUTH_WALL_Y + 1,
    floor: STREET_FLOOR,
    layer: "objects",
    solid: true,
    collider: BOLLARD_COLLIDER,
  },
  // A manhole cover on the pavement crossing -- decoration only.
  {
    id: 116n,
    assetKey: "manhole",
    x: PAVEMENT_CROSSING_REST_X,
    y: STAIRS_Y,
    floor: STREET_FLOOR,
    layer: "objects",
  },
  // The underpass checkpoint's own curb -- decoration only -- and support
  // pillar, a real bridge's own understructure and a real rest, the same
  // reshaped `BOLLARD_COLLIDER`.
  {
    id: 117n,
    assetKey: "manhole",
    x: BRIDGE_UNDER_CURB_X,
    y: BRIDGE_DECK_Y,
    floor: STREET_FLOOR,
    layer: "objects",
  },
  {
    id: 118n,
    assetKey: "bollard",
    x: BRIDGE_UNDER_PILLAR_X,
    y: BRIDGE_DECK_Y,
    floor: STREET_FLOOR,
    layer: "objects",
    solid: true,
    collider: BOLLARD_COLLIDER,
  },
  // A second manhole cover, one row south, for leaving the underpass
  // again -- decoration only.
  {
    id: 119n,
    assetKey: "manhole",
    x: BRIDGE_UNDER_PILLAR_X,
    y: BRIDGE_UNDER_EXIT_Y,
    floor: STREET_FLOOR,
    layer: "objects",
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
  // West and east of the pavement. Anchored at the south end of the
  // 4-tall span (the object-def anchor convention: smallest x, largest
  // y) -- `SOUTH_WALL_Y + 3` is the same four rows `SOUTH_WALL_Y..
  // SOUTH_WALL_Y+3` a top-left anchor at `SOUTH_WALL_Y` used to cover.
  { id: 101n, x: 0, y: SOUTH_WALL_Y + 3, width: 1, height: 4 },
  { id: 102n, x: 21, y: SOUTH_WALL_Y + 3, width: 1, height: 4 },
  // South of the pavement.
  { id: 103n, x: 0, y: PAVEMENT_SOUTH_EDGE_Y, width: 21, height: 1 },
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
  // The underpass checkpoint's own approach column (`BRIDGE_UNDER_CURB_X`)
  // needs a real, hard rest of its own too (story 15.2, cycle 2, Quentin's
  // finding 3's own release-lag regression pins found this the hard way):
  // a walk turning north there -- releasing on a threshold now that the
  // curb it used to rest against carries no collider -- has nothing to
  // catch it before id 105 above, two rows further than intended, deep
  // enough to strand it on the subway stairwell's own row instead of
  // clear of it. `BRIDGE_UNDER_CURB_COLLIDER`'s own doc comment says why
  // this exact shape, at this exact row.
  {
    id: 107n,
    x: BRIDGE_UNDER_CURB_X,
    y: BRIDGE_DECK_Y,
    width: 1,
    height: 1,
    collider: BRIDGE_UNDER_CURB_COLLIDER,
  },
  // Leaving the underpass needs a real, hard rest of its own too, the
  // same way turning onto it does (id 107's own doc comment): a walk
  // south from the support pillar's own row -- releasing on a threshold
  // now that the kerb it used to rest against carries no collider -- has
  // nothing to catch it before the pavement's own south edge, one whole
  // row past `BRIDGE_UNDER_EXIT_Y`, missing the up-transition's own
  // anchor row entirely on the way (found the hard way: the walk climbed
  // onto the deck a whole segment late, at the wrong column). `BRIDGE_
  // UNDER_EXIT_COLLIDER`'s own doc comment says why this exact shape, at
  // this exact row.
  {
    id: 108n,
    x: BRIDGE_UNDER_PILLAR_X,
    y: BRIDGE_UNDER_EXIT_Y,
    width: 1,
    height: 1,
    collider: BRIDGE_UNDER_EXIT_COLLIDER,
  },
  // Story 15.2 (Quentin's direction, cycle 2, finding 3): every rest the
  // scripted walk needs used to live here too (ids 116-121) -- an undrawn
  // collider that exists only so an e2e walk comes to rest
  // deterministically, which the conformance guard below now refuses
  // outright. `STREET_PROPS` now carries a doormat and two manhole
  // covers as pure decoration (no `solid`, no collider at all -- a real
  // manhole or doormat is underfoot, never something a player walks into)
  // and two bollards that keep a real, art-shaped collider
  // (`BOLLARD_COLLIDER`). Every rest the walk used to lean on one of these
  // for is a cell-arrival now instead (`streetWalkRoute`'s own doc
  // comments say why); the two bollards are still real rests, because a
  // bollard is the one piece of this street furniture that actually
  // should block.
  //
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

// Covers every row the pavement is actually standable on -- through the
// lamppost's own row (`STAIRS_Y`) -- and stops there. Widened east to
// cover both shops and the subway stairwell.
//
// Story 15.2 (Quentin's direction): `y1` used to reach one row further,
// through `PAVEMENT_SOUTH_EDGE_Y` itself -- painting the world-edge ring's
// own row (`STREET_BOUNDARY`'s id 103, solid across its whole width) as
// if it were ordinary, walkable pavement. That is the "looks open, is
// blocked" half of this story's own defect class: a player could never
// actually stand in that row (the boundary ring fills it completely), but
// the sidewalk texture said otherwise. The conformance guard's own "world
// edge lies strictly outside the drawn ground" check is what catches a
// future regression of this same mistake. `PAVEMENT_SOUTH_EDGE_Y` itself
// is unaffected: a walker still rests against the ring's own north face,
// which sits exactly one row past this texture's own last painted row,
// same as ever.
export const SIDEWALK_TILES: StreetGroundTiles = {
  assetKey: "sidewalk",
  floor: STREET_FLOOR,
  x0: 1,
  y0: SOUTH_WALL_Y,
  x1: 21,
  y1: PAVEMENT_SOUTH_EDGE_Y,
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
    // `solid` is street-only geometry (`StreetPropBase`'s own doc
    // comment) -- a `defId` row's collision comes from `defs/` instead,
    // read elsewhere, so it never reaches this branch and never needs a
    // `footprint` here.
    if (isDefStreetProp(prop) || !prop.solid) continue;
    const { width, height } = prop.footprint ?? { width: 1, height: 1 };
    sources.set(streetDefId(prop.id), {
      width,
      height,
      collider: prop.collider ?? {
        x0: 0,
        y0: 0,
        x1: width * subcellsPerCell,
        y1: height * subcellsPerCell,
      },
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
    const defId = isDefStreetProp(prop)
      ? prop.defId
      : prop.solid
        ? streetDefId(prop.id)
        : undefined;
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

/** What the route needs from `defs/` -- the one rest position that is a
 * real collider face rather than a cell coordinate, supplied by the
 * caller so this module stays free of `defs/` (and of any filesystem or
 * fetch). */
export interface StreetWalkInputs {
  /** Where the player comes to rest walking straight out of the door
   * (story 2.13; story 15.2, cycle 2, Quentin's finding 3): the top face
   * of the real trash bin's own base collider (FR148), directly south of
   * the door -- `shopfrontExitRestY`'s own doc comment says why this is a
   * real, drawn rest now, not the old undrawn `SHOPFRONT_EXIT_REST_
   * COLLIDER`. */
  readonly shopfrontExitRestY: number;
  /** Where the walk's own eastward approach to the lamppost turns south
   * (story 2.13; reshaped story 15.2, cycle 2): the real centre of the
   * lamppost's own base collider, a waypoint rather than a rest --
   * `lamppostApproachX`'s own doc comment says why no rest is needed on
   * this row, and why that is what keeps this leg (and the one after it)
   * immune to release lag rather than merely tolerant of a little of it. */
  readonly lamppostApproachX: number;
  /** Where a walk into the lamppost comes to rest: the top face of the
   * lamppost's own base collider. */
  readonly lamppostRestY: number;
  /** Where the underpass checkpoint comes to rest: an east rest against
   * `BRIDGE_UNDER_PILLAR_X`'s own real support pillar (`BOLLARD_COLLIDER`),
   * fixing the column. */
  readonly bridgeUnderRestX: number;
  /** Where a walk turning north onto the underpass row comes to rest:
   * `onUnderpassRowY`'s own doc comment says why this is a real rest now
   * too, against `STREET_BOUNDARY`'s own id 107. */
  readonly onUnderpassRowY: number;
  /** Where leaving the underpass has actually cleared the support
   * pillar's own row (story 1.13, cycle 3; story 15.2, cycle 2, Quentin's
   * finding 3): `bridgeUnderExitClearY`'s own doc comment says why a bare
   * cell-arrival is not enough here either. */
  readonly bridgeUnderExitClearY: number;
}

/**
 * The scripted walk, in order. It leaves shop A by its door (the
 * enclosure case), rests part-way through the lamppost (the
 * pass-partly-through case: inside the footprint, outside the collider),
 * detours one row south to cross the subway stairwell's own row clear of
 * it, turns up onto the underpass row and crosses *under* the bridge
 * deck (the two-floors-at-one-`(x, y)` case), climbs onto the deck by
 * its stairs (the transition case), walks the deck's own multi-cell
 * span, and comes back down to the street.
 */
export function streetWalkRoute(inputs: StreetWalkInputs): readonly StreetWalkSegment[] {
  return [
    // Out of the door, onto the pavement: the building's own near-side
    // walls come back the moment the player is no longer inside it.
    // Releases against the real trash bin's own base collider directly
    // south of the door (`inputs.shopfrontExitRestY`'s own doc comment
    // says why) -- the doormat this used to rest against carried an
    // undrawn collider (Quentin's finding 3, which the story removes),
    // but the bin beside it is real, drawn geometry that gives the exact
    // same immune-to-release-lag rest instead.
    {
      label: "outside-the-shopfront",
      key: "ArrowDown",
      until: { kind: "y-at-least", value: inputs.shopfrontExitRestY },
    },
    // East to the lamppost's own column (story 2.13; `LAMPPOST_CELL`'s own
    // doc comment says why it moved off the door's column): a waypoint
    // centred on the lamppost's own real base collider, not a rest
    // (`inputs.lamppostApproachX`'s own doc comment says why), so the
    // southward segment just below always engages that real collider for
    // certain.
    {
      label: "east-to-the-lamppost",
      key: "ArrowRight",
      until: { kind: "x-at-least", value: inputs.lamppostApproachX },
    },
    // Into the lamppost, coming to rest against its own small base
    // collider part-way into its cell.
    {
      label: "part-way-through-the-lamppost",
      key: "ArrowDown",
      until: { kind: "y-at-least", value: inputs.lamppostRestY },
    },
    // East just far enough to clear the lamppost's own collider: resting
    // against its north face (the segment above) leaves the walker
    // directly above the rest of that same collider, which still blocks
    // a straight step south. A handful of cells short of anything else
    // on this row, so the exact distance carries no risk either way.
    {
      label: "past-the-lamppost",
      key: "ArrowRight",
      until: { kind: "x-at-least", value: LAMPPOST_CELL.x + 1 },
    },
    // South off the lamppost's own row, onto the pavement's real south
    // edge (story 1.13, cycle 3): a *rest*, immune to release lag by
    // construction (`PAVEMENT_SOUTH_EDGE_Y`'s own doc comment says why
    // this detour exists at all -- the lamppost's own row is a
    // thoroughfare `enclosure.spec.ts`'s own subway-entry test already
    // walks straight across, so nothing may block it here).
    {
      label: "off-the-crossing-row",
      key: "ArrowDown",
      until: { kind: "y-at-least", value: PAVEMENT_SOUTH_EDGE_Y },
    },
    // East along the pavement's own south edge, releasing on a real
    // cell-arrival (story 1.13, cycle 3; story 15.2, cycle 2 -- the
    // manhole this used to rest against carried an undrawn collider,
    // Quentin's finding 3): `PAVEMENT_CROSSING_REST_X`'s own doc comment
    // says why this exact column matters -- a threshold here hands an
    // uncontrolled x to the *next* segment's own northward walk, which
    // does cross the subway stairwell's own row on the way (found the
    // hard way, when a threshold's own overshoot here previously placed
    // that walk right back in the stairwell's own column). A cell-arrival
    // at the exact column removes that risk the same way a rest did,
    // without leaning on an undrawn collider nobody drew.
    {
      label: "east-along-the-crossing",
      key: "ArrowRight",
      until: { kind: "cell", x: PAVEMENT_CROSSING_REST_X, y: PAVEMENT_SOUTH_EDGE_Y },
    },
    // North onto the row the bridge deck spans (story 1.13, cycle 3;
    // story 15.2, cycle 2 -- the curb this used to rest against carried
    // an undrawn collider, Quentin's finding 3, which the story removes).
    // Releases against `STREET_BOUNDARY`'s own id 107 -- a real, if
    // undrawn *world-edge* boundary (the same kind `PAVEMENT_SOUTH_EDGE_Y`
    // rests against, never a per-object invisible collider), placed
    // specifically at this column so a threshold's own release lag,
    // held long enough, never sails two rows past the deck instead of
    // one, stranding this leg somewhere the checkpoint below can never
    // reach (found the hard way, simulating a slow machine). Approached
    // from the south (`ArrowUp`, up off the pavement's own south edge),
    // the same side `leaving-the-underpass` below continues back toward.
    {
      label: "on-the-underpass-row",
      key: "ArrowUp",
      until: { kind: "y-at-most", value: inputs.onUnderpassRowY },
    },
    // The column half: the checkpoint itself. Both axes are now collider
    // rests, so this position is bit-for-bit identical however long the
    // walk to reach it took. Strictly inside the deck's own span
    // (`[BRIDGE_X0, BRIDGE_X1]`), visibly beneath the drawn deck, and
    // every cell here has a drawable one floor above it at the same
    // `(x, y)` -- the two-floors-at-one-`(x, y)` case.
    {
      label: "under-the-bridge",
      key: "ArrowRight",
      until: { kind: "x-at-least", value: inputs.bridgeUnderRestX },
    },
    // Off the underpass row entirely before continuing east, releasing
    // once the body has actually cleared the support pillar's own row
    // (story 1.13, cycle 3; story 15.2, cycle 2 -- the kerb this used to
    // rest against carried an undrawn collider, Quentin's finding 3): the
    // pillar's own real collider spans the row's own full height, and the
    // body is feet-anchored (it extends *upward* from `pos.y`, never
    // downward), so a bare cell-arrival at `BRIDGE_UNDER_EXIT_Y` (the row
    // just south of it) still leaves the body's own top edge inside the
    // pillar's row the instant it turns east there --
    // `inputs.bridgeUnderExitClearY`'s own doc comment says how much
    // further is actually needed (the same shape as `shopfrontClearY`'s
    // own problem). A plain threshold here has nothing to catch it before
    // the pavement's own south edge, three rows further than intended and
    // still on the subway stairwell's own row rather than clear of it,
    // which is what broke `street-conformance.test.ts`'s own slow-machine
    // walk before this checkpoint existed.
    {
      label: "leaving-the-underpass",
      key: "ArrowDown",
      until: { kind: "y-at-least", value: inputs.bridgeUnderExitClearY },
    },
    // On, past the deck's own east end, to the stairs that climb onto
    // it -- crossing the up-transition's own anchor column on the way,
    // which is what actually triggers the climb; holding the key
    // through that lands on the deck and keeps walking there until its
    // own east edge stops it, satisfying this segment's own threshold
    // either way.
    {
      label: "east-of-the-bridge",
      key: "ArrowRight",
      until: { kind: "x-at-least", value: BRIDGE_X1 + 0.4 },
    },
    // Already on the deck by now in the ordinary case (the segment
    // above's own crossing triggered it); held only so a route that
    // somehow reached this point still on the street keeps walking
    // until it does.
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
