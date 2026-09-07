//! One scheduled table per system that owns a cadence (NFR34), declared now
//! even where a story has not yet given it work to do -- a normal table can
//! never become a scheduled one, so the alternative is being wrong forever.
//! Each carries exactly `scheduled_id`/`scheduled_at` plus nothing yet, and
//! each reducer does exactly two things: refuses any caller that is not
//! the scheduler itself, and otherwise returns `Ok(())`. Nothing is
//! scheduled from `init` in this story (an empty scheduled table costs
//! nothing); the first row is a later story's problem.

use spacetimedb::{ReducerContext, ScheduleAt};

/// Only the module's own scheduler may invoke a scheduled reducer --
/// otherwise any client could call it directly, which is a security hole,
/// not a style point.
fn require_scheduler(ctx: &ReducerContext) -> Result<(), String> {
    if ctx.sender() != ctx.database_identity() {
        return Err("this reducer may only be invoked by the scheduler".to_string());
    }
    Ok(())
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
/// client is connected; the server never spins down.
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
/// belongs to no gameplay system -- expiring matters (FR79), pruning stale
/// memory, and whatever else earns its own slot rather than piggybacking on
/// someone else's cadence.
#[spacetimedb::table(accessor = maintenance_schedule, scheduled(run_maintenance))]
pub struct MaintenanceSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[spacetimedb::reducer]
pub fn run_maintenance(ctx: &ReducerContext, _row: MaintenanceSchedule) -> Result<(), String> {
    require_scheduler(ctx)
}
