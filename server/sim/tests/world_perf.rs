//! A cell collision query sits on every entity's hot path, every frame
//! (Quentin's direction, story 1.5): no wall-clock assertion (it flakes on
//! a shared runner), but the *shape* of the cost is asserted directly --
//! a bounded, small number of memory accesses per query regardless of
//! world size, and a documented, tested memory budget per cell
//! (`docs/architecture.md`'s "World addressing" section).

use sim::world::{FloorCollision, Rect};

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
        let fc = FloorCollision::build(realistic_bounds(), &colliders);
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

#[test]
fn a_collision_query_touches_a_bounded_number_of_cells_regardless_of_world_size() {
    let fc = FloorCollision::build(realistic_bounds(), &scattered_colliders());
    // Every query anywhere in a 1024x1024 floor costs exactly one dense
    // storage access -- an arithmetic index, never a scan over colliders
    // and never a lookup per candidate collider.
    for (x, y) in [(0, 0), (512, 512), (1023, 1023), (66, 400), (900, 1)] {
        fc.reset_access_count();
        let _ = fc.is_blocked(x, y);
        assert_eq!(
            fc.access_count(),
            1,
            "is_blocked({x}, {y}) performed {} dense-storage accesses, not the expected 1",
            fc.access_count()
        );
    }
}
