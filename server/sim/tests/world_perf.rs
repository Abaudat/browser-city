//! A cell collision query and an ownership query both sit on every
//! entity's hot path, every frame (Quentin/Tim's direction, story 1.5): no
//! wall-clock assertion (it flakes on a shared runner, and mutating a
//! counter through `&self` on every production call is worse), but the
//! *shape* of the cost is asserted directly against the real, non-test
//! code -- collision indexing is proven to be pure arithmetic, and
//! ownership indexing is proven to scan only the one chunk a query names,
//! regardless of how many other areas exist elsewhere in the world.

use proptest::prelude::*;
use sim::world::{AreaSpec, FloorSpec, Rect, WorldSpec, cell_index, chunk_key};

/// At least NFR14's 1024-squared growth-target district, per floor.
const WORLD_SIDE: i32 = 1024;
const FLOORS: i32 = 4;

fn realistic_bounds() -> Rect {
    Rect {
        x0: 0,
        y0: 0,
        x1: WORLD_SIDE,
        y1: WORLD_SIDE,
    }
}

/// A scattering of colliders across the grid -- enough that `is_blocked`
/// cannot special-case "always empty", not an attempt at a realistic city.
fn scattered_colliders() -> Vec<Rect> {
    let mut colliders = Vec::new();
    let mut x = 0;
    while x < WORLD_SIDE {
        colliders.push(Rect {
            x0: x,
            y0: 0,
            x1: x + 4,
            y1: WORLD_SIDE,
        });
        x += 64;
    }
    colliders
}

/// The collision budget: 1 bit per cell (`docs/architecture.md`), i.e. 8
/// cells per byte. A 1024x1024 floor is 1,048,576 cells -> 131,072 bytes;
/// four floors at that size is 524,288 bytes, comfortably under half a
/// mebibyte.
const CELLS_PER_BUDGET_BYTE: u64 = 8;

#[test]
fn a_realistic_world_stays_within_the_documented_memory_budget() {
    let colliders = scattered_colliders();
    let mut total_bytes = 0u64;
    for _ in 0..FLOORS {
        let fc = build_floor_collision(realistic_bounds(), &colliders);
        total_bytes += fc.dense_storage_bytes() as u64;
    }
    let cell_count = (WORLD_SIDE as u64) * (WORLD_SIDE as u64) * (FLOORS as u64);
    let budget_bytes = cell_count / CELLS_PER_BUDGET_BYTE;
    assert!(
        total_bytes <= budget_bytes,
        "collision storage for a {WORLD_SIDE}x{WORLD_SIDE}x{FLOORS} world is {total_bytes} bytes, \
         over the documented 1-bit-per-cell budget ({budget_bytes} bytes)"
    );
}

/// `sim::world::FloorCollision::build`, unwrapped -- every rect this file
/// builds is valid and under the cell ceiling, so a construction failure
/// here is this test's own bug.
fn build_floor_collision(bounds: Rect, colliders: &[Rect]) -> sim::world::FloorCollision {
    sim::world::FloorCollision::build(bounds, colliders).expect("test geometry must be valid")
}

proptest! {
    /// `is_blocked`'s only per-query cost beyond the bounds check is one
    /// [`cell_index`] call plus one dense-storage word read -- provable by
    /// showing `cell_index` itself is a pure arithmetic function of its
    /// three inputs (no loop, no scan, no allocation), matching a formula
    /// computed independently here, for arbitrary bounds and coordinates
    /// (never allocating, so no need to bound the ranges).
    #[test]
    fn cell_index_is_a_pure_arithmetic_function_of_bounds_and_xy(
        x0 in any::<i32>(), y0 in any::<i32>(), x1 in any::<i32>(), y1 in any::<i32>(),
        x in any::<i32>(), y in any::<i32>(),
    ) {
        let bounds = Rect { x0, y0, x1, y1 };
        let expected = if bounds.is_valid() && bounds.contains(x, y) {
            let local_x = x as i64 - x0 as i64;
            let local_y = y as i64 - y0 as i64;
            let width = x1 as i64 - x0 as i64;
            // checked_*, matching cell_index itself: a wide-enough bounds
            // makes the index overflow i64, which is a `None` (unreachable
            // cell), not a panic -- see cell_index's own doc comment.
            local_y
                .checked_mul(width)
                .and_then(|v| v.checked_add(local_x))
                .and_then(|v| usize::try_from(v).ok())
        } else {
            None
        };
        prop_assert_eq!(cell_index(bounds, x, y), expected);
    }
}

#[test]
fn ownership_lookup_scans_only_the_queried_chunk_not_every_area_in_the_world() {
    // 5,000 building areas, one per chunk, scattered across a wide extent
    // (Quentin's "realistic area count" -- this PR's own `building_area`
    // bound is 150,000; 5,000 is enough to prove the shape without a slow
    // test).
    const SPARSE_COUNT: i32 = 5_000;
    let mut building_areas = Vec::new();
    for i in 0..SPARSE_COUNT {
        let x = i * 64; // 64 apart: always two chunks apart, never colliding
        let rect = Rect {
            x0: x,
            y0: 0,
            x1: x + 1,
            y1: 1,
        };
        building_areas.push(AreaSpec {
            owner_id: (i + 1) as u64,
            floor: 0,
            rect,
            chunk_key: chunk_key(rect.x0, rect.y0, 0),
        });
    }

    // A separate, deliberately crowded chunk far from the sparse ones: 20
    // non-overlapping areas sharing one chunk.
    const CROWDED_CHUNK_X0: i32 = 1_000_000; // a chunk boundary: 1_000_000 / 32 = 31_250
    const CROWDED_COUNT: i32 = 20;
    let mut crowded_owner_ids = Vec::new();
    for i in 0..CROWDED_COUNT {
        let x = CROWDED_CHUNK_X0 + i;
        let rect = Rect {
            x0: x,
            y0: 0,
            x1: x + 1,
            y1: 1,
        };
        let owner_id = (SPARSE_COUNT + i + 1) as u64;
        crowded_owner_ids.push(owner_id);
        building_areas.push(AreaSpec {
            owner_id,
            floor: 0,
            rect,
            chunk_key: chunk_key(rect.x0, rect.y0, 0),
        });
    }

    let spec = WorldSpec {
        floors: vec![FloorSpec {
            floor: 0,
            bounds: Rect {
                x0: 0,
                y0: 0,
                x1: 1,
                y1: 1,
            },
            colliders: Vec::new(),
        }],
        transitions: Vec::new(),
        building_areas,
        room_areas: Vec::new(),
    };
    let world = spec
        .build()
        .expect("non-overlapping, single-chunk areas must build");

    // A sparse chunk's bucket holds exactly its own one area, regardless
    // of the other 5,019 areas elsewhere in the world.
    let sparse_probe_index = 2_500;
    let sparse_x = sparse_probe_index * 64;
    assert_eq!(world.building_areas_in_chunk_of(sparse_x, 0, 0), 1);
    assert_eq!(
        world.ownership_at(sparse_x, 0, 0).building_id,
        (sparse_probe_index + 1) as u64
    );

    // The crowded chunk's bucket holds exactly its own 20 areas -- not 0
    // (a query landing on the wrong bucket) and not 5,020 (a scan of
    // everything).
    assert_eq!(
        world.building_areas_in_chunk_of(CROWDED_CHUNK_X0, 0, 0),
        CROWDED_COUNT as usize
    );
    for (i, owner_id) in crowded_owner_ids.iter().enumerate() {
        let x = CROWDED_CHUNK_X0 + i as i32;
        assert_eq!(world.ownership_at(x, 0, 0).building_id, *owner_id);
    }

    // An empty chunk between the two scatters has an empty bucket.
    assert_eq!(world.building_areas_in_chunk_of(500_000, 0, 0), 0);
    assert_eq!(
        world.ownership_at(500_000, 0, 0).building_id,
        sim::world::NO_OWNER
    );
}
