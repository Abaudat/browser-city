//! Story 2.9 (AC2/AC3/AC4, FR119): the "harness" Tim's direction names --
//! story 2.11's real harness is not built yet, so this is `evaluate` run
//! over `testing::Site`, exactly like every other rule-defs acceptance
//! test, but at *room and street* scale rather than one isolated pair.
//! Runs the real generated `RULES`/`TAGS` (`sim::generated::defs`), never
//! a hand-written copy.
//!
//! One well-formed composition (a room, and a street fragment: pavement
//! facing a road) with zero violations, and one broken variant per
//! `defs/rules/grammar.toml` row, each yielding exactly that row's own
//! key (and, for a `Forbid` row, the violating pair via `Violation::
//! other`). Per-row unit coverage of each row in isolation already lives
//! in `rule_defs_current.rs`; this file is the room/street-scale
//! integration Tim's direction asks for -- several rows cooperating over
//! one composition, not one row at a time.
//!
//! Scope (see `defs/rules/grammar.toml`'s own header comment): the
//! well-formed room below is fully closed (no doorway) -- combining a
//! doorway with a closed wall run needs the wall-jamb pattern
//! `defs/rules/grammar.toml` names as a follow-up gap, not yet a row.
//! The doorway primitive itself is exercised on its own, standalone
//! neighbourhood (not inside a whole room), exactly like
//! `rule_defs_current.rs`'s own threshold test.

use sim::generated::defs;
use sim::rules::testing::SiteBuilder;
use sim::rules::{Cell, RuleDef, evaluate};

fn tag_id(key: &str) -> u32 {
    defs::TAGS
        .iter()
        .find(|t| t.key == key)
        .unwrap_or_else(|| panic!("defs/tags/*.toml must still declare tag '{key}'"))
        .id
}

fn rule(key: &str) -> RuleDef {
    *defs::RULES
        .iter()
        .find(|r| r.key == key)
        .unwrap_or_else(|| panic!("defs/rules/grammar.toml must still declare rule '{key}'"))
}

/// `defs/rules/grammar.toml`'s own seven rows -- never city.toml's
/// placeholder rows about unrelated content (a room built purely from
/// role tags never carries a waste bin or a shopfront).
fn grammar_rules() -> Vec<RuleDef> {
    let keys = [
        "road_never_touches_floor",
        "road_never_touches_wall",
        "floor_never_touches_bare_ground",
        "floor_never_touches_pavement_directly",
        "floor_never_touches_road_directly",
        "threshold_between_floor_and_pavement_flanked_by_walls",
        "wall_is_part_of_a_straight_run_or_a_corner",
    ];
    keys.iter().map(|k| rule(k)).collect()
}

/// A closed 4x3 wall ring (Artie's own worked example size) with a floor
/// interior, plus a street fragment along its south side: a strip of
/// pavement immediately south of the wall, and a strip of road south of
/// that -- "a building faces pavement, pavement then road" (Artie's
/// direction #7).
fn well_formed_room_and_street() -> sim::rules::testing::Site {
    let wall = tag_id("wall");
    let floor = tag_id("floor");
    let pavement = tag_id("pavement");
    let road = tag_id("road");

    let mut b = SiteBuilder::new();
    for x in 0..4 {
        for y in 0..3 {
            let cell = Cell::new(x, y, 0);
            let on_perimeter = x == 0 || y == 0 || x == 3 || y == 2;
            let tag = if on_perimeter { wall } else { floor };
            b = b.cell(cell, &[tag]);
        }
    }
    for x in 0..4 {
        b = b.cell(Cell::new(x, 3, 0), &[pavement]);
        b = b.cell(Cell::new(x, 4, 0), &[road]);
    }
    b.build()
}

#[test]
fn a_well_formed_room_and_street_fragment_has_zero_violations() {
    let site = well_formed_room_and_street();
    assert_eq!(evaluate(&grammar_rules(), &site), vec![]);
}

/// AC4: a broken variant of the well-formed composition, one grammar row
/// at a time, is rejected with exactly that row's own key -- never a
/// different one.
#[test]
fn a_wall_stub_is_rejected_with_the_wall_closure_rows_own_key() {
    let wall = tag_id("wall");
    let floor = tag_id("floor");
    let mut b = SiteBuilder::new();
    for x in 0..4 {
        for y in 0..3 {
            let cell = Cell::new(x, y, 0);
            if cell == Cell::new(1, 0, 0) {
                continue; // a gap in the north wall -- a free-standing stub either side of it
            }
            let on_perimeter = x == 0 || y == 0 || x == 3 || y == 2;
            let tag = if on_perimeter { wall } else { floor };
            b = b.cell(cell, &[tag]);
        }
    }
    let violations = evaluate(&grammar_rules(), &b.build());
    assert!(!violations.is_empty());
    let expected_id = rule("wall_is_part_of_a_straight_run_or_a_corner").id;
    assert!(violations.iter().all(|v| v.rule_id == expected_id));
}

#[test]
fn a_floor_cell_open_directly_onto_ground_is_rejected_naming_the_pair() {
    let wall = tag_id("wall");
    let floor = tag_id("floor");
    let ground = tag_id("ground");
    let room = Cell::new(1, 1, 0);
    let outside = Cell::new(2, 1, 0);
    let site = SiteBuilder::new()
        .cell(room, &[floor])
        .cell(Cell::new(1, 0, 0), &[wall])
        .cell(Cell::new(0, 1, 0), &[wall])
        .cell(Cell::new(1, 2, 0), &[wall])
        .cell(outside, &[ground])
        .build();
    let rule = rule("floor_never_touches_bare_ground");
    assert_eq!(
        evaluate(&[rule], &site),
        vec![sim::rules::Violation {
            rule_id: rule.id,
            subject: room,
            other: Some(outside),
        }]
    );
}

#[test]
fn a_floor_cell_open_directly_onto_pavement_is_rejected() {
    let floor = tag_id("floor");
    let pavement = tag_id("pavement");
    let site = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[floor])
        .cell(Cell::new(1, 0, 0), &[pavement])
        .build();
    let rule = rule("floor_never_touches_pavement_directly");
    assert_eq!(evaluate(&[rule], &site).len(), 1);
    assert_eq!(evaluate(&[rule], &site)[0].rule_id, rule.id);
}

#[test]
fn a_floor_cell_open_directly_onto_road_is_rejected() {
    let floor = tag_id("floor");
    let road = tag_id("road");
    let site = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[floor])
        .cell(Cell::new(1, 0, 0), &[road])
        .build();
    let rule = rule("floor_never_touches_road_directly");
    assert_eq!(evaluate(&[rule], &site).len(), 1);
    assert_eq!(evaluate(&[rule], &site)[0].rule_id, rule.id);
}

#[test]
fn a_road_cell_touching_a_building_wall_directly_is_rejected() {
    let road = tag_id("road");
    let wall = tag_id("wall");
    let site = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[road])
        .cell(Cell::new(1, 0, 0), &[wall])
        .build();
    let rule = rule("road_never_touches_wall");
    assert_eq!(evaluate(&[rule], &site).len(), 1);
    assert_eq!(evaluate(&[rule], &site)[0].rule_id, rule.id);
}

#[test]
fn a_road_cell_touching_a_buildings_floor_directly_is_rejected() {
    let road = tag_id("road");
    let floor = tag_id("floor");
    let site = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[road])
        .cell(Cell::new(1, 0, 0), &[floor])
        .build();
    let rule = rule("road_never_touches_floor");
    assert_eq!(evaluate(&[rule], &site).len(), 1);
    assert_eq!(evaluate(&[rule], &site)[0].rule_id, rule.id);
}

/// The doorway primitive (AC3: "a doorway is formed rather than drawn"):
/// standalone, not inside the closed room above (see this file's own
/// header comment). A doorway opening onto another wall -- Artie's own
/// named rejection case -- is refused; opening onto floor/pavement with
/// walls on both flanks is accepted.
#[test]
fn a_doorway_opening_onto_another_wall_is_rejected_but_a_real_doorway_is_accepted() {
    let threshold = tag_id("threshold");
    let wall = tag_id("wall");
    let floor = tag_id("floor");
    let pavement = tag_id("pavement");
    let rule = rule("threshold_between_floor_and_pavement_flanked_by_walls");

    let opens_onto_a_wall = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[threshold])
        .cell(Cell::new(-1, 0, 0), &[wall])
        .cell(Cell::new(1, 0, 0), &[wall])
        .cell(Cell::new(0, -1, 0), &[wall])
        .build();
    assert!(!evaluate(&[rule], &opens_onto_a_wall).is_empty());

    let a_real_doorway = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[threshold])
        .cell(Cell::new(-1, 0, 0), &[wall])
        .cell(Cell::new(1, 0, 0), &[wall])
        .cell(Cell::new(0, -1, 0), &[floor])
        .cell(Cell::new(0, 1, 0), &[pavement])
        .build();
    assert!(evaluate(&[rule], &a_real_doorway).is_empty());
}
