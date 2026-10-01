//! Story 6.11 (FR95): an item instance is in exactly one of two forms, and
//! the pure decisions live in `sim::item_instance`.

use sim::codes::container_kind;
use sim::item_instance::{
    ContainerRef, Form, Held, ItemError, MAX_GRID_EXTENT, MovePlan, OFFSET_SUBCELLS, Placed,
    Placement, plan_move,
};
use sim::world::{ORIENTATIONS, chunk_key};

fn cupboard() -> ContainerRef {
    ContainerRef::new(container_kind::OBJECT, 9).unwrap()
}

fn placed(x: i32) -> Placement {
    Placement::Placed(Placed::new(x, -4, 0, (3, OFFSET_SUBCELLS - 1), 0).unwrap())
}

fn held(slot: (u8, u8)) -> Placement {
    Placement::Held(Held::new(cupboard(), slot, 0).unwrap())
}

#[test]
fn the_offset_resolution_is_the_colliders_own() {
    assert_eq!(
        OFFSET_SUBCELLS as i32,
        sim::generated::defs::COLLIDER_SUBCELLS_PER_CELL,
        "FR95: no second sub-tile constant"
    );
}

#[test]
fn an_offset_past_the_sub_cell_range_is_a_typed_error_never_clamped_or_wrapped() {
    assert!(Placed::new(0, 0, 0, (OFFSET_SUBCELLS - 1, OFFSET_SUBCELLS - 1), 0).is_ok());
    for bad in [(OFFSET_SUBCELLS, 0), (0, OFFSET_SUBCELLS), (255, 255)] {
        assert_eq!(
            Placed::new(0, 0, 0, bad, 0),
            Err(ItemError::OffsetOutOfRange { x: bad.0, y: bad.1 }),
            "FR95: offset {bad:?} is refused, not clamped"
        );
    }
}

#[test]
fn a_slot_past_the_grid_extent_is_a_typed_error_never_clamped_or_wrapped() {
    assert!(Held::new(cupboard(), (MAX_GRID_EXTENT - 1, MAX_GRID_EXTENT - 1), 0).is_ok());
    for bad in [(MAX_GRID_EXTENT, 0), (0, MAX_GRID_EXTENT), (255, 255)] {
        assert_eq!(
            Held::new(cupboard(), bad, 0),
            Err(ItemError::SlotOutOfRange { x: bad.0, y: bad.1 }),
            "FR95: slot {bad:?} is refused, not clamped"
        );
    }
}

#[test]
fn an_orientation_outside_the_facings_is_refused_in_both_forms() {
    assert_eq!(
        Placed::new(0, 0, 0, (0, 0), ORIENTATIONS),
        Err(ItemError::OrientationOutOfRange(ORIENTATIONS))
    );
    assert_eq!(
        Held::new(cupboard(), (0, 0), ORIENTATIONS),
        Err(ItemError::OrientationOutOfRange(ORIENTATIONS))
    );
}

#[test]
fn a_container_is_a_minted_kind_and_a_real_id() {
    assert_eq!(
        ContainerRef::new(99, 1),
        Err(ItemError::UnknownContainerKind(99))
    );
    assert_eq!(
        ContainerRef::new(container_kind::OBJECT, 0),
        Err(ItemError::ZeroContainerId)
    );
}

#[test]
fn moving_between_forms_is_one_delete_and_one_insert() {
    assert_eq!(
        plan_move(placed(0), held((1, 1))),
        MovePlan::Cross {
            delete: Form::Placed,
            insert: held((1, 1))
        },
        "FR95: leaving the world deletes the placed row and inserts the held one"
    );
    assert_eq!(
        plan_move(held((1, 1)), placed(7)),
        MovePlan::Cross {
            delete: Form::Held,
            insert: placed(7)
        },
        "FR95: entering the world deletes the held row and inserts the placed one"
    );
}

#[test]
fn moving_within_a_form_updates_in_place() {
    assert_eq!(plan_move(placed(0), placed(1)), MovePlan::Within(placed(1)));
    assert_eq!(
        plan_move(held((0, 0)), held((3, 3))),
        MovePlan::Within(held((3, 3)))
    );
}

/// FR95, second AC (structural half): no public fn of `sim::item_instance`
/// takes an object or prop, so nothing there can cascade. The schema half
/// is `item_instance_bounds.rs`'s column ban; the live half is deferred.
#[test]
fn no_public_item_instance_fn_takes_an_object_id_or_prop() {
    let source = include_str!("../src/item_instance.rs");
    for line in source
        .lines()
        .filter(|l| l.trim_start().starts_with("pub fn"))
    {
        let lower = line.to_lowercase();
        assert!(
            !lower.contains("object") && !lower.contains("prop"),
            "FR95: `{line}` takes an object or prop -- an object-to-items lookup invites a cascade"
        );
    }
}

#[test]
fn an_identity_move_plans_nothing() {
    assert_eq!(plan_move(placed(0), placed(0)), MovePlan::Nothing);
    assert_eq!(plan_move(held((1, 1)), held((1, 1))), MovePlan::Nothing);
}

#[test]
fn a_placed_item_derives_its_chunk_key_from_its_cell_and_floor() {
    let p = Placed::new(-33, 70, -1, (0, 0), 0).unwrap();
    assert_eq!(p.chunk_key(), chunk_key(-33, 70, -1));
}

/// FR95, fourth AC: state travels with the instance id, and a move never
/// names the identity row or any row keyed by the id -- a plan's forms are
/// only the two placement forms.
#[test]
fn a_move_plan_names_only_the_two_placement_forms() {
    for (a, b) in [
        (placed(0), held((0, 0))),
        (held((0, 0)), placed(0)),
        (placed(0), placed(1)),
    ] {
        match plan_move(a, b) {
            MovePlan::Cross { delete, insert } => {
                assert_eq!(delete, a.form());
                assert_ne!(delete, insert.form());
            }
            MovePlan::Within(p) => assert_eq!(p.form(), a.form()),
            MovePlan::Nothing => unreachable!("these pairs differ"),
        }
    }
}
