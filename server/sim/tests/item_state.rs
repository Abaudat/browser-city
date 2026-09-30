//! Story 6.11 (FR95): an item instance is in exactly one of two forms, and
//! the pure decisions live in `sim::item_instance`.

use sim::codes::container_kind;
use sim::item_instance::{
    ContainerRef, Form, Held, ItemError, MAX_GRID_EXTENT, MovePlan, OFFSET_SUBCELLS, ORIENTATIONS,
    Placed, Placement, plan_move,
};

fn cupboard() -> ContainerRef {
    ContainerRef::new(container_kind::OBJECT, 9).unwrap()
}

fn placed(x: i32) -> Placement {
    Placement::Placed(Placed::new(x, -4, 0, (3, 15), 0).unwrap())
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

/// FR95: an item in a cupboard never needed a world position, so the held
/// form exposes a slot and a container and nothing else.
#[test]
fn a_held_item_has_a_slot_and_no_world_position() {
    let Placement::Held(h) = held((2, 5)) else {
        unreachable!()
    };
    assert_eq!(h.slot(), (2, 5));
    assert_eq!(h.container(), cupboard());
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

/// FR95, second AC: the object under a placed item is not the item's
/// business. Removing a prop from a fixture leaves the item's placement
/// byte-identical, and `sim::item_instance` has no function from an object
/// id to the items on it, so nothing can cascade -- adding one flips this
/// test on purpose.
#[test]
fn an_item_placed_over_a_prop_is_accepted_not_corrected_when_the_prop_goes() {
    let item = placed(5);
    let before = format!("{item:?}");
    let mut props = vec![(1u64, 5i32, -4i32), (2, 9, 9)];
    props.retain(|p| p.0 != 1);
    assert_eq!(props.len(), 1);
    assert_eq!(
        format!("{item:?}"),
        before,
        "FR95: a placed item is unchanged by the prop under it going away"
    );
    let source = include_str!("../src/item_instance.rs");
    let code: String = source
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        !code.contains("object_id") && !code.contains("fn items_on"),
        "FR95: sim exposes no object-id -> items lookup (it would invite a cascade)"
    );
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
        }
    }
}
