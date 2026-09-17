//! AC1's other half (Tim's direction, PR #294 cycle 1): the *committed*
//! `sim::generated::defs::RULES` table -- the actual artefact `tools/
//! defs-build` emitted from `defs/rules/*.toml` -- fires for real, not
//! only an in-memory translation of it. Looks each row up by key; this
//! file lives under `server/sim/tests/`, outside `check-rule-engine-no-
//! content-keys.sh`'s scope (`server/sim/src/rules/` only), so naming a
//! real key/tag here is not the hardcoded content-key branch that guard
//! exists to catch -- this test reads the manifest's own vocabulary, it
//! does not special-case it.
//!
//! One fires/stays-silent test per committed row (Quentin's direction,
//! PR #294 cycle 2), pinned shut by [`every_committed_rule_has_a_test_here`]:
//! a sixth row added to `defs/rules/city.toml` with no matching test here
//! fails the count, rather than silently shipping untested.

mod support;

use sim::generated::defs;
use sim::rules::Cell;
use sim::rules::testing::SiteBuilder;
use support::{rule, tag_id};

#[test]
fn the_committed_ground_floor_only_placement_rule_fires_above_the_cap_and_stays_silent_at_it() {
    let rule = rule("lighting_ground_floor_only");
    let lighting = tag_id("lighting");

    let at_cap = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[lighting])
        .build();
    assert!(support::eval(&[rule], &at_cap).is_empty());

    let above_cap = SiteBuilder::new()
        .cell(Cell::new(0, 0, 1), &[lighting])
        .build();
    let violations = support::eval(&[rule], &above_cap);
    assert_eq!(violations.len(), 1);
    assert_eq!(violations[0].rule_id, rule.id);
    assert_eq!(violations[0].subject, Cell::new(0, 0, 1));
}

#[test]
fn the_committed_waste_per_three_seating_distribution_rule_fires_with_no_waste_and_stays_silent_when_satisfied()
 {
    let rule = rule("waste_per_three_seating");
    let waste = tag_id("waste");
    let seating = tag_id("seating");

    // 3 seating, 1 waste co-located with the middle seat: ratio (3/3=1,
    // 50% tolerance) and coverage (max_distance 12) are both satisfied,
    // and a single waste cell can never violate the spacing floor.
    let satisfied = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[seating])
        .cell(Cell::new(1, 0, 0), &[seating, waste])
        .cell(Cell::new(2, 0, 0), &[seating])
        .build();
    assert!(support::eval(&[rule], &satisfied).is_empty());

    // Same 3 seating cells, no waste at all: the ratio floor (0 waste for
    // 3 seating) fires.
    let no_waste = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[seating])
        .cell(Cell::new(1, 0, 0), &[seating])
        .cell(Cell::new(2, 0, 0), &[seating])
        .build();
    assert!(!support::eval(&[rule], &no_waste).is_empty());
}

#[test]
fn the_committed_no_counter_in_a_stairwell_coherence_rule_fires_when_sharing_an_area_and_stays_silent_otherwise()
 {
    let rule = rule("no_counter_in_a_stairwell");
    let counter = tag_id("counter");
    let stairs = tag_id("stairs");
    const AREA: u64 = 1;

    let satisfied = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[counter])
        .build();
    assert!(support::eval(&[rule], &satisfied).is_empty());

    let violated = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[counter])
        .area(Cell::new(0, 0, 0), AREA)
        .cell(Cell::new(1, 0, 0), &[stairs])
        .area(Cell::new(1, 0, 0), AREA)
        .build();
    assert!(!support::eval(&[rule], &violated).is_empty());
}

/// Asymmetric on purpose (Quentin's direction, PR #294 cycle 2): a
/// counter cell with no shopfront neighbour violates, but a shopfront
/// cell with no counter neighbour never does (only `counter` is the
/// rule's own subject `a`) -- if `a`/`b` were ever swapped in `emit.rs`,
/// these two assertions would trade places.
#[test]
fn the_committed_counter_faces_a_shopfront_adjacency_rule_is_asymmetric() {
    let rule = rule("counter_faces_a_shopfront");
    let counter = tag_id("counter");
    let shopfront = tag_id("shopfront");

    let counter_alone = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[counter])
        .build();
    assert!(!support::eval(&[rule], &counter_alone).is_empty());

    let shopfront_alone = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[shopfront])
        .build();
    assert!(support::eval(&[rule], &shopfront_alone).is_empty());

    let counter_next_to_shopfront = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[counter])
        .cell(Cell::new(1, 0, 0), &[shopfront])
        .build();
    assert!(support::eval(&[rule], &counter_next_to_shopfront).is_empty());
}

#[test]
fn the_committed_walled_room_has_waste_bin_requirement_rule_fires_when_missing_and_stays_silent_when_present()
 {
    let rule = rule("walled_room_has_waste_bin");
    let wall = tag_id("wall");
    let waste = tag_id("waste");
    const AREA: u64 = 1;

    let satisfied = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[wall])
        .area(Cell::new(0, 0, 0), AREA)
        .cell(Cell::new(1, 0, 0), &[waste])
        .area(Cell::new(1, 0, 0), AREA)
        .build();
    assert!(support::eval(&[rule], &satisfied).is_empty());

    let violated = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[wall])
        .area(Cell::new(0, 0, 0), AREA)
        .build();
    assert!(!support::eval(&[rule], &violated).is_empty());
}

// --- story 2.9: defs/rules/grammar.toml's own ten rows ----------------------

#[test]
fn the_committed_road_never_touches_wall_rule_fires_and_stays_silent() {
    let rule = rule("road_never_touches_wall");
    let road = tag_id("road");
    let wall = tag_id("wall");

    let violated = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[road])
        .cell(Cell::new(1, 0, 0), &[wall])
        .build();
    assert!(!support::eval(&[rule], &violated).is_empty());

    let satisfied = SiteBuilder::new().cell(Cell::new(0, 0, 0), &[road]).build();
    assert!(support::eval(&[rule], &satisfied).is_empty());
}

#[test]
fn the_committed_road_never_touches_ground_rule_fires_and_stays_silent() {
    let rule = rule("road_never_touches_ground");
    let road = tag_id("road");
    let ground = tag_id("ground");
    let pavement = tag_id("pavement");

    let violated = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[road])
        .cell(Cell::new(1, 0, 0), &[ground])
        .build();
    assert!(!support::eval(&[rule], &violated).is_empty());

    let satisfied = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[road])
        .cell(Cell::new(1, 0, 0), &[pavement])
        .build();
    assert!(support::eval(&[rule], &satisfied).is_empty());
}

#[test]
fn the_committed_floor_never_touches_bare_ground_rule_fires_and_stays_silent() {
    let rule = rule("floor_never_touches_bare_ground");
    let floor = tag_id("floor");
    let ground = tag_id("ground");

    let violated = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[floor])
        .cell(Cell::new(1, 0, 0), &[ground])
        .build();
    assert!(!support::eval(&[rule], &violated).is_empty());

    // An interior floor cell surrounded by more floor never fires.
    let satisfied = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[floor])
        .cell(Cell::new(1, 0, 0), &[floor])
        .build();
    assert!(support::eval(&[rule], &satisfied).is_empty());
}

#[test]
fn the_committed_floor_never_touches_pavement_directly_rule_fires_and_stays_silent() {
    let rule = rule("floor_never_touches_pavement_directly");
    let floor = tag_id("floor");
    let pavement = tag_id("pavement");
    let threshold = tag_id("threshold");

    let violated = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[floor])
        .cell(Cell::new(1, 0, 0), &[pavement])
        .build();
    assert!(!support::eval(&[rule], &violated).is_empty());

    // A threshold cell sits between them instead -- floor no longer
    // directly touches pavement.
    let satisfied = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[floor])
        .cell(Cell::new(1, 0, 0), &[threshold])
        .cell(Cell::new(2, 0, 0), &[pavement])
        .build();
    assert!(support::eval(&[rule], &satisfied).is_empty());
}

#[test]
fn the_committed_floor_never_touches_road_directly_rule_fires_and_stays_silent() {
    let rule = rule("floor_never_touches_road_directly");
    let floor = tag_id("floor");
    let road = tag_id("road");

    let violated = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[floor])
        .cell(Cell::new(1, 0, 0), &[road])
        .build();
    assert!(!support::eval(&[rule], &violated).is_empty());

    let satisfied = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[floor])
        .build();
    assert!(support::eval(&[rule], &satisfied).is_empty());
}

/// The doorway primitive (AC3): `rotate = true` lowers two authored
/// alternatives to six orientations -- this fixture checks a rotated
/// orientation (walls east/west) of the street-door alternative, to
/// prove the rotation actually reached the committed artefact, not only
/// the orientation that happens to match the authored literal order.
#[test]
fn the_committed_doorway_formed_between_walls_rule_fires_and_stays_silent() {
    let rule = rule("doorway_formed_between_walls");
    let threshold = tag_id("threshold");
    let wall = tag_id("wall");
    let floor = tag_id("floor");
    let pavement = tag_id("pavement");

    // A rotated orientation: wall east/west, floor/pavement north/south.
    let street_door = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[threshold])
        .cell(Cell::new(-1, 0, 0), &[wall])
        .cell(Cell::new(1, 0, 0), &[wall])
        .cell(Cell::new(0, -1, 0), &[floor])
        .cell(Cell::new(0, 1, 0), &[pavement])
        .build();
    assert!(support::eval(&[rule], &street_door).is_empty());

    // The second authored alternative: floor on both remaining sides, a
    // door between two rooms rather than onto the street.
    let interior_door = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[threshold])
        .cell(Cell::new(-1, 0, 0), &[wall])
        .cell(Cell::new(1, 0, 0), &[wall])
        .cell(Cell::new(0, -1, 0), &[floor])
        .cell(Cell::new(0, 1, 0), &[floor])
        .build();
    assert!(support::eval(&[rule], &interior_door).is_empty());

    // A doorway opening onto another wall (Artie's own named rejection
    // case) instead of floor/pavement/floor.
    let violated = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[threshold])
        .cell(Cell::new(-1, 0, 0), &[wall])
        .cell(Cell::new(1, 0, 0), &[wall])
        .cell(Cell::new(0, -1, 0), &[wall])
        .build();
    assert!(!support::eval(&[rule], &violated).is_empty());
}

/// The corner/straight-run primitive (AC3): `rotate = true` lowers two
/// authored alternatives to six distinct patterns -- checked here via a
/// corner orientation the literal authoring order did not name directly
/// (south-west), proving the rotation reached the committed artefact.
/// `wall_run` -- carried by both `wall` and `threshold` -- is what a
/// wall cell counts, never `wall` itself, so a doorway jamb is never a
/// free-standing stub.
#[test]
fn the_committed_wall_is_part_of_a_straight_run_or_a_corner_rule_fires_and_stays_silent() {
    let rule = rule("wall_is_part_of_a_straight_run_or_a_corner");
    let wall = tag_id("wall");
    let wall_run = tag_id("wall_run");
    let threshold = tag_id("threshold");

    let stub = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[wall, wall_run])
        .build();
    assert!(!support::eval(&[rule], &stub).is_empty());

    // A closed 2x2 ring: every cell has exactly two wall_run neighbours,
    // each pair perpendicular (a corner) -- includes the south-west
    // orientation the literal authoring order did not name directly.
    let ring = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[wall, wall_run])
        .cell(Cell::new(1, 0, 0), &[wall, wall_run])
        .cell(Cell::new(1, 1, 0), &[wall, wall_run])
        .cell(Cell::new(0, 1, 0), &[wall, wall_run])
        .build();
    assert!(support::eval(&[rule], &ring).is_empty());

    // A wall cell whose one flank is a threshold jamb (wall_run, not
    // wall) is not a stub either.
    let jamb = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[wall, wall_run])
        .cell(Cell::new(1, 0, 0), &[threshold, wall_run])
        .cell(Cell::new(0, 1, 0), &[wall, wall_run])
        .build();
    assert!(
        support::eval(&[rule], &jamb)
            .iter()
            .all(|v| v.subject != Cell::new(0, 0, 0))
    );
}

#[test]
fn the_committed_room_has_a_door_rule_fires_and_stays_silent() {
    let rule = rule("room_has_a_door");
    let floor = tag_id("floor");
    let threshold = tag_id("threshold");
    const AREA: u64 = 1;

    let satisfied = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[floor])
        .area(Cell::new(0, 0, 0), AREA)
        .cell(Cell::new(1, 0, 0), &[threshold])
        .area(Cell::new(1, 0, 0), AREA)
        .build();
    assert!(support::eval(&[rule], &satisfied).is_empty());

    let violated = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[floor])
        .area(Cell::new(0, 0, 0), AREA)
        .build();
    assert!(!support::eval(&[rule], &violated).is_empty());
}

#[test]
fn the_committed_building_has_an_entrance_rule_fires_and_stays_silent() {
    let rule = rule("building_has_an_entrance");
    let wall = tag_id("wall");
    let entrance = tag_id("entrance");
    const AREA: u64 = 1;

    let satisfied = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[wall])
        .area(Cell::new(0, 0, 0), AREA)
        .cell(Cell::new(1, 0, 0), &[entrance])
        .area(Cell::new(1, 0, 0), AREA)
        .build();
    assert!(support::eval(&[rule], &satisfied).is_empty());

    let violated = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[wall])
        .area(Cell::new(0, 0, 0), AREA)
        .build();
    assert!(!support::eval(&[rule], &violated).is_empty());
}

/// Artie's direction (cycle 2): `entrance` opening onto pavement is
/// checked in any of its four rotated orientations, not just the
/// authored literal (`north`).
#[test]
fn the_committed_entrance_opens_onto_pavement_rule_fires_and_stays_silent() {
    let rule = rule("entrance_opens_onto_pavement");
    let entrance = tag_id("entrance");
    let floor = tag_id("floor");
    let pavement = tag_id("pavement");

    // A rotated orientation: pavement to the west, not the authored
    // literal (north).
    let satisfied = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[entrance])
        .cell(Cell::new(-1, 0, 0), &[pavement])
        .build();
    assert!(support::eval(&[rule], &satisfied).is_empty());

    let violated = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[entrance])
        .cell(Cell::new(-1, 0, 0), &[floor])
        .cell(Cell::new(1, 0, 0), &[floor])
        .build();
    assert!(!support::eval(&[rule], &violated).is_empty());
}

/// Pins the set closed: a rule added to `defs/rules/city.toml` with no
/// matching test above must fail this count, not ship silently untested
/// (Quentin's direction, PR #294 cycle 2).
#[test]
fn every_committed_rule_has_a_test_here() {
    let tested = [
        "lighting_ground_floor_only",
        "waste_per_three_seating",
        "no_counter_in_a_stairwell",
        "counter_faces_a_shopfront",
        "walled_room_has_waste_bin",
        "road_never_touches_wall",
        "road_never_touches_ground",
        "floor_never_touches_bare_ground",
        "floor_never_touches_pavement_directly",
        "floor_never_touches_road_directly",
        "doorway_formed_between_walls",
        "wall_is_part_of_a_straight_run_or_a_corner",
        "room_has_a_door",
        "building_has_an_entrance",
        "entrance_opens_onto_pavement",
    ];
    assert_eq!(
        defs::RULES.len(),
        tested.len(),
        "defs/rules/*.toml declares {} rows but only {} are tested in this file -- add a test for the new row(s)",
        defs::RULES.len(),
        tested.len()
    );
    for key in tested {
        assert!(
            defs::RULES.iter().any(|r| r.key == key),
            "'{key}' is tested here but no longer exists in defs::RULES"
        );
    }
}
