//! `WorldSpec::build`'s refusal paths: the only way to get a `World` with
//! a transition in it, so both ways it can refuse are checked directly
//! (the property in `tests/invariants.rs` covers the general case, but
//! never exercises "the target floor does not exist at all", since it
//! always declares the target floor first).

use sim::world::{FloorSpec, Rect, TransitionSpec, WorldSpec};

fn bounds() -> Rect {
    Rect {
        x0: 0,
        y0: 0,
        x1: 10,
        y1: 10,
    }
}

#[test]
fn refuses_a_transition_targeting_an_undeclared_floor() {
    let spec = WorldSpec {
        floors: vec![FloorSpec {
            floor: 0,
            bounds: bounds(),
            colliders: Vec::new(),
        }],
        transitions: vec![TransitionSpec {
            x: 1,
            y: 1,
            floor: 0,
            target_x: 1,
            target_y: 1,
            target_floor: 1, // never declared in `floors`
        }],
        building_areas: Vec::new(),
        room_areas: Vec::new(),
    };

    assert!(spec.build().is_err());
}

#[test]
fn refuses_a_transition_targeting_a_blocked_cell() {
    let spec = WorldSpec {
        floors: vec![FloorSpec {
            floor: 0,
            bounds: bounds(),
            colliders: vec![Rect {
                x0: 5,
                y0: 5,
                x1: 6,
                y1: 6,
            }],
        }],
        transitions: vec![TransitionSpec {
            x: 1,
            y: 1,
            floor: 0,
            target_x: 5,
            target_y: 5, // blocked
            target_floor: 0,
        }],
        building_areas: Vec::new(),
        room_areas: Vec::new(),
    };

    assert!(spec.build().is_err());
}

#[test]
fn accepts_a_transition_targeting_a_standable_cell() {
    let spec = WorldSpec {
        floors: vec![FloorSpec {
            floor: 0,
            bounds: bounds(),
            colliders: Vec::new(),
        }],
        transitions: vec![TransitionSpec {
            x: 1,
            y: 1,
            floor: 0,
            target_x: 5,
            target_y: 5,
            target_floor: 0,
        }],
        building_areas: Vec::new(),
        room_areas: Vec::new(),
    };

    let world = spec.build().expect("standable target must be accepted");
    assert_eq!(world.transition_at(1, 1, 0).unwrap().target_x, 5);
}
