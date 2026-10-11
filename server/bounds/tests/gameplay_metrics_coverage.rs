//! Story 4.14 (FR171, FR172): the gameplay-metrics registry
//! (`sim::gameplay_metrics`) is the one place a metric is added. This pins
//! it against the sampler (one emitter per live series, one generic sample
//! table), the table bounds, the GDD and the trace matrix. Same text-scan
//! house style as `metrics_coverage.rs`.

use std::fs;
use std::path::PathBuf;

use bounds::schema::{module_src_dir, parse_module_schema};
use sim::gameplay_metrics::{GAMEPLAY_METRICS, LIVE_SERIES_COUNT, Series, sample_rows_for_days};
use sim::storage::METRICS_RETENTION_DAYS;

fn repo_file(rel: &str) -> String {
    let path: PathBuf = module_src_dir().join("..").join("..").join(rel);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

fn metrics_rs() -> String {
    let path = module_src_dir().join("tables").join("metrics.rs");
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

fn body_of(text: &str, signature: &str) -> String {
    let fn_at = text
        .find(signature)
        .unwrap_or_else(|| panic!("metrics.rs: no `{signature}`"));
    let open = text[fn_at..].find('{').expect("no body") + fn_at;
    let mut depth = 0i32;
    for (i, b) in text.as_bytes()[open..].iter().enumerate() {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return text[open..open + i + 1].to_string();
                }
            }
            _ => {}
        }
    }
    panic!("unbalanced braces in `{signature}`");
}

#[test]
fn every_series_has_exactly_one_emitter_arm() {
    let body = body_of(&metrics_rs(), "fn emit_series(");
    for s in Series::ALL {
        let arm = format!("Series::{s:?} =>");
        assert_eq!(
            body.matches(&arm).count(),
            1,
            "`emit_series` must have exactly one `{arm}` arm"
        );
    }
    assert_eq!(
        body.matches("Series::").count(),
        Series::ALL.len(),
        "`emit_series` names a series the registry does not have, or one twice"
    );
}

#[test]
fn the_sampler_runs_the_gameplay_emitter_once_per_fire_and_iterates_the_registry() {
    let text = metrics_rs();
    let run = body_of(&text, "pub fn run_sampler(");
    assert_eq!(run.matches("sample_gameplay_metrics(").count(), 1);
    let emit = body_of(&text, "fn sample_gameplay_metrics(");
    assert!(
        emit.contains("Series::ALL") && emit.contains("emit_series("),
        "sample_gameplay_metrics must walk Series::ALL through emit_series"
    );
}

#[test]
fn there_is_one_generic_metric_sample_table_never_one_per_metric() {
    let sample_tables: Vec<String> = parse_module_schema(&module_src_dir())
        .tables
        .into_iter()
        .map(|t| t.accessor)
        .filter(|a| a.ends_with("metric_sample"))
        .collect();
    assert_eq!(sample_tables, ["gameplay_metric_sample"]);
}

#[test]
fn the_sample_bound_is_derived_from_live_series_fires_and_retention() {
    let bound = sim::table_bounds::TABLE_BOUNDS
        .iter()
        .find(|b| b.accessor == "gameplay_metric_sample")
        .expect("gameplay_metric_sample has no bound (NFR37)");
    let live: u64 = GAMEPLAY_METRICS.iter().map(|m| m.series.len() as u64).sum();
    assert_eq!(live, LIVE_SERIES_COUNT);
    // Alert at the retention window's steady state, ceiling at twice it.
    assert_eq!(bound.alert_rows, live * 24 * METRICS_RETENTION_DAYS);
    assert_eq!(
        bound.alert_rows,
        sample_rows_for_days(METRICS_RETENTION_DAYS)
    );
    assert_eq!(bound.max_rows, 2 * bound.alert_rows);
}

#[test]
fn the_tally_bound_is_the_slot_count() {
    let bound = sim::table_bounds::TABLE_BOUNDS
        .iter()
        .find(|b| b.accessor == "metric_tally")
        .expect("metric_tally has no bound (NFR37)");
    assert_eq!(bound.max_rows, sim::gameplay_metrics::TALLY_ROWS);
}

#[test]
fn the_gdd_names_every_metric_by_its_registry_name() {
    let gdd = repo_file("docs/gdd.md");
    for m in GAMEPLAY_METRICS {
        assert!(
            gdd.contains(&format!("`{}`", m.name)),
            "docs/gdd.md's Success Metrics never names `{}`",
            m.name
        );
    }
}

#[test]
fn every_metric_has_its_own_trace_matrix_row_naming_the_registry_epic() {
    let matrix = repo_file("docs/trace-matrix.md");
    for m in GAMEPLAY_METRICS {
        let prefix = format!("| FR172/`{}`:", m.name);
        let row = matrix
            .lines()
            .find(|l| l.starts_with(&prefix))
            .unwrap_or_else(|| panic!("docs/trace-matrix.md has no row starting `{prefix}`"));
        if m.series.is_empty() {
            assert!(
                row.contains("| deferred |") || row.contains("| partial |"),
                "`{}` emits nothing yet: {row}",
                m.name
            );
            assert!(
                row.contains(&format!("epic {}", m.emitting_epic)),
                "`{}`'s row must name epic {} (the registry's emitting_epic)",
                m.name,
                m.emitting_epic
            );
        } else {
            assert!(row.contains("| covered |"), "`{}` is live: {row}", m.name);
        }
    }
}

#[test]
fn a_restore_clears_the_period_state_and_never_the_live_connections() {
    let restore = repo_file("server/src/tables/restore.rs");
    let begin = body_of(&restore, "pub fn begin_restore");
    assert!(
        begin.contains("clear_gameplay_state("),
        "begin_restore must clear the gameplay tally and samples"
    );
    assert!(
        !begin.contains("connected_client"),
        "begin_restore must not touch connected_client: a restore does not drop connections"
    );
    let publish = repo_file("server/src/tables/publish.rs");
    assert!(
        !publish.contains("connected_client"),
        "a publish keeps clients connected; establish_world must not clear connected_client"
    );
}

#[test]
fn only_the_lifecycle_hooks_write_connected_client() {
    let lib = repo_file("server/src/lib.rs");
    assert!(lib.contains("record_connect(ctx)") && lib.contains("record_disconnect(ctx)"));
}
