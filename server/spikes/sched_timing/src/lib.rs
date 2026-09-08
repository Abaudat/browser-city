//! Story 1.3: measurement harness for scheduled-reducer dispatch drift,
//! commit lateness and cumulative slip. See `docs/spikes/1.3-scheduled-
//! reducer-timing.md` for the pre-registered budget, the method and the
//! findings; `scripts/dev/run-sched-timing-spike.sh` is the one-command
//! re-run entry point.
//!
//! This module is throwaway, not permanent state (docs/architecture.md's
//! "Permanent decisions" section is about `browser_city`, not this crate):
//! it is published under its own disposable database name, depended on by
//! nothing, and never touched by the deploy path. It carries no owner
//! check and no NFR36 extensible-set discipline for `mode` -- a plain `u8`
//! code is enough for a crate whose entire lifetime is a measurement run.
//!
//! Every fire writes exactly one raw `observation` row and nothing else
//! (Tim's direction): the module never computes a statistic. Stats are
//! reduced from an exported CSV by the native `sched_timing_report` binary.

use spacetimedb::{ReducerContext, ScheduleAt, Table, TimeDuration, Timestamp, reducer, table};

/// `probe.mode` -- which of three probe shapes a row represents. A plain
/// `u8` rather than an enum: see the module doc comment for why NFR36
/// does not apply here.
pub mod mode {
    /// `ScheduleAt::Time`, and the reducer reinserts a fresh one-shot row
    /// `bucket_ms` after its own fire time on every fire -- a hand-rolled
    /// repeat built from one-shot dispatch, measured against `INTERVAL`
    /// (the platform's own repeat) to see whether the two differ.
    pub const ONESHOT_CHAINED: u8 = 0;
    /// `ScheduleAt::Interval`: the platform reschedules the same row: the
    /// question this mode exists to answer is whether it re-anchors to
    /// the original schedule or to the actual fire time.
    pub const INTERVAL: u8 = 1;
    /// `ScheduleAt::Time`, single fire, no reinsertion -- a load-batch row
    /// (many due in the same tick) or a republish-leg seed row.
    pub const BURST: u8 = 2;
}

/// One pending probe. Scheduled tables need a scheduler-only reducer
/// stub per docs/architecture.md's convention, but this crate has no
/// caller other than the scheduler and the harness's own seeding
/// reducers, so `fire_probe` does not gate on `ctx.sender()` -- there is
/// no owner identity to check against in a disposable spike database.
#[table(accessor = probe, scheduled(fire_probe))]
pub struct Probe {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    /// Tags one measurement leg, e.g. `"idle-interval-1000"` or
    /// `"republish-leg"` -- the harness script's own vocabulary, not a
    /// schema concept.
    pub run_id: String,
    pub mode: u8,
    /// The nominal cadence, in milliseconds, this probe was seeded at.
    pub bucket_ms: u64,
    /// 0 on first insertion; incremented on every re-fire. For `INTERVAL`
    /// and `ONESHOT_CHAINED` this is the tick number cumulative-slip is
    /// computed against.
    pub sequence: u32,
    /// `ctx.timestamp` (as micros since Unix epoch) when this probe chain
    /// was first seeded -- the anchor `fire_probe` computes an `INTERVAL`
    /// row's expected fire time from: `run_start + sequence * bucket_ms`.
    pub run_start_micros: i64,
}

/// One fired probe. Public so the harness's observer client can measure
/// observer lateness (when it saw the row), not just dispatch drift.
#[table(accessor = observation, public)]
pub struct Observation {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub run_id: String,
    pub mode: u8,
    pub bucket_ms: u64,
    pub sequence: u32,
    /// The row's own scheduled time, in micros since Unix epoch: read
    /// directly from `ScheduleAt::Time` for `ONESHOT_CHAINED`/`BURST`;
    /// computed from the run's anchor for `INTERVAL`, which stores a
    /// relative `TimeDuration` rather than an absolute next-fire time.
    pub scheduled_at_micros: i64,
    /// `ctx.timestamp`, i.e. the reducer's own view of "now" -- never a
    /// client wall clock, never `SystemTime` (Tim's measurement rule).
    pub fired_at_micros: i64,
    /// `fired_at_micros - scheduled_at_micros`. Positive is late.
    pub drift_micros: i64,
}

fn micros_of(ts: Timestamp) -> i64 {
    ts.to_micros_since_unix_epoch()
}

/// Seeds one `ONESHOT_CHAINED` probe due `bucket_ms` from now. Call once
/// per (run_id, bucket) pair; `fire_probe` keeps the chain alive.
#[reducer]
pub fn seed_oneshot_ladder(ctx: &ReducerContext, run_id: String, bucket_ms: u64) {
    let now = ctx.timestamp;
    let at = now + TimeDuration::from_micros(bucket_ms as i64 * 1000);
    ctx.db.probe().insert(Probe {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(at),
        run_id,
        mode: mode::ONESHOT_CHAINED,
        bucket_ms,
        sequence: 0,
        run_start_micros: micros_of(now),
    });
}

/// Seeds one `INTERVAL` probe firing every `bucket_ms`. Call once per
/// (run_id, bucket) pair; the platform keeps the row firing.
#[reducer]
pub fn seed_interval_ladder(ctx: &ReducerContext, run_id: String, bucket_ms: u64) {
    let now = ctx.timestamp;
    ctx.db.probe().insert(Probe {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Interval(TimeDuration::from_micros(bucket_ms as i64 * 1000)),
        run_id,
        mode: mode::INTERVAL,
        bucket_ms,
        sequence: 0,
        run_start_micros: micros_of(now),
    });
}

/// Seeds `count` independent `BURST` probes, all due `delay_ms` from now
/// -- a batch of rows due in the same tick, for the under-load ladder.
#[reducer]
pub fn seed_burst(ctx: &ReducerContext, run_id: String, count: u32, delay_ms: u64) {
    let now = ctx.timestamp;
    let at = now + TimeDuration::from_micros(delay_ms as i64 * 1000);
    let run_start_micros = micros_of(now);
    for i in 0..count {
        ctx.db.probe().insert(Probe {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Time(at),
            run_id: run_id.clone(),
            mode: mode::BURST,
            bucket_ms: delay_ms,
            sequence: i,
            run_start_micros,
        });
    }
}

/// Seeds the republish leg: one `BURST` probe per entry in `offsets_ms`
/// (independent one-shots due at each offset from now) plus one
/// `INTERVAL` probe at `interval_ms`, so the leg exercises both survival
/// shapes the AC asks about.
#[reducer]
pub fn seed_republish_leg(
    ctx: &ReducerContext,
    run_id: String,
    offsets_ms: Vec<u64>,
    interval_ms: u64,
) {
    let now = ctx.timestamp;
    let run_start_micros = micros_of(now);
    for (i, offset_ms) in offsets_ms.iter().enumerate() {
        let at = now + TimeDuration::from_micros(*offset_ms as i64 * 1000);
        ctx.db.probe().insert(Probe {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Time(at),
            run_id: run_id.clone(),
            mode: mode::BURST,
            bucket_ms: *offset_ms,
            sequence: i as u32,
            run_start_micros,
        });
    }
    ctx.db.probe().insert(Probe {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Interval(TimeDuration::from_micros(interval_ms as i64 * 1000)),
        run_id,
        mode: mode::INTERVAL,
        bucket_ms: interval_ms,
        sequence: 0,
        run_start_micros,
    });
}

/// The scheduler-only reducer every probe names. Records exactly one raw
/// `observation` row, then keeps the measurement running: `ONESHOT_CHAINED`
/// reinserts itself `bucket_ms` after its own fire time; `INTERVAL` bumps
/// its own `sequence` so the next fire's anchor advances; `BURST` does
/// nothing further (the platform deletes a fired one-shot row itself).
#[reducer]
pub fn fire_probe(ctx: &ReducerContext, row: Probe) {
    let fired_at = ctx.timestamp;
    let fired_at_micros = micros_of(fired_at);

    let scheduled_at_micros = match row.scheduled_at {
        ScheduleAt::Time(t) => micros_of(t),
        // Interval rows carry a relative duration, not an absolute next-fire
        // time -- the anchor this run's own start plus cadence * tick count
        // gives is exactly the "does tick k land near t0 + k*i" quantity
        // Tim's direction asks for, computed independently of whatever the
        // platform's own reschedule arithmetic did. `row.sequence` is the
        // count of fires *before* this one (0 on the row's first fire, the
        // completion of the row's first interval), so the tick this fire
        // completes is `sequence + 1`.
        ScheduleAt::Interval(_) => {
            row.run_start_micros + (row.sequence as i64 + 1) * row.bucket_ms as i64 * 1000
        }
    };

    ctx.db.observation().insert(Observation {
        id: 0,
        run_id: row.run_id.clone(),
        mode: row.mode,
        bucket_ms: row.bucket_ms,
        sequence: row.sequence,
        scheduled_at_micros,
        fired_at_micros,
        drift_micros: fired_at_micros - scheduled_at_micros,
    });

    match row.mode {
        mode::ONESHOT_CHAINED => {
            let next_at = fired_at + TimeDuration::from_micros(row.bucket_ms as i64 * 1000);
            ctx.db.probe().insert(Probe {
                scheduled_id: 0,
                scheduled_at: ScheduleAt::Time(next_at),
                run_id: row.run_id,
                mode: mode::ONESHOT_CHAINED,
                bucket_ms: row.bucket_ms,
                sequence: row.sequence + 1,
                run_start_micros: row.run_start_micros,
            });
        }
        mode::INTERVAL => {
            ctx.db.probe().scheduled_id().update(Probe {
                sequence: row.sequence + 1,
                ..row
            });
        }
        _ => {
            // BURST: single fire, nothing to reinsert. The platform has
            // already deleted this row now that the reducer has run.
        }
    }
}
