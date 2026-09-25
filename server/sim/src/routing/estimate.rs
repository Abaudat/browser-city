//! Origin-independent travel-time estimate between two cells: Manhattan
//! distance x the derived walking rate x the mode's percent, plus a floor
//! change penalty. Pure -- takes no graph, grid or network, holds no cache.

use super::{Milliminutes, Point, TransportMode};
use crate::balance;
use crate::generated::defs::BalanceSeed;
use crate::time::REAL_MS_PER_CITY_MINUTE;

/// Per-region correction, in percent, applied once to the whole estimate.
/// Only [`Correction::NONE`] and [`Correction::percent`] can make one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Correction(i64);

impl Correction {
    /// The neutral factor: every current caller passes this.
    pub const NONE: Correction = Correction(100);
    /// The closed range a factor may take: a region factor above 10x is a bug.
    pub const MIN_PERCENT: i64 = 1;
    pub const MAX_PERCENT: i64 = 1_000;

    pub fn percent(p: i64) -> Option<Correction> {
        (Self::MIN_PERCENT..=Self::MAX_PERCENT)
            .contains(&p)
            .then_some(Correction(p))
    }

    pub fn get(self) -> i64 {
        self.0
    }
}

// Worst case numerator: 2^33 cells x 1e11 x MAX_PERCENT, plus the floor
// term (255 floors x 600_000 x the largest denominator, 20_000 x 2500 x
// 1_000) x MAX_PERCENT -- far inside i128.
const _: () = assert!(
    ((1i128 << 33) * 100_000_000_000 * Correction::MAX_PERCENT as i128
        + 255 * 600_000 * (20_000 * 2_500 * 1_000) * Correction::MAX_PERCENT as i128)
        < i128::MAX / 2
);

/// The balance values the estimate reads, resolved once.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rates {
    pub walk_speed_millicells_per_s: i64,
    pub walk_percent: i64,
    pub bike_percent: i64,
    pub transit_percent: i64,
    pub floor_change_penalty_milliminutes: i64,
}

impl Rates {
    pub fn from_balance(balance: &[BalanceSeed]) -> Rates {
        Rates {
            walk_speed_millicells_per_s: balance::value(
                balance,
                "movement.walk_speed_millicells_per_s",
            ),
            walk_percent: balance::value(balance, "routing.speed_percent.walk"),
            bike_percent: balance::value(balance, "routing.speed_percent.bike"),
            transit_percent: balance::value(balance, "routing.speed_percent.transit"),
            floor_change_penalty_milliminutes: balance::value(
                balance,
                "routing.floor_change_penalty_milliminutes",
            ),
        }
    }

    /// The mode's speed as a percent of walking.
    pub fn percent(&self, mode: TransportMode) -> i64 {
        match mode {
            TransportMode::Walk => self.walk_percent,
            TransportMode::Bike => self.bike_percent,
            TransportMode::Transit => self.transit_percent,
        }
    }
}

/// Estimated in-city travel time from `a` to `b` by `mode`.
///
/// Intermediates are `i128`, so any pair of `i32` coordinates is total.
/// The result fits `i64` under every balance `max` and the correction
/// ceiling: the largest is 2^33 cells at the slowest legal walk speed
/// (100 millicells/s), ~3.4e14 milliminutes, times at most 10.
pub fn estimate(
    rates: &Rates,
    a: Point,
    b: Point,
    mode: TransportMode,
    correction: Correction,
) -> Milliminutes {
    let cells = (a.x as i64 - b.x as i64).unsigned_abs() as i128
        + (a.y as i64 - b.y as i64).unsigned_abs() as i128;
    let floors = (a.floor as i128 - b.floor as i128).abs();
    let denom = rates.walk_speed_millicells_per_s as i128
        * REAL_MS_PER_CITY_MINUTE as i128
        * rates.percent(mode) as i128;
    // (travel + floor penalty) x correction, in milliminutes: one
    // division, last, rounded up so the triangle inequality holds exactly.
    let num = (cells * 100_000_000_000
        + floors * rates.floor_change_penalty_milliminutes as i128 * denom)
        * correction.0 as i128;
    let den = denom * 100;
    Milliminutes(
        i64::try_from((num + den - 1) / den).expect("bounded by the balance maxes; see above"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::defs;

    fn c(p: i64) -> Correction {
        Correction::percent(p).unwrap()
    }

    fn rates() -> Rates {
        Rates::from_balance(defs::BALANCE)
    }

    fn p(x: i32, y: i32, floor: i8) -> Point {
        Point { x, y, floor }
    }

    fn est(a: Point, b: Point, mode: TransportMode) -> i64 {
        estimate(&rates(), a, b, mode, Correction::NONE).0
    }

    /// What a minute costs: the worked examples. Walking is 5.5 cells per
    /// in-city minute (2200 millicells/s x 2.5 s), so 330 cells are 60
    /// minutes on foot, 30 by bike, 20 by transit; the GDD's 333-cell
    /// commute is the same ladder to within rounding.
    #[test]
    fn worked_examples() {
        use TransportMode::*;
        let o = p(0, 0, 0);
        assert_eq!(est(o, o, Walk), 0);
        assert_eq!(est(o, p(1, 0, 0), Walk), 182);
        assert_eq!(est(o, p(1, 0, 0), Walk), est(p(0, 1, 0), o, Walk));
        assert_eq!(est(o, p(330, 0, 0), Walk), 60_000);
        assert_eq!(est(o, p(330, 0, 0), Bike), 30_000);
        assert_eq!(est(o, p(330, 0, 0), Transit), 20_000);
        assert_eq!(est(o, p(200, 133, 0), Walk), 60_546);
        assert_eq!(est(o, p(200, 133, 0), Bike), 30_273);
        assert_eq!(est(o, p(200, 133, 0), Transit), 20_182);
        assert_eq!(est(o, p(0, 0, 1), Walk), 1000);
        assert_eq!(est(o, p(0, 0, -2), Transit), 2000);
    }

    #[test]
    fn committed_correction_default_is_neutral() {
        assert_eq!(Correction::NONE.get(), 100);
        let (a, b) = (p(3, 4, 0), p(90, -7, 2));
        assert_eq!(
            estimate(&rates(), a, b, TransportMode::Bike, Correction::NONE),
            estimate(&rates(), a, b, TransportMode::Bike, c(100)),
        );
    }

    #[test]
    fn a_non_neutral_correction_scales_the_result() {
        let (a, b) = (p(0, 0, 0), p(330, 0, 0));
        let r = rates();
        let base = estimate(&r, a, b, TransportMode::Walk, Correction::NONE).0;
        assert_eq!(
            estimate(&r, a, b, TransportMode::Walk, c(150)).0,
            base * 3 / 2
        );
        assert_eq!(estimate(&r, a, b, TransportMode::Walk, c(50)).0, base / 2);
    }

    #[test]
    fn correction_outside_its_range_is_refused() {
        for bad in [i64::MIN, -1, 0, 1_001, i64::MAX] {
            assert_eq!(Correction::percent(bad), None);
        }
        assert!(Correction::percent(1).is_some() && Correction::percent(1_000).is_some());
    }

    #[test]
    fn rates_come_from_the_balance_slice_not_defs() {
        let mut r = rates();
        r.walk_speed_millicells_per_s = 1100;
        r.floor_change_penalty_milliminutes = 7;
        let e = estimate(
            &r,
            p(0, 0, 0),
            p(330, 0, 1),
            TransportMode::Walk,
            Correction::NONE,
        );
        assert_eq!(e.0, 120_000 + 7);
    }

    #[test]
    fn extreme_coordinates_do_not_overflow() {
        let e = est(
            p(i32::MIN, i32::MIN, i8::MIN),
            p(i32::MAX, i32::MAX, i8::MAX),
            TransportMode::Walk,
        );
        assert!(e > 0);
    }

    #[test]
    fn walk_ladder_committed_percentages() {
        let r = rates();
        assert_eq!(
            (r.walk_percent, r.bike_percent, r.transit_percent),
            (100, 200, 300)
        );
    }
}
