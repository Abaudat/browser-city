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
use super::world::{
    building_area, floor_transition, ground_area, placed_object, roof_area, room_area,
};
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

/// Clears what `create_district` wrote in the chunk columns
/// `cx0..=cx1` x `cy0..=cy1` on `floor`: every `placed_object`,
/// `floor_transition`, `building_area`, `room_area`, `ground_area` and
/// `roof_area` row there whose id is above `keep_id_max`. The e2e harness
/// restores a hand-laid fixture block (ids at or below `keep_id_max`)
/// first, generates the district, then clears the district's own rows
/// under the block, so the block stands alone where the specs expect it.
#[spacetimedb::reducer]
pub fn debug_clear_chunks(
    ctx: &ReducerContext,
    cx0: i32,
    cy0: i32,
    cx1: i32,
    cy1: i32,
    floor: i8,
    keep_id_max: u64,
) -> Result<(), String> {
    count_call(ctx, ReducerClass::Operator);
    if cx1 < cx0 || cy1 < cy0 {
        return Err("debug_clear_chunks: an empty chunk range".to_string());
    }
    for cx in cx0..=cx1 {
        for cy in cy0..=cy1 {
            let key = sim::world::chunk_key(
                cx * sim::world::CHUNK_SIZE,
                cy * sim::world::CHUNK_SIZE,
                floor,
            );
            let ids: Vec<u64> = ctx
                .db
                .placed_object()
                .chunk_key()
                .filter(key)
                .map(|r| r.object_id)
                .filter(|&id| id > keep_id_max)
                .collect();
            for id in ids {
                ctx.db.placed_object().object_id().delete(id);
            }
            let ids: Vec<u64> = ctx
                .db
                .floor_transition()
                .chunk_key()
                .filter(key)
                .map(|r| r.transition_id)
                .filter(|&id| id > keep_id_max)
                .collect();
            for id in ids {
                ctx.db.floor_transition().transition_id().delete(id);
            }
            let ids: Vec<u64> = ctx
                .db
                .building_area()
                .chunk_key()
                .filter(key)
                .map(|r| r.area_id)
                .filter(|&id| id > keep_id_max)
                .collect();
            for id in ids {
                ctx.db.building_area().area_id().delete(id);
            }
            let ids: Vec<u64> = ctx
                .db
                .room_area()
                .chunk_key()
                .filter(key)
                .map(|r| r.area_id)
                .filter(|&id| id > keep_id_max)
                .collect();
            for id in ids {
                ctx.db.room_area().area_id().delete(id);
            }
            let ids: Vec<u64> = ctx
                .db
                .ground_area()
                .chunk_key()
                .filter(key)
                .map(|r| r.area_id)
                .filter(|&id| id > keep_id_max)
                .collect();
            for id in ids {
                ctx.db.ground_area().area_id().delete(id);
            }
            let ids: Vec<u64> = ctx
                .db
                .roof_area()
                .chunk_key()
                .filter(key)
                .map(|r| r.area_id)
                .filter(|&id| id > keep_id_max)
                .collect();
            for id in ids {
                ctx.db.roof_area().area_id().delete(id);
            }
        }
    }
    Ok(())
}
