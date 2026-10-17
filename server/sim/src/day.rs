//! The player's day (FR4): own time is what the day leaves after sleep,
//! the shift and two commute legs. Derived, never stored.

use crate::balance;
use crate::generated::defs::BalanceSeed;
use crate::routing::Milliminutes;
use crate::time::CITY_MINUTES_PER_DAY;

/// Own time for a day with `commute_leg` each way, in milliminutes.
/// Negative when the day is overbooked; defs-build refuses the balance
/// that would make the opening day so.
pub fn own_time(balance: &[BalanceSeed], commute_leg: Milliminutes) -> Milliminutes {
    let blocked =
        balance::value(balance, "day.sleep_minutes") + balance::value(balance, "day.shift_minutes");
    Milliminutes((CITY_MINUTES_PER_DAY - blocked) * 1000 - 2 * commute_leg.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::defs::BALANCE;
    use crate::routing::commute;

    fn m(min: i64) -> Milliminutes {
        Milliminutes(min * 1000)
    }

    #[test]
    fn a_sixty_minute_leg_leaves_six_hours() {
        assert_eq!(own_time(BALANCE, m(60)), m(360));
    }

    #[test]
    fn the_floor_leg_leaves_seven_hours_twenty() {
        assert_eq!(own_time(BALANCE, commute::floor(BALANCE)), m(440));
    }
}
