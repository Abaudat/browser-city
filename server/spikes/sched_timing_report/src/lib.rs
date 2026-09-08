//! Pure reduction of `sched_timing_spike`'s raw `observation` export into
//! the median/p95/max/n table the spike report reads. The module never
//! computes a statistic (Tim's direction) -- this binary is the only
//! place that does, and it is a sort and an index, not a stats crate.

use std::cmp::Ordering;
use std::collections::BTreeMap;

/// `sched_timing_spike::mode` mirrored here as a plain constant, not a
/// shared dependency -- this crate never links against the wasm module
/// crate (NFR30's "no shared code" spirit, applied within `server/` too:
/// a native reducer of a wasm module's export has no business depending
/// on it).
pub mod mode {
    pub const ONESHOT_CHAINED: u8 = 0;
    pub const INTERVAL: u8 = 1;
    pub const BURST: u8 = 2;
}

/// One raw `observation` row, exactly as `sched_timing_spike` wrote it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    pub run_id: String,
    pub mode: u8,
    pub bucket_ms: u64,
    pub sequence: u32,
    pub scheduled_at_micros: i64,
    pub fired_at_micros: i64,
    pub drift_micros: i64,
}

/// Parses the CSV `sched-timing-export.sh`'s jq step writes: header
/// `run_id,mode,bucket_ms,sequence,scheduled_at_micros,fired_at_micros,
/// drift_micros`, one observation per line, no quoting (none of the
/// fields ever contain a comma). Blank lines are skipped. Fails loudly
/// (`Err`, not a silently-dropped row) on anything malformed -- a
/// misparsed row would corrupt a percentile, and a stray warning is
/// exactly the kind of thing this crate exists so a human doesn't have
/// to re-read a terminal transcript to catch.
pub fn parse_csv(input: &str) -> Result<Vec<Row>, String> {
    let mut lines = input.lines();
    let header = lines.next().ok_or("empty input, no header row")?;
    let expected =
        "run_id,mode,bucket_ms,sequence,scheduled_at_micros,fired_at_micros,drift_micros";
    if header.trim() != expected {
        return Err(format!(
            "unexpected header: {header:?} (expected {expected:?})"
        ));
    }
    let mut rows = Vec::new();
    for (i, line) in lines.enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split(',').collect();
        if fields.len() != 7 {
            return Err(format!(
                "line {}: expected 7 fields, got {}: {line:?}",
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
            scheduled_at_micros: parse_i64(4, "scheduled_at_micros")?,
            fired_at_micros: parse_i64(5, "fired_at_micros")?,
            drift_micros: parse_i64(6, "drift_micros")?,
        });
    }
    Ok(rows)
}

/// Median/p95/max/n of one group's `drift_micros`, in milliseconds, plus
/// (for `INTERVAL`) the cumulative-slip reading Tim's direction asks
/// for: the drift at the first and last observed tick and the average
/// per-tick growth between them. A per-fire jitter of a few ms that does
/// not grow with `sequence` is a different finding from a `slip_per_tick_ms`
/// that is not ~0 -- this struct keeps them visibly separate rather than
/// collapsing into one number.
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

            let cumulative_slip = if mode == mode::INTERVAL && group.len() >= 2 {
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

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: &str =
        "run_id,mode,bucket_ms,sequence,scheduled_at_micros,fired_at_micros,drift_micros\n";

    #[test]
    fn parses_a_well_formed_csv() {
        let csv = format!(
            "{HEADER}idle-oneshot-100,0,100,0,1000,1050,50\nidle-oneshot-100,0,100,1,1100,1160,60\n"
        );
        let rows = parse_csv(&csv).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].run_id, "idle-oneshot-100");
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
        let csv = format!("{HEADER}idle-oneshot-100,0,100,0,1000,not-a-number,50\n");
        assert!(parse_csv(&csv).is_err());
    }

    #[test]
    fn skips_blank_lines() {
        let csv = format!("{HEADER}\nidle-oneshot-100,0,100,0,1000,1050,50\n\n");
        let rows = parse_csv(&csv).unwrap();
        assert_eq!(rows.len(), 1);
    }

    fn row(run_id: &str, mode: u8, bucket_ms: u64, sequence: u32, drift_micros: i64) -> Row {
        Row {
            run_id: run_id.to_string(),
            mode,
            bucket_ms,
            sequence,
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
            .map(|i| row("fast-100", mode::ONESHOT_CHAINED, 100, i, i as i64 * 1000))
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

    #[test]
    fn oneshot_and_burst_modes_never_report_cumulative_slip() {
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
}
