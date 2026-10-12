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
    PackingForced,
}

impl Series {
    pub const ALL: &'static [Series] = &[
        Series::BootMillisP50,
        Series::BootMillisP95,
        Series::ConcurrentNow,
        Series::ConcurrentPeak,
        Series::ReconnectWithinSeam,
        Series::PackingForced,
    ];

    pub const fn code(self) -> u32 {
        match self {
            Series::BootMillisP50 => 1,
            Series::BootMillisP95 => 2,
            Series::ConcurrentNow => 3,
            Series::ConcurrentPeak => 4,
            Series::ReconnectWithinSeam => 5,
            Series::PackingForced => 6,
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Series::BootMillisP50 => "boot_millis_p50",
            Series::BootMillisP95 => "boot_millis_p95",
            Series::ConcurrentNow => "concurrent_now",
            Series::ConcurrentPeak => "concurrent_peak",
            Series::ReconnectWithinSeam => "reconnect_within_seam",
            Series::PackingForced => "packing_forced",
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
        unit: Unit::Count,
        emitting_epic: 5,
        emission_point: "once per in-city hour per connected character, only while a player is connected",
        method: Method::Proxy,
        blind_spot: "whether the player describes the city as populated; bodies in the \
            interest region stand in for the screen",
        definition: "At exactly one connected player, per sample, the count of citizen bodies \
            within the character's interest region. Primary reading: the median count per \
            sample, split by city-hour band and district kind, so a busy street at rush hour \
            must read busy and a residential street at 3am quiet. Alarm figure from the same \
            samples: the proportion of samples at zero (the dead screen). Epic 5 adds both as \
            series, the median a count and the dead-screen rate a proportion.",
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
            The denominator is the cohort size. No absence that began before emission started \
            counts: the clock starts when the series does.",
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
        blind_spot: "a player who noticed and did not mention it is invisible, and a debrief is \
            itself a prompt to talk, so the figure is unprompted only in that the city state \
            was never named; the optional unrequired-act proxy cannot see noticing without \
            acting and counts acting without noticing",
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
        definition: "Milliseconds from navigation to controllable on every boot the client \
            reports (once per page that has not lost its connection); the period p50 and p95, \
            each the upper edge of its bucket, with an edge exactly at the one-second target. \
            NFR1's target applies to the return path: the story that adds the name prompt \
            (4.16) must exclude or separate a first boot from Boot.",
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
        blind_spot: "a drop whose page closes before it resumes is never seen, a silent drop \
            is noticed up to the probe timeout after it happened and that detection time is \
            not in the outage, and whether position and state were seamless is not measured \
            here",
        definition: "Resumes whose outage, from the page noticing the drop to the connection \
            returning, was at most the seam threshold (5 s: an outage short enough that the \
            player did not read it as a pause), over all resumes.",
        series: &[Series::ReconnectWithinSeam],
    },
    Metric {
        code: 9,
        name: "packing_forced",
        unit: Unit::Proportion,
        emitting_epic: 6,
        emission_point: "each attempt to store an item into a container's grid (story 6.10's fit rule)",
        method: Method::Instrumented,
        blind_spot: concat!(
            "whether a refusal or a rotation felt like a puzzle or like a chore, and ",
            "stores by a non-player packer, which are counted the same"
        ),
        definition: concat!(
            "Store attempts that were refused because the item did not fit, or that fit only ",
            "rotated (no unrotated placement existed in the grid), over all store attempts. ",
            "The tedium dial: the grid sizes in defs/objects are what moves it. Read first ",
            "when tuning a container."
        ),
        series: &[Series::PackingForced],
    },
];

/// The metric a series belongs to.
pub fn metric_of(series: Series) -> &'static Metric {
    GAMEPLAY_METRICS
        .iter()
        .find(|m| m.series.contains(&series))
        .expect("every series is listed by one metric")
}

/// Series per fire: the rows `gameplay_metric_sample` gains per fire.
pub const LIVE_SERIES_COUNT: u64 = Series::ALL.len() as u64;
/// The sampler fires hourly.
pub const SAMPLES_PER_DAY: u64 = 24;

/// A boot figure above this is refused (one minute).
pub const BOOT_MAX_MS: u32 = 60_000;
/// A resume outage above this is refused (24 hours).
pub const RESUME_MAX_MS: u32 = 24 * 60 * 60 * 1000;
/// A resume whose outage is at most this is within the seam. It equals the
/// client `PROBE_TIMEOUT_MS` (`reconnect-policy.ts`): a silent drop is only
/// noticed that long after it happened, and `tests/gameplay_metrics.rs`
/// pins the two together.
pub const RECONNECT_SEAM_MS: u32 = 5_000;

/// The boot target (NFR1): the histogram has an edge exactly here.
pub const BOOT_TARGET_MS: u32 = 1_000;

/// The next bucket upper edge after `prev`: roughly geometric (x1.19),
/// 50 ms wide from 750 to 1 200 ms (the target sits on an edge), capped at
/// `BOOT_MAX_MS`. Strictly increasing.
const fn edge_after(prev: u32) -> u32 {
    let grown = prev as u64 * 119 / 100;
    let step = if grown > prev as u64 {
        grown
    } else {
        prev as u64 + 1
    };
    let next = if prev < 750 {
        if step > 750 { 750 } else { step }
    } else if prev < 1_200 {
        prev as u64 + 50
    } else if step > BOOT_MAX_MS as u64 {
        BOOT_MAX_MS as u64
    } else {
        step
    };
    next as u32
}

const fn count_edges() -> usize {
    let mut n = 0;
    let mut prev = 0;
    while prev < BOOT_MAX_MS {
        prev = edge_after(prev);
        n += 1;
    }
    n
}

/// Log-spaced boot-time histogram buckets (derived from the edges).
pub const BOOT_BUCKETS: usize = count_edges();

const fn boot_edges() -> [u32; BOOT_BUCKETS] {
    let mut edges = [0u32; BOOT_BUCKETS];
    let mut prev = 0;
    let mut i = 0;
    while i < BOOT_BUCKETS {
        prev = edge_after(prev);
        edges[i] = prev;
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

/// The nearest-rank `pct` percentile of a histogram, as its bucket upper
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

/// Whether a resume outage is inside the seam threshold.
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

/// Validates an untrusted client measure against the connection flags;
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

/// One `metric_tally` row identity, with its own key space (never a series
/// code). `key` is the table primary key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tally {
    ConcurrentPeak,
    ResumeWithinSeam,
    ResumeTotal,
    PackingForced,
    PackingTotal,
    BootBucket(u8),
}

impl Tally {
    /// The tallies that are not boot buckets.
    pub const FIXED: [Tally; 5] = [
        Tally::ConcurrentPeak,
        Tally::ResumeWithinSeam,
        Tally::ResumeTotal,
        Tally::PackingForced,
        Tally::PackingTotal,
    ];

    pub const fn key(self) -> u64 {
        match self {
            Tally::ConcurrentPeak => 1,
            Tally::ResumeWithinSeam => 2,
            Tally::ResumeTotal => 3,
            Tally::PackingForced => 4,
            Tally::PackingTotal => 5,
            Tally::BootBucket(b) => 0x100 + b as u64,
        }
    }

    /// Every tally row that can exist.
    pub fn all() -> impl Iterator<Item = Tally> {
        Tally::FIXED
            .into_iter()
            .chain((0..BOOT_BUCKETS).map(|b| Tally::BootBucket(b as u8)))
    }
}

/// `metric_tally` row count: derived from the tallies above.
pub const TALLY_ROWS: u64 = (Tally::FIXED.len() + BOOT_BUCKETS) as u64;

/// One sampling period accumulators, as a pure value. `server` loads it
/// from `metric_tally`, applies an event, and stores it back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Period {
    pub peak: u64,
    pub boot: [u64; BOOT_BUCKETS],
    pub within: u64,
    pub total: u64,
    /// Store attempts that were refused or needed a rotation.
    pub packing_forced: u64,
    /// All store attempts.
    pub packing_total: u64,
}

impl Period {
    /// A period that starts with `live` connections open.
    pub fn new(live: u64) -> Period {
        Period {
            peak: live,
            boot: [0; BOOT_BUCKETS],
            within: 0,
            total: 0,
            packing_forced: 0,
            packing_total: 0,
        }
    }

    /// A connection opened; `live` is the count including it.
    pub fn on_connect(&mut self, live: u64) {
        self.peak = peak_after(self.peak, live);
    }

    /// An accepted client measure.
    pub fn on_measure(&mut self, measure: Measure) {
        match measure {
            Measure::Boot { millis } => {
                let b = boot_bucket(millis);
                self.boot[b] = self.boot[b].saturating_add(1);
            }
            Measure::Resumed { outage_millis } => {
                if resumed_within_seam(outage_millis) {
                    self.within = self.within.saturating_add(1);
                }
                self.total = self.total.saturating_add(1);
            }
        }
    }

    /// One store attempt into a container's grid; `forced` is
    /// `container_grid::packing_forced`'s verdict.
    pub fn on_store(&mut self, forced: bool) {
        if forced {
            self.packing_forced = self.packing_forced.saturating_add(1);
        }
        self.packing_total = self.packing_total.saturating_add(1);
    }

    /// One series `(value, sample_size)`. The exhaustive `match` is the
    /// compile-time guarantee that a registered series has an emitter. A
    /// boot series with no report reads `(0, 0)`.
    pub fn figure(&self, series: Series, live: u64) -> (u64, u64) {
        let reports = self.boot.iter().fold(0u64, |a, c| a.saturating_add(*c));
        let boot = |pct| {
            let edge = percentile_edge_ms(&self.boot, pct).unwrap_or(0);
            (u64::from(edge), reports)
        };
        match series {
            Series::BootMillisP50 => boot(50),
            Series::BootMillisP95 => boot(95),
            Series::ConcurrentNow => (live, 1),
            Series::ConcurrentPeak => (peak_after(self.peak, live), 1),
            Series::ReconnectWithinSeam => (self.within, self.total),
            Series::PackingForced => (self.packing_forced, self.packing_total),
        }
    }

    /// One fire: every live series once, and the next period (peak
    /// re-seeded to `live`, every other slot zero).
    pub fn fire(&self, live: u64) -> (Vec<(Series, u64, u64)>, Period) {
        let rows = Series::ALL
            .iter()
            .map(|&s| {
                let (value, size) = self.figure(s, live);
                (s, value, size)
            })
            .collect();
        (rows, Period::new(live))
    }

    /// Every tally row value, zero where nothing accumulated.
    pub fn tallies(&self) -> Vec<(Tally, u64)> {
        let mut out = vec![
            (Tally::ConcurrentPeak, self.peak),
            (Tally::ResumeWithinSeam, self.within),
            (Tally::ResumeTotal, self.total),
            (Tally::PackingForced, self.packing_forced),
            (Tally::PackingTotal, self.packing_total),
        ];
        for (b, n) in self.boot.iter().enumerate() {
            out.push((Tally::BootBucket(b as u8), *n));
        }
        out
    }

    /// The period held by `rows`; a missing row reads as zero.
    pub fn from_tallies(rows: impl IntoIterator<Item = (Tally, u64)>) -> Period {
        let mut p = Period::new(0);
        for (tally, v) in rows {
            match tally {
                Tally::ConcurrentPeak => p.peak = v,
                Tally::ResumeWithinSeam => p.within = v,
                Tally::ResumeTotal => p.total = v,
                Tally::PackingForced => p.packing_forced = v,
                Tally::PackingTotal => p.packing_total = v,
                Tally::BootBucket(b) => {
                    if let Some(slot) = p.boot.get_mut(b as usize) {
                        *slot = v;
                    }
                }
            }
        }
        p
    }
}

/// `gameplay_metric_sample` ceiling: live series x fires per day x
/// retention.
pub const fn sample_rows_for_days(days: u64) -> u64 {
    LIVE_SERIES_COUNT * SAMPLES_PER_DAY * days
}
