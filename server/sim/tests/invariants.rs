//! Registry of the invariants named across the architecture and requirements
//! (NFR25, NFR28, NFR29, and Story 0.16's acceptance criteria). Each constant
//! documents one invariant by its trace-matrix id. `docs/trace-matrix.md`
//! records, for every id here, whether it is `covered` (a test with the same
//! name exists) or `deferred` (the subsystem it protects does not exist yet).
//! `scripts/ci/check-trace-matrix.sh` fails the build if the two ever
//! disagree, so this file and the matrix cannot drift silently.

use proptest::prelude::*;
use sim::rng::{Rng, seed_from_ids};
use sim::world::{
    AreaSpec, FloorCollision, FloorSpec, NO_OWNER, Rect, TransitionSpec, WorldSpec, chunk_key,
    fixture,
};

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

/// 0-3 small collider rects scattered within a 16x16 region based at
/// `(base_x, base_y)`.
fn small_rects(base_x: i32, base_y: i32) -> impl Strategy<Value = Vec<Rect>> {
    proptest::collection::vec(
        (0i32..16, 1i32..4, 0i32..16, 1i32..4).prop_map(move |(dx, w, dy, h)| Rect {
            x0: base_x + dx,
            y0: base_y + dy,
            x1: base_x + dx + w,
            y1: base_y + dy + h,
        }),
        0..4,
    )
}

fn blocked_by(rects: &[Rect], x: i32, y: i32) -> bool {
    rects.iter().any(|r| r.contains(x, y))
}

/// Floor 0's extent for the properties below -- deliberately different
/// from [`floor_b_bounds`], so "floors are independent" is actually
/// tested rather than two floors that merely happen to share one rect.
fn floor_a_bounds() -> Rect {
    Rect {
        x0: 0,
        y0: 0,
        x1: 20,
        y1: 20,
    }
}

/// Floor 1's extent.
fn floor_b_bounds() -> Rect {
    Rect {
        x0: 5,
        y0: 5,
        x1: 30,
        y1: 30,
    }
}

proptest! {
    /// `inv_collision_only_within_floor`: two floors, each with their own
    /// arbitrary colliders and its own distinct extent, only ever
    /// influence their own floor's collision query -- the other floor's
    /// colliders and bounds never leak into the queried floor's result,
    /// which is queried at an arbitrary floor, not always floor 0.
    #[test]
    fn inv_collision_only_within_floor(
        floor_a_colliders in small_rects(0, 0),
        floor_b_colliders in small_rects(5, 5),
        floor in prop_oneof![Just(0i8), Just(1i8)],
        x in -5i32..35,
        y in -5i32..35,
    ) {
        let spec = WorldSpec {
            floors: vec![
                FloorSpec { floor: 0, bounds: floor_a_bounds(), colliders: floor_a_colliders.clone() },
                FloorSpec { floor: 1, bounds: floor_b_bounds(), colliders: floor_b_colliders.clone() },
            ],
            transitions: Vec::new(),
            building_areas: Vec::new(),
            room_areas: Vec::new(),
        };
        let world = spec.build().expect("no transitions declared, so build cannot fail");

        let (bounds, colliders) = if floor == 0 {
            (floor_a_bounds(), &floor_a_colliders)
        } else {
            (floor_b_bounds(), &floor_b_colliders)
        };
        let expected = bounds.contains(x, y) && blocked_by(colliders, x, y);
        prop_assert_eq!(world.is_blocked(x, y, floor), expected);
    }

    /// `inv_floor_transition_lands_standable`: `WorldSpec::build` accepts a
    /// candidate transition if and only if both its anchor and its target
    /// are standable on their own declared floor -- there is no other path
    /// to a `World` carrying a transition, so a player falling out of the
    /// world through one, or a transition anchored on unreachable
    /// geometry, is impossible by construction. Exercises a real anchor
    /// (on a declared floor, with its own colliders), not a cell on a
    /// floor the world never declares.
    #[test]
    fn inv_floor_transition_lands_standable(
        anchor_colliders in small_rects(0, 0),
        target_colliders in small_rects(0, 0),
        anchor_x in -5i32..25,
        anchor_y in -5i32..25,
        target_x in -5i32..25,
        target_y in -5i32..25,
    ) {
        let bounds = floor_a_bounds();
        let spec = WorldSpec {
            floors: vec![
                FloorSpec { floor: 0, bounds, colliders: anchor_colliders.clone() },
                FloorSpec { floor: 1, bounds, colliders: target_colliders.clone() },
            ],
            transitions: vec![TransitionSpec {
                x: anchor_x,
                y: anchor_y,
                floor: 0,
                target_x,
                target_y,
                target_floor: 1,
            }],
            building_areas: Vec::new(),
            room_areas: Vec::new(),
        };

        let anchor_fc = FloorCollision::build(bounds, &anchor_colliders).expect("valid bounds");
        let target_fc = FloorCollision::build(bounds, &target_colliders).expect("valid bounds");
        let should_succeed = anchor_fc.is_standable(anchor_x, anchor_y) && target_fc.is_standable(target_x, target_y);

        match spec.build() {
            Ok(world) => {
                prop_assert!(should_succeed);
                prop_assert!(!world.is_blocked(anchor_x, anchor_y, 0));
                prop_assert!(!world.is_blocked(target_x, target_y, 1));
            }
            Err(_) => prop_assert!(!should_succeed),
        }
    }

    /// `inv_world_query_total`: every world query -- and world
    /// construction itself -- is total over arbitrary `i32` coordinates
    /// and `i8`/`u32` floor/layer indices, including `MIN`/`MAX` -- never
    /// a panic, never a wrapping-arithmetic abort (the published profile
    /// runs with `overflow-checks` on). `FloorCollision::build` is the one
    /// constructor that will eventually take generator output directly,
    /// so it is fuzzed with arbitrary (including invalid and enormous)
    /// bounds here, not just queried against an already-built world.
    #[test]
    fn inv_world_query_total(
        x in any::<i32>(), y in any::<i32>(), floor in any::<i8>(), _layer in any::<u32>(),
        bx0 in any::<i32>(), by0 in any::<i32>(), bx1 in any::<i32>(), by1 in any::<i32>(),
    ) {
        let world = fixture::canonical_world();
        let _ = world.is_blocked(x, y, floor);
        let _ = world.transition_at(x, y, floor);
        let _ = world.ownership_at(x, y, floor);
        let _ = chunk_key(x, y, floor);

        let bounds = Rect { x0: bx0, y0: by0, x1: bx1, y1: by1 };
        let _ = FloorCollision::build(bounds, &[]);
    }

    /// `inv_cell_ownership_defined`: the ownership query answers against
    /// an independently computed reference (the rect membership the
    /// generated spec itself declares, not the value `ownership_at`
    /// returns) -- a stub that always returned `NO_OWNER` would fail this,
    /// unlike a bare "two calls agree" check. Building and room areas are
    /// confined to disjoint y-bands so they never overlap regardless of
    /// their generated width, and stability (two calls agree) is checked
    /// alongside correctness.
    #[test]
    fn inv_cell_ownership_defined(
        building_rect in (0i32..20, 1i32..8).prop_map(|(x0, w)| Rect { x0, y0: 0, x1: x0 + w, y1: 8 }),
        room_rect in (0i32..20, 1i32..8).prop_map(|(x0, w)| Rect { x0, y0: 20, x1: x0 + w, y1: 28 }),
        building_owner in 1u64..1000,
        room_owner in 1u64..1000,
        x in -5i32..35,
        y in -5i32..35,
    ) {
        let floor = 0i8;
        let spec = WorldSpec {
            floors: Vec::new(),
            transitions: Vec::new(),
            building_areas: vec![AreaSpec {
                owner_id: building_owner,
                floor,
                rect: building_rect,
                chunk_key: chunk_key(building_rect.x0, building_rect.y0, floor),
            }],
            room_areas: vec![AreaSpec {
                owner_id: room_owner,
                floor,
                rect: room_rect,
                chunk_key: chunk_key(room_rect.x0, room_rect.y0, floor),
            }],
        };
        let world = spec.build().expect("disjoint, single-chunk areas must build");

        let expected_building = if building_rect.contains(x, y) { building_owner } else { NO_OWNER };
        let expected_room = if room_rect.contains(x, y) { room_owner } else { NO_OWNER };

        let first = world.ownership_at(x, y, floor);
        prop_assert_eq!(first.building_id, expected_building);
        prop_assert_eq!(first.room_id, expected_room);

        let second = world.ownership_at(x, y, floor);
        prop_assert_eq!(first, second);
    }
}
