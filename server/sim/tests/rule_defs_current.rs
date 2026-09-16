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

use sim::generated::defs;
use sim::rules::testing::SiteBuilder;
use sim::rules::{Cell, evaluate};

fn tag_id(key: &str) -> u32 {
    defs::TAGS
        .iter()
        .find(|t| t.key == key)
        .unwrap_or_else(|| panic!("defs/tags/city.toml must still declare tag '{key}'"))
        .id
}

fn rule(key: &str) -> sim::rules::RuleDef {
    *defs::RULES
        .iter()
        .find(|r| r.key == key)
        .unwrap_or_else(|| panic!("defs/rules/city.toml must still declare rule '{key}'"))
}

#[test]
fn the_committed_ground_floor_only_placement_rule_fires_above_the_cap_and_stays_silent_at_it() {
    let rule = rule("lighting_ground_floor_only");
    let lighting = tag_id("lighting");

    let at_cap = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[lighting])
        .build();
    assert!(evaluate(&[rule], &at_cap).is_empty());

    let above_cap = SiteBuilder::new()
        .cell(Cell::new(0, 0, 1), &[lighting])
        .build();
    let violations = evaluate(&[rule], &above_cap);
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
    assert!(evaluate(&[rule], &satisfied).is_empty());

    // Same 3 seating cells, no waste at all: the ratio floor (0 waste for
    // 3 seating) fires.
    let no_waste = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[seating])
        .cell(Cell::new(1, 0, 0), &[seating])
        .cell(Cell::new(2, 0, 0), &[seating])
        .build();
    assert!(!evaluate(&[rule], &no_waste).is_empty());
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
    assert!(evaluate(&[rule], &satisfied).is_empty());

    let violated = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[counter])
        .area(Cell::new(0, 0, 0), AREA)
        .cell(Cell::new(1, 0, 0), &[stairs])
        .area(Cell::new(1, 0, 0), AREA)
        .build();
    assert!(!evaluate(&[rule], &violated).is_empty());
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
    assert!(!evaluate(&[rule], &counter_alone).is_empty());

    let shopfront_alone = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[shopfront])
        .build();
    assert!(evaluate(&[rule], &shopfront_alone).is_empty());

    let counter_next_to_shopfront = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[counter])
        .cell(Cell::new(1, 0, 0), &[shopfront])
        .build();
    assert!(evaluate(&[rule], &counter_next_to_shopfront).is_empty());
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
    assert!(evaluate(&[rule], &satisfied).is_empty());

    let violated = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[wall])
        .area(Cell::new(0, 0, 0), AREA)
        .build();
    assert!(!evaluate(&[rule], &violated).is_empty());
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
    ];
    assert_eq!(
        defs::RULES.len(),
        tested.len(),
        "defs/rules/city.toml declares {} rows but only {} are tested in this file -- add a test for the new row(s)",
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
