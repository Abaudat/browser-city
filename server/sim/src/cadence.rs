//! One repeat pattern for every scheduled cadence in the module (story
//! 4.2): phase-locked to a durable origin, catch-up-bounded, and proven
//! not to compound (docs/spikes/1.3-scheduled-reducer-timing.md's
//! `ONESHOT_ANCHORED` shape, corrected here to skip straight to the next
//! still-future target rather than reinserting one bucket past a target
//! already in the past -- which is what produced the spike's own
//! measured catch-up burst). `docs/architecture.md`'s "Scheduled
//! reducers" section is the rule this implements;
//! `tables::schedules::arm_cadence` (`../../src`) is its one reducer-side
//! caller, never `ScheduleAt::Interval` (`scripts/ci/
//! check-server-src-bans.sh` bans it mechanically).

use crate::time::REAL_MS_PER_CITY_MINUTE;

/// The floor every cadence period must clear (docs/architecture.md): no
/// system built on this pattern may assume finer real-time precision
/// than one in-city minute.
pub const MIN_PERIOD_MS: i64 = REAL_MS_PER_CITY_MINUTE;

/// Declares a cadence period in whole city minutes -- never a raw
/// millisecond count, so a sub-minute cadence cannot even be spelled. A
/// `const fn`: called from a `const` context (every cadence's own period
/// constant below), a period under one city minute panics at *compile*
/// time, never in production (AC2's server half).
pub const fn period_ms(city_minutes: i64) -> i64 {
    assert!(
        city_minutes >= 1,
        "a cadence period must be at least one whole city minute"
    );
    city_minutes * REAL_MS_PER_CITY_MINUTE
}

/// The maintenance cadence's own period (story 4.2's first occupant): ten
/// city minutes, a placeholder ops cadence (Tim's direction, not a design
/// decision this story makes permanent).
pub const MAINTENANCE_PERIOD_CITY_MINUTES: i64 = 10;
pub const MAINTENANCE_PERIOD_MS: i64 = period_ms(MAINTENANCE_PERIOD_CITY_MINUTES);

/// The next phase-preserving, catch-up-bounded target strictly after
/// both `now_micros` and `origin_micros`, for a cadence anchored at
/// `origin_micros` (any grid point congruent to the cadence's true phase
/// mod `period_ms` -- `world_clock.epoch_at`'s own micros on the first
/// arm, or a previously returned target on a later re-arm; both are
/// valid, and re-arming from either at the same real time yields the
/// identical result) with period `period_ms`. Returns `(target_micros,
/// missed)`: `missed` is how many whole periods elapsed between
/// `origin_micros` and `now_micros` -- `0` when `now_micros` is still
/// within the first period after the origin (the steady, on-time case),
/// `> 0` only after a real pause (a deploy, a host stall) longer than one
/// period. Every missed target is skipped, never separately dispatched:
/// this is what bounds catch-up to exactly one late fire rather than the
/// back-to-back burst a repeat that reschedules one bucket past an
/// already-past target produces (docs/spikes/
/// 1.3-scheduled-reducer-timing.md's Catch-up leg).
///
/// `next_index` is floored at `1`: an early dispatch (`now_micros`
/// strictly before `origin_micros`, which nothing forbids -- a scheduled
/// reducer can run any time at or after its own target, never provably
/// before it, but a microsecond-scale race is not excluded) would
/// otherwise make `div_euclid` return `-1` and the target collapse onto
/// `origin_micros` itself -- an already-due target reinserted, firing the
/// same grid point twice. Clamping means the target is always strictly
/// after `origin_micros` too, not only after `now_micros`.
///
/// Integer arithmetic only, `i128` intermediates: total over any `i64`
/// pair for `origin_micros`/`now_micros`, for any positive `period_ms` --
/// never panics, never wraps (NFR41), even at `i64::MIN`/`i64::MAX`. A
/// non-positive `period_ms` (never produced by a real cadence constant --
/// [`period_ms`] above refuses it at compile time) is floored to 1ms
/// rather than dividing by zero, so this function stays total over every
/// input.
pub fn next_target(origin_micros: i64, period_ms: i64, now_micros: i64) -> (i64, u64) {
    let period_micros = (period_ms.max(1) as i128) * 1000;
    let elapsed = now_micros as i128 - origin_micros as i128;
    // The largest whole number of periods that have elapsed by `now`
    // (negative before the origin, via div_euclid) -- the "arithmetic
    // gap". The returned target is always the *next* grid point past it.
    let last_index = elapsed.div_euclid(period_micros);
    let next_index = (last_index + 1).max(1);
    let target = (origin_micros as i128 + next_index * period_micros)
        .clamp(i64::MIN as i128, i64::MAX as i128) as i64;
    let missed = last_index.max(0) as u64;
    (target, missed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn period_ms_converts_whole_city_minutes() {
        assert_eq!(period_ms(1), REAL_MS_PER_CITY_MINUTE);
        assert_eq!(period_ms(10), 10 * REAL_MS_PER_CITY_MINUTE);
        assert_eq!(MAINTENANCE_PERIOD_MS, 10 * REAL_MS_PER_CITY_MINUTE);
    }

    #[test]
    fn an_early_dispatch_never_returns_its_own_origin() {
        let origin = 1_000_000i64;
        let period_ms = 2_500i64;
        // one microsecond before the origin -- nothing forbids a
        // scheduled reducer's own dispatch from landing here.
        let now = origin - 1;
        let (target, missed) = next_target(origin, period_ms, now);
        assert_eq!(missed, 0);
        assert_eq!(target, origin + period_ms * 1000);
        assert!(target > origin);
    }

    #[test]
    fn on_time_call_has_zero_missed_and_targets_one_period_out() {
        let origin = 0i64;
        let period_ms = 2_500i64;
        let now = 100_000i64; // still within the first period
        let (target, missed) = next_target(origin, period_ms, now);
        assert_eq!(missed, 0);
        assert_eq!(target, period_ms * 1000);
    }

    #[test]
    fn a_pause_skips_straight_to_the_next_future_target_and_counts_what_it_skipped() {
        let origin = 0i64;
        let period_ms = 100i64;
        // 10_050ms elapsed: 100 whole 100ms periods (indices 1..=100) have
        // already passed by `now`; the next one is index 101.
        let now = 10_050_000i64;
        let (target, missed) = next_target(origin, period_ms, now);
        assert_eq!(missed, 100);
        assert_eq!(target, 101 * period_ms * 1000);
        assert!(target > now);
    }
}
