//! Every cadence's work, as a function of the city minute it fires for
//! and nothing else: the live scheduled reducer (`schedules.rs`) and a
//! clock jump's replay (`time_control`) call the same bodies with the
//! same signature, so a replayed tick and a live tick are one code path.
//! `scripts/ci/check-server-src-bans.sh` bans reading the real clock in
//! this file, so a body cannot know real time at all.

use spacetimedb::ReducerContext;

/// Maintenance/janitor slot (`maintenance_schedule`). Nothing to maintain
/// yet (matters do not exist): the only work today is the loop's own
/// bookkeeping, which the caller records.
pub fn maintenance(_ctx: &ReducerContext, _city_minute: i64) {
    // NFR18: this tick writes no ledger or world table; the next story
    // that wants it to "just update" something has to delete this
    // sentence to do it.
}
