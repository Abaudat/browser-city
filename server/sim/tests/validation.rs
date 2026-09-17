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
//! (no real `shopfront` neighbour is ever placed, and the one real
//! object that carries `shopfront` also carries `wall`, which would
//! trip the same two Requirement rows anyway): none of these are hidden
//! -- they are genuine, already-committed content rules firing honestly
//! on real content, not test noise, so the broken variants below include
//! them all in their expected sets. `docs/trace-matrix.md` records the
//! "real door joins the correct block" half as `deferred` to #300, and
//! that a `counter`/`wall` row can never have a real, non-violating
//! subject in the correct block until it lands either (see
//! `the_correct_block_gives_every_achievable_rule_at_least_one_subject_cell`
//! below).
//!
//! Each floor below is independent (never sharing an area or an
//! adjacency with another floor's content), so the four breaks can be
//! combined into one candidate with no incidental cross-talk, and each
//! isolated variant is exactly the correct block plus that break's own
//! floor (and, for the sealed-ring/narrow-passage breaks, their own
//! building area).

mod support;

use sim::rules::{Cell, RuleKind, RuleSite, TagId};
use sim::validation::{
    Candidate, Check, Defect, FloorWindow, Location, PlacedSite, ValidationError, validate,
};
use sim::world::chunk_key;
use sim::world::walkability::{self, Placement};
use sim::world::{AreaSpec, Rect};

const BASELINE_FLOOR: i8 = 0;
const LIGHTING_FLOOR: i8 = 10;
const STAIRWELL_FLOOR: i8 = 2;
const SEALED_RING_FLOOR: i8 = 3;
const NARROW_PASSAGE_FLOOR: i8 = 4;
/// A floor used only by the dedicated Requirement-fallback test below --
/// never combined with anything else, so it needs no `FloorWindow`.
const FALLBACK_FLOOR: i8 = 20;

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

/// The tag [`sim::rules::evaluate`] treats as "the subject" for any
/// `RuleKind` -- the tag it calls `site.subjects_in_area(None, ..)` with,
/// so a rule with zero cells of this tag anywhere can never fire and
/// never pass either; it simply has nothing to say. Exhaustively matched
/// (no `_ =>` arm), same discipline as `sim::rules::evaluate`'s own match
/// on this type: a sixth kind is a compile error here too.
fn subject_tag_of(kind: &RuleKind) -> TagId {
    match kind {
        RuleKind::Placement { subject, .. } => *subject,
        RuleKind::Distribution { subject, .. } => *subject,
        RuleKind::Coherence { subject, .. } => *subject,
        RuleKind::Adjacency { a, .. } => *a,
        RuleKind::Requirement { container, .. } => *container,
    }
}

/// Composes the walkability half of `sim::validation::validate` directly
/// (`rasterise` + `enclosed_regions`/`narrow_passages`, the same real
/// functions `validate` itself calls) so a broken variant's own expected
/// [`Defect`]s are *derived* from the real committed `trash_bin` collider
/// and `player_body_subcells(BALANCE)`, never a hand-typed sub-cell rect
/// (Quentin's direction): a collider or body-size tweak then fails this
/// file with a meaningful diff instead of an unexplained magic number.
fn walkability_defects_for(
    floor: i8,
    placements: &[Placement],
    window: &FloorWindow,
) -> Vec<Defect> {
    let grid = walkability::rasterise(
        window.bounds,
        floor,
        placements,
        sim::generated::defs::OBJECTS,
    )
    .unwrap();
    let (body_w, body_h) = walkability::player_body_subcells(sim::generated::defs::BALANCE);
    let mut defects = Vec::new();
    for finding in walkability::enclosed_regions(&grid, window.seed_x, window.seed_y).unwrap() {
        defects.push(Defect {
            check: Check::EnclosedRegion,
            location: Location::SubcellRect {
                floor,
                rect: finding.bounds,
            },
        });
    }
    for finding in
        walkability::narrow_passages(&grid, window.seed_x, window.seed_y, body_w, body_h).unwrap()
    {
        defects.push(Defect {
            check: Check::NarrowPassage,
            location: Location::SubcellRect {
                floor,
                rect: finding.bounds,
            },
        });
    }
    defects
}

// --- the correct block ------------------------------------------------

/// Every safe, real object the correct block places -- none of these
/// ever trips a committed rule on its own (Quentin's non-vacuousness
/// direction, to the extent today's real content allows it -- see this
/// file's own module doc and
/// `the_correct_block_gives_every_achievable_rule_at_least_one_subject_cell`
/// below for exactly which rules that is). The three `park_bench`es sit
/// within `waste_per_three_seating`'s own `max_distance` (12) of the one
/// `trash_bin`, giving that rule real `waste`/`seating` subjects that
/// satisfy its ratio and coverage checks rather than merely never firing
/// for lack of any subject at all.
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
        Placement {
            def_id: support::object_id("park_bench"),
            anchor_x: 18,
            anchor_y: 1,
            floor: BASELINE_FLOOR,
        },
        Placement {
            def_id: support::object_id("park_bench"),
            anchor_x: 22,
            anchor_y: 1,
            floor: BASELINE_FLOOR,
        },
        Placement {
            def_id: support::object_id("park_bench"),
            anchor_x: 20,
            anchor_y: 3,
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
            cell: Cell::new(0, 0, LIGHTING_FLOOR),
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
            cell: Cell::new(2, 0, STAIRWELL_FLOOR),
            other: None,
        },
    }];
    for x in 0..3 {
        defects.push(Defect {
            check: Check::Rule(support::rule("counter_faces_a_shopfront").id),
            location: Location::Cell {
                cell: Cell::new(x, 0, STAIRWELL_FLOOR),
                other: None,
            },
        });
    }
    defects
}

// --- break 3: a sealed wall ring -- enclosed_regions + building_has_an_
// entrance (Tim's direction). A closed, gapless 3x3 ring of real
// `wall_segment` objects, placed inside its own real `building_areas`
// entry that covers exactly its own footprint (Quentin's direction: the
// ring must be inside a real area, so `building_has_an_entrance` and
// `walled_room_has_waste_bin` fire through Requirement's ordinary
// per-area counting -- the area holds zero `entrance`/`waste` cells --
// never through the "container cell outside any real area" fallback,
// which the dedicated
// `a_wall_cell_outside_any_area_is_itself_a_violation_through_requirements_own_fallback`
// test below pins on its own).

const SEALED_RING_OWNER: u64 = 100;

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

fn sealed_ring_areas() -> Vec<AreaSpec> {
    vec![area(
        SEALED_RING_OWNER,
        SEALED_RING_FLOOR,
        Rect {
            x0: 0,
            y0: 0,
            x1: 3,
            y1: 3,
        },
    )]
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
/// `building_has_an_entrance` and `walled_room_has_waste_bin` both are.
/// A bare wall cell trips both at once; neither is hidden from the
/// expected set (see this file's own module doc).
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
                    cell: Cell::new(x, y, SEALED_RING_FLOOR),
                    other: None,
                },
            });
        }
    }
    defects.extend(walkability_defects_for(
        SEALED_RING_FLOOR,
        &sealed_ring_placements(),
        &sealed_ring_floor_window(),
    ));
    defects
}

// --- break 4: a doorway too narrow -- the same ring shape, one gap in
// the middle of the north wall, with a real `trash_bin` sitting in the
// gap: its own collider (centred, 8x8 of the cell's 16x16 sub-cells)
// leaves single-sub-cell margins a raw walker can still slip through
// (never `enclosed_regions`), but no `player_body_subcells`-wide window
// survives anywhere in the gap, cutting the interior off from
// `narrow_passages`' own eroded reachability. Also placed inside its own
// real building area, same reason as break 3.

const NARROW_PASSAGE_OWNER: u64 = 101;
const NARROW_PASSAGE_BASE: i32 = 10; // offset so this break's cells never collide with break 3's

fn narrow_passage_wall_cells() -> Vec<(i32, i32)> {
    sealed_ring_wall_cells()
        .into_iter()
        .filter(|&(x, y)| (x, y) != (1, 0)) // the gap: north-middle
        .collect()
}

fn narrow_passage_placements() -> Vec<Placement> {
    let base = NARROW_PASSAGE_BASE;
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

fn narrow_passage_areas() -> Vec<AreaSpec> {
    let base = NARROW_PASSAGE_BASE;
    vec![area(
        NARROW_PASSAGE_OWNER,
        NARROW_PASSAGE_FLOOR,
        Rect {
            x0: base,
            y0: base,
            x1: base + 3,
            y1: base + 3,
        },
    )]
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
    let base = NARROW_PASSAGE_BASE;
    let mut defects: Vec<Defect> = Vec::new();
    // Only `building_has_an_entrance` fires here, not `walled_room_has_
    // waste_bin` -- the gap's own `trash_bin` is a real `waste` cell
    // inside this ring's own area too, which genuinely satisfies that
    // Requirement row's own count (>= 1), the same real counting that
    // makes `sealed_ring` (no waste cell anywhere in its area) still
    // violate both.
    for (x, y) in narrow_passage_wall_cells() {
        defects.push(Defect {
            check: Check::Rule(support::rule("building_has_an_entrance").id),
            location: Location::Cell {
                cell: Cell::new(base + x, base + y, NARROW_PASSAGE_FLOOR),
                other: None,
            },
        });
    }
    // The two corners flanking the missing north-middle cell each lose
    // their own east/west `wall_run` neighbour and become stubs; the two
    // remaining side-middles and the two south corners keep a valid pair.
    for &(x, y) in &[(0, 0), (2, 0)] {
        defects.push(Defect {
            check: Check::Rule(support::rule("wall_is_part_of_a_straight_run_or_a_corner").id),
            location: Location::Cell {
                cell: Cell::new(base + x, base + y, NARROW_PASSAGE_FLOOR),
                other: None,
            },
        });
    }
    defects.extend(walkability_defects_for(
        NARROW_PASSAGE_FLOOR,
        &narrow_passage_placements(),
        &narrow_passage_floor_window(),
    ));
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

/// Quentin's direction: an explicit, named assertion of which committed
/// rules the correct block gives a real subject to, so a future defs
/// edit that silently stops exercising one of them fails loudly rather
/// than an ever-green `[] == []`. Only two of today's fifteen rows
/// qualify -- every other row's own subject/container tag (`wall`,
/// `counter`, `floor`, `road`, `ground`, `pavement`, `threshold`,
/// `entrance`) is either unplaceable today or, once placed (`wall`,
/// `counter`), always trips an unrelated already-committed rule too (see
/// this file's own module doc): giving it a subject here would trade the
/// block's own correctness for non-vacuousness, which is the wrong
/// trade.
#[test]
fn the_correct_block_gives_every_achievable_rule_at_least_one_subject_cell() {
    let placements = baseline_placements();
    let site = PlacedSite::build(&placements, &[], &[]).unwrap();

    let mut has_subject: Vec<&'static str> = sim::generated::defs::RULES
        .iter()
        .filter(|r| {
            !site
                .subjects_in_area(None, subject_tag_of(&r.kind))
                .is_empty()
        })
        .map(|r| r.key)
        .collect();
    has_subject.sort_unstable();

    let mut expected = vec!["lighting_ground_floor_only", "waste_per_three_seating"];
    expected.sort_unstable();
    assert_eq!(has_subject, expected);
}

#[test]
fn a_doorway_too_narrow_is_reported_and_only_it_changes_the_correct_block() {
    let mut placements = baseline_placements();
    placements.extend(narrow_passage_placements());
    let building_areas = narrow_passage_areas();
    let candidate = Candidate {
        defs_version: sim::generated::defs::DEFS_VERSION,
        placements: &placements,
        building_areas: &building_areas,
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
    let building_areas = sealed_ring_areas();
    let candidate = Candidate {
        defs_version: sim::generated::defs::DEFS_VERSION,
        placements: &placements,
        building_areas: &building_areas,
        room_areas: &[],
        floors: &[baseline_floor_window(), sealed_ring_floor_window()],
    };
    let mut expected = sealed_ring_defects();
    expected.sort();
    assert_eq!(validate(&candidate).unwrap(), expected);
}

/// Quentin's direction: pins the "container cell outside any real area"
/// half of Requirement's own documented behaviour on its own, in
/// isolation -- neither `sealed_ring`/`narrow_passage` above lean on it
/// any more, both give the ring a real area of its own.
#[test]
fn a_wall_cell_outside_any_area_is_itself_a_violation_through_requirements_own_fallback() {
    let placements = vec![Placement {
        def_id: support::object_id("wall_segment"),
        anchor_x: 0,
        anchor_y: 0,
        floor: FALLBACK_FLOOR,
    }];
    let candidate = Candidate {
        defs_version: sim::generated::defs::DEFS_VERSION,
        placements: &placements,
        building_areas: &[],
        room_areas: &[],
        floors: &[],
    };
    let mut expected: Vec<Defect> = wall_container_rule_keys()
        .into_iter()
        .map(|key| Defect {
            check: Check::Rule(support::rule(key).id),
            location: Location::Cell {
                cell: Cell::new(0, 0, FALLBACK_FLOOR),
                other: None,
            },
        })
        .collect();
    expected.push(Defect {
        check: Check::Rule(support::rule("wall_is_part_of_a_straight_run_or_a_corner").id),
        location: Location::Cell {
            cell: Cell::new(0, 0, FALLBACK_FLOOR),
            other: None,
        },
    });
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
    let mut building_areas = stairwell_break_areas();
    building_areas.extend(sealed_ring_areas());
    building_areas.extend(narrow_passage_areas());

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
            cell: Cell::new(0, 0, LIGHTING_FLOOR),
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
            cell: Cell::new(2, 0, STAIRWELL_FLOOR),
            other: Some(Cell::new(3, 0, STAIRWELL_FLOOR)),
        },
    };
    assert_eq!(
        defect.to_string(),
        format!(
            "no_counter_in_a_stairwell at (2, 0, {STAIRWELL_FLOOR}) <-> (3, 0, {STAIRWELL_FLOOR})"
        )
    );
}
