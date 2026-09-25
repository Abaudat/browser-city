//! `fixtures/city-clock-conformance.v1.json`: hand-typed `(epoch, now) ->
//! city time` rows that `sim::time` (`bounds/tests/city_clock_fixture_current.rs`) and
//! the client's `time/city-time.ts` are both checked against (NFR30). The
//! expected values are typed by hand from the FR1 constants, never computed
//! by the functions under test. Instants are microseconds since the Unix
//! epoch, carried as decimal strings so no JSON reader rounds them.

use std::path::PathBuf;

use serde::Serialize;

use crate::world_fixture::repo_root_dir;

#[derive(Debug, Serialize)]
pub struct ClockCase {
    pub epoch_micros: String,
    pub now_micros: String,
    pub day: i64,
    pub hour: u8,
    pub minute: u8,
    pub weekday: u8,
    pub real_ms_into_minute: u16,
}

#[derive(Debug, Serialize)]
pub struct ClockFixture {
    pub real_ms_per_city_minute: i64,
    pub cases: Vec<ClockCase>,
}

impl ClockFixture {
    pub fn to_pretty_json(&self) -> String {
        let mut json = serde_json::to_string_pretty(self).expect("ClockFixture always serializes");
        json.push('\n');
        json
    }
}

/// An epoch that is not aligned to any second, minute or day boundary.
const ODD_EPOCH: i64 = 1_700_000_000_123_456;

/// `(epoch, extra_micros_on_top_of_whole_ms, elapsed_ms, expected)` where
/// expected is `(day, hour, minute, weekday, real_ms_into_minute)`.
type Row = (i64, i64, i64, (i64, u8, u8, u8, u16));

#[rustfmt::skip]
const ROWS: &[Row] = &[
    (0, 0, 0,                      (0, 0, 0, 0, 0)),
    (0, 0, 2_499,                  (0, 0, 0, 0, 2499)),          // k - 1
    (0, 0, 2_500,                  (0, 0, 1, 0, 0)),             // k
    (0, 0, 150_000,                (0, 1, 0, 0, 0)),             // one city hour
    (0, 0, 3_599_999,              (0, 23, 59, 0, 2499)),        // one day - 1 ms
    (0, 0, 3_600_000,              (1, 0, 0, 1, 0)),             // day rollover
    (0, 0, 25_200_000,             (7, 0, 0, 0, 0)),             // weekday wraps
    (0, 0, 2_147_483_648,          (596, 12, 33, 1, 1148)),      // 2^31 ms
    (0, 0, 4_294_967_296,          (1193, 1, 6, 3, 2296)),       // 2^32 ms
    (0, 0, 1_099_511_627_776,      (305_419, 21, 31, 2, 276)),   // 2^40 ms
    (0, 0, -1,                     (-1, 23, 59, 6, 2499)),       // pre-epoch
    (0, 0, -2_500,                 (-1, 23, 59, 6, 0)),
    (0, 0, -3_600_000,             (-1, 0, 0, 6, 0)),
    (0, 0, -3_600_001,             (-2, 23, 59, 5, 2499)),
    (ODD_EPOCH, 999, 150_000,      (0, 1, 0, 0, 0)),             // sub-ms floors
    (ODD_EPOCH, 0, 3_600_000 * 3 + 2_500 * 61 + 7, (3, 1, 1, 3, 7)),
];

pub fn build_fixture_document() -> ClockFixture {
    let cases = ROWS
        .iter()
        .map(
            |&(epoch, extra, elapsed_ms, (day, hour, minute, weekday, into))| ClockCase {
                epoch_micros: epoch.to_string(),
                now_micros: (epoch + elapsed_ms * 1000 + extra).to_string(),
                day,
                hour,
                minute,
                weekday,
                real_ms_into_minute: into,
            },
        )
        .collect();
    ClockFixture {
        real_ms_per_city_minute: sim::time::REAL_MS_PER_CITY_MINUTE,
        cases,
    }
}

pub fn fixture_path() -> PathBuf {
    repo_root_dir()
        .join("fixtures")
        .join("city-clock-conformance.v1.json")
}
