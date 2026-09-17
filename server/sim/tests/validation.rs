//! Story 2.11 (FR112): the acceptance fixture for `sim::validation`, over
//! the real committed rule set and real committed objects only -- Tim's
//! direction. No `fixtures/*.json` file (that directory is for
//! cross-implementation conformance, and the client never evaluates a
//! rule): every block here is composed in Rust, object keys resolved
//! through `support`.
//!
//! Assumption (Tim's direction, since #300 has not merged and no real
//! object carries `floor`/`threshold` today): the *correct* block is an
//! open street with no building at all -- a legal, real-object room
//! needs a real threshold object, which does not exist yet. Every wall
//! cell placed anywhere (any real object tagged `wall`) therefore always
//! trips both real `container = "wall"` rows -- `building_has_an_
//! entrance` and `walled_room_has_waste_bin` -- since no real `entrance`
//! or `waste` cell is ever placed inside a wall's own area either, and
//! every real `counter` cell always trips `counter_faces_a_shopfront`
//! (no real `shopfront` neighbour is ever placed): none of these are
//! hidden -- they are genuine, already-committed content rules firing
//! honestly on real content, not test noise, so the broken variants
//! below include them all in their expected sets. `docs/trace-matrix.md`
//! records the "real door joins the correct block" half as `deferred` to
//! #300.
//!
//! Each floor below is independent (never sharing an area or an
//! adjacency with another floor's content), so the four breaks can be
//! combined into one candidate with no incidental cross-talk, and each
//! isolated variant is exactly the correct block plus that break's own
//! floor.

mod support;

use sim::validation::{Candidate, Check, Defect, FloorWindow, Location, ValidationError, validate};
use sim::world::chunk_key;
use sim::world::walkability::Placement;
use sim::world::{AreaSpec, Rect};

const BASELINE_FLOOR: i8 = 0;
const LIGHTING_FLOOR: i8 = 10;
const STAIRWELL_FLOOR: i8 = 2;
const SEALED_RING_FLOOR: i8 = 3;
const NARROW_PASSAGE_FLOOR: i8 = 4;

fn area(owner_id: u64, floor: i8, rect: Rect) -> AreaSpec {
    AreaSpec {
        owner_id,
        floor,
        rect,
        chunk_key: chunk_key(rect.x0, rect.y0, floor),
    }
}

fn subcells(cells: i32) -> i32 {
    cells * sim::generated::defs::COLLIDER_SUBCELLS_PER_CELL
}

// --- the correct block ------------------------------------------------

/// Every safe, real object the correct block places -- none of these
/// ever trips a committed rule on its own (Quentin's non-vacuousness
/// direction, to the extent today's real content allows it: a lone
/// `wall`/`counter` cell cannot be placed at all without tripping an
/// unrelated, already-committed rule -- see this file's own module doc).
fn baseline_placements() -> Vec<Placement> {
    vec![
        Placement {
            def_id: support::object_id("lamppost"),
            anchor_x: 0,
            anchor_y: 0,
            floor: BASELINE_FLOOR,
        },
        Placement {
            def_id: support::object_id("foot_stairs"),
            anchor_x: 10,
            anchor_y: 0,
            floor: BASELINE_FLOOR,
        },
        Placement {
            def_id: support::object_id("trash_bin"),
            anchor_x: 20,
            anchor_y: 0,
            floor: BASELINE_FLOOR,
        },
    ]
}

fn baseline_floor_window() -> FloorWindow {
    FloorWindow {
        floor: BASELINE_FLOOR,
        bounds: Rect {
            x0: subcells(-10),
            y0: subcells(-10),
            x1: subcells(40),
            y1: subcells(10),
        },
        seed_x: subcells(-5),
        seed_y: subcells(-5),
    }
}

// --- break 1: lighting_ground_floor_only, a lamppost on floor 10 -------

fn lighting_break_placements() -> Vec<Placement> {
    vec![Placement {
        def_id: support::object_id("lamppost"),
        anchor_x: 0,
        anchor_y: 0,
        floor: LIGHTING_FLOOR,
    }]
}

fn lighting_break_defects() -> Vec<Defect> {
    vec![Defect {
        check: Check::Rule(support::rule("lighting_ground_floor_only").id),
        location: Location::Cell {
            cell: sim::rules::Cell::new(0, 0, LIGHTING_FLOOR),
            other: None,
        },
    }]
}

// --- break 2: no_counter_in_a_stairwell -- a counter sharing an area
// with a foot_stairs. A real `shop_counter` (width 3) always also trips
// `counter_faces_a_shopfront` (no `shopfront` neighbour exists anywhere
// in this fixture) -- honestly included, not hidden (see module doc).

fn stairwell_break_placements() -> Vec<Placement> {
    vec![
        Placement {
            def_id: support::object_id("shop_counter"),
            anchor_x: 0,
            anchor_y: 0,
            floor: STAIRWELL_FLOOR,
        },
        Placement {
            def_id: support::object_id("foot_stairs"),
            anchor_x: 3,
            anchor_y: 0,
            floor: STAIRWELL_FLOOR,
        },
    ]
}

/// Only the counter's own last footprint cell (2, 0) shares an area with
/// the stairs -- the first two footprint cells sit outside every area,
/// which `no_counter_in_a_stairwell` (a `Forbid` coherence row) never
/// violates (Coherence::Forbid's own documented rule).
fn stairwell_break_areas() -> Vec<AreaSpec> {
    vec![area(
        1,
        STAIRWELL_FLOOR,
        Rect {
            x0: 2,
            y0: 0,
            x1: 4,
            y1: 1,
        },
    )]
}

fn stairwell_break_defects() -> Vec<Defect> {
    let mut defects = vec![Defect {
        check: Check::Rule(support::rule("no_counter_in_a_stairwell").id),
        location: Location::Cell {
            cell: sim::rules::Cell::new(2, 0, STAIRWELL_FLOOR),
            other: None,
        },
    }];
    for x in 0..3 {
        defects.push(Defect {
            check: Check::Rule(support::rule("counter_faces_a_shopfront").id),
            location: Location::Cell {
                cell: sim::rules::Cell::new(x, 0, STAIRWELL_FLOOR),
                other: None,
            },
        });
    }
    defects
}

// --- break 3: a sealed wall ring -- enclosed_regions + building_has_an_
// entrance (Tim's direction). A closed, gapless 3x3 ring of real
// `wall_segment` objects: every wall cell sits outside every area, which
// `building_has_an_entrance` (a Requirement row) always violates
// unconditionally (Requirement's own documented rule) -- eight distinct
// subject cells, proving the harness never stops at the first (AC3).

fn sealed_ring_wall_cells() -> Vec<(i32, i32)> {
    let mut cells = Vec::new();
    for y in 0..3 {
        for x in 0..3 {
            if x == 1 && y == 1 {
                continue; // the interior, left empty and enclosed
            }
            cells.push((x, y));
        }
    }
    cells
}

fn sealed_ring_placements() -> Vec<Placement> {
    sealed_ring_wall_cells()
        .into_iter()
        .map(|(x, y)| Placement {
            def_id: support::object_id("wall_segment"),
            anchor_x: x,
            anchor_y: y,
            floor: SEALED_RING_FLOOR,
        })
        .collect()
}

fn sealed_ring_floor_window() -> FloorWindow {
    FloorWindow {
        floor: SEALED_RING_FLOOR,
        bounds: Rect {
            x0: subcells(-10),
            y0: subcells(-10),
            x1: subcells(10),
            y1: subcells(10),
        },
        seed_x: subcells(-5),
        seed_y: subcells(-5),
    }
}

/// Every real committed rule whose `container` is the `wall` tag --
/// `building_has_an_entrance` and `walled_room_has_waste_bin` both are --
/// fires unconditionally on a wall cell outside any area (Requirement's
/// own documented rule). A bare wall cell trips both at once; neither is
/// hidden from the expected set (see this file's own module doc).
fn wall_container_rule_keys() -> [&'static str; 2] {
    ["building_has_an_entrance", "walled_room_has_waste_bin"]
}

fn sealed_ring_defects() -> Vec<Defect> {
    let mut defects: Vec<Defect> = Vec::new();
    for (x, y) in sealed_ring_wall_cells() {
        for key in wall_container_rule_keys() {
            defects.push(Defect {
                check: Check::Rule(support::rule(key).id),
                location: Location::Cell {
                    cell: sim::rules::Cell::new(x, y, SEALED_RING_FLOOR),
                    other: None,
                },
            });
        }
    }
    defects.push(Defect {
        check: Check::EnclosedRegion,
        location: Location::SubcellRect {
            floor: SEALED_RING_FLOOR,
            rect: Rect {
                x0: subcells(1),
                y0: subcells(1),
                x1: subcells(2),
                y1: subcells(2),
            },
        },
    });
    defects
}

// --- break 4: a doorway too narrow -- the same ring shape, one gap in
// the middle of the north wall, with a real `trash_bin` sitting in the
// gap: its own collider (centred, 8x8 of the cell's 16x16 sub-cells)
// leaves single-sub-cell margins a raw walker can still slip through
// (never `enclosed_regions`), but no `player_body_subcells`-wide window
// survives anywhere in the gap, cutting the interior off from
// `narrow_passages`' own eroded reachability.

fn narrow_passage_wall_cells() -> Vec<(i32, i32)> {
    sealed_ring_wall_cells()
        .into_iter()
        .filter(|&(x, y)| (x, y) != (1, 0)) // the gap: north-middle
        .collect()
}

fn narrow_passage_placements() -> Vec<Placement> {
    let base = 10; // offset so this break's cells never collide with break 3's
    let mut placements: Vec<Placement> = narrow_passage_wall_cells()
        .into_iter()
        .map(|(x, y)| Placement {
            def_id: support::object_id("wall_segment"),
            anchor_x: base + x,
            anchor_y: base + y,
            floor: NARROW_PASSAGE_FLOOR,
        })
        .collect();
    placements.push(Placement {
        def_id: support::object_id("trash_bin"),
        anchor_x: base + 1,
        anchor_y: base,
        floor: NARROW_PASSAGE_FLOOR,
    });
    placements
}

fn narrow_passage_floor_window() -> FloorWindow {
    FloorWindow {
        floor: NARROW_PASSAGE_FLOOR,
        bounds: Rect {
            x0: 0,
            y0: 0,
            x1: subcells(25),
            y1: subcells(25),
        },
        seed_x: subcells(1),
        seed_y: subcells(1),
    }
}

fn narrow_passage_defects() -> Vec<Defect> {
    let base = 10;
    let mut defects: Vec<Defect> = Vec::new();
    for (x, y) in narrow_passage_wall_cells() {
        for key in wall_container_rule_keys() {
            defects.push(Defect {
                check: Check::Rule(support::rule(key).id),
                location: Location::Cell {
                    cell: sim::rules::Cell::new(base + x, base + y, NARROW_PASSAGE_FLOOR),
                    other: None,
                },
            });
        }
    }
    // The two corners flanking the missing north-middle cell each lose
    // their own east/west `wall_run` neighbour and become stubs; the two
    // remaining side-middles and the two south corners keep a valid pair
    // (see this file's own derivation in the story 2.11 PR description).
    for &(x, y) in &[(0, 0), (2, 0)] {
        defects.push(Defect {
            check: Check::Rule(support::rule("wall_is_part_of_a_straight_run_or_a_corner").id),
            location: Location::Cell {
                cell: sim::rules::Cell::new(base + x, base + y, NARROW_PASSAGE_FLOOR),
                other: None,
            },
        });
    }
    defects.push(Defect {
        check: Check::NarrowPassage,
        location: Location::SubcellRect {
            floor: NARROW_PASSAGE_FLOOR,
            rect: Rect {
                x0: subcells(base + 1),
                y0: subcells(base) + 12,
                x1: subcells(base + 1) + 9,
                y1: subcells(base) + 12 + 17,
            },
        },
    });
    defects
}

// --- the tests ----------------------------------------------------------

#[test]
fn correct_block_validates_with_no_defects() {
    let placements = baseline_placements();
    let candidate = Candidate {
        defs_version: sim::generated::defs::DEFS_VERSION,
        placements: &placements,
        building_areas: &[],
        room_areas: &[],
        floors: &[baseline_floor_window()],
    };
    assert_eq!(validate(&candidate).unwrap(), vec![]);
}

#[test]
fn a_doorway_too_narrow_is_reported_and_only_it_changes_the_correct_block() {
    let mut placements = baseline_placements();
    placements.extend(narrow_passage_placements());
    let candidate = Candidate {
        defs_version: sim::generated::defs::DEFS_VERSION,
        placements: &placements,
        building_areas: &[],
        room_areas: &[],
        floors: &[baseline_floor_window(), narrow_passage_floor_window()],
    };
    let mut expected = narrow_passage_defects();
    expected.sort();
    assert_eq!(validate(&candidate).unwrap(), expected);
}

#[test]
fn a_sealed_wall_ring_with_no_door_is_reported() {
    let mut placements = baseline_placements();
    placements.extend(sealed_ring_placements());
    let candidate = Candidate {
        defs_version: sim::generated::defs::DEFS_VERSION,
        placements: &placements,
        building_areas: &[],
        room_areas: &[],
        floors: &[baseline_floor_window(), sealed_ring_floor_window()],
    };
    let mut expected = sealed_ring_defects();
    expected.sort();
    assert_eq!(validate(&candidate).unwrap(), expected);
}

#[test]
fn a_counter_sharing_a_stairwells_area_is_reported() {
    let mut placements = baseline_placements();
    placements.extend(stairwell_break_placements());
    let building_areas = stairwell_break_areas();
    let candidate = Candidate {
        defs_version: sim::generated::defs::DEFS_VERSION,
        placements: &placements,
        building_areas: &building_areas,
        room_areas: &[],
        floors: &[baseline_floor_window()],
    };
    let mut expected = stairwell_break_defects();
    expected.sort();
    assert_eq!(validate(&candidate).unwrap(), expected);
}

#[test]
fn a_lamppost_above_the_ground_floor_is_reported() {
    let mut placements = baseline_placements();
    placements.extend(lighting_break_placements());
    let candidate = Candidate {
        defs_version: sim::generated::defs::DEFS_VERSION,
        placements: &placements,
        building_areas: &[],
        room_areas: &[],
        floors: &[baseline_floor_window()],
    };
    let mut expected = lighting_break_defects();
    expected.sort();
    assert_eq!(validate(&candidate).unwrap(), expected);
}

/// AC3: all four breaks combined in one candidate report every one of
/// them, with no short-circuit -- includes a rule
/// (`building_has_an_entrance`) violated at multiple distinct cells in
/// two different breaks at once, proving there is no per-rule or
/// per-block early exit.
#[test]
fn all_four_breaks_combined_report_every_defect_with_no_short_circuit() {
    let mut placements = baseline_placements();
    placements.extend(lighting_break_placements());
    placements.extend(stairwell_break_placements());
    placements.extend(sealed_ring_placements());
    placements.extend(narrow_passage_placements());
    let building_areas = stairwell_break_areas();

    let candidate = Candidate {
        defs_version: sim::generated::defs::DEFS_VERSION,
        placements: &placements,
        building_areas: &building_areas,
        room_areas: &[],
        floors: &[
            baseline_floor_window(),
            sealed_ring_floor_window(),
            narrow_passage_floor_window(),
        ],
    };

    let mut expected = Vec::new();
    expected.extend(lighting_break_defects());
    expected.extend(stairwell_break_defects());
    expected.extend(sealed_ring_defects());
    expected.extend(narrow_passage_defects());
    expected.sort();
    expected.dedup();

    let actual = validate(&candidate).unwrap();
    assert_eq!(actual, expected);

    // At least one rule violated at two different cells (Quentin's
    // direction): building_has_an_entrance fires on both the sealed-ring
    // and narrow-passage floors, at several distinct cells each.
    let entrance_rule_id = support::rule("building_has_an_entrance").id;
    let entrance_cells: std::collections::BTreeSet<_> = actual
        .iter()
        .filter(|d| d.check == Check::Rule(entrance_rule_id))
        .map(|d| d.location)
        .collect();
    assert!(entrance_cells.len() >= 2);
}

// --- AC1/AC4: the stamp mismatch ----------------------------------------

#[test]
fn a_candidate_stamped_with_a_foreign_defs_version_is_refused_not_silently_validated() {
    let placements = baseline_placements();
    let candidate = Candidate {
        defs_version: "0000000000000000",
        placements: &placements,
        building_areas: &[],
        room_areas: &[],
        floors: &[baseline_floor_window()],
    };
    assert_eq!(
        validate(&candidate),
        Err(ValidationError::RuleSourceMismatch {
            expected: sim::generated::defs::DEFS_VERSION,
            actual: "0000000000000000".to_string(),
        })
    );
}

#[test]
fn the_same_site_stamped_with_the_committed_version_validates_normally() {
    let placements = baseline_placements();
    let candidate = Candidate {
        defs_version: sim::generated::defs::DEFS_VERSION,
        placements: &placements,
        building_areas: &[],
        room_areas: &[],
        floors: &[baseline_floor_window()],
    };
    assert_eq!(validate(&candidate).unwrap(), vec![]);
}

// --- report rendering -----------------------------------------------------

#[test]
fn a_rule_defect_renders_the_rule_key_and_the_full_cell_location() {
    let defect = Defect {
        check: Check::Rule(support::rule("lighting_ground_floor_only").id),
        location: Location::Cell {
            cell: sim::rules::Cell::new(0, 0, LIGHTING_FLOOR),
            other: None,
        },
    };
    assert_eq!(
        defect.to_string(),
        format!("lighting_ground_floor_only at (0, 0, {LIGHTING_FLOOR})")
    );
}

#[test]
fn a_forbid_adjacency_defect_renders_the_other_cell_too() {
    let defect = Defect {
        check: Check::Rule(support::rule("no_counter_in_a_stairwell").id),
        location: Location::Cell {
            cell: sim::rules::Cell::new(2, 0, STAIRWELL_FLOOR),
            other: Some(sim::rules::Cell::new(3, 0, STAIRWELL_FLOOR)),
        },
    };
    assert_eq!(
        defect.to_string(),
        format!(
            "no_counter_in_a_stairwell at (2, 0, {STAIRWELL_FLOOR}) <-> (3, 0, {STAIRWELL_FLOOR})"
        )
    );
}
