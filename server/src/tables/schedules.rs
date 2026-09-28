//! One scheduled table per system that owns a cadence (NFR34), declared
//! now even where a story has not yet given it work to do -- a normal
//! table can never become a scheduled one, so the alternative is being
//! wrong forever. Each carries exactly `scheduled_id`/`scheduled_at` plus
//! nothing yet, and each reducer does exactly two things: refuses any
//! caller that is not the scheduler itself, and otherwise returns
//! `Ok(())`.
//!
//! Story 4.2 arms the first one for real: `maintenance_schedule`, ten
//! city minutes. Every cadence in this module shares the one repeat
//! pattern below -- `sim::cadence::next_target`, `ScheduleAt::Time` only,
//! never `ScheduleAt::Interval` (`scripts/ci/check-server-src-bans.sh`
//! bans it mechanically). The other six scheduled tables stay unarmed:
//! an empty-bodied cadence still costs one dispatch's worth of scheduler
//! bookkeeping per fire for nothing (Tim's direction) -- each is armed by
//! the story that first gives it real work.
//!
//! `cadence_liveness` (below) is the durable proof a cadence is alive:
//! one row per armed cadence, written only from inside that cadence's own
//! fired reducer, never from an arm. What `scripts/ci/
//! check-authoritative-loop.sh` reads with zero clients connected, what a
//! future metrics sampler (story 4.12) will sample for lateness, and what
//! a future dead-man's check in `backup.yml` can alarm on.
//!
//! `begin_restore`/`finish_restore` (`tables::restore`) bracket every
//! restore with [`disarm_all_scheduled_tables`] and [`arm_every_cadence`]:
//! a restore target's own cadence is live and armed the instant `init`
//! publishes it, so nothing may be allowed to fire between opening a
//! restore and re-arming from the epoch actually being restored.

use spacetimedb::{ReducerContext, ScheduleAt, Table, Timestamp};

use super::cadences;
use super::clock::{current_speed, read_clock};

/// Only the module's own scheduler may invoke a scheduled reducer --
/// otherwise any client could call it directly, which is a security hole,
/// not a style point.
fn require_scheduler(ctx: &ReducerContext) -> Result<(), String> {
    if ctx.sender() != ctx.database_identity() {
        return Err("this reducer may only be invoked by the scheduler".to_string());
    }
    Ok(())
}

/// A fired cadence row's own `scheduled_at` must always be
/// `ScheduleAt::Time` -- this module never inserts `ScheduleAt::Interval`
/// anywhere (`scripts/ci/check-server-src-bans.sh`). Written with a
/// `let-else`, never a `match` naming `ScheduleAt::Interval` by pattern,
/// so that ban has nothing to except itself against.
fn schedule_at_micros(at: ScheduleAt) -> Result<i64, String> {
    let ScheduleAt::Time(t) = at else {
        return Err(
            "a cadence's own scheduled row must always hold ScheduleAt::Time -- never a repeating schedule"
                .to_string(),
        );
    };
    Ok(t.to_micros_since_unix_epoch())
}

/// Deletes every pending row `iter_ids`/`delete` can see and inserts
/// exactly one, at the next phase-preserving, catch-up-bounded target
/// computed by `sim::cadence::next_target` from `origin_micros`/
/// `period_ms`/`ctx.timestamp`. The one function every cadence's arm
/// (`arm_every_cadence_from`/`arm_every_cadence`) and every cadence's own
/// fired reducer body (re-arming itself after doing its work) both call.
/// `insert`/`delete`/`iter_ids` close over `ctx` and one
/// cadence's own scheduled table -- the same shape
/// `tables::restore::restore_autoinc_rows` uses, for the same reason: no
/// shared trait across SpacetimeDB's per-table generated accessors to
/// abstract this genuinely generically. Returns `(target_micros,
/// missed)`.
fn arm_cadence(
    ctx: &ReducerContext,
    origin_micros: i64,
    period_ms: i64,
    mut iter_ids: impl FnMut() -> Vec<u64>,
    mut delete: impl FnMut(u64),
    mut insert: impl FnMut(ScheduleAt),
) -> (i64, u64) {
    for id in iter_ids() {
        delete(id);
    }
    let (target_micros, missed) = sim::cadence::next_target(
        origin_micros,
        period_ms,
        current_speed(ctx),
        ctx.timestamp.to_micros_since_unix_epoch(),
    );
    insert(ScheduleAt::Time(Timestamp::from_micros_since_unix_epoch(
        target_micros,
    )));
    (target_micros, missed)
}

/// L2 citizen transitions (FR49): advances every citizen identically at
/// transitions via this table -- nobody ticks.
#[spacetimedb::table(accessor = citizen_transition_schedule, scheduled(advance_citizen_transitions))]
pub struct CitizenTransitionSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[spacetimedb::reducer]
pub fn advance_citizen_transitions(
    ctx: &ReducerContext,
    _row: CitizenTransitionSchedule,
) -> Result<(), String> {
    require_scheduler(ctx)
}

/// The metrics sampler (FR169): samples per-table row counts and bytes on a
/// slow cadence.
#[spacetimedb::table(accessor = metrics_sample_schedule, scheduled(sample_metrics))]
pub struct MetricsSampleSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[spacetimedb::reducer]
pub fn sample_metrics(ctx: &ReducerContext, _row: MetricsSampleSchedule) -> Result<(), String> {
    require_scheduler(ctx)
}

/// The institutional calendar's budget review (FR78): drains the demand
/// signal deferred matters accumulate.
#[spacetimedb::table(accessor = budget_review_schedule, scheduled(run_budget_review))]
pub struct BudgetReviewSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[spacetimedb::reducer]
pub fn run_budget_review(ctx: &ReducerContext, _row: BudgetReviewSchedule) -> Result<(), String> {
    require_scheduler(ctx)
}

/// The world clock (FR1-FR3): advances continuously whether or not any
/// client is connected; the server never spins down. Story 4.1's own
/// decision stands: nothing ticks it, so this table carries no row and
/// this reducer is never armed.
#[spacetimedb::table(accessor = world_clock_schedule, scheduled(advance_world_clock))]
pub struct WorldClockSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[spacetimedb::reducer]
pub fn advance_world_clock(ctx: &ReducerContext, _row: WorldClockSchedule) -> Result<(), String> {
    require_scheduler(ctx)
}

/// The economy (FR66-FR68, FR91): exogenous prices, labour-market
/// self-balancing and the rest of L1's slow-cadence upkeep.
#[spacetimedb::table(accessor = economy_schedule, scheduled(run_economy_tick))]
pub struct EconomySchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[spacetimedb::reducer]
pub fn run_economy_tick(ctx: &ReducerContext, _row: EconomySchedule) -> Result<(), String> {
    require_scheduler(ctx)
}

/// Growth and development (FR157-FR162): new neighbourhoods, in-migration
/// and the development chain's slow cadence.
#[spacetimedb::table(accessor = growth_schedule, scheduled(run_growth_tick))]
pub struct GrowthSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[spacetimedb::reducer]
pub fn run_growth_tick(ctx: &ReducerContext, _row: GrowthSchedule) -> Result<(), String> {
    require_scheduler(ctx)
}

/// Maintenance/janitor slot: the one cadence reserved for upkeep that
/// belongs to no gameplay system -- expiring matters (FR79), pruning
/// stale memory, and whatever else earns its own slot rather than
/// piggybacking on someone else's cadence. Story 4.2's first real
/// occupant: armed at ten city minutes (`sim::cadence::
/// MAINTENANCE_PERIOD_MS`), a placeholder ops cadence, not a design
/// decision. Has nothing to maintain yet (matters do not exist), so its
/// only work today is recording that the loop is alive
/// (`cadence_liveness`, below).
#[spacetimedb::table(accessor = maintenance_schedule, scheduled(run_maintenance))]
pub struct MaintenanceSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

/// One row per armed cadence -- the durable proof a repeat is alive.
/// `cadence` is this table's own small, closed code space (never
/// `sim::codes`' NFR36 extensible sets: there are exactly as many
/// cadences as this file declares scheduled tables, never a
/// content-extensible one). Public and ordinary (non-scheduled) durable
/// state, restored like the code tables and `module_owner`:
/// `restore_cadence_liveness` replaces whatever is there rather than
/// requiring it empty, because a freshly-published target's own `init`
/// arms its cadence immediately, and that cadence can fire for real (and
/// write this table) any time before `begin_restore` ever runs.
#[derive(Clone)]
#[spacetimedb::table(accessor = cadence_liveness, public)]
pub struct CadenceLiveness {
    #[primary_key]
    // `pub`: `tables::restore::restore_cadence_liveness` constructs this
    // row.
    pub cadence: u32,
    pub last_target_at: Timestamp,
    pub last_fired_at: Timestamp,
    pub fires: u64,
    pub missed: u64,
}

/// [`CadenceLiveness::cadence`] codes -- one per scheduled table this
/// file arms for real, added the story that arms it.
pub mod cadence_code {
    pub const MAINTENANCE: u32 = 1;
}

/// Re-arms `maintenance_schedule` from `origin_micros`. Shared by
/// `arm_every_cadence_from` (the initial arm, from `init`/
/// `finish_restore`), `arm_every_cadence` (from `rearm_schedules`), and
/// `run_maintenance` (the re-arm after firing).
fn arm_maintenance_schedule(ctx: &ReducerContext, origin_micros: i64) -> (i64, u64) {
    arm_cadence(
        ctx,
        origin_micros,
        sim::cadence::MAINTENANCE_PERIOD_MS,
        || {
            ctx.db
                .maintenance_schedule()
                .iter()
                .map(|r| r.scheduled_id)
                .collect()
        },
        |id| {
            ctx.db.maintenance_schedule().scheduled_id().delete(id);
        },
        |at| {
            ctx.db.maintenance_schedule().insert(MaintenanceSchedule {
                scheduled_id: 0,
                scheduled_at: at,
            });
        },
    )
}

/// Records that `cadence` fired: `origin_micros` is the target *this*
/// fire satisfies (the row's own `scheduled_at` before re-arming -- never
/// the freshly re-armed *next* target, which is always about one period
/// in the future and would make every recorded drift read as roughly
/// `-period_ms`), `ctx.timestamp` the real fire time, `fires` and
/// `missed` (NFR41: the whole quantity below is `Copy`/plain arithmetic,
/// nothing here can panic) both accumulated across the cadence's whole
/// life -- an upsert, since the very first fire creates this row.
pub(super) fn record_cadence_fire(
    ctx: &ReducerContext,
    cadence: u32,
    origin_micros: i64,
    missed_this_fire: u64,
) {
    let last_target_at = Timestamp::from_micros_since_unix_epoch(origin_micros);
    let last_fired_at = ctx.timestamp;
    match ctx.db.cadence_liveness().cadence().find(cadence) {
        Some(row) => {
            ctx.db.cadence_liveness().cadence().update(CadenceLiveness {
                last_target_at,
                last_fired_at,
                fires: row.fires + 1,
                missed: row.missed + missed_this_fire,
                ..row
            });
        }
        None => {
            ctx.db.cadence_liveness().insert(CadenceLiveness {
                cadence,
                last_target_at,
                last_fired_at,
                fires: 1,
                missed: missed_this_fire,
            });
        }
    }
}

#[spacetimedb::reducer]
pub fn run_maintenance(ctx: &ReducerContext, row: MaintenanceSchedule) -> Result<(), String> {
    require_scheduler(ctx)?;
    let origin_micros = schedule_at_micros(row.scheduled_at)?;
    // The work is a function of the city minute this fire is for, never
    // of the real time it happened to run at.
    let (epoch_micros, speed) =
        read_clock(ctx).ok_or_else(|| "world_clock has no row -- init did not run".to_string())?;
    cadences::maintenance(
        ctx,
        sim::cadence::city_minute_of(epoch_micros, speed, origin_micros),
    );
    let (_next_target_micros, missed) = arm_maintenance_schedule(ctx, origin_micros);
    record_cadence_fire(ctx, cadence_code::MAINTENANCE, origin_micros, missed);
    Ok(())
}

/// Arms every cadence this file gives real work to (today: just
/// `maintenance_schedule`) from an already-known epoch, in micros --
/// infallible, since the caller already has the epoch in hand (`init`
/// just wrote or found it; `finish_restore` just restored `world_clock`
/// itself) and there is no lookup here that could fail. Schedules are
/// derived state, rebuilt explicitly, never trusted to survive a deploy
/// purely by surviving as pending rows (docs/architecture.md).
pub fn arm_every_cadence_from(ctx: &ReducerContext, epoch_micros: i64) {
    arm_maintenance_schedule(ctx, epoch_micros);
}

/// Looks up `world_clock.epoch_at` and arms every cadence from it.
/// `ok_or(Err)`, never `unwrap`/`expect` (NFR41): an absent epoch aborts
/// the whole call and arms nothing, which is the correct outcome for an
/// inconsistent world. The owner-only `rearm_schedules` reducer
/// (`../lib.rs`) is this function's only caller -- every other caller
/// already has the epoch in hand and calls [`arm_every_cadence_from`]
/// directly instead.
pub fn arm_every_cadence(ctx: &ReducerContext) -> Result<(), String> {
    let (epoch_micros, _speed) =
        read_clock(ctx).ok_or_else(|| "world_clock has no row -- init did not run".to_string())?;
    arm_every_cadence_from(ctx, epoch_micros);
    Ok(())
}

/// Deletes every pending row of every scheduled table this module
/// declares, armed or not. Called from `begin_restore` (`tables::
/// restore`, story 4.2): a restore target's own cadence is live and armed
/// from its own `init` the instant it is published, so without this a
/// scheduled reducer can fire on the target at any point during the
/// restore, using an epoch that belongs to the target's own pre-restore
/// world, not the one being restored. Schedules are derived state
/// (docs/architecture.md) -- disarming the target's own is exactly as
/// disposable as never restoring the source's.
///
/// One `disarm!(accessor)` invocation per scheduled table, never a
/// hand-copied loop body per table (seven identical bodies is the shape
/// that gets one of them wrong) -- the same `macro_rules!`-per-table
/// precedent `tables::restore::impl_autoinc_row!` sets.
/// `bounds/tests/schedules_coverage.rs` keeps this list itself honest:
/// every scheduled accessor the schema declares must appear as a
/// `disarm!(...)` call here, and nothing else may.
pub fn disarm_all_scheduled_tables(ctx: &ReducerContext) {
    macro_rules! disarm {
        ($accessor:ident) => {
            for id in ctx
                .db
                .$accessor()
                .iter()
                .map(|r| r.scheduled_id)
                .collect::<Vec<_>>()
            {
                ctx.db.$accessor().scheduled_id().delete(id);
            }
        };
    }
    disarm!(citizen_transition_schedule);
    disarm!(metrics_sample_schedule);
    disarm!(budget_review_schedule);
    disarm!(world_clock_schedule);
    disarm!(economy_schedule);
    disarm!(growth_schedule);
    disarm!(maintenance_schedule);
}

/// Replays every fire a forward clock jump skips, through the same
/// bodies the live loop calls, in ascending city minute (ties in walk
/// order), recording each in `cadence_liveness` with its target
/// expressed in the post-jump epoch `new_epoch_micros`. Refuses --
/// before anything is written -- when the jump holds more than
/// `sim::time::MAX_JUMP_TICKS` ticks, or when a scheduled table this
/// walker does not own has a pending row. The caller (`time_control`)
/// runs it inside the one reducer transaction, so any `Err` rolls the
/// whole jump back.
///
/// One `walk!`/`refuse!` invocation per scheduled table:
/// `bounds/tests/schedules_coverage.rs` requires every scheduled
/// accessor to appear here exactly once, so a cadence added later cannot
/// be silently skipped by a jump.
#[cfg(feature = "time-control")]
pub fn replay_skipped_cadences(
    ctx: &ReducerContext,
    epoch_micros: i64,
    speed: u32,
    jump_micros: i64,
    new_epoch_micros: i64,
) -> Result<(), String> {
    type Body = fn(&ReducerContext, i64);
    let mut walked: Vec<(u32, i64, Body)> = Vec::new();
    macro_rules! walk {
        ($accessor:ident, $code:expr, $period_ms:expr, $body:expr) => {
            if ctx.db.$accessor().iter().count() > 1 {
                return Err(format!(
                    "{} has more than its one armed row",
                    stringify!($accessor)
                ));
            }
            walked.push(($code, $period_ms, $body));
        };
    }
    macro_rules! refuse {
        ($accessor:ident) => {
            if ctx.db.$accessor().iter().next().is_some() {
                return Err(format!(
                    "{} has a pending row a clock jump cannot replay",
                    stringify!($accessor)
                ));
            }
        };
    }
    refuse!(citizen_transition_schedule);
    refuse!(metrics_sample_schedule);
    refuse!(budget_review_schedule);
    refuse!(world_clock_schedule);
    refuse!(economy_schedule);
    refuse!(growth_schedule);
    walk!(
        maintenance_schedule,
        cadence_code::MAINTENANCE,
        sim::cadence::MAINTENANCE_PERIOD_MS,
        cadences::maintenance
    );

    let periods: Vec<i64> = walked.iter().map(|w| w.1).collect();
    let plan = sim::cadence::replay_plan(
        epoch_micros,
        &periods,
        speed,
        ctx.timestamp.to_micros_since_unix_epoch(),
        jump_micros,
        sim::time::MAX_JUMP_TICKS,
    )
    .map_err(|total| {
        format!(
            "this jump would replay {total} cadence ticks, over the {} allowed -- jump less",
            sim::time::MAX_JUMP_TICKS
        )
    })?;
    for replay in plan {
        let Some(&(code, period_ms, body)) = walked.get(replay.cadence) else {
            return Err("replay plan names a cadence that is not walked".to_string());
        };
        body(ctx, replay.city_minute);
        let target = sim::cadence::grid_point(new_epoch_micros, period_ms, speed, replay.index);
        record_cadence_fire(ctx, code, target, 0);
    }
    Ok(())
}
