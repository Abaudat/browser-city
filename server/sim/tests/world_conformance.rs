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
