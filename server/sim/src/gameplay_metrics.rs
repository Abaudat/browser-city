//! FR171/FR172: the gameplay-metrics registry and the pure folds behind the
//! three metrics that emit today. Every figure is an integer count, a
//! duration in milliseconds or a numerator over a denominator -- never a
//! float, never a free-text unit. A metric is one `GAMEPLAY_METRICS` row;
//! a figure it emits is one `Series`, written by one emitter chosen by an
//! exhaustive `match` in `tables::metrics`, so a series without an emitter
//! does not compile. `bounds/tests/gameplay_metrics_coverage.rs` gates the
//! registry against the GDD, the trace matrix and the sampler.

/// How a figure reads. `gameplay_metric_sample.value`/`sample_size` mean:
/// `Count` -- the count, 1; `Millis` -- the percentile's bucket upper edge,
/// the number of reports; `Proportion` -- numerator, denominator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Count,
    Millis,
    Proportion,
}

/// How the figure is obtained.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    /// Counted or timed by the game itself.
    Instrumented,
    /// A stand-in for the thing meant; its `blind_spot` names the gap.
    Proxy,
    /// Only a conversation with players answers it.
    AskPlayers,
}

/// One number a metric is read through, with its own append-only code
/// (`tests/goldens/codes_gameplay_metrics_v1.golden`). A deferred metric
/// has none; its emitting epic adds the variant and its emitter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Series {
    BootMillisP50,
    BootMillisP95,
    ConcurrentNow,
    ConcurrentPeak,
    ReconnectWithinSeam,
}

impl Series {
    pub const ALL: &'static [Series] = &[
        Series::BootMillisP50,
        Series::BootMillisP95,
        Series::ConcurrentNow,
        Series::ConcurrentPeak,
        Series::ReconnectWithinSeam,
    ];

    pub const fn code(self) -> u32 {
        match self {
            Series::BootMillisP50 => 1,
            Series::BootMillisP95 => 2,
            Series::ConcurrentNow => 3,
            Series::ConcurrentPeak => 4,
            Series::ReconnectWithinSeam => 5,
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Series::BootMillisP50 => "boot_millis_p50",
            Series::BootMillisP95 => "boot_millis_p95",
            Series::ConcurrentNow => "concurrent_now",
            Series::ConcurrentPeak => "concurrent_peak",
            Series::ReconnectWithinSeam => "reconnect_within_seam",
        }
    }
}

/// One metric's definition. `definition` is the one place its words live;
/// the GDD names the metric and does not restate it.
#[derive(Debug, Clone, Copy)]
pub struct Metric {
    pub code: u32,
    pub name: &'static str,
    pub unit: Unit,
    pub emitting_epic: u32,
    pub emission_point: &'static str,
    pub method: Method,
    pub blind_spot: &'static str,
    pub definition: &'static str,
    pub series: &'static [Series],
}

/// Every metric. Append-only by code.
pub const GAMEPLAY_METRICS: &[Metric] = &[
    Metric {
        code: 1,
        name: "middle_presence",
        unit: Unit::Proportion,
        emitting_epic: 8,
        emission_point: "once per completed shift, at ritual close (stories 8.4, 8.5)",
        method: Method::Instrumented,
        blind_spot: "whether the player who stayed was enjoying it or waiting it out",
        definition: "City-minutes of the discretionary middle in which the shift's character was \
            driven by a connected player, over the middle's city-minutes. Sitting still counts \
            as present. A shift the understudy worked contributes nothing. Each row also \
            carries whether a player act occurred and whether the body was the player's own.",
        series: &[],
    },
    Metric {
        code: 2,
        name: "screen_density",
        unit: Unit::Proportion,
        emitting_epic: 5,
        emission_point: "once per in-city hour per connected character, only while a player is connected",
        method: Method::Proxy,
        blind_spot: "whether the player describes the city as populated; bodies in the \
            interest region stand in for the screen",
        definition: "At exactly one connected player, the samples whose count of citizen bodies \
            within the character's interest region is zero, over all samples, split by city \
            hour and district kind.",
        series: &[],
    },
    Metric {
        code: 3,
        name: "return_after_absence",
        unit: Unit::Proportion,
        emitting_epic: 9,
        emission_point: "sampler fire, from connect and disconnect gaps",
        method: Method::Instrumented,
        blind_spot: "why the player came back; reads as a safe-absence test only once the \
            understudy exists, and is meaningless below a cohort of about twenty",
        definition: "Of the characters whose absence passed seven real days at least \
            twenty-eight days ago, those who connected again within those twenty-eight days. \
            The denominator is the cohort size.",
        series: &[],
    },
    Metric {
        code: 4,
        name: "own_time_split",
        unit: Unit::Proportion,
        emitting_epic: 12,
        emission_point: "end of each own-time activity (epic 12 pursuits, epic 13 qualification)",
        method: Method::Instrumented,
        blind_spot: "a pursuit that is a qualification in disguise, and a class attended for \
            the people",
        definition: "Three proportions of own-time minutes while connected: qualification, \
            pursuit, and own-time in neither. Reads only once both sides exist (story 13.10).",
        series: &[],
    },
    Metric {
        code: 5,
        name: "noticing",
        unit: Unit::Proportion,
        emitting_epic: 7,
        emission_point: "a debrief after a session, recorded under docs (first at story 7.13)",
        method: Method::AskPlayers,
        blind_spot: "noticing is a remark and the game has no free text; the optional \
            unrequired-act proxy cannot see noticing without acting and counts acting \
            without noticing",
        definition: "Of debriefs held on an open prompt that does not mention the city's state, \
            those containing at least one unprompted mention of a specific carrier verified \
            against what the world held at the time.",
        series: &[],
    },
    Metric {
        code: 6,
        name: "boot_time",
        unit: Unit::Millis,
        emitting_epic: 4,
        emission_point: "client boot marks, reported once per boot on a connected page",
        method: Method::Instrumented,
        blind_spot: "players who never reach a connected page, and a tab woken from sleep; \
            percentiles are the upper edge of a log-spaced bucket",
        definition: "Milliseconds from navigation to controllable on a returning player's \
            boot; the period's p50 and p95 against the one-second target.",
        series: &[Series::BootMillisP50, Series::BootMillisP95],
    },
    Metric {
        code: 7,
        name: "concurrent_players",
        unit: Unit::Count,
        emitting_epic: 4,
        emission_point: "sampler fire, counted from live connections",
        method: Method::Instrumented,
        blind_spot: "who the connections are; an open tab with nobody at it counts",
        definition: "Live connections at the fire, and the highest count seen since the \
            previous fire.",
        series: &[Series::ConcurrentNow, Series::ConcurrentPeak],
    },
    Metric {
        code: 8,
        name: "reconnection_continuity",
        unit: Unit::Proportion,
        emitting_epic: 4,
        emission_point: "client resume after a drop on the same page",
        method: Method::Instrumented,
        blind_spot: "a drop whose page closes before it resumes is never seen, and whether \
            position and state were seamless is not measured here",
        definition: "Resumes whose outage was at most the seam threshold, over all resumes.",
        series: &[Series::ReconnectWithinSeam],
    },
];

/// The metric a series belongs to.
pub fn metric_of(series: Series) -> &'static Metric {
    GAMEPLAY_METRICS
        .iter()
        .find(|m| m.series.contains(&series))
        .expect("every series is listed by one metric")
}

/// Series per fire: `gameplay_metric_sample`'s rows per fire.
pub const LIVE_SERIES_COUNT: u64 = Series::ALL.len() as u64;
/// The sampler fires hourly.
pub const SAMPLES_PER_DAY: u64 = 24;

/// A boot figure above this is refused (one minute).
pub const BOOT_MAX_MS: u32 = 60_000;
/// A resume outage above this is refused (24 hours).
pub const RESUME_MAX_MS: u32 = 24 * 60 * 60 * 1000;
/// A resume whose outage is at most this is within the seam.
pub const RECONNECT_SEAM_MS: u32 = 5_000;

/// Log-spaced boot-time histogram buckets.
pub const BOOT_BUCKETS: usize = 64;

const fn boot_edges() -> [u32; BOOT_BUCKETS] {
    let mut edges = [0u32; BOOT_BUCKETS];
    let mut prev: u64 = 0;
    let mut i = 0;
    while i < BOOT_BUCKETS {
        let grown = prev * 119 / 100;
        let mut next = if grown > prev { grown } else { prev + 1 };
        if next > BOOT_MAX_MS as u64 || i == BOOT_BUCKETS - 1 {
            next = BOOT_MAX_MS as u64;
        }
        edges[i] = next as u32;
        prev = next;
        i += 1;
    }
    edges
}

const BOOT_EDGES: [u32; BOOT_BUCKETS] = boot_edges();

/// The upper edge, in ms, of bucket `bucket` (clamped to the last).
pub fn bucket_upper_edge_ms(bucket: usize) -> u32 {
    BOOT_EDGES[bucket.min(BOOT_BUCKETS - 1)]
}

/// The first bucket whose upper edge covers `ms` (`ms` is clamped to
/// `1..=BOOT_MAX_MS`).
pub fn boot_bucket(ms: u32) -> usize {
    let ms = ms.clamp(1, BOOT_MAX_MS);
    BOOT_EDGES
        .iter()
        .position(|&e| e >= ms)
        .unwrap_or(BOOT_BUCKETS - 1)
}

/// The nearest-rank `pct` percentile of a histogram, as its bucket's upper
/// edge; `None` when it holds no report.
pub fn percentile_edge_ms(counts: &[u64], pct: u64) -> Option<u32> {
    let total = counts.iter().fold(0u64, |a, c| a.saturating_add(*c));
    if total == 0 {
        return None;
    }
    let rank = pct.min(100).saturating_mul(total).div_ceil(100).max(1);
    let mut seen = 0u64;
    for (i, c) in counts.iter().enumerate() {
        seen = seen.saturating_add(*c);
        if seen >= rank {
            return Some(bucket_upper_edge_ms(i));
        }
    }
    Some(bucket_upper_edge_ms(counts.len().saturating_sub(1)))
}

/// The peak after observing `current` live connections.
pub fn peak_after(peak: u64, current: u64) -> u64 {
    peak.max(current)
}

/// Whether a resume's outage is inside the seam threshold.
pub fn resumed_within_seam(outage_ms: u32) -> bool {
    outage_ms <= RECONNECT_SEAM_MS
}

/// What a client reports about itself (`report_client_measure`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Measure {
    Boot { millis: u32 },
    Resumed { outage_millis: u32 },
}

/// Which measures one connection has already reported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ConnFlags {
    pub boot_reported: bool,
    pub resume_reported: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeasureRefusal {
    OutOfRange,
    AlreadyReported,
}

impl MeasureRefusal {
    pub fn message(self) -> &'static str {
        match self {
            MeasureRefusal::OutOfRange => "measure out of range",
            MeasureRefusal::AlreadyReported => "measure already reported on this connection",
        }
    }
}

/// Validates an untrusted client measure against the connection's flags;
/// returns the flags after accepting it.
pub fn accept_measure(flags: ConnFlags, measure: Measure) -> Result<ConnFlags, MeasureRefusal> {
    match measure {
        Measure::Boot { millis } => {
            if millis == 0 || millis > BOOT_MAX_MS {
                return Err(MeasureRefusal::OutOfRange);
            }
            if flags.boot_reported {
                return Err(MeasureRefusal::AlreadyReported);
            }
            Ok(ConnFlags {
                boot_reported: true,
                ..flags
            })
        }
        Measure::Resumed { outage_millis } => {
            if outage_millis == 0 || outage_millis > RESUME_MAX_MS {
                return Err(MeasureRefusal::OutOfRange);
            }
            if flags.resume_reported {
                return Err(MeasureRefusal::AlreadyReported);
            }
            Ok(ConnFlags {
                resume_reported: true,
                ..flags
            })
        }
    }
}

/// Tally slots. Peak and resume counts are one row each; the boot
/// histogram is one row per bucket, under `BootMillisP50`.
pub const SLOT_PEAK: u32 = 0;
pub const SLOT_RESUME_WITHIN: u32 = 0;
pub const SLOT_RESUME_TOTAL: u32 = 1;

/// The `metric_tally` primary key for `series` and `slot`.
pub const fn tally_key(series: Series, slot: u32) -> u64 {
    ((series.code() as u64) << 32) | slot as u64
}

/// Every `(series, slot)` a tally row exists for.
pub fn all_tally_slots() -> Vec<(Series, u32)> {
    let mut out = vec![(Series::ConcurrentPeak, SLOT_PEAK)];
    out.push((Series::ReconnectWithinSeam, SLOT_RESUME_WITHIN));
    out.push((Series::ReconnectWithinSeam, SLOT_RESUME_TOTAL));
    for b in 0..BOOT_BUCKETS as u32 {
        out.push((Series::BootMillisP50, b));
    }
    out
}

/// `metric_tally`'s row count: derived from the slots above.
pub const TALLY_ROWS: u64 = 1 + 2 + BOOT_BUCKETS as u64;

/// `gameplay_metric_sample`'s ceiling: live series x fires per day x
/// retention.
pub const fn sample_rows_for_days(days: u64) -> u64 {
    LIVE_SERIES_COUNT * SAMPLES_PER_DAY * days
}
