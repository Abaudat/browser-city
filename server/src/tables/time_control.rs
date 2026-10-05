//! Dev-only clock control (FR163), compiled only with the `time-control`
//! feature and published only by `scripts/dev/publish-dev.sh`: without
//! the feature these reducers do not exist. Open to any caller -- the
//! flavour never leaves a local instance. All arithmetic is
//! `sim::time`'s; each reducer is one transaction, so an `Err` rolls
//! everything back.

use spacetimedb::{ReducerContext, Timestamp};

use super::clock::{WorldClock, read_clock, world_clock};
use super::metrics::count_call;
use super::schedules;
use sim::reducer_classes::ReducerClass;

fn write_clock(ctx: &ReducerContext, epoch_micros: i64, speed: u32) {
    ctx.db.world_clock().id().update(WorldClock {
        id: 0,
        epoch_at: Timestamp::from_micros_since_unix_epoch(epoch_micros),
        speed,
    });
}

/// Skips the city clock forward by whole `city_minutes`, replaying every
/// cadence fire inside the skipped interval, then re-arms everything
/// from the rewritten epoch.
#[spacetimedb::reducer]
pub fn jump_clock(ctx: &ReducerContext, city_minutes: u32) -> Result<(), String> {
    count_call(ctx, ReducerClass::Operator);
    sim::time::validate_jump(city_minutes)?;
    let (epoch, speed) =
        read_clock(ctx).ok_or_else(|| "world_clock has no row -- init did not run".to_string())?;
    let new_epoch = sim::time::jumped_epoch(epoch, city_minutes, speed);
    let jump_micros = city_minutes as i64 * sim::time::micros_per_city_minute(speed);
    schedules::replay_skipped_cadences(ctx, epoch, speed, jump_micros, new_epoch)?;
    write_clock(ctx, new_epoch, speed);
    schedules::disarm_all_scheduled_tables(ctx);
    schedules::arm_every_cadence_from(ctx, new_epoch, speed);
    Ok(())
}

/// Sets the clock multiplier without moving the clock: the epoch is
/// re-anchored so the city minute at this instant is unchanged.
#[spacetimedb::reducer]
pub fn set_clock_speed(ctx: &ReducerContext, speed: u32) -> Result<(), String> {
    count_call(ctx, ReducerClass::Operator);
    sim::time::validate_speed(speed)?;
    let (epoch, old_speed) =
        read_clock(ctx).ok_or_else(|| "world_clock has no row -- init did not run".to_string())?;
    let new_epoch = sim::time::reanchor(
        epoch,
        ctx.timestamp.to_micros_since_unix_epoch(),
        old_speed,
        speed,
    );
    write_clock(ctx, new_epoch, speed);
    schedules::disarm_all_scheduled_tables(ctx);
    schedules::arm_every_cadence_from(ctx, new_epoch, speed);
    Ok(())
}
