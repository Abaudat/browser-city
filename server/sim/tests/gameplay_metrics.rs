//! Story 4.14 (FR171, FR172): the gameplay-metrics registry, its pinned
//! codes and the pure folds the sampler and `report_client_measure` use.

use proptest::prelude::*;
use sim::gameplay_metrics::{
    BOOT_BUCKETS, BOOT_MAX_MS, ConnFlags, GAMEPLAY_METRICS, Measure, MeasureRefusal, Method,
    RECONNECT_SEAM_MS, RESUME_MAX_MS, Series, TALLY_ROWS, Unit, accept_measure, boot_bucket,
    bucket_upper_edge_ms, metric_of, peak_after, percentile_edge_ms, resumed_within_seam,
    tally_key,
};

const GOLDEN: &str = include_str!("goldens/codes_gameplay_metrics_v1.golden");

fn golden(set: &str) -> Vec<(u32, String)> {
    GOLDEN
        .lines()
        .filter_map(|l| {
            let mut p = l.split(' ');
            if p.next()? != set {
                return None;
            }
            Some((p.next()?.parse().ok()?, p.next()?.to_string()))
        })
        .collect()
}

#[test]
fn registry_holds_exactly_the_fr172_five_and_the_three_live_technical_metrics() {
    let names: Vec<&str> = GAMEPLAY_METRICS.iter().map(|m| m.name).collect();
    assert_eq!(
        names,
        [
            "middle_presence",
            "screen_density",
            "return_after_absence",
            "own_time_split",
            "noticing",
            "boot_time",
            "concurrent_players",
            "reconnection_continuity",
        ]
    );
}

#[test]
fn metric_codes_match_the_append_only_golden() {
    let live: Vec<(u32, String)> = GAMEPLAY_METRICS
        .iter()
        .map(|m| (m.code, m.name.to_string()))
        .collect();
    assert_eq!(live, golden("metric"));
}

#[test]
fn series_codes_match_the_append_only_golden() {
    let live: Vec<(u32, String)> = Series::ALL
        .iter()
        .map(|s| (s.code(), s.name().to_string()))
        .collect();
    assert_eq!(live, golden("series"));
}

#[test]
fn a_series_belongs_to_exactly_one_metric() {
    for s in Series::ALL {
        let owners = GAMEPLAY_METRICS
            .iter()
            .filter(|m| m.series.contains(s))
            .count();
        assert_eq!(owners, 1, "series {} has {owners} owners", s.name());
        assert!(metric_of(*s).series.contains(s));
    }
}

#[test]
fn a_deferred_metric_names_an_epic_after_4_and_a_live_one_epic_4() {
    for m in GAMEPLAY_METRICS {
        if m.series.is_empty() {
            assert!(
                m.emitting_epic > 4,
                "{} is deferred to epic {}",
                m.name,
                m.emitting_epic
            );
        } else {
            assert_eq!(m.emitting_epic, 4, "{} is live", m.name);
        }
    }
}

#[test]
fn every_metric_states_what_it_cannot_see_and_how_it_is_defined() {
    for m in GAMEPLAY_METRICS {
        assert!(
            !m.blind_spot.trim().is_empty(),
            "{} has no blind_spot",
            m.name
        );
        assert!(
            !m.definition.trim().is_empty(),
            "{} has no definition",
            m.name
        );
        assert!(
            !m.emission_point.trim().is_empty(),
            "{} has no emission_point",
            m.name
        );
    }
}

#[test]
fn unprompted_noticing_is_asked_of_players_never_instrumented() {
    let m = GAMEPLAY_METRICS
        .iter()
        .find(|m| m.name == "noticing")
        .unwrap();
    assert_eq!(m.method, Method::AskPlayers);
    assert_eq!(m.unit, Unit::Proportion);
    assert!(m.series.is_empty());
}

#[test]
fn units_of_the_live_metrics() {
    let unit = |n: &str| GAMEPLAY_METRICS.iter().find(|m| m.name == n).unwrap().unit;
    assert_eq!(unit("boot_time"), Unit::Millis);
    assert_eq!(unit("concurrent_players"), Unit::Count);
    assert_eq!(unit("reconnection_continuity"), Unit::Proportion);
}

#[test]
fn tally_keys_are_distinct_and_the_row_count_is_derived_from_the_slots() {
    let mut keys = std::collections::BTreeSet::new();
    for (series, slot) in sim::gameplay_metrics::all_tally_slots() {
        assert!(keys.insert(tally_key(series, slot)), "duplicate tally key");
    }
    assert_eq!(keys.len() as u64, TALLY_ROWS);
}

#[test]
fn boot_edges_are_non_decreasing_and_capped() {
    let mut prev = 0;
    for b in 0..BOOT_BUCKETS {
        let e = bucket_upper_edge_ms(b);
        assert!(e >= prev && e >= 1);
        prev = e;
    }
    assert_eq!(bucket_upper_edge_ms(BOOT_BUCKETS - 1), BOOT_MAX_MS);
    assert_eq!(boot_bucket(1), 0);
    assert!(boot_bucket(BOOT_MAX_MS) < BOOT_BUCKETS);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn a_boot_figure_lands_in_a_bucket_whose_edge_covers_it(ms in 1u32..=BOOT_MAX_MS) {
        let b = boot_bucket(ms);
        prop_assert!(bucket_upper_edge_ms(b) >= ms);
        if b > 0 {
            prop_assert!(bucket_upper_edge_ms(b - 1) < ms);
        }
    }

    #[test]
    fn percentile_is_the_upper_edge_of_the_nearest_rank_bucket(
        reports in proptest::collection::vec(1u32..=BOOT_MAX_MS, 1..200),
        pct in prop_oneof![Just(50u64), Just(95u64)],
    ) {
        let mut counts = vec![0u64; BOOT_BUCKETS];
        for r in &reports {
            counts[boot_bucket(*r)] += 1;
        }
        let mut sorted = reports.clone();
        sorted.sort_unstable();
        let rank = (pct * sorted.len() as u64).div_ceil(100).max(1) as usize;
        let truth = sorted[rank - 1];
        let got = percentile_edge_ms(&counts, pct).unwrap();
        prop_assert_eq!(got, bucket_upper_edge_ms(boot_bucket(truth)));
        prop_assert!(got >= truth);
    }

    #[test]
    fn p50_never_exceeds_p95(reports in proptest::collection::vec(1u32..=BOOT_MAX_MS, 1..100)) {
        let mut counts = vec![0u64; BOOT_BUCKETS];
        for r in &reports {
            counts[boot_bucket(*r)] += 1;
        }
        prop_assert!(percentile_edge_ms(&counts, 50) <= percentile_edge_ms(&counts, 95));
    }

    #[test]
    fn peak_is_never_below_the_peak_or_the_current_count(peak in any::<u64>(), current in any::<u64>()) {
        let next = peak_after(peak, current);
        prop_assert!(next >= current && next >= peak);
    }

    #[test]
    fn resumes_within_the_seam_never_exceed_the_resumes(
        outages in proptest::collection::vec(1u32..=RESUME_MAX_MS, 0..50)
    ) {
        let within = outages.iter().filter(|o| resumed_within_seam(**o)).count();
        prop_assert!(within <= outages.len());
    }
}

#[test]
fn empty_histogram_has_no_percentile() {
    assert_eq!(percentile_edge_ms(&vec![0; BOOT_BUCKETS], 50), None);
}

#[test]
fn the_seam_boundary_is_inclusive() {
    assert!(resumed_within_seam(RECONNECT_SEAM_MS));
    assert!(!resumed_within_seam(RECONNECT_SEAM_MS + 1));
}

const FRESH: ConnFlags = ConnFlags {
    boot_reported: false,
    resume_reported: false,
};

#[test]
fn boot_is_accepted_once_in_range() {
    let f = accept_measure(FRESH, Measure::Boot { millis: 900 }).unwrap();
    assert!(f.boot_reported && !f.resume_reported);
    assert_eq!(
        accept_measure(f, Measure::Boot { millis: 900 }),
        Err(MeasureRefusal::AlreadyReported)
    );
}

#[test]
fn boot_refuses_zero_and_absurd_values() {
    for millis in [0, BOOT_MAX_MS + 1, u32::MAX] {
        assert_eq!(
            accept_measure(FRESH, Measure::Boot { millis }),
            Err(MeasureRefusal::OutOfRange),
            "{millis}"
        );
    }
    assert!(
        accept_measure(
            FRESH,
            Measure::Boot {
                millis: BOOT_MAX_MS
            }
        )
        .is_ok()
    );
}

#[test]
fn resume_is_accepted_once_and_bounded() {
    let f = accept_measure(
        FRESH,
        Measure::Resumed {
            outage_millis: 1200,
        },
    )
    .unwrap();
    assert!(f.resume_reported && !f.boot_reported);
    assert_eq!(
        accept_measure(
            f,
            Measure::Resumed {
                outage_millis: 1200
            }
        ),
        Err(MeasureRefusal::AlreadyReported)
    );
    for outage_millis in [0, RESUME_MAX_MS + 1] {
        assert_eq!(
            accept_measure(FRESH, Measure::Resumed { outage_millis }),
            Err(MeasureRefusal::OutOfRange)
        );
    }
}

#[test]
fn boot_and_resume_are_independent_flags() {
    let f = accept_measure(FRESH, Measure::Boot { millis: 10 }).unwrap();
    assert!(accept_measure(f, Measure::Resumed { outage_millis: 10 }).is_ok());
}
