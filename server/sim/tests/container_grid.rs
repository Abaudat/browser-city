//! Story 6.10 (FR94, FR95): the one container-fit rule. An item's footprint
//! in a grid is its world `bulk`, swapped on odd orientations; a placement
//! fits when every cell is in the grid and no other item covers one. Full
//! is a shape, never a count.

use sim::codes::container_kind;
use sim::container_grid::{
    FitError, Occupant, Store, can_ever_fit, first_fit, first_misfit, fits, footprint,
    needs_rotation, packing_forced, plan_store,
};
use sim::generated::defs::{ITEMS, MAX_FOOTPRINT_CELLS, OBJECTS};
use sim::item_instance::{
    ContainerRef, Form, Held, MAX_GRID_EXTENT, MAX_ITEMS_PER_CONTAINER, MovePlan, Placed, Placement,
};

fn occ(instance_id: u64, slot: (u8, u8), bulk: (u8, u8), orientation: u8) -> Occupant {
    Occupant {
        instance_id,
        slot,
        bulk,
        orientation,
    }
}

#[test]
fn a_three_by_two_item_covers_three_by_two_cells_and_two_by_three_when_rotated() {
    assert_eq!(footprint((3, 2), 0), (3, 2));
    assert_eq!(footprint((3, 2), 1), (2, 3));
    assert_eq!(footprint((3, 2), 2), (3, 2));
    assert_eq!(footprint((3, 2), 3), (2, 3));
}

#[test]
fn an_item_at_the_grid_edge_fits_and_one_cell_further_is_out_of_the_grid() {
    let grid = (4, 3);
    assert_eq!(fits(grid, &[], (3, 2), 0, (1, 1)), Ok(()));
    assert_eq!(fits(grid, &[], (3, 2), 0, (2, 1)), Err(FitError::OutOfGrid));
    assert_eq!(fits(grid, &[], (3, 2), 0, (1, 2)), Err(FitError::OutOfGrid));
    // Rotated, the same slot covers 2 wide by 3 tall.
    assert_eq!(fits(grid, &[], (3, 2), 1, (2, 0)), Ok(()));
    assert_eq!(fits(grid, &[], (3, 2), 1, (3, 0)), Err(FitError::OutOfGrid));
}

#[test]
fn two_items_overlapping_by_a_single_cell_are_refused_naming_the_occupant() {
    let grid = (4, 3);
    let held = [occ(7, (0, 0), (2, 2), 0)];
    assert_eq!(
        fits(grid, &held, (2, 1), 0, (1, 1)),
        Err(FitError::Overlaps { instance_id: 7 })
    );
    // Touching along an edge is not overlap.
    assert_eq!(fits(grid, &held, (2, 1), 0, (2, 0)), Ok(()));
    assert_eq!(fits(grid, &held, (2, 1), 0, (0, 2)), Ok(()));
}

#[test]
fn an_occupant_is_covered_by_its_own_rotation() {
    let grid = (4, 4);
    // A 3x1 item rotated once covers 1 wide by 3 tall.
    let held = [occ(1, (0, 0), (3, 1), 1)];
    assert_eq!(
        fits(grid, &held, (1, 1), 0, (0, 2)),
        Err(FitError::Overlaps { instance_id: 1 })
    );
    assert_eq!(fits(grid, &held, (1, 1), 0, (1, 2)), Ok(()));
}

#[test]
fn an_item_larger_than_the_grid_in_both_orientations_never_fits() {
    // The car-in-a-cupboard case: a synthetic footprint, not a car item.
    let car = (MAX_FOOTPRINT_CELLS as u8, MAX_FOOTPRINT_CELLS as u8);
    let cupboard = (4, 3);
    assert!(!can_ever_fit(cupboard, car));
    for o in 0..4 {
        for slot in [(0, 0), (3, 2)] {
            assert_eq!(
                fits(cupboard, &[], car, o, slot),
                Err(FitError::NeverFits),
                "orientation {o} slot {slot:?}"
            );
        }
    }
    assert_eq!(first_fit(cupboard, &[], car), None);
    // 4x3 into 3x4 fits only rotated: it can ever fit.
    assert!(can_ever_fit((3, 4), (4, 3)));
}

#[test]
fn full_by_shape_not_by_count_fragmented_free_cells_refuse_a_large_item() {
    let grid = (4, 3);
    // Free cells are plentiful (6 of 12) but split: columns 0 and 2 of
    // every row are taken by 1x3 posts, leaving two separate 1x3 strips...
    let posts = [occ(1, (0, 0), (1, 3), 0), occ(2, (2, 0), (1, 3), 0)];
    // ...a 2x2 item has area 4 <= 6 free cells but no placement, in
    // either orientation; a 1x2 item still goes in a strip.
    assert_eq!(first_fit(grid, &posts, (2, 2)), None);
    assert_eq!(first_fit(grid, &posts, (1, 2)), Some(((1, 0), 0)));
    for y in 0..3 {
        for x in 0..4 {
            for o in 0..2 {
                assert!(fits(grid, &posts, (2, 2), o, (x, y)).is_err());
            }
        }
    }
}

#[test]
fn a_grid_holding_one_large_item_is_full_with_a_count_of_one() {
    let grid = (4, 3);
    let one = [occ(1, (0, 0), (4, 3), 0)];
    assert_eq!(first_fit(grid, &one, (1, 1)), None);
    assert_eq!(
        fits(grid, &one, (1, 1), 0, (2, 1)),
        Err(FitError::Overlaps { instance_id: 1 })
    );
}

#[test]
fn first_fit_scans_row_major_trying_orientation_zero_then_one() {
    let grid = (3, 2);
    assert_eq!(first_fit(grid, &[], (2, 1)), Some(((0, 0), 0)));
    // The first cell is taken: the next column, still orientation 0.
    let held = [occ(1, (0, 0), (1, 1), 0)];
    assert_eq!(first_fit(grid, &held, (2, 1)), Some(((1, 0), 0)));
    // Orientation 0 overlaps at (0,0), so the rotated item is taken there.
    let held = [occ(1, (1, 0), (1, 1), 0)];
    assert_eq!(first_fit(grid, &held, (2, 1)), Some(((0, 0), 1)));
    // A 1x3 in a one-row grid is only reachable rotated.
    let grid = (3, 1);
    assert_eq!(first_fit(grid, &[], (1, 3)), Some(((0, 0), 1)));
}

#[test]
fn the_rule_reads_no_count_a_grid_of_one_by_one_items_fills_to_its_area() {
    let grid = (MAX_GRID_EXTENT, MAX_GRID_EXTENT);
    let mut held: Vec<Occupant> = Vec::new();
    let mut id = 1;
    while let Some((slot, o)) = first_fit(grid, &held, (1, 1)) {
        held.push(occ(id, slot, (1, 1), o));
        id += 1;
    }
    assert_eq!(held.len() as u64, u64::from(MAX_GRID_EXTENT).pow(2));
}

fn container() -> ContainerRef {
    ContainerRef::new(container_kind::OBJECT, 5).unwrap()
}

#[test]
fn a_store_that_fits_is_a_cross_move_from_the_world_into_the_container() {
    let world = Placement::Placed(Placed::new(1, 2, 0, (0, 0), 0).unwrap());
    let out = plan_store(world, container(), (4, 3), 9, &[], (2, 1), (1, 1), 0).unwrap();
    let want = Placement::Held(Held::new(container(), (1, 1), 0).unwrap());
    assert_eq!(
        out,
        Store::Stored(MovePlan::Cross {
            delete: Form::Placed,
            insert: want
        })
    );
}

#[test]
fn a_store_that_does_not_fit_writes_nothing_and_says_why() {
    let world = Placement::Placed(Placed::new(1, 2, 0, (0, 0), 0).unwrap());
    let held = [occ(3, (1, 1), (1, 1), 0)];
    assert_eq!(
        plan_store(world, container(), (4, 3), 9, &held, (2, 1), (1, 1), 0).unwrap(),
        Store::DoesNotFit(FitError::Overlaps { instance_id: 3 })
    );
    assert_eq!(
        plan_store(world, container(), (4, 3), 9, &held, (2, 1), (3, 0), 0).unwrap(),
        Store::DoesNotFit(FitError::OutOfGrid)
    );
}

#[test]
fn rotating_in_place_ignores_the_item_itself() {
    let here = Placement::Held(Held::new(container(), (0, 0), 0).unwrap());
    // The item is the only thing in a 3x2 grid and is 3x1: rotating it
    // to 1x3 does not fit (out of grid) but 2x... a 2x1 rotating to 1x2 does.
    let held = [occ(9, (0, 0), (2, 1), 0)];
    let out = plan_store(here, container(), (3, 2), 9, &held, (2, 1), (0, 0), 1).unwrap();
    let want = Placement::Held(Held::new(container(), (0, 0), 1).unwrap());
    assert_eq!(out, Store::Stored(MovePlan::Within(want)));
}

#[test]
fn a_bad_orientation_is_a_typed_error_never_a_store() {
    let world = Placement::Placed(Placed::new(1, 2, 0, (0, 0), 0).unwrap());
    assert!(plan_store(world, container(), (4, 3), 9, &[], (1, 1), (0, 0), 4).is_err());
}

// ---- the shipped defs ---------------------------------------------------

#[test]
fn every_shipped_container_grid_is_within_the_extent_and_the_count_cap() {
    let mut seen = 0;
    for o in OBJECTS {
        let Some(g) = o.grid else { continue };
        seen += 1;
        assert!(
            g.width >= 1 && g.width <= u32::from(MAX_GRID_EXTENT),
            "{}",
            o.key
        );
        assert!(
            g.height >= 1 && g.height <= u32::from(MAX_GRID_EXTENT),
            "{}",
            o.key
        );
        assert!(
            u64::from(g.width) * u64::from(g.height) <= MAX_ITEMS_PER_CONTAINER,
            "{}: the count cap must never be what makes a container full",
            o.key
        );
    }
    assert!(seen >= 4);
}

#[test]
fn the_shipped_containers_each_have_their_own_dimensions() {
    let dims = |key: &str| {
        let o = OBJECTS
            .iter()
            .find(|o| o.key == key)
            .unwrap_or_else(|| panic!("{key}"));
        let g = o.grid.unwrap_or_else(|| panic!("{key} has no grid"));
        (g.width, g.height)
    };
    let all = [dims("bag"), dims("cupboard"), dims("crate"), dims("pallet")];
    assert_eq!(all, [(3, 2), (4, 3), (4, 4), (8, 6)]);
    assert_eq!(dims("trash_bin"), (2, 3));
}

#[test]
fn the_item_def_carries_no_container_specific_size() {
    // An item's footprint in a grid is its world bulk: the def has exactly
    // width and height, and the fit rule is handed those unchanged.
    for i in ITEMS {
        assert!(i.width >= 1 && i.height >= 1);
        assert!(i.width as i64 <= MAX_FOOTPRINT_CELLS as i64);
    }
}

#[test]
fn the_fit_path_reads_no_count() {
    let src = include_str!("../src/container_grid.rs");
    let body = src.split("#[cfg(test)]").next().unwrap();
    for banned in [
        "MAX_ITEMS_PER_CONTAINER",
        ".len() >",
        ".len() <",
        ".len() ==",
    ] {
        assert!(
            !body.contains(banned),
            "container_grid reads a count: `{banned}`"
        );
    }
}

/// The reference shopping basket (Derek): a box, a loaf, a bottle crate
/// and three tins, largest first -- authored as data here, since no basket
/// item exists yet. It must pack into the shipped cupboard in one
/// first-fit pass with no rearrangement.
const SHOPPING_BASKET: &[(u8, u8)] = &[(2, 2), (2, 1), (1, 2), (1, 1), (1, 1), (1, 1)];

#[test]
fn a_reference_shopping_basket_fits_the_shipped_cupboard_in_one_first_fit_pass() {
    let cupboard = OBJECTS.iter().find(|o| o.key == "cupboard").unwrap();
    let g = cupboard.grid.unwrap();
    let grid = (g.width as u8, g.height as u8);
    let mut held: Vec<Occupant> = Vec::new();
    for (i, bulk) in SHOPPING_BASKET.iter().enumerate() {
        let (slot, o) = first_fit(grid, &held, *bulk)
            .unwrap_or_else(|| panic!("item {i} {bulk:?} did not fit: retune the grid"));
        held.push(occ(i as u64 + 1, slot, *bulk, o));
    }
    assert_eq!(held.len(), SHOPPING_BASKET.len());
}

#[test]
fn packing_is_forced_by_a_refusal_or_by_needing_a_rotation_and_by_nothing_else() {
    let grid = (3, 1);
    // A 1x3 item can only go in rotated: forced, though it fits.
    assert!(needs_rotation(grid, &[], (1, 3)));
    assert!(!needs_rotation(grid, &[], (3, 1)));
    let world = Placement::Placed(Placed::new(1, 2, 0, (0, 0), 0).unwrap());
    let stored = plan_store(world, container(), grid, 9, &[], (1, 3), (0, 0), 1).unwrap();
    assert!(matches!(stored, Store::Stored(_)));
    assert!(packing_forced(grid, 9, &[], (1, 3), &stored));
    // A plain store is not forced.
    let plain = plan_store(world, container(), grid, 9, &[], (1, 1), (0, 0), 0).unwrap();
    assert!(!packing_forced(grid, 9, &[], (1, 1), &plain));
    // A refusal is.
    let held = [occ(3, (0, 0), (1, 1), 0)];
    let refused = plan_store(world, container(), grid, 9, &held, (1, 1), (0, 0), 0).unwrap();
    assert!(packing_forced(grid, 9, &held, (1, 1), &refused));
}

#[test]
fn the_audit_names_the_first_row_that_leaves_the_grid_or_overlaps() {
    let grid = (4, 3);
    let ok = [occ(1, (0, 0), (2, 2), 0), occ(2, (2, 0), (2, 1), 0)];
    assert_eq!(first_misfit(grid, &ok), None);
    let out = [occ(1, (0, 0), (2, 2), 0), occ(2, (3, 0), (2, 1), 0)];
    assert_eq!(first_misfit(grid, &out), Some((2, FitError::OutOfGrid)));
    let over = [occ(1, (0, 0), (2, 2), 0), occ(2, (1, 1), (1, 1), 0)];
    assert_eq!(
        first_misfit(grid, &over),
        Some((2, FitError::Overlaps { instance_id: 1 }))
    );
}
