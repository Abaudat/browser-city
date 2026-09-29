//! NFR15's storage constants and the metrics sampler's pure decisions
//! (FR169): total classification, per-table alert, byte scaling and the
//! retention arithmetic. SpacetimeDB's module SDK exposes row counts but no
//! byte figure, so every byte here is an estimate: this module never claims
//! host storage. The sampler body (`tables::metrics`) is a loop of
//! `count()` calls feeding these functions.

/// NFR15: the storage wall -- the hosting tier's ceiling.
pub const STORAGE_WALL_BYTES: u64 = 40 * 1024 * 1024 * 1024;
/// NFR15: the total at which storage is reviewed.
pub const STORAGE_REVIEW_BYTES: u64 = 10 * 1024 * 1024 * 1024;
/// NFR15: the launch-scale estimate.
pub const STORAGE_LAUNCH_ESTIMATE_BYTES: u64 = 200 * 1024 * 1024;

/// Rows serialised per table per sampler fire to estimate bytes.
pub const METRICS_BYTES_SAMPLE_ROWS: u64 = 64;
/// Real days a sample row is kept.
pub const METRICS_RETENTION_DAYS: u64 = 90;

const MICROS_PER_DAY: i64 = 24 * 60 * 60 * 1_000_000;

/// Total storage classification against NFR15's figures.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum StorageClass {
    Ok,
    Review,
    Wall,
}

/// `Wall` at or past the wall, `Review` at or past the review trigger.
pub fn classify_total(total_bytes: u64) -> StorageClass {
    if total_bytes >= STORAGE_WALL_BYTES {
        StorageClass::Wall
    } else if total_bytes >= STORAGE_REVIEW_BYTES {
        StorageClass::Review
    } else {
        StorageClass::Ok
    }
}

/// A single table is over its alert when strictly past `alert_rows`.
pub fn over_alert(rows: u64, alert_rows: u64) -> bool {
    rows > alert_rows
}

/// Scales `sampled_bytes` (over `sampled_rows` serialised rows) to a table
/// of `count` rows. Zero rows or zero sampled rows is zero bytes, never a
/// division; the result saturates rather than wraps.
pub fn scale_bytes_est(sampled_bytes: u64, sampled_rows: u64, count: u64) -> u64 {
    if count == 0 || sampled_rows == 0 {
        return 0;
    }
    let scaled = sampled_bytes as u128 * count as u128 / sampled_rows as u128;
    u64::try_from(scaled).unwrap_or(u64::MAX)
}

/// How many of the oldest rows must go so that a table holding `count`
/// rows still fits `max_rows` after `incoming` more are inserted.
pub fn rows_to_drop(count: u64, incoming: u64, max_rows: u64) -> u64 {
    count.saturating_add(incoming).saturating_sub(max_rows)
}

/// Rows stamped before this instant are pruned (real microseconds).
pub fn retention_cutoff_micros(now_micros: i64) -> i64 {
    now_micros.saturating_sub(METRICS_RETENTION_DAYS as i64 * MICROS_PER_DAY)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn nfr15_figures() {
        assert_eq!(STORAGE_WALL_BYTES, 42_949_672_960);
        assert_eq!(STORAGE_REVIEW_BYTES, 10_737_418_240);
        assert_eq!(STORAGE_LAUNCH_ESTIMATE_BYTES, 209_715_200);
    }

    #[test]
    fn classification_boundaries_are_exact() {
        assert_eq!(classify_total(0), StorageClass::Ok);
        assert_eq!(classify_total(STORAGE_REVIEW_BYTES - 1), StorageClass::Ok);
        assert_eq!(classify_total(STORAGE_REVIEW_BYTES), StorageClass::Review);
        assert_eq!(classify_total(STORAGE_WALL_BYTES - 1), StorageClass::Review);
        assert_eq!(classify_total(STORAGE_WALL_BYTES), StorageClass::Wall);
        assert_eq!(classify_total(u64::MAX), StorageClass::Wall);
    }

    #[test]
    fn over_alert_is_strictly_past_the_threshold() {
        assert!(!over_alert(10, 10));
        assert!(over_alert(11, 10));
        assert!(!over_alert(0, 0));
    }

    #[test]
    fn rows_to_drop_is_exact_at_the_boundary() {
        assert_eq!(rows_to_drop(0, 30, 100), 0, "an empty table drops nothing");
        assert_eq!(rows_to_drop(70, 30, 100), 0, "exactly full drops nothing");
        assert_eq!(rows_to_drop(71, 30, 100), 1, "one over drops one");
        assert_eq!(rows_to_drop(100, 30, 100), 30);
        assert_eq!(
            rows_to_drop(0, 150, 100),
            50,
            "incoming larger than the bound"
        );
        assert_eq!(rows_to_drop(u64::MAX, u64::MAX, 1), u64::MAX - 1);
    }

    #[test]
    fn scaling_handles_zero_and_never_divides_by_zero() {
        assert_eq!(scale_bytes_est(100, 0, 10), 0);
        assert_eq!(scale_bytes_est(0, 5, 10), 0);
        assert_eq!(scale_bytes_est(100, 4, 0), 0);
        assert_eq!(scale_bytes_est(100, 4, 8), 200);
        assert_eq!(scale_bytes_est(u64::MAX, 1, u64::MAX), u64::MAX);
    }

    #[test]
    fn retention_cutoff_is_ninety_days_back() {
        assert_eq!(
            retention_cutoff_micros(100 * MICROS_PER_DAY),
            10 * MICROS_PER_DAY
        );
        assert_eq!(retention_cutoff_micros(i64::MIN), i64::MIN);
    }

    proptest! {
        #[test]
        fn classification_is_monotonic(a in any::<u64>(), b in any::<u64>()) {
            let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
            prop_assert!(classify_total(lo) <= classify_total(hi));
        }

        #[test]
        fn over_alert_is_monotonic_in_rows_and_antitone_in_threshold(
            r in any::<u64>(), t in any::<u64>(), d in 0u64..1000
        ) {
            if over_alert(r, t) {
                prop_assert!(over_alert(r.saturating_add(d), t));
                prop_assert!(over_alert(r, t.saturating_sub(d)));
            }
        }

        #[test]
        fn scaled_bytes_grow_with_count(
            sb in any::<u32>(), s in 1u64..65, c1 in any::<u32>(), c2 in any::<u32>()
        ) {
            let (lo, hi) = if c1 <= c2 { (c1, c2) } else { (c2, c1) };
            prop_assert!(
                scale_bytes_est(sb as u64, s, lo as u64) <= scale_bytes_est(sb as u64, s, hi as u64)
            );
        }
    }
}
