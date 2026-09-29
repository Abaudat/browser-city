//! The metrics sampler (FR169, NFR15, NFR37): once per period, one
//! `table_sample` row per table -- row count, an estimated byte size, the
//! declared `alert_rows`/`max_rows` and whether the count is past the
//! alert -- plus one `storage_sample` row classifying the estimated total
//! against NFR15's figures. Breaches are durable columns, never only log
//! lines, so a dead-man's check (`scripts/ops/storage-report.sh`) can
//! read them.
//!
//! Row counts are `Table::count()` (O(1)). The module SDK exposes no
//! per-table byte figure, so `bytes_est` is an estimate: the encoded size
//! of the first `METRICS_BYTES_SAMPLE_ROWS` rows scaled by `count`. It
//! excludes indexes and the commit log, so it undercounts real storage by
//! a roughly constant factor; the review trigger is set low enough for
//! that. The work per fire never grows with table size.
//!
//! The sampler's own tables are bounded by retention: each fire deletes
//! rows older than `METRICS_RETENTION_DAYS` through the `sampled_at`
//! index. `sample_all_tables` names every table exactly once;
//! `bounds/tests/metrics_coverage.rs` enforces it.

use spacetimedb::sats::bsatn;
use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::demo_ping;

use super::citizen::{citizen, citizen_state};
use super::clock::world_clock;
use super::codes::{matter_kind, node_kind, provision, reason_code, unit};
use super::identity::{character, character_identity};
use super::ops::module_owner;
use super::restore::restore_state;
use super::schedules::{
    budget_review_schedule, cadence_liveness, citizen_transition_schedule, economy_schedule,
    growth_schedule, maintenance_schedule, metrics_sample_schedule, world_clock_schedule,
};
use super::world::{
    building, building_area, floor_transition, layer_code, placed_object, room, room_area,
};

/// One table's figures at one fire. Private tables: read as the owner over
/// `spacetime sql`.
#[derive(Clone)]
#[spacetimedb::table(accessor = table_sample)]
pub struct TableSample {
    #[primary_key]
    #[auto_inc]
    // `pub`: `tables::restore::restore_table_sample` constructs this row.
    pub sample_id: u64,
    #[index(btree)]
    pub sampled_at: Timestamp,
    pub table_accessor: String,
    pub rows: u64,
    pub bytes_est: u64,
    pub alert_rows: u64,
    pub max_rows: u64,
    pub over_alert: bool,
}

/// The estimated total across every table at one fire, classified against
/// NFR15 (`sim::storage`).
#[derive(Clone)]
#[spacetimedb::table(accessor = storage_sample)]
pub struct StorageSample {
    #[primary_key]
    #[auto_inc]
    pub sample_id: u64,
    #[index(btree)]
    pub sampled_at: Timestamp,
    pub total_bytes_est: u64,
    pub over_review: bool,
    pub over_wall: bool,
}

/// Estimated bytes of `table`: encode the first
/// `METRICS_BYTES_SAMPLE_ROWS` rows and scale to the row count.
fn table_bytes_est<T: Table>(table: &T, count: u64) -> Result<u64, String>
where
    T::Row: spacetimedb::sats::ser::Serialize,
{
    let mut sampled_rows = 0u64;
    let mut sampled_bytes = 0u64;
    for row in table
        .iter()
        .take(sim::storage::METRICS_BYTES_SAMPLE_ROWS as usize)
    {
        let encoded = bsatn::to_vec(&row).map_err(|e| format!("cannot encode a row: {e}"))?;
        sampled_rows += 1;
        sampled_bytes += encoded.len() as u64;
    }
    Ok(sim::storage::scale_bytes_est(
        sampled_bytes,
        sampled_rows,
        count,
    ))
}

/// Samples every table this module declares. One `sample!(accessor)` per
/// table; figures are gathered before anything is inserted so a fire never
/// counts its own rows.
fn sample_all_tables(ctx: &ReducerContext, now: Timestamp) -> Result<(), String> {
    let mut taken: Vec<TableSample> = Vec::new();
    macro_rules! sample {
        ($accessor:ident) => {{
            let name = stringify!($accessor);
            let bound = sim::table_bounds::TABLE_BOUNDS
                .iter()
                .find(|b| b.accessor == name)
                .ok_or_else(|| format!("table `{name}` has no bound in TABLE_BOUNDS"))?;
            let table = ctx.db.$accessor();
            let rows = table.count();
            let bytes_est = table_bytes_est(table, rows)?;
            taken.push(TableSample {
                sample_id: 0,
                sampled_at: now,
                table_accessor: name.to_string(),
                rows,
                bytes_est,
                alert_rows: bound.alert_rows,
                max_rows: bound.max_rows,
                over_alert: sim::storage::over_alert(rows, bound.alert_rows),
            });
        }};
    }
    sample!(demo_ping);
    sample!(character);
    sample!(character_identity);
    sample!(module_owner);
    sample!(world_clock);
    sample!(restore_state);
    sample!(citizen);
    sample!(citizen_state);
    sample!(matter_kind);
    sample!(provision);
    sample!(reason_code);
    sample!(node_kind);
    sample!(unit);
    sample!(layer_code);
    sample!(placed_object);
    sample!(floor_transition);
    sample!(building);
    sample!(room);
    sample!(building_area);
    sample!(room_area);
    sample!(citizen_transition_schedule);
    sample!(metrics_sample_schedule);
    sample!(budget_review_schedule);
    sample!(world_clock_schedule);
    sample!(economy_schedule);
    sample!(growth_schedule);
    sample!(maintenance_schedule);
    sample!(cadence_liveness);
    sample!(table_sample);
    sample!(storage_sample);

    let total: u64 = taken
        .iter()
        .fold(0u64, |acc, s| acc.saturating_add(s.bytes_est));
    let class = sim::storage::classify_total(total);
    for s in &taken {
        if s.over_alert {
            log::warn!(
                "metrics: table `{}` has {} rows, past its alert of {} (max {})",
                s.table_accessor,
                s.rows,
                s.alert_rows,
                s.max_rows
            );
        }
    }
    if class != sim::storage::StorageClass::Ok {
        log::warn!("metrics: estimated storage {total} bytes is {class:?}");
    }
    for s in taken {
        ctx.db.table_sample().insert(s);
    }
    ctx.db.storage_sample().insert(StorageSample {
        sample_id: 0,
        sampled_at: now,
        total_bytes_est: total,
        over_review: class >= sim::storage::StorageClass::Review,
        over_wall: class == sim::storage::StorageClass::Wall,
    });
    Ok(())
}

/// Deletes sample rows older than the retention window, through the
/// `sampled_at` index -- never a full scan.
fn prune(ctx: &ReducerContext, now: Timestamp) {
    let cutoff = Timestamp::from_micros_since_unix_epoch(sim::storage::retention_cutoff_micros(
        now.to_micros_since_unix_epoch(),
    ));
    let old: Vec<u64> = ctx
        .db
        .table_sample()
        .sampled_at()
        .filter(..cutoff)
        .map(|r| r.sample_id)
        .collect();
    for id in old {
        ctx.db.table_sample().sample_id().delete(id);
    }
    let old: Vec<u64> = ctx
        .db
        .storage_sample()
        .sampled_at()
        .filter(..cutoff)
        .map(|r| r.sample_id)
        .collect();
    for id in old {
        ctx.db.storage_sample().sample_id().delete(id);
    }
}

/// One sampler fire: prune, then sample. A breached bound is never a
/// reason to fail -- the caller still re-arms.
pub fn run_sampler(ctx: &ReducerContext) -> Result<(), String> {
    let now = ctx.timestamp;
    prune(ctx, now);
    sample_all_tables(ctx, now)
}
