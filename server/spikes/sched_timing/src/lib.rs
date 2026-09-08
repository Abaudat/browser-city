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
//!
//! **One reference frame for every repeating mode (Quentin's cycle-1
//! finding).** Every repeating probe's `scheduled_at_micros` is computed
//! from the same fixed origin, `run_start_micros + (sequence + 1) *
//! bucket_ms`, regardless of *how* the row reschedules itself. The first
//! cut of this module measured `ONESHOT_CHAINED` against its own
//! just-updated `scheduled_at` (`fired_at + bucket`) -- a moving goalpost
//! that absorbs every millisecond of lateness before the next measurement,
//! and so can never show compounding no matter what the platform does.
//! Only `BURST` (a single independent fire, no chain, no fixed-origin
//! tick number) still reads its own `scheduled_at` directly.

use spacetimedb::{ReducerContext, ScheduleAt, Table, TimeDuration, Timestamp, reducer, table};

/// `probe.mode` -- which probe shape a row represents. A plain `u8`
/// rather than an enum: see the module doc comment for why NFR36 does
/// not apply here.
pub mod mode {
    /// `ScheduleAt::Time`, and the reducer reinserts a fresh one-shot row
    /// at `fired_at + bucket` on every fire -- reschedules from *actual
    /// fire time*, so any per-fire lateness is carried forward into the
    /// next target rather than corrected. Compounds by construction.
    pub const ONESHOT_CHAINED: u8 = 0;
    /// `ScheduleAt::Interval`: the platform reschedules the same row.
    pub const INTERVAL: u8 = 1;
    /// `ScheduleAt::Time`, single fire, no reinsertion -- a load-batch row
    /// (many due in the same tick) or a republish-leg seed row.
    pub const BURST: u8 = 2;
    /// `ScheduleAt::Time`, and the reducer reinserts a fresh one-shot row
    /// at `<this fire's own fixed-origin target> + bucket` -- reschedules
    /// from the *intended* time, never from when the reducer actually
    /// ran, so a late fire does not push the next target later. This is
    /// the candidate mitigation D7 needs measured, not assumed (Quentin's
    /// cycle-1 direction): if anything can hold phase indefinitely on
    /// this platform, it should be this one.
    pub const ONESHOT_ANCHORED: u8 = 3;

    pub fn is_repeating(mode: u8) -> bool {
        mode != BURST
    }
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
    /// 0 on first insertion; incremented on every re-fire. The tick
    /// number the fixed-origin anchor is computed against for every
    /// repeating mode.
    pub sequence: u32,
    /// `ctx.timestamp` (as micros since Unix epoch) when this probe chain
    /// was first seeded -- the fixed origin every repeating mode's
    /// expected fire time is computed from:
    /// `run_start + (sequence + 1) * bucket_ms`.
    pub run_start_micros: i64,
    /// Extra `scratch` table writes `fire_probe` performs before
    /// returning, simulating a heavier reducer body -- 0 for every
    /// ladder/load/republish probe; only the "under load, per-fire cost"
    /// comparison in the idle leg sets this above 0 (Quentin's direction:
    /// the compounding rate is per-fire cost, not a platform constant,
    /// and this is what proves the rate scales with it).
    pub extra_writes: u32,
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
    /// Copied from the firing `Probe` row -- lets `sched_timing_report`
    /// (or a reader with a calculator) independently re-derive
    /// `scheduled_at_micros` for any repeating mode from
    /// `run_start_micros + (sequence + 1) * bucket_ms` rather than
    /// trusting this row's own `scheduled_at_micros` column.
    pub run_start_micros: i64,
    /// The row's expected fire time, in micros since Unix epoch. For
    /// `BURST` this is its own `ScheduleAt::Time` field; for every
    /// repeating mode it is the fixed-origin anchor above -- the same
    /// formula regardless of how the row reschedules itself, so the
    /// column never mixes two reference frames under one heading.
    pub scheduled_at_micros: i64,
    /// `ctx.timestamp`, i.e. the reducer's own view of "now" -- never a
    /// client wall clock, never `SystemTime` (Tim's measurement rule).
    pub fired_at_micros: i64,
    /// `fired_at_micros - scheduled_at_micros`. Positive is late.
    pub drift_micros: i64,
}

/// Throwaway sink `fire_probe` writes into to simulate a heavier reducer
/// body (`Probe::extra_writes`). Never read back; its only purpose is to
/// cost the reducer real commit time.
#[table(accessor = scratch)]
pub struct Scratch {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub payload: u64,
}

fn micros_of(ts: Timestamp) -> i64 {
    ts.to_micros_since_unix_epoch()
}

/// Seeds one `ONESHOT_CHAINED` probe due `bucket_ms` from now. Call once
/// per (run_id, bucket) pair; `fire_probe` keeps the chain alive.
#[reducer]
pub fn seed_oneshot_ladder(ctx: &ReducerContext, run_id: String, bucket_ms: u64) {
    seed_oneshot(ctx, run_id, bucket_ms, mode::ONESHOT_CHAINED);
}

/// Seeds one `ONESHOT_ANCHORED` probe due `bucket_ms` from now -- the
/// candidate mitigation: reschedules from its own intended time, never
/// from when it actually fired.
#[reducer]
pub fn seed_oneshot_anchored_ladder(ctx: &ReducerContext, run_id: String, bucket_ms: u64) {
    seed_oneshot(ctx, run_id, bucket_ms, mode::ONESHOT_ANCHORED);
}

fn seed_oneshot(ctx: &ReducerContext, run_id: String, bucket_ms: u64, probe_mode: u8) {
    let now = ctx.timestamp;
    let at = now + TimeDuration::from_micros(bucket_ms as i64 * 1000);
    ctx.db.probe().insert(Probe {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(at),
        run_id,
        mode: probe_mode,
        bucket_ms,
        sequence: 0,
        run_start_micros: micros_of(now),
        extra_writes: 0,
    });
}

/// Seeds one `INTERVAL` probe firing every `bucket_ms`. Call once per
/// (run_id, bucket) pair; the platform keeps the row firing.
/// `extra_writes` extra `scratch` inserts happen on every fire -- 0 for
/// the normal ladder; set above 0 only for the per-fire-cost comparison.
#[reducer]
pub fn seed_interval_ladder(
    ctx: &ReducerContext,
    run_id: String,
    bucket_ms: u64,
    extra_writes: u32,
) {
    let now = ctx.timestamp;
    ctx.db.probe().insert(Probe {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Interval(TimeDuration::from_micros(bucket_ms as i64 * 1000)),
        run_id,
        mode: mode::INTERVAL,
        bucket_ms,
        sequence: 0,
        run_start_micros: micros_of(now),
        extra_writes,
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
            extra_writes: 0,
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
            extra_writes: 0,
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
        extra_writes: 0,
    });
}

/// The scheduler-only reducer every probe names. Records exactly one raw
/// `observation` row, performs `extra_writes` throwaway writes to
/// simulate a heavier body, then keeps the measurement running:
/// `ONESHOT_CHAINED` reinserts at `fired_at + bucket`; `ONESHOT_ANCHORED`
/// reinserts at `<this fire's own fixed-origin target> + bucket`;
/// `INTERVAL` bumps its own `sequence` so the next fire's anchor
/// advances; `BURST` does nothing further (the platform deletes a fired
/// one-shot row itself).
#[reducer]
pub fn fire_probe(ctx: &ReducerContext, row: Probe) {
    let fired_at = ctx.timestamp;
    let fired_at_micros = micros_of(fired_at);

    // One reference frame for every repeating mode (see module doc
    // comment): only BURST, which never reschedules and has no tick
    // number, reads its own `scheduled_at` directly.
    let scheduled_at_micros = if mode::is_repeating(row.mode) {
        row.run_start_micros + (row.sequence as i64 + 1) * row.bucket_ms as i64 * 1000
    } else {
        match row.scheduled_at {
            ScheduleAt::Time(t) => micros_of(t),
            ScheduleAt::Interval(_) => unreachable!("BURST rows are always ScheduleAt::Time"),
        }
    };

    ctx.db.observation().insert(Observation {
        id: 0,
        run_id: row.run_id.clone(),
        mode: row.mode,
        bucket_ms: row.bucket_ms,
        sequence: row.sequence,
        run_start_micros: row.run_start_micros,
        scheduled_at_micros,
        fired_at_micros,
        drift_micros: fired_at_micros - scheduled_at_micros,
    });

    for i in 0..row.extra_writes {
        ctx.db.scratch().insert(Scratch {
            id: 0,
            payload: (row.sequence as u64) * 1_000_000 + i as u64,
        });
    }

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
                extra_writes: row.extra_writes,
            });
        }
        mode::ONESHOT_ANCHORED => {
            // Reschedules from the target this fire was *supposed* to
            // hit, not from when it actually ran -- if that target is
            // already in the past (this fire was late), the platform
            // dispatches the next one immediately rather than waiting a
            // full bucket, which is the honest, unmassaged behaviour of
            // "try to hold phase" on this platform.
            let next_at_micros = scheduled_at_micros + row.bucket_ms as i64 * 1000;
            ctx.db.probe().insert(Probe {
                scheduled_id: 0,
                scheduled_at: ScheduleAt::Time(Timestamp::from_micros_since_unix_epoch(
                    next_at_micros,
                )),
                run_id: row.run_id,
                mode: mode::ONESHOT_ANCHORED,
                bucket_ms: row.bucket_ms,
                sequence: row.sequence + 1,
                run_start_micros: row.run_start_micros,
                extra_writes: row.extra_writes,
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
