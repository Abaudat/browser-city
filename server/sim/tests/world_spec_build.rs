//! `WorldSpec::build`'s refusal paths: the only way to get a `World` with
//! a transition in it, so both ways it can refuse are checked directly
//! (the property in `tests/invariants.rs` covers the general case, but
//! never exercises "the target floor does not exist at all", since it
//! always declares the target floor first).

use sim::world::{
    AreaSpec, FloorSpec, MAX_CELLS_PER_FLOOR, Rect, TransitionSpec, WorldSpec, chunk_key,
};

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

#[test]
fn refuses_a_transition_anchored_on_an_undeclared_floor() {
    let spec = WorldSpec {
        floors: vec![FloorSpec {
            floor: 0,
            bounds: bounds(),
            colliders: Vec::new(),
        }],
        transitions: vec![TransitionSpec {
            x: 1,
            y: 1,
            floor: 5, // never declared in `floors`
            target_x: 2,
            target_y: 2,
            target_floor: 0,
        }],
        building_areas: Vec::new(),
        room_areas: Vec::new(),
    };

    assert!(spec.build().is_err());
}

#[test]
fn refuses_a_transition_anchored_on_a_blocked_cell() {
    let spec = WorldSpec {
        floors: vec![FloorSpec {
            floor: 0,
            bounds: bounds(),
            colliders: vec![Rect {
                x0: 1,
                y0: 1,
                x1: 2,
                y1: 2,
            }],
        }],
        transitions: vec![TransitionSpec {
            x: 1,
            y: 1, // blocked
            floor: 0,
            target_x: 5,
            target_y: 5,
            target_floor: 0,
        }],
        building_areas: Vec::new(),
        room_areas: Vec::new(),
    };

    assert!(spec.build().is_err());
}

#[test]
fn refuses_a_floor_with_invalid_bounds() {
    let spec = WorldSpec {
        floors: vec![FloorSpec {
            floor: 0,
            bounds: Rect {
                x0: 5,
                y0: 5,
                x1: 5,
                y1: 5,
            },
            colliders: Vec::new(),
        }],
        transitions: Vec::new(),
        building_areas: Vec::new(),
        room_areas: Vec::new(),
    };

    assert!(spec.build().is_err());
}

#[test]
fn refuses_a_floor_over_the_max_cell_ceiling() {
    let side = (MAX_CELLS_PER_FLOOR as i64).isqrt() as i32 * 2 + 2;
    let spec = WorldSpec {
        floors: vec![FloorSpec {
            floor: 0,
            bounds: Rect {
                x0: 0,
                y0: 0,
                x1: side,
                y1: side,
            },
            colliders: Vec::new(),
        }],
        transitions: Vec::new(),
        building_areas: Vec::new(),
        room_areas: Vec::new(),
    };

    assert!(spec.build().is_err());
}

#[test]
fn refuses_an_area_whose_declared_chunk_key_does_not_match_its_rect() {
    let rect = Rect {
        x0: 1,
        y0: 1,
        x1: 2,
        y1: 2,
    };
    let spec = WorldSpec {
        floors: vec![FloorSpec {
            floor: 0,
            bounds: bounds(),
            colliders: Vec::new(),
        }],
        transitions: Vec::new(),
        building_areas: vec![AreaSpec {
            owner_id: 1,
            floor: 0,
            rect,
            chunk_key: chunk_key(rect.x0, rect.y0, 0) ^ 1, // deliberately wrong
        }],
        room_areas: Vec::new(),
    };

    assert!(spec.build().is_err());
}

#[test]
fn refuses_an_area_spanning_more_than_one_chunk() {
    // CHUNK_SIZE is 32: x0=30..x1=34 crosses the boundary at x=32.
    let rect = Rect {
        x0: 30,
        y0: 0,
        x1: 34,
        y1: 1,
    };
    let spec = WorldSpec {
        floors: vec![FloorSpec {
            floor: 0,
            bounds: Rect {
                x0: 0,
                y0: 0,
                x1: 40,
                y1: 10,
            },
            colliders: Vec::new(),
        }],
        transitions: Vec::new(),
        building_areas: vec![AreaSpec {
            owner_id: 1,
            floor: 0,
            rect,
            chunk_key: chunk_key(rect.x0, rect.y0, 0),
        }],
        room_areas: Vec::new(),
    };

    assert!(spec.build().is_err());
}

#[test]
fn refuses_two_overlapping_areas_of_the_same_kind() {
    let a = Rect {
        x0: 1,
        y0: 1,
        x1: 4,
        y1: 4,
    };
    let b = Rect {
        x0: 2,
        y0: 2,
        x1: 5,
        y1: 5,
    };
    let spec = WorldSpec {
        floors: vec![FloorSpec {
            floor: 0,
            bounds: bounds(),
            colliders: Vec::new(),
        }],
        transitions: Vec::new(),
        building_areas: vec![
            AreaSpec {
                owner_id: 1,
                floor: 0,
                rect: a,
                chunk_key: chunk_key(a.x0, a.y0, 0),
            },
            AreaSpec {
                owner_id: 2,
                floor: 0,
                rect: b,
                chunk_key: chunk_key(b.x0, b.y0, 0),
            },
        ],
        room_areas: Vec::new(),
    };

    assert!(spec.build().is_err());
}

#[test]
fn accepts_overlapping_areas_of_different_kinds() {
    // A room fully inside its building's footprint overlaps it -- that is
    // the ordinary case (FR119), not a conflict: only same-kind overlap is
    // refused.
    let building = Rect {
        x0: 0,
        y0: 0,
        x1: 5,
        y1: 5,
    };
    let room = Rect {
        x0: 1,
        y0: 1,
        x1: 4,
        y1: 4,
    };
    let spec = WorldSpec {
        floors: vec![FloorSpec {
            floor: 0,
            bounds: bounds(),
            colliders: Vec::new(),
        }],
        transitions: Vec::new(),
        building_areas: vec![AreaSpec {
            owner_id: 1,
            floor: 0,
            rect: building,
            chunk_key: chunk_key(building.x0, building.y0, 0),
        }],
        room_areas: vec![AreaSpec {
            owner_id: 1,
            floor: 0,
            rect: room,
            chunk_key: chunk_key(room.x0, room.y0, 0),
        }],
    };

    let world = spec
        .build()
        .expect("overlap across kinds is not a conflict");
    let ownership = world.ownership_at(2, 2, 0);
    assert_eq!(ownership.building_id, 1);
    assert_eq!(ownership.room_id, 1);
}
