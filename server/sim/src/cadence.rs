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

use crate::time::{MAX_CLOCK_SPEED, REAL_MS_PER_CITY_MINUTE};

/// The floor every cadence period must clear (docs/architecture.md): no
/// system built on this pattern may assume finer real-time precision
/// than one in-city minute.
pub const MIN_PERIOD_MS: i64 = REAL_MS_PER_CITY_MINUTE;

// The shortest declared period, at the fastest clock, is still at least 25
// real ms: the multiplier is for watching, and past this the scheduler
// could not deliver a tick anyway.
const _: () = assert!(MIN_PERIOD_MS * 1000 / MAX_CLOCK_SPEED as i64 >= 25_000);

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

/// The metrics sampler's period: one city day, which is exactly one real
/// hour at speed 1.
pub const METRICS_PERIOD_CITY_MINUTES: i64 = 1440;
pub const METRICS_PERIOD_MS: i64 = period_ms(METRICS_PERIOD_CITY_MINUTES);

/// A cadence period in real microseconds at clock `speed`: `period_ms` is
/// the period at speed 1. Floored to 1 so it is never a divisor of zero.
fn period_micros(period_ms: i64, speed: u32) -> i128 {
    ((period_ms.max(1) as i128) * 1000 / speed.max(1) as i128).max(1)
}

/// The whole city minute (since the epoch) a real `target_micros` falls
/// in for a clock anchored at `origin_micros` running at `speed`: the
/// minute a live tick is for.
pub fn city_minute_of(origin_micros: i64, speed: u32, target_micros: i64) -> i64 {
    let minute = crate::time::micros_per_city_minute(speed) as i128;
    (target_micros as i128 - origin_micros as i128)
        .div_euclid(minute)
        .clamp(i64::MIN as i128, i64::MAX as i128) as i64
}

/// The real instant of grid point `index` of a cadence anchored at
/// `origin_micros`, at clock `speed`. Clamped to `i64`, never panics.
pub fn grid_point(origin_micros: i64, period_ms: i64, speed: u32, index: i64) -> i64 {
    (origin_micros as i128 + index as i128 * period_micros(period_ms, speed))
        .clamp(i64::MIN as i128, i64::MAX as i128) as i64
}

/// The grid index of a pending target: `target_micros` is a grid point of
/// the cadence anchored at `origin_micros`, so this is exact for one.
pub fn pending_index(origin_micros: i64, period_ms: i64, speed: u32, target_micros: i64) -> i128 {
    (target_micros as i128 - origin_micros as i128).div_euclid(period_micros(period_ms, speed))
}

/// The last grid index at or before the instant `now + jump_micros` (a
/// forward jump of that many real microseconds) for one cadence.
pub fn last_index(
    origin_micros: i64,
    period_ms: i64,
    speed: u32,
    now_micros: i64,
    jump_micros: i64,
) -> i128 {
    let elapsed = now_micros as i128 - origin_micros as i128;
    (elapsed + jump_micros.max(0) as i128).div_euclid(period_micros(period_ms, speed))
}

/// One replayed cadence fire.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Replay {
    /// The city minute (since the epoch) the fire is for.
    pub city_minute: i64,
    /// Position in the caller's cadence list -- the fixed tie-break order.
    pub cadence: usize,
    pub index: i64,
}

/// Every fire a jump replays, in ascending city minute, ties in list
/// order. Each entry of `cadences` is one armed cadence's `(period_ms,
/// first_index)`: `first_index` is its pending row's own grid index (the
/// fire the scheduler has not yet dispatched, which may already be due),
/// and the plan runs through the last index at or before `now + jump`. A
/// cadence with no pending row is simply not listed. `city_minute` is
/// derived exactly as a live tick derives it (`city_minute_of` over the
/// grid point). `Err(total)` when there would be more than `max_ticks`,
/// before anything is built.
pub fn replay_plan(
    origin_micros: i64,
    cadences: &[(i64, i128)],
    speed: u32,
    now_micros: i64,
    jump_micros: i64,
    max_ticks: u64,
) -> Result<Vec<Replay>, u64> {
    let lasts: Vec<i128> = cadences
        .iter()
        .map(|&(p, _)| last_index(origin_micros, p, speed, now_micros, jump_micros))
        .collect();
    let total: u128 = cadences
        .iter()
        .zip(&lasts)
        .map(|(&(_, first), &last)| (last - first + 1).max(0) as u128)
        .sum();
    if total > max_ticks as u128 {
        return Err(total.min(u64::MAX as u128) as u64);
    }
    let mut plan = Vec::with_capacity(total as usize);
    for (cadence, (&(p, first), &last)) in cadences.iter().zip(&lasts).enumerate() {
        let mut index = first;
        while index <= last {
            let index64 = index.clamp(i64::MIN as i128, i64::MAX as i128) as i64;
            let at = grid_point(origin_micros, p, speed, index64);
            plan.push(Replay {
                city_minute: city_minute_of(origin_micros, speed, at),
                cadence,
                index: index64,
            });
            index += 1;
        }
    }
    plan.sort_by_key(|r| (r.city_minute, r.cadence));
    Ok(plan)
}

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
pub fn next_target(origin_micros: i64, period_ms: i64, speed: u32, now_micros: i64) -> (i64, u64) {
    let period_micros = period_micros(period_ms, speed);
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
    fn the_metrics_period_is_one_real_hour_at_speed_one() {
        assert_eq!(METRICS_PERIOD_MS, 3_600_000);
    }

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
        let (target, missed) = next_target(origin, period_ms, 1, now);
        assert_eq!(missed, 0);
        assert_eq!(target, origin + period_ms * 1000);
        assert!(target > origin);
    }

    #[test]
    fn on_time_call_has_zero_missed_and_targets_one_period_out() {
        let origin = 0i64;
        let period_ms = 2_500i64;
        let now = 100_000i64; // still within the first period
        let (target, missed) = next_target(origin, period_ms, 1, now);
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
        let (target, missed) = next_target(origin, period_ms, 1, now);
        assert_eq!(missed, 100);
        assert_eq!(target, 101 * period_ms * 1000);
        assert!(target > now);
    }
}

#[cfg(test)]
mod jump_tests {
    use super::*;

    #[test]
    fn a_faster_clock_shortens_the_period() {
        let (target, _) = next_target(0, 2_500, 10, 0);
        assert_eq!(target, 250_000);
    }

    #[test]
    fn a_ten_minute_cadence_fires_1008_times_in_a_week() {
        let week = 7 * 1440 * REAL_MS_PER_CITY_MINUTE * 1000;
        let first = pending_index(
            0,
            MAINTENANCE_PERIOD_MS,
            1,
            next_target(0, MAINTENANCE_PERIOD_MS, 1, 0).0,
        );
        let last = last_index(0, MAINTENANCE_PERIOD_MS, 1, 0, week);
        assert_eq!(last - first + 1, 1008);
    }

    #[test]
    fn the_plan_is_ordered_and_capped() {
        let p = replay_plan(
            0,
            &[(period_ms(10), 1), (period_ms(5), 1)],
            1,
            0,
            30 * 2_500_000,
            100,
        )
        .unwrap();
        let minutes: Vec<_> = p.iter().map(|r| (r.city_minute, r.cadence)).collect();
        assert_eq!(
            minutes,
            [
                (5, 1),
                (10, 0),
                (10, 1),
                (15, 1),
                (20, 0),
                (20, 1),
                (25, 1),
                (30, 0),
                (30, 1)
            ]
        );
        assert_eq!(
            replay_plan(0, &[(period_ms(1), 1)], 1, 0, 100 * 2_500_000, 10),
            Err(100)
        );
    }

    #[test]
    fn a_pending_target_already_due_is_replayed() {
        // Index 3 is one microsecond before `now`: due, not yet dispatched.
        let p = 2_500i64;
        let now = 3 * p * 1000 + 1;
        let plan = replay_plan(0, &[(p, 3)], 1, now, 2_500_000, 100).unwrap();
        assert_eq!(plan.first().map(|r| r.index), Some(3));
    }

    #[test]
    fn a_cadence_with_no_pending_row_replays_nothing() {
        assert_eq!(replay_plan(0, &[], 1, 0, 2_500_000 * 100, 10), Ok(vec![]));
    }
}
