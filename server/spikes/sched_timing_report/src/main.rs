//! `sched_timing_report <subcommand> <args>...` -- the three reductions
//! `scripts/dev/run-sched-timing-spike.sh` calls out to:
//!
//!   ladder <csv-file>...            median/p95/max/n + cumulative slip
//!   observer <observer-log-file>    client-side receipt latency
//!   republish <summary.json> <republish-leg.csv>   survival classification
//!
//! Exits non-zero, with a message naming the offending file, on any
//! unparseable input -- a silently-skipped bad row would corrupt a
//! percentile or a classification.

use std::env;
use std::fs;
use std::process::ExitCode;

use sched_timing_report::{
    Row, classify_republish, parse_csv, parse_observer_log, parse_republish_summary,
    render_latency_markdown, render_markdown, render_republish_markdown, summarize,
    summarize_latencies,
};

fn read_or_fail(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("could not read {path}: {e}"))
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let Some((subcommand, rest)) = args.split_first() else {
        eprintln!("usage: sched_timing_report <ladder|observer|republish> <args>...");
        return ExitCode::FAILURE;
    };

    match subcommand.as_str() {
        "ladder" => {
            if rest.is_empty() {
                eprintln!("usage: sched_timing_report ladder <csv-file>...");
                return ExitCode::FAILURE;
            }
            let mut rows: Vec<Row> = Vec::new();
            for path in rest {
                let content = match read_or_fail(path) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("sched_timing_report: FAIL -- {e}");
                        return ExitCode::FAILURE;
                    }
                };
                match parse_csv(&content) {
                    Ok(parsed) => rows.extend(parsed),
                    Err(e) => {
                        eprintln!("sched_timing_report: FAIL -- {path}: {e}");
                        return ExitCode::FAILURE;
                    }
                }
            }
            print!("{}", render_markdown(&summarize(&rows)));
            ExitCode::SUCCESS
        }
        "observer" => {
            let [path] = rest else {
                eprintln!("usage: sched_timing_report observer <observer-log-file>");
                return ExitCode::FAILURE;
            };
            let content = match read_or_fail(path) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("sched_timing_report: FAIL -- {e}");
                    return ExitCode::FAILURE;
                }
            };
            match parse_observer_log(&content) {
                Ok(latencies) => {
                    print!(
                        "{}",
                        render_latency_markdown(&summarize_latencies(&latencies))
                    );
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("sched_timing_report: FAIL -- {path}: {e}");
                    ExitCode::FAILURE
                }
            }
        }
        "republish" => {
            let [summary_path, csv_path] = rest else {
                eprintln!(
                    "usage: sched_timing_report republish <summary.json> <republish-leg.csv>"
                );
                return ExitCode::FAILURE;
            };
            let summary_content = match read_or_fail(summary_path) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("sched_timing_report: FAIL -- {e}");
                    return ExitCode::FAILURE;
                }
            };
            let summary = match parse_republish_summary(&summary_content) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("sched_timing_report: FAIL -- {summary_path}: {e}");
                    return ExitCode::FAILURE;
                }
            };
            let csv_content = match read_or_fail(csv_path) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("sched_timing_report: FAIL -- {e}");
                    return ExitCode::FAILURE;
                }
            };
            let rows = match parse_csv(&csv_content) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("sched_timing_report: FAIL -- {csv_path}: {e}");
                    return ExitCode::FAILURE;
                }
            };
            let report = classify_republish(&summary.pending_before, &summary.pending_after, &rows);
            print!("{}", render_republish_markdown(&report));
            ExitCode::SUCCESS
        }
        other => {
            eprintln!(
                "sched_timing_report: unknown subcommand {other:?} (want ladder|observer|republish)"
            );
            ExitCode::FAILURE
        }
    }
}
