//! Story 5.3 (FR58): a chunk crossing along a leg is a pure function of the
//! route -- the instants are L3's, the placements `plan_move`'s. Story 5.5
//! arms it against real transits; 5.18 reads `crossings_per_route`.

use proptest::prelude::*;
use sim::actor_location::{
    Placement, Waypoint, crossings, crossings_per_route, crossings_per_walking_hour_milli,
    leg_instants,
};
use sim::world::{CHUNK_SIZE, chunk_key};

fn route() -> impl Strategy<Value = Vec<Waypoint>> {
    prop::collection::vec((-100i32..100, -100i32..100, -1i8..=2), 1..6)
}

proptest! {
    /// Replaying every crossing leaves the actor where `chunk_key` of the
    /// route's end says, and no crossing repeats the placement before it.
    #[test]
    fn crossings_end_at_the_routes_end_and_each_changes_the_placement(
        r in route(), depart in 0i64..10_000, len in 1i64..100_000,
    ) {
        let out = crossings(&r, depart, depart + len, None);
        let (x, y, f) = *r.last().unwrap();
        let last = out.last().unwrap();
        prop_assert_eq!(last.placement, Placement { chunk_key: chunk_key(x, y, f), floor: f });
        let mut prev = None;
        let mut at = i64::MIN;
        for c in &out {
            prop_assert_ne!(Some(c.placement), prev);
            prop_assert!(c.at >= at);
            prop_assert!(c.at >= depart && c.at <= depart + len);
            prev = Some(c.placement);
            at = c.at;
        }
    }

    /// A route inside one chunk and one floor has no crossing.
    #[test]
    fn a_route_inside_one_chunk_never_crosses(
        cx in -5i32..5, cy in -5i32..5,
        pts in prop::collection::vec((0..CHUNK_SIZE, 0..CHUNK_SIZE), 1..6),
        len in 1i64..100_000,
    ) {
        let r: Vec<Waypoint> = pts
            .iter()
            .map(|(x, y)| (cx * CHUNK_SIZE + x, cy * CHUNK_SIZE + y, 0))
            .collect();
        prop_assert_eq!(crossings_per_route(&r), 0);
        prop_assert_eq!(crossings(&r, 0, len, None).len(), 1);
    }

    /// Instants never decrease, and end exactly at the arrival.
    #[test]
    fn leg_instants_are_monotone_and_span_the_leg(
        r in route(), depart in 0i64..10_000, len in 0i64..100_000,
    ) {
        let i = leg_instants(&r, depart, depart + len);
        prop_assert_eq!(i.len(), r.len());
        prop_assert!(i.windows(2).all(|w| w[0] <= w[1]));
        prop_assert_eq!(i[0], depart);
        if r.len() > 1 { prop_assert_eq!(*i.last().unwrap(), depart + len); }
    }
}

#[test]
fn a_straight_walk_east_crosses_once_per_chunk() {
    let r = [(0, 0, 0), (CHUNK_SIZE * 3, 0, 0)];
    assert_eq!(crossings_per_route(&r), 3);
    let out = crossings(&r, 0, 3 * CHUNK_SIZE as i64 * 1000, None);
    // The placement at departure, then one per boundary, at the instant the
    // cell becomes the boundary's: cell 32 is reached at 32 cells of 96.
    assert_eq!(out.len(), 4);
    let boundary_at = (CHUNK_SIZE as i64 * 3 * 1000) / 3;
    // Tile centres: the cell index passes 32 half a cell after 31.5.
    assert!(out[1].at >= boundary_at - 1000 && out[1].at <= boundary_at);
}

#[test]
fn a_floor_change_at_a_waypoint_is_a_write() {
    let r = [(5, 5, 0), (5, 5, 1)];
    assert_eq!(crossings_per_route(&r), 1);
}

#[test]
fn the_rate_scales_inversely_with_chunk_size() {
    // 2.2 cells/s for an hour is 7920 cells: 247.5 chunks of 32, 495 of 16.
    assert_eq!(crossings_per_walking_hour_milli(32, 2200), 247_500);
    assert_eq!(crossings_per_walking_hour_milli(16, 2200), 495_000);
}
