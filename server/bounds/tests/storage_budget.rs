//! NFR15 as arithmetic (FR169): the registry's anticipated rows, priced
//! with the estimator over the schema snapshot's own column types, must
//! stay under the review trigger, and its ceilings under the wall -- a
//! bound whose ceiling alone could blow the wall is a failed build. Also
//! the metrics tables' own retention formula, recomputed from the registry
//! so adding a table cannot silently shrink retention below what the
//! declaration promises.

use bounds::TABLE_BOUNDS;
use bounds::schema::{module_src_dir, parse_module_schema};
use sim::storage::{
    METRICS_RETENTION_DAYS, STORAGE_LAUNCH_ESTIMATE_BYTES, STORAGE_REVIEW_BYTES, STORAGE_WALL_BYTES,
};

/// Each registered table's estimated row size, from one parse of `../src`.
fn priced(f: impl Fn(&bounds::TableBound) -> u64) -> u128 {
    let schema = parse_module_schema(&module_src_dir());
    TABLE_BOUNDS
        .iter()
        .map(|b| {
            let table = schema
                .tables
                .iter()
                .find(|t| t.accessor == b.accessor)
                .unwrap_or_else(|| panic!("no table `{}`", b.accessor));
            f(b) as u128 * table.row_bytes_est() as u128
        })
        .sum()
}

#[test]
fn nfr15_expected_rows_priced_stay_under_the_review_trigger() {
    let total = priced(|b| b.expected_rows);
    assert!(
        total < STORAGE_REVIEW_BYTES as u128,
        "sum of expected_rows * row_bytes is {total}, past the review trigger {STORAGE_REVIEW_BYTES}"
    );
}

#[test]
fn nfr15_max_rows_priced_stay_under_the_wall() {
    let total = priced(|b| b.max_rows);
    assert!(
        total < STORAGE_WALL_BYTES as u128,
        "sum of max_rows * row_bytes is {total}, past the wall {STORAGE_WALL_BYTES}"
    );
}

#[test]
fn nfr15_launch_estimate_is_under_the_review_trigger() {
    const { assert!(STORAGE_LAUNCH_ESTIMATE_BYTES < STORAGE_REVIEW_BYTES) };
}

fn bound(accessor: &str) -> &'static bounds::TableBound {
    TABLE_BOUNDS
        .iter()
        .find(|b| b.accessor == accessor)
        .unwrap_or_else(|| panic!("no bound for `{accessor}`"))
}

#[test]
fn table_sample_alert_covers_the_retention_window_of_every_registered_table() {
    let needed = TABLE_BOUNDS.len() as u64 * 24 * METRICS_RETENTION_DAYS;
    assert!(
        needed <= bound("table_sample").alert_rows,
        "retention keeps {needed} table_sample rows ({} tables x 24 x {METRICS_RETENTION_DAYS} days), \
         past its alert_rows {} -- raise the ceiling or shorten retention",
        TABLE_BOUNDS.len(),
        bound("table_sample").alert_rows
    );
}

#[test]
fn storage_sample_alert_covers_the_retention_window() {
    let needed = 24 * METRICS_RETENTION_DAYS;
    assert!(
        needed <= bound("storage_sample").alert_rows,
        "retention keeps {needed} storage_sample rows, past its alert_rows {}",
        bound("storage_sample").alert_rows
    );
}

#[test]
fn the_count_cap_the_sampler_enforces_is_the_registrys_own_max_rows() {
    for accessor in ["table_sample", "storage_sample"] {
        assert_eq!(
            sim::table_bounds::max_rows_of(accessor),
            Some(bound(accessor).max_rows),
            "`{accessor}`: the sampler's count cap must be its registered max_rows"
        );
    }
}
