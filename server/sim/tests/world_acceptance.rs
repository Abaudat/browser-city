//! One named test per acceptance criterion (issue #53), against the
//! canonical fixture (`sim/src/world/fixture.rs`). Names say what a player
//! experiences, not what a field contains.

use sim::world::NO_OWNER;
use sim::world::fixture::{
    self, BRIDGE_DECK_X0, BRIDGE_DECK_X1, MANHOLE_X, MANHOLE_Y, STAIR_X, STAIR_Y, canonical_world,
};

/// AC1: two cells at the same (x, y) on different floors both exist
/// without conflict, and an entity on floor 0 tests collision only
/// against floor 0.
#[test]
fn two_cells_at_the_same_xy_on_different_floors_never_conflict() {
    let world = canonical_world();
    // The bridge's railing post blocks floor UPPER at this (x, y)...
    assert!(world.is_blocked(BRIDGE_DECK_X0, 0, fixture::UPPER));
    // ...but the street floor directly below it, same (x, y), is untouched.
    assert!(!world.is_blocked(BRIDGE_DECK_X0, 0, fixture::STREET));
}

/// AC2: a player on the road beneath the bridge passes under it -- the
/// deck is not in the street floor's collision set -- and the same walk
/// one floor up interacts with the deck's own geometry (open in the
/// middle, blocked at its railings). Both halves are checked: a bridge you
/// can walk under but not on is as broken as the reverse.
#[test]
fn walking_under_the_bridge_is_unobstructed_the_whole_span() {
    let world = canonical_world();
    for x in BRIDGE_DECK_X0..BRIDGE_DECK_X1 {
        assert!(
            !world.is_blocked(x, 0, fixture::STREET),
            "street floor blocked under the bridge at x={x}"
        );
    }
}

#[test]
fn walking_on_the_bridge_deck_interacts_with_its_railings() {
    let world = canonical_world();
    // The railing posts, the deck's two edge columns, block the deck
    // itself.
    assert!(world.is_blocked(BRIDGE_DECK_X0, 0, fixture::UPPER));
    assert!(world.is_blocked(BRIDGE_DECK_X1 - 1, 0, fixture::UPPER));
    // Between them, the deck's surface is walkable.
    for x in (BRIDGE_DECK_X0 + 1)..(BRIDGE_DECK_X1 - 1) {
        assert!(
            !world.is_blocked(x, 0, fixture::UPPER),
            "bridge deck blocked at x={x}"
        );
    }
}

/// AC3: entering a transition cell changes the entity's floor and its
/// collision set together, in the same function application -- there is no
/// intermediate state to observe.
#[test]
fn entering_a_transition_yields_the_target_floor_and_its_collision_set_together() {
    let world = canonical_world();
    let (target_floor, collision) = world
        .enter_transition(MANHOLE_X, MANHOLE_Y, fixture::STREET)
        .expect("the manhole is a transition");
    assert_eq!(target_floor, fixture::SUBWAY);
    // The one collision set returned is already the subway's: the landing
    // is standable in it.
    assert!(collision.is_standable(MANHOLE_X, MANHOLE_Y));

    let (target_floor, collision) = world
        .enter_transition(STAIR_X, STAIR_Y, fixture::STREET)
        .expect("the staircase is a transition");
    assert_eq!(target_floor, fixture::UPPER);
    assert!(collision.is_standable(STAIR_X, STAIR_Y));
}

#[test]
fn a_cell_with_no_transition_yields_none() {
    let world = canonical_world();
    assert!(world.enter_transition(2, 0, fixture::STREET).is_none());
}

/// AC4: a door is an ordinary walkable cell -- walking through it involves
/// no map or space identifier at all, just a continuous position sequence.
#[test]
fn walking_through_a_doorway_is_a_continuous_walk_with_no_space_transition() {
    let world = canonical_world();
    let door_x = 12;
    let door_y = 1; // fixture's door row
    let steps = [
        (door_x, door_y - 1), // just outside
        (door_x, door_y),     // the door itself
        (door_x, door_y + 1), // just inside, in the room
    ];
    for (x, y) in steps {
        assert!(
            !world.is_blocked(x, y, fixture::STREET),
            "({x}, {y}) should be walkable"
        );
        assert!(
            world.transition_at(x, y, fixture::STREET).is_none(),
            "({x}, {y}) must not be a transition -- a door is never one (FR118)"
        );
    }
}

/// AC5: every cell carries a building/room ownership id, queryable for the
/// player's current position both inside and outside a building.
#[test]
fn the_buildings_id_is_queryable_inside_and_not_outside() {
    let world = canonical_world();
    let inside = world.ownership_at(12, 3, fixture::STREET);
    assert_eq!(inside.building_id, fixture::FIXTURE_BUILDING_ID);
    assert_eq!(inside.room_id, fixture::FIXTURE_ROOM_ID);

    let outside = world.ownership_at(2, 0, fixture::STREET);
    assert_eq!(outside.building_id, NO_OWNER);
    assert_eq!(outside.room_id, NO_OWNER);
}
