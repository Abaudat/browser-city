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
//! The sampler's own tables are bounded by retention and by their own
//! declared `max_rows`: each fire deletes rows older than
//! `METRICS_RETENTION_DAYS`, then the oldest rows past the bound, through
//! the `sampled_at` index. `sample_all_tables` names every table exactly
//! once; `bounds/tests/metrics_coverage.rs` enforces it.
//!
//! Calls per reducer class (NFR17, story 4.13): every reducer's first
//! statement is `count_call`, one row update in `reducer_class_counter`;
//! each fire writes one `reducer_class_sample` row per class with the
//! running total and the delta since the previous fire. No threshold: the
//! first months of samples are the baseline.

use sim::reducer_classes::{ALL_CLASSES, ReducerClass};
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

/// Calls made to one reducer class since the module was published (or the
/// counter last restored). One row per class, established by
/// `finish_publish`. `sampled_calls` is `calls` at the previous sampler
/// fire, so the next fire's delta needs no scan of the sample table.
#[derive(Clone)]
#[spacetimedb::table(accessor = reducer_class_counter)]
pub struct ReducerClassCounter {
    #[primary_key]
    // `pub`: `tables::restore` constructs this row.
    pub class: String,
    pub calls: u64,
    pub sampled_calls: u64,
}

/// One class's calls at one fire.
#[derive(Clone)]
#[spacetimedb::table(accessor = reducer_class_sample)]
pub struct ReducerClassSample {
    #[primary_key]
    #[auto_inc]
    pub sample_id: u64,
    #[index(btree)]
    pub sampled_at: Timestamp,
    pub class: String,
    pub calls_total: u64,
    pub calls_delta: u64,
}

/// Counts one call to `class`. The first statement of every reducer body
/// (`scripts/ci/check-reducer-counted.sh`), never fails: a missing counter
/// row is created.
pub fn count_call(ctx: &ReducerContext, class: ReducerClass) {
    let name = class.name();
    match ctx
        .db
        .reducer_class_counter()
        .class()
        .find(name.to_string())
    {
        Some(row) => {
            let calls = sim::reducer_classes::next_calls(row.calls);
            ctx.db
                .reducer_class_counter()
                .class()
                .update(ReducerClassCounter { calls, ..row });
        }
        None => {
            ctx.db.reducer_class_counter().insert(ReducerClassCounter {
                class: name.to_string(),
                calls: 1,
                sampled_calls: 0,
            });
        }
    }
}

/// Seeds the counter with one zeroed row per class that has none. Called
/// by `tables::publish::establish_world`.
pub fn establish_counters(ctx: &ReducerContext) {
    for class in ALL_CLASSES {
        if ctx
            .db
            .reducer_class_counter()
            .class()
            .find(class.name().to_string())
            .is_none()
        {
            ctx.db.reducer_class_counter().insert(ReducerClassCounter {
                class: class.name().to_string(),
                calls: 0,
                sampled_calls: 0,
            });
        }
    }
}

/// Estimated bytes of `table`: encode the first
/// `METRICS_BYTES_SAMPLE_ROWS` rows and scale to the row count. A row that
/// cannot be encoded is logged and contributes nothing -- the sampler never
/// fails.
fn table_bytes_est<T: Table>(table: &T, count: u64) -> u64
where
    T::Row: spacetimedb::sats::ser::Serialize,
{
    let mut sampled_rows = 0u64;
    let mut sampled_bytes = 0u64;
    for row in table
        .iter()
        .take(sim::storage::METRICS_BYTES_SAMPLE_ROWS as usize)
    {
        sampled_rows += 1;
        match bsatn::to_vec(&row) {
            Ok(encoded) => sampled_bytes += encoded.len() as u64,
            Err(e) => log::error!("metrics: cannot encode a row: {e}"),
        }
    }
    sim::storage::scale_bytes_est(sampled_bytes, sampled_rows, count)
}

/// Samples every table this module declares, then bounds the sample tables
/// and inserts. One `sample!(accessor)` per table; figures are gathered
/// before anything is inserted so a fire never counts its own rows. Never
/// fails: a table missing from the registry is written as a breach.
fn sample_all_tables(ctx: &ReducerContext, now: Timestamp) {
    let mut taken: Vec<TableSample> = Vec::new();
    macro_rules! sample {
        ($accessor:ident) => {{
            let name = stringify!($accessor);
            let bound = sim::table_bounds::TABLE_BOUNDS
                .iter()
                .find(|b| b.accessor == name);
            let (alert_rows, max_rows) = match bound {
                Some(b) => (b.alert_rows, b.max_rows),
                None => {
                    log::error!("metrics: table `{name}` has no bound in TABLE_BOUNDS");
                    (0, 0)
                }
            };
            let table = ctx.db.$accessor();
            let rows = table.count();
            taken.push(TableSample {
                sample_id: 0,
                sampled_at: now,
                table_accessor: name.to_string(),
                rows,
                bytes_est: table_bytes_est(table, rows),
                alert_rows,
                max_rows,
                // No bound at all is itself a breach.
                over_alert: bound.is_none() || sim::storage::over_alert(rows, alert_rows),
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
    sample!(reducer_class_counter);
    sample!(reducer_class_sample);

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
    let class_samples = take_class_samples(ctx, now);
    prune(ctx, now, taken.len() as u64, 1, class_samples.len() as u64);
    for s in taken {
        ctx.db.table_sample().insert(s);
    }
    for s in class_samples {
        ctx.db.reducer_class_sample().insert(s);
    }
    ctx.db.storage_sample().insert(StorageSample {
        sample_id: 0,
        sampled_at: now,
        total_bytes_est: total,
        over_review: class >= sim::storage::StorageClass::Review,
        over_wall: class == sim::storage::StorageClass::Wall,
    });
}

/// One `ReducerClassSample` per counter row, and advances each row's
/// `sampled_calls` so the next fire's delta starts here.
fn take_class_samples(ctx: &ReducerContext, now: Timestamp) -> Vec<ReducerClassSample> {
    let counters: Vec<ReducerClassCounter> = ctx.db.reducer_class_counter().iter().collect();
    let mut out = Vec::with_capacity(counters.len());
    for row in counters {
        out.push(ReducerClassSample {
            sample_id: 0,
            sampled_at: now,
            class: row.class.clone(),
            calls_total: row.calls,
            calls_delta: sim::reducer_classes::calls_delta(row.calls, row.sampled_calls),
        });
        let calls = row.calls;
        ctx.db
            .reducer_class_counter()
            .class()
            .update(ReducerClassCounter {
                sampled_calls: calls,
                ..row
            });
    }
    out
}

/// Bounds the sample tables before this fire's rows go in: deletes rows
/// older than the retention window in one ranged call per table, then the
/// oldest rows past the table's own declared `max_rows` (retention is real
/// time and the cadence is city time, so a fast clock outruns the age
/// window). Both go through the `sampled_at` index -- never a full scan.
fn prune(
    ctx: &ReducerContext,
    now: Timestamp,
    incoming_tables: u64,
    incoming_totals: u64,
    incoming_classes: u64,
) {
    let cutoff = Timestamp::from_micros_since_unix_epoch(sim::storage::retention_cutoff_micros(
        now.to_micros_since_unix_epoch(),
    ));
    ctx.db.table_sample().sampled_at().delete(..cutoff);
    ctx.db.storage_sample().sampled_at().delete(..cutoff);
    ctx.db.reducer_class_sample().sampled_at().delete(..cutoff);

    let drop = sim::storage::rows_to_drop(
        ctx.db.table_sample().count(),
        incoming_tables,
        sim::table_bounds::max_rows_of("table_sample").unwrap_or(0),
    );
    let oldest: Vec<u64> = ctx
        .db
        .table_sample()
        .sampled_at()
        .filter(Timestamp::from_micros_since_unix_epoch(i64::MIN)..)
        .take(drop as usize)
        .map(|r| r.sample_id)
        .collect();
    for id in oldest {
        ctx.db.table_sample().sample_id().delete(id);
    }
    let drop = sim::storage::rows_to_drop(
        ctx.db.storage_sample().count(),
        incoming_totals,
        sim::table_bounds::max_rows_of("storage_sample").unwrap_or(0),
    );
    let oldest: Vec<u64> = ctx
        .db
        .storage_sample()
        .sampled_at()
        .filter(Timestamp::from_micros_since_unix_epoch(i64::MIN)..)
        .take(drop as usize)
        .map(|r| r.sample_id)
        .collect();
    for id in oldest {
        ctx.db.storage_sample().sample_id().delete(id);
    }
    let drop = sim::storage::rows_to_drop(
        ctx.db.reducer_class_sample().count(),
        incoming_classes,
        sim::table_bounds::max_rows_of("reducer_class_sample").unwrap_or(0),
    );
    let oldest: Vec<u64> = ctx
        .db
        .reducer_class_sample()
        .sampled_at()
        .filter(Timestamp::from_micros_since_unix_epoch(i64::MIN)..)
        .take(drop as usize)
        .map(|r| r.sample_id)
        .collect();
    for id in oldest {
        ctx.db.reducer_class_sample().sample_id().delete(id);
    }
}

/// One sampler fire. Infallible: a breached bound or an unencodable row is
/// recorded and logged, never a reason to abort -- an `Err` would roll back
/// the caller's re-arm and stop the cadence.
pub fn run_sampler(ctx: &ReducerContext) {
    sample_all_tables(ctx, ctx.timestamp);
}
