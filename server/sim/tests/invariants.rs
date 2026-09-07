//! Registry of the invariants named across the architecture and requirements
//! (NFR25, NFR28, NFR29, and Story 0.16's acceptance criteria). Each constant
//! documents one invariant by its trace-matrix id. `docs/trace-matrix.md`
//! records, for every id here, whether it is `covered` (a test with the same
//! name exists) or `deferred` (the subsystem it protects does not exist yet).
//! `scripts/ci/check-trace-matrix.sh` fails the build if the two ever
//! disagree, so this file and the matrix cannot drift silently.

use proptest::prelude::*;
use sim::rng::{Rng, seed_from_ids};
use sim::world::{FloorCollision, FloorSpec, Rect, TransitionSpec, WorldSpec, chunk_key, fixture};

pub const INV_NO_MATTER_STARVES: &str = "no matter starves indefinitely";
pub const INV_INVENTORY_SUPERSET_AFTER_ABSENCE: &str = "inventory is a superset after any absence";
pub const INV_NO_OWNED_ITEM_DEGRADES_DURING_ABSENCE: &str = "no owned item degrades during absence";
pub const INV_BUDGET_NEVER_NEGATIVE: &str = "budget never goes negative";
pub const INV_COLLIDER_WITHIN_FOOTPRINT: &str = "collider is contained within footprint";
pub const INV_IDENTICAL_SEEDS_DERIVE_IDENTICALLY: &str =
    "two derivations from identical seeded inputs match";
pub const INV_COLLISION_ONLY_WITHIN_FLOOR: &str =
    "no cell on any other floor ever contributes to an entity's collision result";
pub const INV_FLOOR_TRANSITION_LANDS_STANDABLE: &str = "no transition cell ever targets a floor or cell where the entity would be inside geometry or out of bounds";
pub const INV_WORLD_QUERY_TOTAL: &str =
    "a world query never panics and never wraps, for any i32 coordinate and any floor or layer";
pub const INV_CELL_OWNERSHIP_DEFINED: &str =
    "every in-bounds cell answers the ownership query, and ids are stable across queries";

proptest! {
    /// `inv_identical_seeds_derive_identically`: the only invariant among the
    /// six that has a subsystem to test today (NFR25's pinned RNG). Two
    /// derivations from the same ids, run independently, must produce the
    /// same seed and the same output stream.
    #[test]
    fn inv_identical_seeds_derive_identically(a in any::<u64>(), b in any::<u64>(), n in 1usize..64) {
        let seed_1 = seed_from_ids(a, b);
        let seed_2 = seed_from_ids(a, b);
        prop_assert_eq!(seed_1, seed_2);

        let mut rng_1 = Rng::new(seed_1);
        let mut rng_2 = Rng::new(seed_2);
        let out_1: Vec<u64> = (0..n).map(|_| rng_1.next_u64()).collect();
        let out_2: Vec<u64> = (0..n).map(|_| rng_2.next_u64()).collect();
        prop_assert_eq!(out_1, out_2);
    }
}

/// A shared, generous extent for every generated floor in the properties
/// below.
fn floor_bounds() -> Rect {
    Rect {
        x0: 0,
        y0: 0,
        x1: 20,
        y1: 20,
    }
}

/// 0-3 small collider rects scattered within [`floor_bounds`].
fn small_rects() -> impl Strategy<Value = Vec<Rect>> {
    proptest::collection::vec(
        (0i32..16, 1i32..4, 0i32..16, 1i32..4).prop_map(|(x0, w, y0, h)| Rect {
            x0,
            y0,
            x1: x0 + w,
            y1: y0 + h,
        }),
        0..4,
    )
}

fn blocked_by(rects: &[Rect], x: i32, y: i32) -> bool {
    rects.iter().any(|r| r.contains(x, y))
}

proptest! {
    /// `inv_collision_only_within_floor`: an arbitrary floor 0 and floor 1,
    /// each with their own arbitrary colliders (which may cover the exact
    /// same cells), only ever influence their own floor's collision query
    /// -- floor 1's colliders never leak into floor 0's result, and floor
    /// 0's result matches an independent reference computed only from its
    /// own colliders.
    #[test]
    fn inv_collision_only_within_floor(
        floor_a_colliders in small_rects(),
        floor_b_colliders in small_rects(),
        x in 0i32..20,
        y in 0i32..20,
    ) {
        let spec = WorldSpec {
            floors: vec![
                FloorSpec { floor: 0, bounds: floor_bounds(), colliders: floor_a_colliders.clone() },
                FloorSpec { floor: 1, bounds: floor_bounds(), colliders: floor_b_colliders },
            ],
            transitions: Vec::new(),
            building_areas: Vec::new(),
            room_areas: Vec::new(),
        };
        let world = spec.build().expect("no transitions declared, so build cannot fail");

        prop_assert_eq!(world.is_blocked(x, y, 0), blocked_by(&floor_a_colliders, x, y));
    }

    /// `inv_floor_transition_lands_standable`: `WorldSpec::build` accepts a
    /// candidate transition if and only if its target is standable on the
    /// target floor -- there is no other path to a `World` carrying a
    /// transition, so a player falling out of the world through one is
    /// impossible by construction.
    #[test]
    fn inv_floor_transition_lands_standable(
        colliders in small_rects(),
        target_x in -5i32..25,
        target_y in -5i32..25,
    ) {
        let bounds = floor_bounds();
        let spec = WorldSpec {
            floors: vec![FloorSpec { floor: 0, bounds, colliders: colliders.clone() }],
            transitions: vec![TransitionSpec {
                x: 100,
                y: 100,
                floor: 5,
                target_x,
                target_y,
                target_floor: 0,
            }],
            building_areas: Vec::new(),
            room_areas: Vec::new(),
        };

        let reference = FloorCollision::build(bounds, &colliders);
        let should_succeed = reference.is_standable(target_x, target_y);

        match spec.build() {
            Ok(world) => {
                prop_assert!(should_succeed);
                prop_assert!(!world.is_blocked(target_x, target_y, 0));
            }
            Err(_) => prop_assert!(!should_succeed),
        }
    }

    /// `inv_world_query_total`: every world query is total over arbitrary
    /// `i32` coordinates and `i8`/`u32` floor/layer indices, including
    /// `MIN`/`MAX` -- never a panic, never a wrapping-arithmetic abort
    /// (the published profile runs with `overflow-checks` on).
    #[test]
    fn inv_world_query_total(x in any::<i32>(), y in any::<i32>(), floor in any::<i8>(), _layer in any::<u32>()) {
        let world = fixture::canonical_world();
        let _ = world.is_blocked(x, y, floor);
        let _ = world.transition_at(x, y, floor);
        let _ = world.ownership_at(x, y, floor);
        let _ = chunk_key(x, y, floor);
    }

    /// `inv_cell_ownership_defined`: the ownership query is total (it
    /// returns an `Ownership`, never an `Option`) and two calls with the
    /// same input always agree.
    #[test]
    fn inv_cell_ownership_defined(x in any::<i32>(), y in any::<i32>(), floor in any::<i8>()) {
        let world = fixture::canonical_world();
        let first = world.ownership_at(x, y, floor);
        let second = world.ownership_at(x, y, floor);
        prop_assert_eq!(first, second);
    }
}
