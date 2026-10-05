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

/// The largest clock multiplier (FR163): a city day in 36 real seconds.
pub const MAX_CLOCK_SPEED: u32 = 100;

/// Real microseconds per city minute at speed 1.
const REAL_MICROS_PER_CITY_MINUTE: i64 = REAL_MS_PER_CITY_MINUTE * 1000;

/// The most city minutes one jump may skip: eight city days (a rent week
/// plus slack; call it twice for longer).
pub const MAX_JUMP_CITY_MINUTES: u32 = 8 * CITY_MINUTES_PER_DAY as u32;

/// The most cadence ticks one jump may replay in total. Sized for one
/// ten-minute cadence (1008 a week). A future one-minute cadence makes a
/// week's jump 10080 ticks and `check-time-control.sh`'s week jump will
/// refuse: that is deliberate -- raise this cap, do not shrink the test.
pub const MAX_JUMP_TICKS: u64 = 5_000;

/// A multiplier is valid when it is in `1..=MAX_CLOCK_SPEED` and divides
/// the real microseconds of a city minute exactly, so every grid point
/// stays an exact integer instant.
pub fn validate_speed(speed: u32) -> Result<(), String> {
    if speed == 0 || speed > MAX_CLOCK_SPEED {
        return Err(format!(
            "clock speed must be 1..={MAX_CLOCK_SPEED}, got {speed}"
        ));
    }
    if REAL_MICROS_PER_CITY_MINUTE % speed as i64 != 0 {
        return Err(format!(
            "clock speed {speed} does not divide {REAL_MICROS_PER_CITY_MINUTE} real microseconds per city minute exactly"
        ));
    }
    Ok(())
}

/// Real microseconds per city minute at `speed` (a `speed` of 0 is read
/// as 1, so this is total).
pub fn micros_per_city_minute(speed: u32) -> i64 {
    (REAL_MICROS_PER_CITY_MINUTE / speed.max(1) as i64).max(1)
}

fn clamp_i64(v: i128) -> i64 {
    v.clamp(i64::MIN as i128, i64::MAX as i128) as i64
}

/// City time at `now_micros` for a clock whose day 0, 00:00 is `epoch_micros`
/// (both microseconds since the Unix epoch, as `Timestamp` carries them),
/// running at `speed` city minutes per base city minute.
/// Never panics or wraps, for any pair of `i64`s.
pub fn city_time(epoch_micros: i64, now_micros: i64, speed: u32) -> CityTime {
    let minute = micros_per_city_minute(speed) as i128;
    let elapsed = now_micros as i128 - epoch_micros as i128;
    let minutes = elapsed.div_euclid(minute);
    let into_micros = elapsed.rem_euclid(minute);
    // |minutes| <= 2^64 / 25_000: always fits an i64.
    city_time_from_minutes(minutes as i64, (into_micros / 1000) as u16)
}

/// The epoch under which the whole city minutes at `now_micros` (and the
/// position inside the minute, rounded down) are unchanged when the speed
/// goes from `old_speed` to `new_speed`: a multiplier switch never moves
/// the clock. Total over every `i64` pair.
pub fn reanchor(epoch_micros: i64, now_micros: i64, old_speed: u32, new_speed: u32) -> i64 {
    let old = micros_per_city_minute(old_speed) as i128;
    let new = micros_per_city_minute(new_speed) as i128;
    let elapsed = now_micros as i128 - epoch_micros as i128;
    let minutes = elapsed.div_euclid(old);
    let into = elapsed.rem_euclid(old);
    clamp_i64(now_micros as i128 - minutes * new - into * new / old)
}

/// The epoch after skipping `city_minutes` forward at `speed`:
/// `city_time(jumped, now, speed)` equals `city_time(epoch, now + delta,
/// speed)` for `delta = city_minutes * micros_per_city_minute(speed)`.
pub fn jumped_epoch(epoch_micros: i64, city_minutes: u32, speed: u32) -> i64 {
    clamp_i64(epoch_micros as i128 - city_minutes as i128 * micros_per_city_minute(speed) as i128)
}

/// A jump is forward only, whole city minutes, at most
/// [`MAX_JUMP_CITY_MINUTES`].
pub fn validate_jump(city_minutes: u32) -> Result<(), String> {
    if city_minutes == 0 || city_minutes > MAX_JUMP_CITY_MINUTES {
        return Err(format!(
            "a clock jump must be 1..={MAX_JUMP_CITY_MINUTES} city minutes forward, got {city_minutes}"
        ));
    }
    Ok(())
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
        let t = city_time(0, 150_000 * 1000, 1);
        assert_eq!((t.day, t.hour, t.minute), (0, 1, 0));
    }

    #[test]
    fn before_the_epoch_decomposes_without_negative_fields() {
        let t = city_time(0, -1000, 1);
        assert_eq!(t.day, -1);
        assert_eq!((t.hour, t.minute), (23, 59));
        assert_eq!(t.weekday, 6);
        assert_eq!(t.real_ms_into_minute, 2499);
    }

    #[test]
    fn extreme_inputs_never_panic() {
        for speed in [0, 1, 100, u32::MAX] {
            let _ = city_time(i64::MIN, i64::MAX, speed);
            let _ = city_time(i64::MAX, i64::MIN, speed);
            let _ = reanchor(i64::MIN, i64::MAX, speed, 1);
            let _ = reanchor(i64::MAX, i64::MIN, 1, speed);
            let _ = jumped_epoch(i64::MIN, u32::MAX, speed);
        }
    }

    #[test]
    fn speed_validation() {
        assert!(validate_speed(0).is_err());
        assert!(validate_speed(1).is_ok());
        assert!(validate_speed(10).is_ok());
        assert!(validate_speed(100).is_ok());
        assert!(validate_speed(101).is_err());
        assert!(validate_speed(3).is_err(), "3 does not divide 2_500_000");
        assert!(validate_speed(u32::MAX).is_err());
    }

    #[test]
    fn a_faster_clock_runs_faster() {
        // 10x: one city minute per 250ms.
        let t = city_time(0, 250_000, 10);
        assert_eq!((t.hour, t.minute, t.real_ms_into_minute), (0, 1, 0));
        assert_eq!(micros_per_city_minute(10), 250_000);
    }

    #[test]
    fn the_jump_cap_covers_a_rent_week() {
        assert!(MAX_JUMP_CITY_MINUTES as i64 >= 7 * 1440);
        assert!(validate_jump(MAX_JUMP_CITY_MINUTES).is_ok());
        assert!(validate_jump(MAX_JUMP_CITY_MINUTES + 1).is_err());
        assert!(validate_jump(0).is_err());
    }
}
