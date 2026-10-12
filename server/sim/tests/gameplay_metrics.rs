//! Story 4.14 (FR171, FR172): the gameplay-metrics registry, its pinned
//! codes and the pure period fold the sampler and `report_client_measure`
//! use.

use proptest::prelude::*;
use sim::gameplay_metrics::{
    BOOT_BUCKETS, BOOT_MAX_MS, BOOT_TARGET_MS, ConnFlags, GAMEPLAY_METRICS, Measure,
    MeasureRefusal, Method, Period, RECONNECT_SEAM_MS, RESUME_MAX_MS, Series, TALLY_ROWS, Tally,
    Unit, accept_measure, boot_bucket, bucket_upper_edge_ms, metric_of, percentile_edge_ms,
    resumed_within_seam,
};

const GOLDEN: &str = include_str!("goldens/codes_gameplay_metrics_v1.golden");
const EDGES_GOLDEN: &str = include_str!("goldens/boot_edges_v1.golden");

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
            "packing_forced",
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
fn a_deferred_metric_names_an_epic_after_4_and_a_live_one_an_epic_that_has_landed() {
    for m in GAMEPLAY_METRICS {
        if m.series.is_empty() {
            assert!(
                m.emitting_epic > 4,
                "{} is deferred to epic {}",
                m.name,
                m.emitting_epic
            );
        } else {
            // Epic 4 (the technical metrics) and epic 8 (`packing_forced`'s
            // first store writer).
            assert!([4, 8].contains(&m.emitting_epic), "{} is live", m.name);
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

fn metric(name: &str) -> &'static sim::gameplay_metrics::Metric {
    GAMEPLAY_METRICS.iter().find(|m| m.name == name).unwrap()
}

#[test]
fn unprompted_noticing_is_asked_of_players_never_instrumented() {
    let m = metric("noticing");
    assert_eq!(m.method, Method::AskPlayers);
    assert_eq!(m.unit, Unit::Proportion);
    assert!(m.series.is_empty());
}

#[test]
fn units_of_the_live_metrics() {
    assert_eq!(metric("boot_time").unit, Unit::Millis);
    assert_eq!(metric("concurrent_players").unit, Unit::Count);
    assert_eq!(metric("reconnection_continuity").unit, Unit::Proportion);
}

#[test]
fn the_definitions_say_what_the_instrument_does() {
    let boot = metric("boot_time").definition;
    assert!(
        !boot.contains("returning"),
        "nothing distinguishes a returning boot"
    );
    assert!(boot.contains("first boot"), "the 4.16 obligation is stated");
    let density = metric("screen_density").definition;
    assert!(density.contains("median") && density.contains("zero"));
    assert!(
        metric("reconnection_continuity")
            .definition
            .contains("pause")
    );
}

// -- tallies -----------------------------------------------------------

#[test]
fn tally_keys_are_distinct_and_the_row_count_is_derived_from_them() {
    let mut keys = std::collections::BTreeSet::new();
    for t in Tally::all() {
        assert!(keys.insert(t.key()), "duplicate tally key for {t:?}");
    }
    assert_eq!(keys.len() as u64, TALLY_ROWS);
    assert_eq!(Tally::all().count() as u64, TALLY_ROWS);
}

#[test]
fn a_period_round_trips_through_its_tally_rows() {
    let mut p = Period::new(3);
    p.on_measure(Measure::Boot { millis: 900 });
    p.on_measure(Measure::Resumed { outage_millis: 10 });
    let back = Period::from_tallies(p.tallies());
    assert_eq!(back, p);
    assert_eq!(p.tallies().len() as u64, TALLY_ROWS);
}

// -- boot edges ----------------------------------------------------------

fn edges() -> Vec<u32> {
    (0..BOOT_BUCKETS).map(bucket_upper_edge_ms).collect()
}

#[test]
fn boot_edges_are_strictly_increasing_and_end_at_the_cap() {
    let e = edges();
    assert!(e.windows(2).all(|w| w[0] < w[1]), "{e:?}");
    assert_eq!(*e.last().unwrap(), BOOT_MAX_MS);
    assert_eq!(boot_bucket(1), 0);
}

#[test]
fn there_is_an_edge_exactly_at_the_one_second_target() {
    assert_eq!(BOOT_TARGET_MS, 1_000);
    assert_eq!(bucket_upper_edge_ms(boot_bucket(1_000)), 1_000);
    assert!(bucket_upper_edge_ms(boot_bucket(1_001)) > 1_000);
}

#[test]
fn no_bucket_near_the_target_is_wider_than_50_ms() {
    let e = edges();
    let mut lower = 0;
    for &upper in &e {
        if upper >= 800 && lower < 1_200 {
            assert!(upper - lower <= 50, "bucket ({lower}, {upper}] is too wide");
        }
        lower = upper;
    }
}

#[test]
fn the_edges_are_pinned_to_the_golden_the_e2e_reads() {
    let golden: Vec<u32> = EDGES_GOLDEN
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.trim().parse().unwrap())
        .collect();
    assert_eq!(golden, edges());
}

// -- the seam ---------------------------------------------------------------
// `RECONNECT_SEAM_MS` is held equal to the client PROBE_TIMEOUT_MS by
// `scripts/ci/check-reconnect-seam-agrees.sh` (NFR30: server tests never
// read the client tree).

#[test]
fn the_seam_boundary_is_inclusive() {
    assert!(resumed_within_seam(RECONNECT_SEAM_MS));
    assert!(!resumed_within_seam(RECONNECT_SEAM_MS + 1));
}

// -- the period fold -------------------------------------------------------

#[derive(Debug, Clone)]
enum Op {
    Connect,
    Disconnect,
    Boot(u32),
    Resume(u32),
    Fire,
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        3 => Just(Op::Connect),
        3 => Just(Op::Disconnect),
        2 => (1u32..=BOOT_MAX_MS).prop_map(Op::Boot),
        2 => (1u32..=RESUME_MAX_MS).prop_map(Op::Resume),
        2 => Just(Op::Fire),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(128))]

    #[test]
    fn every_fire_reports_exactly_what_its_period_saw(ops in proptest::collection::vec(op(), 0..120)) {
        let mut live = 0u64;
        let mut period = Period::new(live);
        // The independent model of one period.
        let (mut max_live, mut boots, mut resumes, mut within) = (live, Vec::new(), 0u64, 0u64);
        for op in ops {
            match op {
                Op::Connect => {
                    live += 1;
                    period.on_connect(live);
                    max_live = max_live.max(live);
                }
                Op::Disconnect => live = live.saturating_sub(1),
                Op::Boot(ms) => {
                    period.on_measure(Measure::Boot { millis: ms });
                    boots.push(ms);
                }
                Op::Resume(ms) => {
                    period.on_measure(Measure::Resumed { outage_millis: ms });
                    resumes += 1;
                    if ms <= RECONNECT_SEAM_MS {
                        within += 1;
                    }
                }
                Op::Fire => {
                    let (rows, next) = period.fire(live);
                    let get = |s: Series| rows.iter().find(|r| r.0 == s).map(|r| (r.1, r.2)).unwrap();
                    prop_assert_eq!(rows.len(), Series::ALL.len());
                    prop_assert_eq!(get(Series::ConcurrentNow), (live, 1));
                    let (peak, _) = get(Series::ConcurrentPeak);
                    prop_assert!(peak >= live);
                    prop_assert_eq!(peak, max_live);
                    prop_assert_eq!(get(Series::ReconnectWithinSeam), (within, resumes));
                    prop_assert!(within <= resumes);
                    let (p50, n50) = get(Series::BootMillisP50);
                    let (p95, n95) = get(Series::BootMillisP95);
                    prop_assert_eq!(n50, boots.len() as u64);
                    prop_assert_eq!(n95, boots.len() as u64);
                    if boots.is_empty() {
                        prop_assert_eq!((p50, p95), (0, 0));
                    } else {
                        prop_assert!(p50 <= p95);
                        prop_assert!(p95 >= u64::from(*boots.iter().min().unwrap()));
                    }
                    // The next period: peak seeded at the live count, every
                    // other slot zero.
                    prop_assert_eq!(next.peak, live);
                    prop_assert_eq!((next.within, next.total), (0, 0));
                    prop_assert!(next.boot.iter().all(|c| *c == 0));
                    period = next;
                    max_live = live;
                    boots.clear();
                    resumes = 0;
                    within = 0;
                }
            }
        }
    }

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
}

#[test]
fn empty_histogram_has_no_percentile() {
    assert_eq!(percentile_edge_ms(&vec![0; BOOT_BUCKETS], 50), None);
}

// -- the measure call ------------------------------------------------------

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

#[test]
fn packing_forced_is_one_proportion_series_folded_into_the_period() {
    let m = GAMEPLAY_METRICS
        .iter()
        .find(|m| m.name == "packing_forced")
        .unwrap();
    assert_eq!(m.unit, Unit::Proportion);
    assert_eq!(m.method, Method::Instrumented);
    assert_eq!(m.series, &[Series::PackingForced]);
    assert_eq!(metric_of(Series::PackingForced).name, "packing_forced");
}

#[test]
fn packing_forced_counts_forced_stores_over_all_store_attempts() {
    let mut p = Period::new(0);
    assert_eq!(p.figure(Series::PackingForced, 0), (0, 0));
    p.on_store(false);
    p.on_store(true);
    p.on_store(false);
    p.on_store(true);
    assert_eq!(p.figure(Series::PackingForced, 0), (2, 4));
    // A fire reports it and the next period starts empty.
    let (rows, next) = p.fire(0);
    assert!(rows.contains(&(Series::PackingForced, 2, 4)));
    assert_eq!(next.figure(Series::PackingForced, 0), (0, 0));
}

#[test]
fn packing_tallies_round_trip_through_their_rows() {
    let mut p = Period::new(0);
    p.on_store(true);
    p.on_store(false);
    let back = Period::from_tallies(p.tallies());
    assert_eq!(back.packing_forced, 1);
    assert_eq!(back.packing_total, 2);
}
