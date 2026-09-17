//! Story 2.9 (AC2/AC3/AC4, FR119): the "harness" Tim's direction names --
//! story 2.11's real harness is not built yet, so this is `evaluate` run
//! over `testing::Site`, exactly like every other rule-defs acceptance
//! test, but at *room and building* scale rather than one isolated pair.
//! Runs the real generated `RULES`/`TAGS` (`sim::generated::defs`), never
//! a hand-written copy.
//!
//! One well-formed composition -- a 4x3 room and building, with a real
//! doorway, facing pavement then road -- with zero violations across
//! [`support::grammar_rules`] (every committed rule whose own subject
//! tag has a role), and one broken variant per `defs/rules/grammar.toml`
//! row, each asserting the exact `Vec<Violation>` (Tim's direction).
//! Per-row unit coverage in isolation also lives in
//! `rule_defs_current.rs`; this file is the room/building-scale
//! integration several rows cooperate over one composition, not one row
//! at a time.

mod support;

use sim::rules::{Cell, Violation, evaluate};
use support::{grammar_rules, rule, tag_id};

const BUILDING_AREA: u64 = 1;
const ROOM_AREA: u64 = 2;

/// A 4x3 room and building: a closed wall ring except one south-wall
/// cell (non-corner) formed into a doorway, floor inside, a waste bin
/// (satisfies the pre-existing `walled_room_has_waste_bin` row, whose
/// own `container = "wall"` makes it a "subject has a role" row too --
/// see `support::grammar_rules`'s own doc comment), pavement immediately
/// outside the door, and road beyond that (Artie's direction: "a
/// building faces pavement, pavement then road").
fn well_formed_room_and_building() -> sim::rules::testing::Site {
    let wall = tag_id("wall");
    let wall_run = tag_id("wall_run");
    let floor = tag_id("floor");
    let threshold = tag_id("threshold");
    let entrance = tag_id("entrance");
    let pavement = tag_id("pavement");
    let road = tag_id("road");
    let waste = tag_id("waste");

    let door = Cell::new(1, 2, 0);
    let mut b = sim::rules::testing::SiteBuilder::new();
    for x in 0..4 {
        for y in 0..3 {
            let cell = Cell::new(x, y, 0);
            let on_perimeter = x == 0 || y == 0 || x == 3 || y == 2;
            if cell == door {
                b = b
                    .cell(cell, &[threshold, wall_run, entrance])
                    .area(cell, BUILDING_AREA)
                    .area(cell, ROOM_AREA);
            } else if on_perimeter {
                b = b.cell(cell, &[wall, wall_run]).area(cell, BUILDING_AREA);
            } else {
                b = b
                    .cell(cell, &[floor])
                    .area(cell, BUILDING_AREA)
                    .area(cell, ROOM_AREA);
            }
        }
    }
    b = b
        .cell(Cell::new(2, 1, 0), &[waste])
        .area(Cell::new(2, 1, 0), BUILDING_AREA)
        .cell(Cell::new(1, 3, 0), &[pavement])
        .cell(Cell::new(1, 4, 0), &[road]);
    b.build()
}

#[test]
fn a_well_formed_room_and_building_has_zero_violations() {
    let site = well_formed_room_and_building();
    assert_eq!(evaluate(&grammar_rules(), &site), vec![]);
}

#[test]
fn dropping_a_wall_cell_leaves_its_two_neighbours_as_free_standing_stubs() {
    let wall = tag_id("wall");
    let wall_run = tag_id("wall_run");
    let dropped = Cell::new(1, 0, 0);
    let mut b = sim::rules::testing::SiteBuilder::new();
    for x in 0..4 {
        for y in 0..3 {
            let cell = Cell::new(x, y, 0);
            if cell == dropped {
                continue;
            }
            let on_perimeter = x == 0 || y == 0 || x == 3 || y == 2;
            if on_perimeter {
                b = b.cell(cell, &[wall, wall_run]);
            }
        }
    }
    let rule = rule("wall_is_part_of_a_straight_run_or_a_corner");
    assert_eq!(
        evaluate(&[rule], &b.build()),
        vec![
            Violation {
                rule_id: rule.id,
                subject: Cell::new(0, 0, 0),
                other: None,
            },
            Violation {
                rule_id: rule.id,
                subject: Cell::new(2, 0, 0),
                other: None,
            },
        ]
    );
}

/// AC3: a wall with three or four `wall_run` neighbours (a T-junction or
/// a four-way crossing) is never rejected -- an alternative only
/// constrains the two sides it names. Only the centre cell is asserted:
/// its own three/four arm-end cells are genuine one-neighbour stubs in
/// this deliberately minimal fixture, not what this test is about.
#[test]
fn a_wall_t_junction_and_a_four_way_crossing_both_pass() {
    let wall = tag_id("wall");
    let wall_run = tag_id("wall_run");
    let rule = rule("wall_is_part_of_a_straight_run_or_a_corner");
    let centre = Cell::new(0, 0, 0);

    let t_junction = sim::rules::testing::SiteBuilder::new()
        .cell(centre, &[wall, wall_run])
        .cell(Cell::new(-1, 0, 0), &[wall, wall_run])
        .cell(Cell::new(1, 0, 0), &[wall, wall_run])
        .cell(Cell::new(0, 1, 0), &[wall, wall_run])
        .build();
    assert!(
        evaluate(&[rule], &t_junction)
            .iter()
            .all(|v| v.subject != centre)
    );

    let four_way = sim::rules::testing::SiteBuilder::new()
        .cell(centre, &[wall, wall_run])
        .cell(Cell::new(-1, 0, 0), &[wall, wall_run])
        .cell(Cell::new(1, 0, 0), &[wall, wall_run])
        .cell(Cell::new(0, 1, 0), &[wall, wall_run])
        .cell(Cell::new(0, -1, 0), &[wall, wall_run])
        .build();
    assert!(
        evaluate(&[rule], &four_way)
            .iter()
            .all(|v| v.subject != centre)
    );
}

#[test]
fn a_floor_cell_open_directly_onto_ground_is_rejected_naming_the_pair() {
    let wall = tag_id("wall");
    let floor = tag_id("floor");
    let ground = tag_id("ground");
    let room = Cell::new(1, 1, 0);
    let outside = Cell::new(2, 1, 0);
    let site = sim::rules::testing::SiteBuilder::new()
        .cell(room, &[floor])
        .cell(Cell::new(1, 0, 0), &[wall])
        .cell(Cell::new(0, 1, 0), &[wall])
        .cell(Cell::new(1, 2, 0), &[wall])
        .cell(outside, &[ground])
        .build();
    let rule = rule("floor_never_touches_bare_ground");
    assert_eq!(
        evaluate(&[rule], &site),
        vec![Violation {
            rule_id: rule.id,
            subject: room,
            other: Some(outside),
        }]
    );
}

#[test]
fn a_floor_cell_open_directly_onto_pavement_is_rejected_naming_the_pair() {
    let floor = tag_id("floor");
    let pavement = tag_id("pavement");
    let room = Cell::new(0, 0, 0);
    let outside = Cell::new(1, 0, 0);
    let site = sim::rules::testing::SiteBuilder::new()
        .cell(room, &[floor])
        .cell(outside, &[pavement])
        .build();
    let rule = rule("floor_never_touches_pavement_directly");
    assert_eq!(
        evaluate(&[rule], &site),
        vec![Violation {
            rule_id: rule.id,
            subject: room,
            other: Some(outside),
        }]
    );
}

#[test]
fn a_floor_cell_open_directly_onto_road_is_rejected_naming_the_pair() {
    let floor = tag_id("floor");
    let road = tag_id("road");
    let room = Cell::new(0, 0, 0);
    let outside = Cell::new(1, 0, 0);
    let site = sim::rules::testing::SiteBuilder::new()
        .cell(room, &[floor])
        .cell(outside, &[road])
        .build();
    let rule = rule("floor_never_touches_road_directly");
    assert_eq!(
        evaluate(&[rule], &site),
        vec![Violation {
            rule_id: rule.id,
            subject: room,
            other: Some(outside),
        }]
    );
}

#[test]
fn a_road_cell_touching_a_building_wall_directly_is_rejected_naming_the_pair() {
    let road = tag_id("road");
    let wall = tag_id("wall");
    let street = Cell::new(0, 0, 0);
    let facade = Cell::new(1, 0, 0);
    let site = sim::rules::testing::SiteBuilder::new()
        .cell(street, &[road])
        .cell(facade, &[wall])
        .build();
    let rule = rule("road_never_touches_wall");
    assert_eq!(
        evaluate(&[rule], &site),
        vec![Violation {
            rule_id: rule.id,
            subject: street,
            other: Some(facade),
        }]
    );
}

#[test]
fn a_road_cell_touching_bare_ground_directly_is_rejected_naming_the_pair() {
    let road = tag_id("road");
    let ground = tag_id("ground");
    let street = Cell::new(0, 0, 0);
    let grass = Cell::new(1, 0, 0);
    let site = sim::rules::testing::SiteBuilder::new()
        .cell(street, &[road])
        .cell(grass, &[ground])
        .build();
    let rule = rule("road_never_touches_ground");
    assert_eq!(
        evaluate(&[rule], &site),
        vec![Violation {
            rule_id: rule.id,
            subject: street,
            other: Some(grass),
        }]
    );
}

/// The doorway primitive (AC3: "a doorway is formed rather than
/// drawn"): opening onto another wall -- Artie's own named rejection
/// case -- is refused; opening onto floor+pavement (a street door) or
/// floor+floor (a door between two rooms) is accepted.
#[test]
fn a_doorway_opening_onto_another_wall_is_rejected_naming_the_cell() {
    let threshold = tag_id("threshold");
    let wall = tag_id("wall");
    let subject = Cell::new(0, 0, 0);
    let site = sim::rules::testing::SiteBuilder::new()
        .cell(subject, &[threshold])
        .cell(Cell::new(-1, 0, 0), &[wall])
        .cell(Cell::new(1, 0, 0), &[wall])
        .cell(Cell::new(0, -1, 0), &[wall])
        .build();
    let rule = rule("doorway_formed_between_walls");
    assert_eq!(
        evaluate(&[rule], &site),
        vec![Violation {
            rule_id: rule.id,
            subject,
            other: None,
        }]
    );
}

#[test]
fn a_street_doorway_and_an_interior_doorway_are_both_accepted() {
    let threshold = tag_id("threshold");
    let wall = tag_id("wall");
    let floor = tag_id("floor");
    let pavement = tag_id("pavement");
    let rule = rule("doorway_formed_between_walls");

    let street_door = sim::rules::testing::SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[threshold])
        .cell(Cell::new(-1, 0, 0), &[wall])
        .cell(Cell::new(1, 0, 0), &[wall])
        .cell(Cell::new(0, -1, 0), &[floor])
        .cell(Cell::new(0, 1, 0), &[pavement])
        .build();
    assert!(evaluate(&[rule], &street_door).is_empty());

    let interior_door = sim::rules::testing::SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[threshold])
        .cell(Cell::new(-1, 0, 0), &[wall])
        .cell(Cell::new(1, 0, 0), &[wall])
        .cell(Cell::new(0, -1, 0), &[floor])
        .cell(Cell::new(0, 1, 0), &[floor])
        .build();
    assert!(evaluate(&[rule], &interior_door).is_empty());
}

/// A doorway placed on a corner -- Tim/Artie's own named broken variant
/// -- is rejected: a corner has only two same-ring neighbours,
/// perpendicular, never the opposite pair every doorway alternative
/// needs.
#[test]
fn a_doorway_on_a_corner_is_rejected() {
    let wall = tag_id("wall");
    let wall_run = tag_id("wall_run");
    let threshold = tag_id("threshold");
    let corner = Cell::new(0, 0, 0);
    let site = sim::rules::testing::SiteBuilder::new()
        .cell(corner, &[threshold, wall_run])
        .cell(Cell::new(1, 0, 0), &[wall, wall_run])
        .cell(Cell::new(0, 1, 0), &[wall, wall_run])
        .build();
    let rule = rule("doorway_formed_between_walls");
    assert_eq!(
        evaluate(&[rule], &site),
        vec![Violation {
            rule_id: rule.id,
            subject: corner,
            other: None,
        }]
    );
}

#[test]
fn a_room_with_no_door_is_rejected() {
    let wall = tag_id("wall");
    let wall_run = tag_id("wall_run");
    let floor = tag_id("floor");
    let mut b = sim::rules::testing::SiteBuilder::new();
    for x in 0..4 {
        for y in 0..3 {
            let cell = Cell::new(x, y, 0);
            let on_perimeter = x == 0 || y == 0 || x == 3 || y == 2;
            if on_perimeter {
                b = b.cell(cell, &[wall, wall_run]).area(cell, BUILDING_AREA);
            } else {
                b = b.cell(cell, &[floor]).area(cell, ROOM_AREA);
            }
        }
    }
    let rule = rule("room_has_a_door");
    let violations = evaluate(&[rule], &b.build());
    assert!(!violations.is_empty());
    assert!(violations.iter().all(|v| v.rule_id == rule.id));
}

/// The same well-formed shape as [`well_formed_room_and_building`], but
/// its doorway carries `threshold` without `entrance` -- a real
/// doorway, just never opened onto the exterior by name.
#[test]
fn a_building_with_no_entrance_is_rejected() {
    let wall = tag_id("wall");
    let threshold = tag_id("threshold");
    let floor = tag_id("floor");
    let door = Cell::new(1, 2, 0);
    let mut b = sim::rules::testing::SiteBuilder::new();
    for x in 0..4 {
        for y in 0..3 {
            let cell = Cell::new(x, y, 0);
            let on_perimeter = x == 0 || y == 0 || x == 3 || y == 2;
            if cell == door {
                b = b.cell(cell, &[threshold]).area(cell, BUILDING_AREA);
            } else if on_perimeter {
                b = b.cell(cell, &[wall]).area(cell, BUILDING_AREA);
            } else {
                b = b.cell(cell, &[floor]).area(cell, BUILDING_AREA);
            }
        }
    }
    let rule = rule("building_has_an_entrance");
    let violations = evaluate(&[rule], &b.build());
    assert!(!violations.is_empty());
    assert!(violations.iter().all(|v| v.rule_id == rule.id));
}
