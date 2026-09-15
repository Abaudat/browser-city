//! Story 1.14: measurement fixture for D4's subscription-decode risk (the
//! client does not yet subscribe to any world table, so the ~28k-row
//! street ux.md names is simulated here). See `docs/spikes/1.14-boot-
//! budget.md` for the pre-registered revisit trigger and the findings;
//! `scripts/dev/run-boot-budget-spike.sh` is the one-command re-run entry
//! point.
//!
//! Throwaway, not permanent state, the same discipline `sched_timing`
//! documents (docs/architecture.md's "Permanent decisions" section is
//! about `browser_city`, not this crate): published under its own
//! disposable database name, depended on by nothing, never touched by the
//! deploy path, and never published to Maincloud under any circumstance.
//!
//! `placed_object` is a column-for-column copy of `browser_city`'s own
//! `server/src/tables/world.rs::PlacedObject` (story 1.5) -- same fields,
//! same types, same `#[index(btree)] chunk_key`, packed with the real
//! `sim::world::chunk_key` (never a second, spike-local formula). That
//! real table exists already but nothing subscribes to it yet (no
//! generator has run); this crate never reads or writes it, and never
//! reaches Maincloud -- it only gives decode timing a payload shaped
//! exactly like the one a street will eventually stream.
use sim::world::{CHUNK_SIZE, chunk_key};
use spacetimedb::{ReducerContext, Table, reducer, table};

#[table(accessor = placed_object, public)]
pub struct PlacedObject {
    #[primary_key]
    #[auto_inc]
    pub object_id: u64,
    pub def_id: u32,
    pub x: i32,
    pub y: i32,
    pub floor: i8,
    pub layer: u32,
    pub orientation: u8,
    #[index(btree)]
    pub chunk_key: u64,
}

/// Deletes every seeded row, so one published database can be reused
/// across the row-count sweep without a fresh publish per point -- Crew's
/// choice, mirroring `sched_timing`'s per-leg isolation but avoiding N
/// separate publishes for what is otherwise the same schema and query
/// shape.
#[reducer]
pub fn clear(ctx: &ReducerContext) {
    for row in ctx.db.placed_object().iter().collect::<Vec<_>>() {
        ctx.db.placed_object().object_id().delete(row.object_id);
    }
}

/// Seeds `count` rows tiling a rectangular area on `floor`, starting at
/// the world origin, wide enough that the area spans multiple chunks the
/// way a real street does -- never a single chunk holding an unrealistic
/// density. Row `i` lands at `(i % width, i / width)`; `width` is fixed at
/// four chunks (`4 * CHUNK_SIZE` cells) so the seeded set always spans
/// more than one `chunk_key`, regardless of `count`.
#[reducer]
pub fn seed_rows(ctx: &ReducerContext, count: u32, floor: i8) {
    let width: i32 = 4 * CHUNK_SIZE;
    for i in 0..count {
        let x = (i as i32) % width;
        let y = (i as i32) / width;
        ctx.db.placed_object().insert(PlacedObject {
            object_id: 0,
            def_id: (i % 64) + 1,
            x,
            y,
            floor,
            layer: (i % 5) + 1,
            orientation: (i % 4) as u8,
            chunk_key: chunk_key(x, y, floor),
        });
    }
}
