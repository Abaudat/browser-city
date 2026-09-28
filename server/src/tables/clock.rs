//! The in-city clock's one durable row (FR1-FR3). In-city time is
//! `sim::time::city_time(epoch_at, now)`, evaluated on demand by whoever
//! needs it; nothing ticks and nothing is broadcast per minute.

use spacetimedb::{ReducerContext, Table, Timestamp};

/// A one-row table: `id` is always `0` (NFR33). `epoch_at` is the real
/// instant at which in-city time was day 0, 00:00 -- `ctx.timestamp` at
/// `init`, deliberately not aligned to any real boundary (FR2).
#[derive(Clone)]
#[spacetimedb::table(accessor = world_clock, public)]
pub struct WorldClock {
    #[primary_key]
    // `pub`: `tables::restore::restore_world_clock` constructs this row.
    pub id: u8,
    pub epoch_at: Timestamp,
}

/// Writes the epoch. Called from `init` only, and never overwrites: a
/// republish must not reset the city to dawn. Returns the epoch that is
/// now on record either way (freshly written, or already there from an
/// earlier publish) -- `init`'s own caller needs it to arm every cadence
/// from, without a second lookup.
pub fn record_epoch_from_init(ctx: &ReducerContext) -> Timestamp {
    match ctx.db.world_clock().id().find(0) {
        Some(row) => row.epoch_at,
        None => {
            let epoch_at = ctx.timestamp;
            ctx.db.world_clock().insert(WorldClock { id: 0, epoch_at });
            epoch_at
        }
    }
}
