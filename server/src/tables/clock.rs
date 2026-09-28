//! The in-city clock's one durable row (FR1-FR3). In-city time is
//! `sim::time::city_time(epoch_at, now, speed)`, evaluated on demand by whoever
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
    /// The clock multiplier (FR163), 1 in production: the only writer is
    /// the `time-control` feature's `set_clock_speed`.
    #[default(1)]
    pub speed: u32,
}

/// The clock row's epoch (micros) and speed -- `None` before `init`.
pub fn read_clock(ctx: &ReducerContext) -> Option<(i64, u32)> {
    let row = ctx.db.world_clock().id().find(0)?;
    Some((row.epoch_at.to_micros_since_unix_epoch(), row.speed))
}

/// The current multiplier; 1 where no row exists yet.
pub fn current_speed(ctx: &ReducerContext) -> u32 {
    read_clock(ctx).map_or(1, |(_, speed)| speed)
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
            ctx.db.world_clock().insert(WorldClock {
                id: 0,
                epoch_at,
                speed: 1,
            });
            epoch_at
        }
    }
}
