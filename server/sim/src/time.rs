//! The in-city clock (FR1-FR3): a pure function of one durable epoch and the
//! server's own `now`. Nothing ticks, nothing is stored per minute. Integer
//! arithmetic only; the smallest unit of city time is the minute.

pub use crate::generated::defs::REAL_MS_PER_CITY_MINUTE;

// `CityTime::real_ms_into_minute` is a u16.
const _: () = assert!(REAL_MS_PER_CITY_MINUTE > 0 && REAL_MS_PER_CITY_MINUTE <= u16::MAX as i64);

pub const CITY_MINUTES_PER_HOUR: i64 = 60;
pub const CITY_HOURS_PER_DAY: i64 = 24;
pub const CITY_MINUTES_PER_DAY: i64 = CITY_MINUTES_PER_HOUR * CITY_HOURS_PER_DAY;
pub const CITY_DAYS_PER_WEEK: i64 = 7;
pub const REAL_MS_PER_CITY_HOUR: i64 = REAL_MS_PER_CITY_MINUTE * CITY_MINUTES_PER_HOUR;
pub const REAL_MS_PER_CITY_DAY: i64 = REAL_MS_PER_CITY_MINUTE * CITY_MINUTES_PER_DAY;

/// One instant of city time. `day` counts from the city's own epoch (day 0,
/// 00:00) and is negative before it; every other field is always in range.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CityTime {
    pub day: i64,
    pub hour: u8,
    pub minute: u8,
    /// `day` mod 7 -- the only calendar cycle the game defines (rent).
    pub weekday: u8,
    /// Real milliseconds elapsed inside the current city minute. For
    /// rendering interpolation only; no reducer, rule or gameplay decision
    /// may read this field -- the minute is the smallest unit of city time.
    pub real_ms_into_minute: u16,
}

impl CityTime {
    /// Whole city minutes since the epoch (negative before it).
    pub fn total_minutes(&self) -> i64 {
        self.day * CITY_MINUTES_PER_DAY
            + self.hour as i64 * CITY_MINUTES_PER_HOUR
            + self.minute as i64
    }
}

/// Decomposes a whole-minute count since the epoch. Total: `div_euclid` /
/// `rem_euclid` keep every field non-negative before the epoch too.
pub fn city_time_from_minutes(total_minutes: i64, real_ms_into_minute: u16) -> CityTime {
    let day = total_minutes.div_euclid(CITY_MINUTES_PER_DAY);
    let minute_of_day = total_minutes.rem_euclid(CITY_MINUTES_PER_DAY);
    CityTime {
        day,
        hour: (minute_of_day / CITY_MINUTES_PER_HOUR) as u8,
        minute: (minute_of_day % CITY_MINUTES_PER_HOUR) as u8,
        weekday: day.rem_euclid(CITY_DAYS_PER_WEEK) as u8,
        real_ms_into_minute,
    }
}

/// City time at `now_micros` for a clock whose day 0, 00:00 is `epoch_micros`
/// (both microseconds since the Unix epoch, as `Timestamp` carries them).
/// Never panics or wraps, for any pair of `i64`s.
pub fn city_time(epoch_micros: i64, now_micros: i64) -> CityTime {
    let elapsed_ms = (now_micros as i128 - epoch_micros as i128).div_euclid(1000);
    let rate = REAL_MS_PER_CITY_MINUTE as i128;
    let minutes = elapsed_ms.div_euclid(rate);
    let into = elapsed_ms.rem_euclid(rate);
    // |minutes| <= 2^64 / 1000 / 2500: always fits an i64.
    city_time_from_minutes(minutes as i64, into as u16)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversion_is_exact() {
        assert_eq!(REAL_MS_PER_CITY_MINUTE, 2500);
        assert_eq!(24 * 60 * REAL_MS_PER_CITY_MINUTE, 3_600_000);
        assert_eq!(REAL_MS_PER_CITY_HOUR, 150_000);
        assert_eq!(REAL_MS_PER_CITY_DAY, 3_600_000);
    }

    #[test]
    fn two_and_a_half_real_minutes_is_one_city_hour() {
        let t = city_time(0, 150_000 * 1000);
        assert_eq!((t.day, t.hour, t.minute), (0, 1, 0));
    }

    #[test]
    fn before_the_epoch_decomposes_without_negative_fields() {
        let t = city_time(0, -1000);
        assert_eq!(t.day, -1);
        assert_eq!((t.hour, t.minute), (23, 59));
        assert_eq!(t.weekday, 6);
        assert_eq!(t.real_ms_into_minute, 2499);
    }

    #[test]
    fn extreme_inputs_never_panic() {
        let _ = city_time(i64::MIN, i64::MAX);
        let _ = city_time(i64::MAX, i64::MIN);
    }
}
