//! Runs `sim::world`'s real query functions against the canonical fixture
//! and checks them against `conformance_cases()`'s hand-typed answers
//! (`sim/src/world/fixture.rs`'s doc comment explains why those answers are
//! not derived from the functions under test). `bounds/tests/
//! world_fixture_current.rs` keeps the same two inputs serialised to
//! `fixtures/world-conformance.v1.json` current, for a future client suite
//! to read.

use sim::world::fixture::{canonical_world, conformance_cases};

#[test]
fn every_conformance_case_matches_the_real_world_queries() {
    let world = canonical_world();
    for case in conformance_cases() {
        assert_eq!(
            world.is_blocked(case.x, case.y, case.floor),
            case.expect_blocked,
            "is_blocked({}, {}, {}) mismatch",
            case.x,
            case.y,
            case.floor
        );

        let transition = world
            .transition_at(case.x, case.y, case.floor)
            .map(|t| (t.target_x, t.target_y, t.target_floor));
        assert_eq!(
            transition, case.expect_transition,
            "transition_at({}, {}, {}) mismatch",
            case.x, case.y, case.floor
        );

        let ownership = world.ownership_at(case.x, case.y, case.floor);
        assert_eq!(
            ownership.building_id, case.expect_building_id,
            "ownership_at({}, {}, {}).building_id mismatch",
            case.x, case.y, case.floor
        );
        assert_eq!(
            ownership.room_id, case.expect_room_id,
            "ownership_at({}, {}, {}).room_id mismatch",
            case.x, case.y, case.floor
        );
    }
}

/// Story 3.8 AC2 (FR135, NFR30): the tile rasterisation rule -- a tile is
/// blocked iff any collider touches it, half-open -- against the shared,
/// hand-typed `raster` case. The client asserts the same case in
/// `client/tests/unit/world/conformance.test.ts`; no code is shared.
#[test]
fn the_floor_grids_block_exactly_the_hand_typed_tiles_of_the_raster_case() {
    use sim::generated::defs::{ColliderRect, ObjectDef};
    use sim::world::fixture::raster_case;
    use sim::world::floor_grids;
    use sim::world::walkability::Placement;

    let case = raster_case();
    assert_eq!(
        case.subcells_per_cell,
        sim::generated::defs::COLLIDER_SUBCELLS_PER_CELL
    );
    let objects: Vec<ObjectDef> = case
        .defs
        .iter()
        .map(|d| ObjectDef {
            id: d.id,
            key: "",
            name: "",
            layer: 0,
            sprite: None,
            width: d.width,
            height: d.height,
            collider: d
                .collider
                .map(|(x0, y0, x1, y1)| ColliderRect { x0, y0, x1, y1 }),
            interact_at: None,
            grid: None,
            window: false,
            tags: &[],
        })
        .collect();
    let placements: Vec<Placement> = case
        .rows
        .iter()
        .map(|r| Placement {
            def_id: r.def_id,
            anchor_x: r.x,
            anchor_y: r.y,
            floor: r.floor,
        })
        .collect();
    let grids = floor_grids(case.bounds, &placements, &objects).unwrap();
    for floor in sim::generated::defs::MIN_FLOOR..=sim::generated::defs::MAX_FLOOR {
        let floor = floor as i8;
        let grid = &grids[&floor];
        for y in case.bounds.y0..case.bounds.y1 {
            for x in case.bounds.x0..case.bounds.x1 {
                assert_eq!(
                    grid.is_blocked(x, y),
                    case.blocked.contains(&(floor, x, y)),
                    "tile ({x}, {y}) on floor {floor}"
                );
            }
        }
    }
}
