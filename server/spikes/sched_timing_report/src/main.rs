//! `sched_timing_report <csv-file>...` -- reduces one or more exported
//! `observation` CSVs (see `sched_timing_report::parse_csv` for the exact
//! shape) into the Markdown table `scripts/dev/run-sched-timing-spike.sh`
//! prints and `docs/spikes/1.3-scheduled-reducer-timing.md` embeds.
//! Exits non-zero, with a message naming the offending file, on any
//! unparseable input -- a silently-skipped bad row would corrupt a
//! percentile.

use std::env;
use std::fs;
use std::process::ExitCode;

use sched_timing_report::{Row, parse_csv, render_markdown, summarize};

fn main() -> ExitCode {
    let paths: Vec<String> = env::args().skip(1).collect();
    if paths.is_empty() {
        eprintln!("usage: sched_timing_report <csv-file>...");
        return ExitCode::FAILURE;
    }

    let mut rows: Vec<Row> = Vec::new();
    for path in &paths {
        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("sched_timing_report: FAIL -- could not read {path}: {e}");
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

    let summaries = summarize(&rows);
    print!("{}", render_markdown(&summaries));
    ExitCode::SUCCESS
}
