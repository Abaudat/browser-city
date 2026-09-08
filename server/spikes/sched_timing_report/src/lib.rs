//! Pure reduction of `sched_timing_spike`'s three raw exports into the
//! tables `docs/spikes/1.3-scheduled-reducer-timing.md` embeds: the
//! ladder CSV (median/p95/max/n and cumulative slip), the observer-log
//! (client-side receipt latency), and the republish leg's before/after
//! survival record. The module never computes a statistic (Tim's
//! direction) -- this binary is the only place any of the three
//! reductions happens, deliberately, so a hand-typed number in the report
//! is never the only copy of it.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use serde::Deserialize;

/// `sched_timing_spike::mode` mirrored here as plain constants, not a
/// shared dependency -- this crate never links against the wasm module
/// crate (NFR30's "no shared code" spirit, applied within `server/` too:
/// a native reducer of a wasm module's export has no business depending
/// on it).
pub mod mode {
    pub const ONESHOT_CHAINED: u8 = 0;
    pub const INTERVAL: u8 = 1;
    pub const BURST: u8 = 2;
    pub const ONESHOT_ANCHORED: u8 = 3;

    pub fn is_repeating(mode: u8) -> bool {
        mode != BURST
    }
}

// ---------------------------------------------------------------------
// Ladder legs (idle, under load): median/p95/max/n and cumulative slip.
// ---------------------------------------------------------------------

/// One raw `observation` row, exactly as `sched_timing_spike` wrote it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    pub run_id: String,
    pub mode: u8,
    pub bucket_ms: u64,
    pub sequence: u32,
    pub run_start_micros: i64,
    pub scheduled_at_micros: i64,
    pub fired_at_micros: i64,
    pub drift_micros: i64,
}

const CSV_HEADER: &str = "run_id,mode,bucket_ms,sequence,run_start_micros,scheduled_at_micros,fired_at_micros,drift_micros";

/// Parses the CSV the harness script's export step writes: header
/// `CSV_HEADER`, one observation per line, no quoting (none of the
/// fields ever contain a comma). Blank lines are skipped. Fails loudly
/// (`Err`, not a silently-dropped row) on anything malformed -- a
/// misparsed row would corrupt a percentile, and a stray warning is
/// exactly the kind of thing this crate exists so a human doesn't have
/// to re-read a terminal transcript to catch.
pub fn parse_csv(input: &str) -> Result<Vec<Row>, String> {
    let mut lines = input.lines();
    let header = lines.next().ok_or("empty input, no header row")?;
    if header.trim() != CSV_HEADER {
        return Err(format!(
            "unexpected header: {header:?} (expected {CSV_HEADER:?})"
        ));
    }
    let mut rows = Vec::new();
    for (i, line) in lines.enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split(',').collect();
        if fields.len() != 8 {
            return Err(format!(
                "line {}: expected 8 fields, got {}: {line:?}",
                i + 2,
                fields.len()
            ));
        }
        let parse_i64 = |idx: usize, name: &str| -> Result<i64, String> {
            fields[idx]
                .trim()
                .parse::<i64>()
                .map_err(|e| format!("line {}: bad {name} {:?}: {e}", i + 2, fields[idx]))
        };
        let parse_u64 = |idx: usize, name: &str| -> Result<u64, String> {
            fields[idx]
                .trim()
                .parse::<u64>()
                .map_err(|e| format!("line {}: bad {name} {:?}: {e}", i + 2, fields[idx]))
        };
        rows.push(Row {
            run_id: fields[0].trim().to_string(),
            mode: parse_u64(1, "mode")? as u8,
            bucket_ms: parse_u64(2, "bucket_ms")?,
            sequence: parse_u64(3, "sequence")? as u32,
            run_start_micros: parse_i64(4, "run_start_micros")?,
            scheduled_at_micros: parse_i64(5, "scheduled_at_micros")?,
            fired_at_micros: parse_i64(6, "fired_at_micros")?,
            drift_micros: parse_i64(7, "drift_micros")?,
        });
    }
    Ok(rows)
}

/// Median/p95/max/n of one group's `drift_micros`, in milliseconds, plus
/// (for every *repeating* mode -- `ONESHOT_CHAINED`, `ONESHOT_ANCHORED`
/// and `INTERVAL` alike, never just `INTERVAL`) the cumulative-slip
/// reading: the drift at the first and last observed tick and the
/// average per-tick growth between them. Restricting this to one mode
/// was cycle 1's defect (Quentin's direction): every repeating mode's
/// `drift_micros` is computed against the same fixed origin (see
/// `sched_timing_spike`'s module doc comment), so every repeating mode
/// gets the same cumulative-slip treatment here.
#[derive(Debug, Clone, PartialEq)]
pub struct Summary {
    pub run_id: String,
    pub mode: u8,
    pub bucket_ms: u64,
    pub n: usize,
    /// `None` when `n == 0`. Below `SMALL_N`, callers must render the raw
    /// observations instead of trusting these (Quentin's direction).
    pub median_ms: Option<f64>,
    pub p95_ms: Option<f64>,
    pub max_ms: Option<f64>,
    pub raw_drift_ms: Vec<f64>,
    pub cumulative_slip: Option<CumulativeSlip>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CumulativeSlip {
    pub first_sequence: u32,
    pub first_drift_ms: f64,
    pub last_sequence: u32,
    pub last_drift_ms: f64,
    pub slip_per_tick_ms: f64,
}

/// Below this sample count a percentile is decoration, not evidence
/// (Quentin's direction): render the raw observations and say so.
pub const SMALL_N: usize = 20;

fn micros_to_ms(micros: i64) -> f64 {
    micros as f64 / 1000.0
}

/// Nearest-rank percentile over an already-sorted slice, `p` in `0.0..=1.0`.
fn percentile(sorted: &[f64], p: f64) -> f64 {
    debug_assert!(!sorted.is_empty());
    let rank = (p * sorted.len() as f64).ceil() as usize;
    let idx = rank.saturating_sub(1).min(sorted.len() - 1);
    sorted[idx]
}

/// Groups `rows` by `run_id` and reduces each group to a `Summary`,
/// sorted by `run_id` so the report's table order is stable across runs.
pub fn summarize(rows: &[Row]) -> Vec<Summary> {
    let mut groups: BTreeMap<String, Vec<&Row>> = BTreeMap::new();
    for row in rows {
        groups.entry(row.run_id.clone()).or_default().push(row);
    }

    groups
        .into_iter()
        .map(|(run_id, mut group)| {
            group.sort_by_key(|r| r.sequence);
            let mode = group[0].mode;
            let bucket_ms = group[0].bucket_ms;
            let n = group.len();

            let mut drift_ms: Vec<f64> =
                group.iter().map(|r| micros_to_ms(r.drift_micros)).collect();
            drift_ms.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));

            let (median_ms, p95_ms, max_ms) = if n >= SMALL_N {
                (
                    Some(percentile(&drift_ms, 0.50)),
                    Some(percentile(&drift_ms, 0.95)),
                    Some(*drift_ms.last().expect("n >= SMALL_N > 0")),
                )
            } else {
                (None, None, None)
            };

            let cumulative_slip = if mode::is_repeating(mode) && group.len() >= 2 {
                let first = group.first().expect("checked len >= 2");
                let last = group.last().expect("checked len >= 2");
                let ticks = (last.sequence - first.sequence) as f64;
                let first_drift_ms = micros_to_ms(first.drift_micros);
                let last_drift_ms = micros_to_ms(last.drift_micros);
                Some(CumulativeSlip {
                    first_sequence: first.sequence,
                    first_drift_ms,
                    last_sequence: last.sequence,
                    last_drift_ms,
                    slip_per_tick_ms: if ticks > 0.0 {
                        (last_drift_ms - first_drift_ms) / ticks
                    } else {
                        0.0
                    },
                })
            } else {
                None
            };

            Summary {
                run_id,
                mode,
                bucket_ms,
                n,
                median_ms,
                p95_ms,
                max_ms,
                raw_drift_ms: drift_ms,
                cumulative_slip,
            }
        })
        .collect()
}

pub fn mode_name(mode: u8) -> &'static str {
    match mode {
        mode::ONESHOT_CHAINED => "oneshot-chained",
        mode::INTERVAL => "interval",
        mode::BURST => "burst",
        mode::ONESHOT_ANCHORED => "oneshot-anchored",
        _ => "unknown",
    }
}

/// Renders `summaries` as the Markdown table `docs/spikes/1.3-scheduled-
/// reducer-timing.md` embeds verbatim.
pub fn render_markdown(summaries: &[Summary]) -> String {
    let mut out = String::new();
    out.push_str("| run_id | mode | bucket_ms | n | median (ms) | p95 (ms) | max (ms) |\n");
    out.push_str("| --- | --- | --- | --- | --- | --- | --- |\n");
    for s in summaries {
        let fmt = |v: Option<f64>| {
            v.map(|v| format!("{v:.3}"))
                .unwrap_or_else(|| "-".to_string())
        };
        out.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {} |\n",
            s.run_id,
            mode_name(s.mode),
            s.bucket_ms,
            s.n,
            fmt(s.median_ms),
            fmt(s.p95_ms),
            fmt(s.max_ms),
        ));
        if s.n < SMALL_N {
            let raw: Vec<String> = s.raw_drift_ms.iter().map(|v| format!("{v:.3}")).collect();
            let label = if s.n <= 1 {
                "single observation".to_string()
            } else {
                format!("n={}", s.n)
            };
            out.push_str(&format!(
                "  - {label}, raw drift (ms): [{}]\n",
                raw.join(", ")
            ));
        }
        if let Some(slip) = &s.cumulative_slip {
            out.push_str(&format!(
                "  - cumulative slip: tick {} drift {:.3} ms -> tick {} drift {:.3} ms ({:+.4} ms/tick)\n",
                slip.first_sequence, slip.first_drift_ms, slip.last_sequence, slip.last_drift_ms, slip.slip_per_tick_ms
            ));
        }
    }
    out
}

// ---------------------------------------------------------------------
// Observer lateness: client-side receipt time minus fired_at_micros,
// parsed from the harness's `observer-lateness.log`.
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ObserverLine {
    observation: ObservationUpdate,
}

#[derive(Debug, Deserialize)]
struct ObservationUpdate {
    #[serde(default)]
    inserts: Vec<InsertedRow>,
}

#[derive(Debug, Deserialize)]
struct InsertedRow {
    fired_at_micros: i64,
}

/// Parses `observer-lateness.log`: each line is `<recv_micros> <json>`,
/// written by `spacetime subscribe` piped through a wall-clock-stamping
/// loop. Returns one latency (`recv_micros - fired_at_micros`) per
/// inserted row. Fails loudly on a line that is not `<int> <json>` --
/// the same discipline as `parse_csv`.
pub fn parse_observer_log(input: &str) -> Result<Vec<i64>, String> {
    let mut latencies = Vec::new();
    for (i, line) in input.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let (recv_str, json_str) = line.split_once(' ').ok_or_else(|| {
            format!(
                "line {}: no space separating receipt time from JSON: {line:?}",
                i + 1
            )
        })?;
        let recv_micros: i64 = recv_str
            .parse()
            .map_err(|e| format!("line {}: bad receipt timestamp {recv_str:?}: {e}", i + 1))?;
        let parsed: ObserverLine =
            serde_json::from_str(json_str).map_err(|e| format!("line {}: bad JSON: {e}", i + 1))?;
        for row in parsed.observation.inserts {
            latencies.push(recv_micros - row.fired_at_micros);
        }
    }
    Ok(latencies)
}

#[derive(Debug, Clone, PartialEq)]
pub struct LatencySummary {
    pub n: usize,
    pub median_ms: Option<f64>,
    pub p95_ms: Option<f64>,
    pub max_ms: Option<f64>,
    pub raw_ms: Vec<f64>,
}

/// Same median/p95/max/n-with-small-n-fallback shape as the ladder
/// summary, over an arbitrary set of latencies rather than one run_id's
/// `drift_micros`.
pub fn summarize_latencies(latencies_micros: &[i64]) -> LatencySummary {
    let mut ms: Vec<f64> = latencies_micros.iter().map(|&v| micros_to_ms(v)).collect();
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    let n = ms.len();
    let (median_ms, p95_ms, max_ms) = if n >= SMALL_N {
        (
            Some(percentile(&ms, 0.50)),
            Some(percentile(&ms, 0.95)),
            Some(*ms.last().expect("n >= SMALL_N > 0")),
        )
    } else {
        (None, None, None)
    };
    LatencySummary {
        n,
        median_ms,
        p95_ms,
        max_ms,
        raw_ms: ms,
    }
}

pub fn render_latency_markdown(summary: &LatencySummary) -> String {
    let fmt = |v: Option<f64>| {
        v.map(|v| format!("{v:.3} ms"))
            .unwrap_or_else(|| "-".to_string())
    };
    if summary.n < SMALL_N {
        let raw: Vec<String> = summary.raw_ms.iter().map(|v| format!("{v:.3}")).collect();
        format!("n={}, raw latency (ms): [{}]\n", summary.n, raw.join(", "))
    } else {
        format!(
            "n={}, median {}, p95 {}, max {}\n",
            summary.n,
            fmt(summary.median_ms),
            fmt(summary.p95_ms),
            fmt(summary.max_ms)
        )
    }
}

// ---------------------------------------------------------------------
// Republish leg: cross-references republish-summary.json's before/after
// pending record against the leg's own CSV export to classify every
// seeded probe -- fired on schedule, still pending, or vanished -- by
// machine rather than by eye (Quentin's direction).
// ---------------------------------------------------------------------

/// `(scheduled_id, mode, bucket_ms, sequence)`, exactly the row shape
/// the harness's `SELECT scheduled_id, mode, bucket_ms, sequence FROM
/// probe` query exports as a JSON array of 4-number arrays.
pub type PendingRow = (u64, u8, u64, u32);

#[derive(Debug, Deserialize)]
pub struct RepublishSummary {
    pub republished_at_micros: i64,
    pub pending_before: Vec<PendingRow>,
    pub pending_after: Vec<PendingRow>,
}

pub fn parse_republish_summary(input: &str) -> Result<RepublishSummary, String> {
    serde_json::from_str(input).map_err(|e| format!("bad republish-summary.json: {e}"))
}

#[derive(Debug, Clone, PartialEq)]
pub struct OneShotOutcome {
    pub offset_ms: u64,
    pub fired: bool,
    pub drift_ms: Option<f64>,
    pub still_pending: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct IntervalOutcome {
    pub bucket_ms: u64,
    pub still_pending: bool,
    pub fire_count: usize,
    pub first_drift_ms: Option<f64>,
    pub last_drift_ms: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct RepublishReport {
    pub one_shots: Vec<OneShotOutcome>,
    pub interval: Option<IntervalOutcome>,
}

/// Classifies every row `pending_before` named against the leg's CSV
/// export (`fired`) and the post-republish pending snapshot (`post`).
/// One-shot (`BURST`) rows are matched by `(mode, bucket_ms, sequence)`,
/// unique within one republish leg by construction (each offset seeds
/// exactly one row at a distinct index); the repeating row is matched by
/// `mode` alone (a republish leg seeds at most one).
pub fn classify_republish(
    pre: &[PendingRow],
    post: &[PendingRow],
    fired: &[Row],
) -> RepublishReport {
    let mut one_shots = Vec::new();
    let mut interval = None;

    for &(_scheduled_id, m, bucket_ms, sequence) in pre {
        if m == mode::BURST {
            let fired_row = fired.iter().find(|r| {
                r.mode == mode::BURST && r.bucket_ms == bucket_ms && r.sequence == sequence
            });
            let still_pending = post
                .iter()
                .any(|&(_, pm, pb, ps)| pm == mode::BURST && pb == bucket_ms && ps == sequence);
            one_shots.push(OneShotOutcome {
                offset_ms: bucket_ms,
                fired: fired_row.is_some(),
                drift_ms: fired_row.map(|r| micros_to_ms(r.drift_micros)),
                still_pending,
            });
        } else if mode::is_repeating(m) {
            let mut fires: Vec<&Row> = fired.iter().filter(|r| r.mode == m).collect();
            fires.sort_by_key(|r| r.sequence);
            let still_pending = post.iter().any(|&(_, pm, _, _)| pm == m);
            interval = Some(IntervalOutcome {
                bucket_ms,
                still_pending,
                fire_count: fires.len(),
                first_drift_ms: fires.first().map(|r| micros_to_ms(r.drift_micros)),
                last_drift_ms: fires.last().map(|r| micros_to_ms(r.drift_micros)),
            });
        }
    }
    one_shots.sort_by_key(|o| o.offset_ms);
    RepublishReport {
        one_shots,
        interval,
    }
}

pub fn render_republish_markdown(report: &RepublishReport) -> String {
    let mut out = String::new();
    out.push_str("| Offset | Fired? | Drift at fire | Still pending? |\n");
    out.push_str("| --- | --- | --- | --- |\n");
    for o in &report.one_shots {
        let status = if o.fired {
            "yes"
        } else if o.still_pending {
            "no (still pending)"
        } else {
            "no (vanished)"
        };
        let drift = o
            .drift_ms
            .map(|v| format!("{v:.3} ms"))
            .unwrap_or_else(|| "-".to_string());
        out.push_str(&format!(
            "| {}s | {} | {} | {} |\n",
            o.offset_ms / 1000,
            status,
            drift,
            o.still_pending
        ));
    }
    if let Some(iv) = &report.interval {
        out.push_str(&format!(
            "\nRepeating row ({}ms cadence): still pending = {}, fired {} time(s), first-tick drift {}, last-tick drift {}\n",
            iv.bucket_ms,
            iv.still_pending,
            iv.fire_count,
            iv.first_drift_ms.map(|v| format!("{v:.3} ms")).unwrap_or_else(|| "-".to_string()),
            iv.last_drift_ms.map(|v| format!("{v:.3} ms")).unwrap_or_else(|| "-".to_string()),
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: &str = "run_id,mode,bucket_ms,sequence,run_start_micros,scheduled_at_micros,fired_at_micros,drift_micros\n";

    #[test]
    fn parses_a_well_formed_csv() {
        let csv = format!(
            "{HEADER}idle-oneshot-100,0,100,0,1000,1100,1150,50\nidle-oneshot-100,0,100,1,1000,1200,1260,60\n"
        );
        let rows = parse_csv(&csv).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].run_id, "idle-oneshot-100");
        assert_eq!(rows[0].run_start_micros, 1000);
        assert_eq!(rows[0].drift_micros, 50);
        assert_eq!(rows[1].sequence, 1);
    }

    #[test]
    fn rejects_a_wrong_header() {
        let csv = "run_id,mode\nfoo,0\n";
        assert!(parse_csv(csv).is_err());
    }

    #[test]
    fn rejects_a_malformed_row_rather_than_dropping_it() {
        let csv = format!("{HEADER}idle-oneshot-100,0,100,0,1000,1100,not-a-number,50\n");
        assert!(parse_csv(&csv).is_err());
    }

    #[test]
    fn skips_blank_lines() {
        let csv = format!("{HEADER}\nidle-oneshot-100,0,100,0,1000,1100,1150,50\n\n");
        let rows = parse_csv(&csv).unwrap();
        assert_eq!(rows.len(), 1);
    }

    fn row(run_id: &str, mode: u8, bucket_ms: u64, sequence: u32, drift_micros: i64) -> Row {
        Row {
            run_id: run_id.to_string(),
            mode,
            bucket_ms,
            sequence,
            run_start_micros: 0,
            scheduled_at_micros: 0,
            fired_at_micros: drift_micros,
            drift_micros,
        }
    }

    #[test]
    fn small_n_groups_report_no_percentile_and_carry_raw_observations() {
        let rows = vec![
            row("slow-600000", mode::ONESHOT_CHAINED, 600_000, 0, 12_000),
            row("slow-600000", mode::ONESHOT_CHAINED, 600_000, 1, 8_000),
        ];
        let summaries = summarize(&rows);
        assert_eq!(summaries.len(), 1);
        let s = &summaries[0];
        assert_eq!(s.n, 2);
        assert_eq!(s.median_ms, None);
        assert_eq!(s.p95_ms, None);
        assert_eq!(s.max_ms, None);
        assert_eq!(s.raw_drift_ms, vec![8.0, 12.0]);
    }

    #[test]
    fn large_n_groups_report_median_p95_and_max() {
        // 100 samples, drift_micros = 1000*i for i in 1..=100 -- median is
        // the average-free midpoint of an even count under nearest-rank,
        // p95 is the 95th value, max is the 100th.
        let rows: Vec<Row> = (1..=100)
            .map(|i| row("fast-100", mode::BURST, 100, i, i as i64 * 1000))
            .collect();
        let summaries = summarize(&rows);
        let s = &summaries[0];
        assert_eq!(s.n, 100);
        assert_eq!(s.median_ms, Some(50.0));
        assert_eq!(s.p95_ms, Some(95.0));
        assert_eq!(s.max_ms, Some(100.0));
    }

    #[test]
    fn interval_mode_reports_cumulative_slip_between_first_and_last_tick() {
        let rows = vec![
            row("idle-interval-100", mode::INTERVAL, 100, 0, 1_000),
            row("idle-interval-100", mode::INTERVAL, 100, 1, 3_000),
            row("idle-interval-100", mode::INTERVAL, 100, 2, 5_000),
        ];
        let summaries = summarize(&rows);
        let slip = summaries[0].cumulative_slip.as_ref().unwrap();
        assert_eq!(slip.first_sequence, 0);
        assert_eq!(slip.first_drift_ms, 1.0);
        assert_eq!(slip.last_sequence, 2);
        assert_eq!(slip.last_drift_ms, 5.0);
        assert_eq!(slip.slip_per_tick_ms, 2.0);
    }

    // Cycle 1's defect (Quentin's finding): this crate restricted
    // cumulative slip to INTERVAL, so a probe shape measured against a
    // moving goalpost (the old ONESHOT_CHAINED anchor) was never checked
    // for slip at all -- the blind spot promoted to a tested requirement.
    // Every repeating mode gets the same treatment now.
    #[test]
    fn oneshot_chained_mode_reports_cumulative_slip_when_its_fires_are_late() {
        let rows = vec![
            row("idle-oneshot-100", mode::ONESHOT_CHAINED, 100, 0, 1_000),
            row("idle-oneshot-100", mode::ONESHOT_CHAINED, 100, 1, 3_000),
            row("idle-oneshot-100", mode::ONESHOT_CHAINED, 100, 2, 5_000),
        ];
        let summaries = summarize(&rows);
        let slip = summaries[0].cumulative_slip.as_ref().unwrap();
        assert_eq!(slip.first_drift_ms, 1.0);
        assert_eq!(slip.last_drift_ms, 5.0);
        assert_eq!(slip.slip_per_tick_ms, 2.0);
    }

    #[test]
    fn oneshot_anchored_mode_also_reports_cumulative_slip() {
        let rows = vec![
            row("idle-anchored-100", mode::ONESHOT_ANCHORED, 100, 0, 500),
            row("idle-anchored-100", mode::ONESHOT_ANCHORED, 100, 1, 520),
        ];
        let summaries = summarize(&rows);
        assert!(summaries[0].cumulative_slip.is_some());
    }

    #[test]
    fn burst_mode_never_reports_cumulative_slip() {
        let rows = vec![
            row("burst-1000", mode::BURST, 0, 0, 1_000),
            row("burst-1000", mode::BURST, 0, 1, 2_000),
        ];
        let summaries = summarize(&rows);
        assert!(summaries[0].cumulative_slip.is_none());
    }

    #[test]
    fn groups_are_sorted_by_run_id_for_a_stable_report() {
        let rows = vec![
            row("z-run", mode::BURST, 0, 0, 0),
            row("a-run", mode::BURST, 0, 0, 0),
        ];
        let summaries = summarize(&rows);
        assert_eq!(summaries[0].run_id, "a-run");
        assert_eq!(summaries[1].run_id, "z-run");
    }

    #[test]
    fn markdown_render_includes_raw_observations_for_small_n() {
        let rows = vec![row(
            "slow-600000",
            mode::ONESHOT_CHAINED,
            600_000,
            0,
            12_000,
        )];
        let summaries = summarize(&rows);
        let md = render_markdown(&summaries);
        assert!(md.contains("single observation"));
        assert!(md.contains("12.000"));
    }

    // --- observer log ---------------------------------------------------

    #[test]
    fn parses_an_observer_log_line_and_computes_latency() {
        let log = r#"1000200 {"observation":{"deletes":[],"inserts":[{"id":1,"run_id":"r","mode":0,"bucket_ms":100,"sequence":0,"scheduled_at_micros":900000,"fired_at_micros":1000000,"drift_micros":100000}]}}"#;
        let latencies = parse_observer_log(log).unwrap();
        assert_eq!(latencies, vec![200]);
    }

    #[test]
    fn observer_log_line_with_no_inserts_contributes_nothing() {
        let log = r#"1000200 {"observation":{"deletes":[{"id":1}],"inserts":[]}}"#;
        let latencies = parse_observer_log(log).unwrap();
        assert!(latencies.is_empty());
    }

    #[test]
    fn observer_log_rejects_a_line_with_no_separating_space() {
        assert!(parse_observer_log("garbage").is_err());
    }

    #[test]
    fn observer_log_rejects_bad_json_rather_than_skipping_it() {
        assert!(parse_observer_log("1000 not-json").is_err());
    }

    #[test]
    fn latency_summary_renders_small_n_as_raw() {
        let summary = summarize_latencies(&[1000, 2000]);
        let md = render_latency_markdown(&summary);
        assert!(md.contains("n=2"));
        assert!(md.contains("1.000"));
    }

    // --- republish classification ---------------------------------------

    fn fired_row(mode: u8, bucket_ms: u64, sequence: u32, drift_micros: i64) -> Row {
        row("republish-leg", mode, bucket_ms, sequence, drift_micros)
    }

    #[test]
    fn classifies_a_one_shot_that_fired() {
        let pre: Vec<PendingRow> = vec![(1, mode::BURST, 5000, 0)];
        let post: Vec<PendingRow> = vec![];
        let fired = vec![fired_row(mode::BURST, 5000, 0, 11_800)];
        let report = classify_republish(&pre, &post, &fired);
        assert_eq!(report.one_shots.len(), 1);
        let o = &report.one_shots[0];
        assert_eq!(o.offset_ms, 5000);
        assert!(o.fired);
        assert_eq!(o.drift_ms, Some(11.8));
        assert!(!o.still_pending);
    }

    #[test]
    fn classifies_a_one_shot_still_pending() {
        let pre: Vec<PendingRow> = vec![(1, mode::BURST, 600_000, 0)];
        let post: Vec<PendingRow> = vec![(1, mode::BURST, 600_000, 0)];
        let report = classify_republish(&pre, &post, &[]);
        let o = &report.one_shots[0];
        assert!(!o.fired);
        assert!(o.still_pending);
    }

    #[test]
    fn classifies_a_one_shot_that_vanished() {
        let pre: Vec<PendingRow> = vec![(1, mode::BURST, 5000, 0)];
        let report = classify_republish(&pre, &[], &[]);
        let o = &report.one_shots[0];
        assert!(!o.fired);
        assert!(!o.still_pending);
    }

    #[test]
    fn classifies_the_repeating_row_with_fire_count_and_first_last_drift() {
        let pre: Vec<PendingRow> = vec![(8, mode::INTERVAL, 1000, 0)];
        let post: Vec<PendingRow> = vec![(8, mode::INTERVAL, 1000, 643)];
        let fired = vec![
            fired_row(mode::INTERVAL, 1000, 0, 443_000),
            fired_row(mode::INTERVAL, 1000, 1, 452_000),
            fired_row(mode::INTERVAL, 1000, 2, 462_000),
        ];
        let report = classify_republish(&pre, &post, &fired);
        let iv = report.interval.unwrap();
        assert!(iv.still_pending);
        assert_eq!(iv.fire_count, 3);
        assert_eq!(iv.first_drift_ms, Some(443.0));
        assert_eq!(iv.last_drift_ms, Some(462.0));
    }
}
