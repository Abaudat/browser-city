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
//!
//! Gameplay metrics (FR171, FR172, story 4.14) ride the same fire: the
//! registry is `sim::gameplay_metrics`, one `gameplay_metric_sample` row
//! per live series per fire. `connected_client` mirrors open connections;
//! `metric_tally` holds the period peak, boot histogram and resume
//! counts, zeroed after each fire.

use sim::gameplay_metrics::{ConnFlags, Measure, Period, Tally};
use sim::reducer_classes::{ALL_CLASSES, ReducerClass};
use spacetimedb::sats::bsatn;
use spacetimedb::{ConnectionId, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::demo_ping;

use super::actor::{actor_kind, actor_location};
use super::citizen::{citizen, citizen_state};
use super::clock::world_clock;
use super::codes::{
    container_kind, holder_kind, matter_kind, node_kind, provision, reason_code, unit,
};
use super::district::district;
use super::housing::tenancy;
use super::identity::{character, character_identity, link_request, oidc_issuer};
use super::item_instance::{item_held, item_instance, item_placed};
use super::ops::module_owner;
use super::player_position::player_position;
use super::restore::restore_state;
use super::routing::{edge_kind, route_edge, route_node, route_provision};
use super::schedules::{
    budget_review_schedule, cadence_liveness, citizen_transition_schedule, economy_schedule,
    growth_schedule, maintenance_schedule, metrics_sample_schedule, world_clock_schedule,
};
use super::stock::{business, stock};
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
    /// The thresholds `over_review`/`over_wall` were classified against
    /// (`sim::storage`), so a reader alerts against the bound it reads.
    #[default(0u64)]
    pub review_bytes: u64,
    #[default(0u64)]
    pub wall_bytes: u64,
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

/// One gameplay-metric series figure at one fire, read through its
/// metric unit (`sim::gameplay_metrics::Unit`): `value`/`sample_size` are
/// the count and 1, the percentile and its report count, or a numerator
/// and its denominator. No threshold: no target exists yet.
#[derive(Clone)]
#[spacetimedb::table(accessor = gameplay_metric_sample)]
pub struct GameplayMetricSample {
    #[primary_key]
    #[auto_inc]
    // `pub`: `tables::restore::restore_gameplay_metric_sample` constructs this row.
    pub sample_id: u64,
    #[index(btree)]
    pub sampled_at: Timestamp,
    pub series_code: u32,
    pub value: u64,
    pub sample_size: u64,
}

/// One period accumulator row (`sim::gameplay_metrics::Tally`).
#[derive(Clone)]
#[spacetimedb::table(accessor = metric_tally)]
pub struct MetricTally {
    #[primary_key]
    pub tally_key: u64,
    pub value: u64,
}

/// One open connection. Inserted by `identity_connected`, deleted by
/// `identity_disconnected`; the flags record which client measures the
/// connection has reported. It carries no identity (FR142): a player is
/// keyed on `character_id`, and nothing here needs to know who. The host
/// calls `client_disconnected` for every dangling client at launch, and on an
/// update that disconnects clients, so no row outlives its connection
/// (SpacetimeDB `crates/core/src/host/host_controller.rs`, "Disconnect
/// dangling clients").
#[derive(Clone)]
#[spacetimedb::table(accessor = connected_client)]
pub struct ConnectedClient {
    #[primary_key]
    pub connection_id: ConnectionId,
    pub boot_reported: bool,
    pub resume_reported: bool,
}

/// What a client reports about itself; validated in
/// `sim::gameplay_metrics::accept_measure`.
#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClientMeasure {
    Boot { millis: u32 },
    Resumed { outage_millis: u32 },
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

/// The period held in `metric_tally`; a missing row reads as zero.
fn load_period(ctx: &ReducerContext) -> Period {
    Period::from_tallies(Tally::all().map(|t| {
        let value = ctx
            .db
            .metric_tally()
            .tally_key()
            .find(t.key())
            .map_or(0, |r| r.value);
        (t, value)
    }))
}

/// Writes `period` back: a zero is the absence of a row, so the table
/// holds only what accumulated.
fn store_period(ctx: &ReducerContext, period: &Period) {
    for (tally, value) in period.tallies() {
        let key = tally.key();
        let existing = ctx.db.metric_tally().tally_key().find(key);
        match (existing, value) {
            (Some(_), 0) => {
                ctx.db.metric_tally().tally_key().delete(key);
            }
            (Some(row), v) if row.value != v => {
                ctx.db.metric_tally().tally_key().update(MetricTally {
                    tally_key: key,
                    value: v,
                });
            }
            (None, v) if v > 0 => {
                ctx.db.metric_tally().insert(MetricTally {
                    tally_key: key,
                    value: v,
                });
            }
            _ => {}
        }
    }
}

/// `identity_connected` write: registers the connection and lifts the
/// period peak. Infallible.
pub fn record_connect(ctx: &ReducerContext) {
    let Some(connection_id) = ctx.connection_id() else {
        return;
    };
    let table = ctx.db.connected_client();
    if table.connection_id().find(connection_id).is_none() {
        table.insert(ConnectedClient {
            connection_id,
            boot_reported: false,
            resume_reported: false,
        });
    }
    let mut period = load_period(ctx);
    period.on_connect(table.count());
    store_period(ctx, &period);
}

/// `identity_disconnected` write: deleting a missing row is a no-op, so
/// the count cannot underflow. Infallible.
pub fn record_disconnect(ctx: &ReducerContext) {
    if let Some(connection_id) = ctx.connection_id() {
        ctx.db
            .connected_client()
            .connection_id()
            .delete(connection_id);
    }
}

/// The one client-to-server measure call (NFR32 allowlist). A refusal is
/// `Err`, so it is uncounted and writes nothing.
#[spacetimedb::reducer]
pub fn report_client_measure(ctx: &ReducerContext, measure: ClientMeasure) -> Result<(), String> {
    count_call(ctx, ReducerClass::Player);
    let connection_id = ctx
        .connection_id()
        .ok_or_else(|| "no connection to report on".to_string())?;
    let row = ctx
        .db
        .connected_client()
        .connection_id()
        .find(connection_id)
        .ok_or_else(|| "connection is not registered".to_string())?;
    let measure = match measure {
        ClientMeasure::Boot { millis } => Measure::Boot { millis },
        ClientMeasure::Resumed { outage_millis } => Measure::Resumed { outage_millis },
    };
    let flags = sim::gameplay_metrics::accept_measure(
        ConnFlags {
            boot_reported: row.boot_reported,
            resume_reported: row.resume_reported,
        },
        measure,
    )
    .map_err(|refusal| refusal.message().to_string())?;
    let mut period = load_period(ctx);
    period.on_measure(measure);
    store_period(ctx, &period);
    ctx.db
        .connected_client()
        .connection_id()
        .update(ConnectedClient {
            boot_reported: flags.boot_reported,
            resume_reported: flags.resume_reported,
            ..row
        });
    Ok(())
}

/// One fire gameplay-metric rows: every live series once (`Period::fire`,
/// whose exhaustive `match` is the compile-time emitter guarantee), then
/// the next period is stored. Prunes by retention and by the table own
/// `max_rows` before inserting.
fn sample_gameplay_metrics(ctx: &ReducerContext, now: Timestamp) {
    let live = ctx.db.connected_client().count();
    let (figures, next) = load_period(ctx).fire(live);
    let rows: Vec<GameplayMetricSample> = figures
        .into_iter()
        .map(|(series, value, sample_size)| GameplayMetricSample {
            sample_id: 0,
            sampled_at: now,
            series_code: series.code(),
            value,
            sample_size,
        })
        .collect();
    store_period(ctx, &next);

    let cutoff = Timestamp::from_micros_since_unix_epoch(sim::storage::retention_cutoff_micros(
        now.to_micros_since_unix_epoch(),
    ));
    ctx.db
        .gameplay_metric_sample()
        .sampled_at()
        .delete(..cutoff);
    drop_oldest(
        ctx.db.gameplay_metric_sample().count(),
        rows.len() as u64,
        "gameplay_metric_sample",
        |n| {
            ctx.db
                .gameplay_metric_sample()
                .sampled_at()
                .filter(Timestamp::from_micros_since_unix_epoch(i64::MIN)..)
                .take(n)
                .map(|r| r.sample_id)
                .collect()
        },
        |id| {
            ctx.db.gameplay_metric_sample().sample_id().delete(id);
        },
    );
    for row in rows {
        ctx.db.gameplay_metric_sample().insert(row);
    }
}

/// Empties the gameplay-metric period state; `begin_restore` calls it
/// (a restore does not drop connections, so `connected_client` stays).
pub fn clear_gameplay_state(ctx: &ReducerContext) {
    let keys: Vec<u64> = ctx.db.metric_tally().iter().map(|r| r.tally_key).collect();
    for key in keys {
        ctx.db.metric_tally().tally_key().delete(key);
    }
    let ids: Vec<u64> = ctx
        .db
        .gameplay_metric_sample()
        .iter()
        .map(|r| r.sample_id)
        .collect();
    for id in ids {
        ctx.db.gameplay_metric_sample().sample_id().delete(id);
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
    sample!(tenancy);
    sample!(oidc_issuer);
    sample!(link_request);
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
    sample!(holder_kind);
    sample!(actor_kind);
    sample!(actor_location);
    sample!(player_position);
    sample!(business);
    sample!(stock);
    sample!(container_kind);
    sample!(item_instance);
    sample!(item_placed);
    sample!(item_held);
    sample!(placed_object);
    sample!(floor_transition);
    sample!(building);
    sample!(room);
    sample!(building_area);
    sample!(district);
    sample!(route_node);
    sample!(route_edge);
    sample!(route_provision);
    sample!(edge_kind);
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
    sample!(gameplay_metric_sample);
    sample!(metric_tally);
    sample!(connected_client);

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
        review_bytes: sim::storage::STORAGE_REVIEW_BYTES,
        wall_bytes: sim::storage::STORAGE_WALL_BYTES,
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

    drop_oldest(
        ctx.db.table_sample().count(),
        incoming_tables,
        "table_sample",
        |n| {
            ctx.db
                .table_sample()
                .sampled_at()
                .filter(Timestamp::from_micros_since_unix_epoch(i64::MIN)..)
                .take(n)
                .map(|r| r.sample_id)
                .collect()
        },
        |id| {
            ctx.db.table_sample().sample_id().delete(id);
        },
    );
    drop_oldest(
        ctx.db.storage_sample().count(),
        incoming_totals,
        "storage_sample",
        |n| {
            ctx.db
                .storage_sample()
                .sampled_at()
                .filter(Timestamp::from_micros_since_unix_epoch(i64::MIN)..)
                .take(n)
                .map(|r| r.sample_id)
                .collect()
        },
        |id| {
            ctx.db.storage_sample().sample_id().delete(id);
        },
    );
    drop_oldest(
        ctx.db.reducer_class_sample().count(),
        incoming_classes,
        "reducer_class_sample",
        |n| {
            ctx.db
                .reducer_class_sample()
                .sampled_at()
                .filter(Timestamp::from_micros_since_unix_epoch(i64::MIN)..)
                .take(n)
                .map(|r| r.sample_id)
                .collect()
        },
        |id| {
            ctx.db.reducer_class_sample().sample_id().delete(id);
        },
    );
}

/// Deletes the oldest rows of one `*_sample` table past its declared
/// `max_rows`: `oldest_ids(n)` lists the `n` oldest ids through the
/// `sampled_at` index, `delete` removes one. A new sample table adds one
/// call in `prune`.
fn drop_oldest(
    count: u64,
    incoming: u64,
    accessor: &str,
    oldest_ids: impl FnOnce(usize) -> Vec<u64>,
    mut delete: impl FnMut(u64),
) {
    let drop = sim::storage::rows_to_drop(
        count,
        incoming,
        sim::table_bounds::max_rows_of(accessor).unwrap_or(0),
    );
    for id in oldest_ids(drop as usize) {
        delete(id);
    }
}

/// One sampler fire. Infallible: a breached bound or an unencodable row is
/// recorded and logged, never a reason to abort -- an `Err` would roll back
/// the caller's re-arm and stop the cadence.
pub fn run_sampler(ctx: &ReducerContext) {
    sample_all_tables(ctx, ctx.timestamp);
    sample_gameplay_metrics(ctx, ctx.timestamp);
}
