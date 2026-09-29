//! The body shared by `init` and the owner-only `finish_publish` reducer
//! (`../lib.rs`): every table a world needs to exist is established here,
//! never by `init` alone.

use spacetimedb::ReducerContext;

use super::{clock, codes, ops, schedules};

/// Ensures the clock row, seeds every extensible set and arms every cadence
/// from the epoch and speed on record. Errs -- rolling the whole
/// transaction back -- if a one-row table is still absent afterwards, so a
/// deploy fails at `publish-module` rather than shipping a broken world.
pub fn establish_world(ctx: &ReducerContext) -> Result<(), String> {
    let (epoch_micros, speed) = clock::ensure_epoch(ctx);
    codes::seed_all_codes(ctx);
    schedules::arm_every_cadence_from(ctx, epoch_micros, speed);
    if clock::read_clock(ctx).is_none() {
        return Err("world_clock is still empty after finish_publish".to_string());
    }
    if !ops::owner_recorded(ctx) {
        return Err("module_owner is still empty after finish_publish".to_string());
    }
    Ok(())
}
