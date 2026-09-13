//! The canonical, hand-authored fixture world (Quentin's direction, story
//! 1.5): one small world containing every shape the acceptance criteria
//! name -- a road with a bridge deck overhead one floor up, a building
//! whose interior sits at its footprint with a door on its perimeter, a
//! manhole down to a subway floor, and a staircase up to an upper storey.
//!
//! [`conformance_cases`]'s `expect_*` fields are typed in by hand against
//! this layout, not derived by calling the functions under test -- that is
//! what makes [`World::is_blocked`]/[`World::ownership_at`]/etc. an actual
//! test rather than a tautology. `bounds`'s `regen-world-fixture` binary
//! serialises this same spec and case list to
//! `fixtures/world-conformance.v1.json` at the repo root, so a future
//! client-side vitest suite can check its own TypeScript port of this
//! model against the identical oracle (NFR30: the two implementations are
//! never the same code, only the same fixture).

use super::collision::{AreaSpec, FloorSpec, TransitionSpec, World, WorldSpec};
use super::{NO_OWNER, Rect, chunk_key, clip_rect_to_chunks};

/// Builds an [`AreaSpec`], computing its `chunk_key` from `rect`/`floor`
/// rather than repeating it by hand at every call site -- the one thing
/// [`WorldSpec::build`] would otherwise reject a typo in.
fn area(owner_id: u64, floor: i8, rect: Rect) -> AreaSpec {
    AreaSpec {
        owner_id,
        floor,
        rect,
        chunk_key: chunk_key(rect.x0, rect.y0, floor),
    }
}

/// Splits `rect` into one [`AreaSpec`] per chunk it spans, all sharing
/// `owner_id` -- the real generator idiom [`clip_rect_to_chunks`]'s own doc
/// comment describes, exercised here by [`chunk_boundary_building_rect`].
fn clipped_area(owner_id: u64, floor: i8, rect: Rect) -> Vec<AreaSpec> {
    clip_rect_to_chunks(rect, floor)
        .into_iter()
        .map(|(piece, key)| AreaSpec {
            owner_id,
            floor,
            rect: piece,
            chunk_key: key,
        })
        .collect()
}

/// Every floor the fixture declares.
pub const STREET: i8 = 0;
pub const SUBWAY: i8 = -1;
pub const UPPER: i8 = 1;

/// The single building's id in `building_area`/`room_area`.
pub const FIXTURE_BUILDING_ID: u64 = 1;
/// The single room's id, inside `FIXTURE_BUILDING_ID`.
pub const FIXTURE_ROOM_ID: u64 = 1;

/// Story 1.7 (Quentin's direction): a terrace of two adjacent shops
/// sharing one wall line, each with its own building id and its own room
/// nested inside it -- the ownership shapes a future client-side
/// retraction/enclosure port must agree with the Rust oracle on.
pub const TERRACE_SHOP_A_ID: u64 = 2;
pub const TERRACE_ROOM_A_ID: u64 = 2;
pub const TERRACE_SHOP_B_ID: u64 = 3;
pub const TERRACE_ROOM_B_ID: u64 = 3;

/// Shop A's whole footprint: touches Shop B's along `x = 25`, the shared
/// wall line -- `x1` here equals Shop B's `x0` below, so the two rects are
/// adjacent, never overlapping (the same no-overlap rule `WorldSpec::build`
/// already enforces for same-kind areas).
fn terrace_shop_a() -> Rect {
    Rect {
        x0: 20,
        y0: 1,
        x1: 25,
        y1: 6,
    }
}

/// Shop A's room, nested entirely inside its own building footprint, one
/// ring in from every wall -- "a room nested in a building".
fn terrace_room_a() -> Rect {
    Rect {
        x0: 21,
        y0: 2,
        x1: 24,
        y1: 5,
    }
}

/// Shop B's whole footprint, immediately east of Shop A's -- `x0` here is
/// Shop A's own `x1`.
fn terrace_shop_b() -> Rect {
    Rect {
        x0: 25,
        y0: 1,
        x1: 30,
        y1: 6,
    }
}

fn terrace_room_b() -> Rect {
    Rect {
        x0: 26,
        y0: 2,
        x1: 29,
        y1: 5,
    }
}

/// Story 1.7: a building whose declared footprint would span two chunks
/// along `x` (`CHUNK_SIZE` is 32; this rect covers `30..35`, crossing
/// `x = 32`) -- clipped into per-chunk pieces by
/// [`super::clip_rect_to_chunks`], the one function a real generator uses
/// for exactly this shape, each piece sharing the same owner id. Proves an
/// ownership query on either side of the boundary agrees, even though the
/// two pieces live in different `AreaIndex` buckets.
pub const CHUNK_BOUNDARY_BUILDING_ID: u64 = 4;

fn chunk_boundary_building_rect() -> Rect {
    Rect {
        x0: 30,
        y0: 2,
        x1: 35,
        y1: 4,
    }
}

/// Story 1.7: a subway platform, floor -1, directly under Shop A's own
/// footprint -- proves the same `(x, y)` on two different floors never
/// shares an owner, and that ownership is queried per floor like collision
/// is.
pub const SUBWAY_PLATFORM_BUILDING_ID: u64 = 5;

/// Story 1.7: a building at negative world coordinates -- ownership is
/// never assumed non-negative.
pub const NEGATIVE_COORDS_BUILDING_ID: u64 = 6;

fn negative_coords_building_rect() -> Rect {
    Rect {
        x0: -5,
        y0: -4,
        x1: -1,
        y1: -1,
    }
}

/// Shared extent for every floor -- generous enough to hold the whole
/// layout below with room either side.
fn floor_bounds() -> Rect {
    Rect {
        x0: -5,
        y0: -5,
        x1: 40,
        y1: 10,
    }
}

/// The building's whole footprint (its walls included): a 5x5 block south
/// of the road, door in the middle of its north wall.
fn building_footprint() -> Rect {
    Rect {
        x0: 10,
        y0: 1,
        x1: 15,
        y1: 6,
    }
}

/// The door: the one walkable gap in the north wall (FR118 - an ordinary
/// walkable cell, never a transition).
const DOOR_X: i32 = 12;
const DOOR_Y: i32 = 1;

/// The building's interior, one ring in from every wall -- the room.
fn room_interior() -> Rect {
    Rect {
        x0: 11,
        y0: 2,
        x1: 14,
        y1: 5,
    }
}

/// The building's perimeter wall cells, minus the door -- every ring cell
/// of `building_footprint()` that is not inside `room_interior()` and is
/// not the door.
fn building_walls() -> Vec<Rect> {
    let footprint = building_footprint();
    let interior = room_interior();
    let mut walls = Vec::new();
    for y in footprint.y0..footprint.y1 {
        for x in footprint.x0..footprint.x1 {
            if interior.contains(x, y) {
                continue;
            }
            if x == DOOR_X && y == DOOR_Y {
                continue;
            }
            walls.push(Rect {
                x0: x,
                y0: y,
                x1: x + 1,
                y1: y + 1,
            });
        }
    }
    walls
}

/// The bridge's two railing posts on `UPPER`, directly above the road span
/// the street floor walks under (AC2). `BRIDGE_DECK_X0..BRIDGE_DECK_X1` is
/// the whole deck; the railings are its two edge columns, leaving the
/// middle open to walk across.
pub const BRIDGE_DECK_X0: i32 = 4;
pub const BRIDGE_DECK_X1: i32 = 8;
const BRIDGE_Y: i32 = 0;

fn bridge_railings() -> Vec<Rect> {
    vec![
        Rect {
            x0: BRIDGE_DECK_X0,
            y0: BRIDGE_Y,
            x1: BRIDGE_DECK_X0 + 1,
            y1: BRIDGE_Y + 1,
        },
        Rect {
            x0: BRIDGE_DECK_X1 - 1,
            y0: BRIDGE_Y,
            x1: BRIDGE_DECK_X1,
            y1: BRIDGE_Y + 1,
        },
    ]
}

/// The manhole: street to subway (FR117).
pub const MANHOLE_X: i32 = 18;
pub const MANHOLE_Y: i32 = 0;

/// The staircase: street to the upper storey (FR117).
pub const STAIR_X: i32 = 23;
pub const STAIR_Y: i32 = 0;

/// The declarative fixture, before it is built into a [`World`].
pub fn canonical_world_spec() -> WorldSpec {
    WorldSpec {
        floors: vec![
            FloorSpec {
                floor: STREET,
                bounds: floor_bounds(),
                colliders: building_walls(),
            },
            FloorSpec {
                floor: UPPER,
                bounds: floor_bounds(),
                colliders: bridge_railings(),
            },
            FloorSpec {
                floor: SUBWAY,
                bounds: floor_bounds(),
                colliders: Vec::new(),
            },
        ],
        transitions: vec![
            TransitionSpec {
                x: MANHOLE_X,
                y: MANHOLE_Y,
                floor: STREET,
                target_x: MANHOLE_X,
                target_y: MANHOLE_Y,
                target_floor: SUBWAY,
            },
            TransitionSpec {
                x: STAIR_X,
                y: STAIR_Y,
                floor: STREET,
                target_x: STAIR_X,
                target_y: STAIR_Y,
                target_floor: UPPER,
            },
        ],
        building_areas: {
            let mut areas = vec![
                area(FIXTURE_BUILDING_ID, STREET, building_footprint()),
                area(TERRACE_SHOP_A_ID, STREET, terrace_shop_a()),
                area(TERRACE_SHOP_B_ID, STREET, terrace_shop_b()),
                area(SUBWAY_PLATFORM_BUILDING_ID, SUBWAY, terrace_shop_a()),
                area(
                    NEGATIVE_COORDS_BUILDING_ID,
                    STREET,
                    negative_coords_building_rect(),
                ),
            ];
            areas.extend(clipped_area(
                CHUNK_BOUNDARY_BUILDING_ID,
                STREET,
                chunk_boundary_building_rect(),
            ));
            areas
        },
        room_areas: vec![
            area(FIXTURE_ROOM_ID, STREET, room_interior()),
            area(TERRACE_ROOM_A_ID, STREET, terrace_room_a()),
            area(TERRACE_ROOM_B_ID, STREET, terrace_room_b()),
        ],
    }
}

/// A floor no `FloorSpec` above declares -- used by [`conformance_cases`]
/// to pin the undeclared-floor behaviour a future client port is most
/// likely to get wrong.
pub const UNDECLARED_FLOOR: i8 = 5;

/// A cell outside every declared floor's extent -- see
/// [`UNDECLARED_FLOOR`]'s doc comment.
pub const OUT_OF_BOUNDS_X: i32 = 10_000;
pub const OUT_OF_BOUNDS_Y: i32 = 10_000;

/// Builds the fixture. `WorldSpec::build` only fails if a transition
/// targets ungrounded geometry, which this hand-checked layout never does.
pub fn canonical_world() -> World {
    canonical_world_spec()
        .build()
        .expect("the canonical fixture is a valid world by construction")
}

/// One hand-typed expectation against the canonical fixture.
#[derive(Debug, Clone, Copy)]
pub struct ConformanceCase {
    pub x: i32,
    pub y: i32,
    pub floor: i8,
    pub expect_blocked: bool,
    pub expect_transition: Option<(i32, i32, i8)>,
    pub expect_building_id: u64,
    pub expect_room_id: u64,
}

/// Every case the conformance fixture pins. Hand-authored against the
/// layout above -- never generated by calling [`World`]'s own query
/// functions, or this would prove nothing.
pub fn conformance_cases() -> Vec<ConformanceCase> {
    vec![
        // Open road, street floor: walkable, unowned, no transition.
        ConformanceCase {
            x: 2,
            y: 0,
            floor: STREET,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: NO_OWNER,
            expect_room_id: NO_OWNER,
        },
        // Under the bridge deck, street floor: walkable (AC2's first half
        // -- the deck above is not in this floor's collision set).
        ConformanceCase {
            x: 5,
            y: BRIDGE_Y,
            floor: STREET,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: NO_OWNER,
            expect_room_id: NO_OWNER,
        },
        ConformanceCase {
            x: 6,
            y: BRIDGE_Y,
            floor: STREET,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: NO_OWNER,
            expect_room_id: NO_OWNER,
        },
        // The same (x, y) one floor up, on the bridge deck itself: open in
        // the middle (AC2's second half -- walking ON the deck is not
        // walking through its railing).
        ConformanceCase {
            x: 5,
            y: BRIDGE_Y,
            floor: UPPER,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: NO_OWNER,
            expect_room_id: NO_OWNER,
        },
        // The deck's railing posts: blocked on UPPER...
        ConformanceCase {
            x: BRIDGE_DECK_X0,
            y: BRIDGE_Y,
            floor: UPPER,
            expect_blocked: true,
            expect_transition: None,
            expect_building_id: NO_OWNER,
            expect_room_id: NO_OWNER,
        },
        ConformanceCase {
            x: BRIDGE_DECK_X1 - 1,
            y: BRIDGE_Y,
            floor: UPPER,
            expect_blocked: true,
            expect_transition: None,
            expect_building_id: NO_OWNER,
            expect_room_id: NO_OWNER,
        },
        // ...but not on STREET: the two cells at this (x, y) on different
        // floors never conflict (AC1).
        ConformanceCase {
            x: BRIDGE_DECK_X0,
            y: BRIDGE_Y,
            floor: STREET,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: NO_OWNER,
            expect_room_id: NO_OWNER,
        },
        // The building's north wall: blocked, no owner query needed
        // through a wall, but it is still inside the footprint.
        ConformanceCase {
            x: 10,
            y: DOOR_Y,
            floor: STREET,
            expect_blocked: true,
            expect_transition: None,
            expect_building_id: FIXTURE_BUILDING_ID,
            expect_room_id: NO_OWNER,
        },
        // The exterior cell just outside the door: walkable, unowned.
        ConformanceCase {
            x: DOOR_X,
            y: 0,
            floor: STREET,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: NO_OWNER,
            expect_room_id: NO_OWNER,
        },
        // The door itself (AC4): an ordinary walkable cell, no transition,
        // already inside the building's ownership but not yet a room.
        ConformanceCase {
            x: DOOR_X,
            y: DOOR_Y,
            floor: STREET,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: FIXTURE_BUILDING_ID,
            expect_room_id: NO_OWNER,
        },
        // One step past the door: inside the room (AC5).
        ConformanceCase {
            x: DOOR_X,
            y: DOOR_Y + 1,
            floor: STREET,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: FIXTURE_BUILDING_ID,
            expect_room_id: FIXTURE_ROOM_ID,
        },
        // The manhole anchor: walkable, and a transition to the subway.
        ConformanceCase {
            x: MANHOLE_X,
            y: MANHOLE_Y,
            floor: STREET,
            expect_blocked: false,
            expect_transition: Some((MANHOLE_X, MANHOLE_Y, SUBWAY)),
            expect_building_id: NO_OWNER,
            expect_room_id: NO_OWNER,
        },
        // The subway landing: standable, unowned, and not itself a
        // transition (this fixture's manhole is one-way; a return trip is
        // a separate anchor a real generator would also place).
        ConformanceCase {
            x: MANHOLE_X,
            y: MANHOLE_Y,
            floor: SUBWAY,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: NO_OWNER,
            expect_room_id: NO_OWNER,
        },
        // The staircase anchor: walkable, and a transition to the upper
        // storey.
        ConformanceCase {
            x: STAIR_X,
            y: STAIR_Y,
            floor: STREET,
            expect_blocked: false,
            expect_transition: Some((STAIR_X, STAIR_Y, UPPER)),
            expect_building_id: NO_OWNER,
            expect_room_id: NO_OWNER,
        },
        // The staircase landing: standable.
        ConformanceCase {
            x: STAIR_X,
            y: STAIR_Y,
            floor: UPPER,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: NO_OWNER,
            expect_room_id: NO_OWNER,
        },
        // Outside every declared floor's extent: unblocked, unowned, no
        // transition -- the single behaviour a future client port is most
        // likely to get wrong (returning blocked, or throwing, instead).
        ConformanceCase {
            x: OUT_OF_BOUNDS_X,
            y: OUT_OF_BOUNDS_Y,
            floor: STREET,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: NO_OWNER,
            expect_room_id: NO_OWNER,
        },
        // A floor this fixture never declares at all: same answer.
        ConformanceCase {
            x: 0,
            y: 0,
            floor: UNDECLARED_FLOOR,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: NO_OWNER,
            expect_room_id: NO_OWNER,
        },
        // Story 1.7: the terrace's shared wall line -- Shop A's own wall
        // column (x=24, its footprint's east edge, one short of the room
        // interior) and Shop B's own wall column (x=25, its footprint's
        // west edge) are adjacent but never the same cell, and never the
        // same owner.
        ConformanceCase {
            x: 24,
            y: 3,
            floor: STREET,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: TERRACE_SHOP_A_ID,
            expect_room_id: NO_OWNER,
        },
        ConformanceCase {
            x: 25,
            y: 3,
            floor: STREET,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: TERRACE_SHOP_B_ID,
            expect_room_id: NO_OWNER,
        },
        // Inside each shop's own room -- "a room nested in a building",
        // and proof that standing in one shop never touches the other's
        // ownership.
        ConformanceCase {
            x: 22,
            y: 3,
            floor: STREET,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: TERRACE_SHOP_A_ID,
            expect_room_id: TERRACE_ROOM_A_ID,
        },
        ConformanceCase {
            x: 27,
            y: 3,
            floor: STREET,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: TERRACE_SHOP_B_ID,
            expect_room_id: TERRACE_ROOM_B_ID,
        },
        // Story 1.7: an area clipped across a chunk boundary
        // (`chunk_boundary_building_rect` spans x=32, `CHUNK_SIZE`) --
        // both pieces share the same owner id, on either side of the
        // boundary.
        ConformanceCase {
            x: 31,
            y: 3,
            floor: STREET,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: CHUNK_BOUNDARY_BUILDING_ID,
            expect_room_id: NO_OWNER,
        },
        ConformanceCase {
            x: 32,
            y: 3,
            floor: STREET,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: CHUNK_BOUNDARY_BUILDING_ID,
            expect_room_id: NO_OWNER,
        },
        // Story 1.7: a floor -1 area directly under a floor 0 building --
        // the same (x, y) on two different floors never shares an owner.
        ConformanceCase {
            x: 22,
            y: 3,
            floor: SUBWAY,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: SUBWAY_PLATFORM_BUILDING_ID,
            expect_room_id: NO_OWNER,
        },
        // Story 1.7: negative world coordinates.
        ConformanceCase {
            x: -3,
            y: -2,
            floor: STREET,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: NEGATIVE_COORDS_BUILDING_ID,
            expect_room_id: NO_OWNER,
        },
        ConformanceCase {
            x: -10,
            y: -2,
            floor: STREET,
            expect_blocked: false,
            expect_transition: None,
            expect_building_id: NO_OWNER,
            expect_room_id: NO_OWNER,
        },
    ]
}
