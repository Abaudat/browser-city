//! The determinism harness (NFR25, NFR29's "identical seeds derive
//! identically" invariant, and Story 0.16's "determinism must survive
//! dependency bumps" criterion). Regenerates the RNG's output from a fixed
//! set of ids, and compares it field-by-field against the committed golden
//! in `tests/goldens/rng_v1.golden` -- a `Cargo.lock` bump that moves the
//! output stream fails this on the very next `cargo test`, with the id and
//! the first diverging value named, not just "hashes differ".
//!
//! The golden is keyed by `sim::rng::RNG_VERSION`; `check-golden-version-bump.sh`
//! fails a PR that touches the golden without bumping that constant.

use sim::rng::{RNG_VERSION, Rng, seed_from_ids};

const IDS: [u64; 4] = [0, 1, 42, 0xDEADBEEFCAFEu64];
const STREAM_LEN: usize = 8;

const GOLDEN: &str = include_str!("goldens/rng_v1.golden");

struct GoldenRow {
    id: u64,
    seed: u64,
    stream: Vec<u64>,
}

fn parse_golden(text: &str) -> (u32, Vec<GoldenRow>) {
    let mut lines = text.lines();
    let version_line = lines.next().expect("golden file is empty");
    let version: u32 = version_line
        .strip_prefix("version=")
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(|| {
            panic!("golden file's first line must be 'version=<n>', got {version_line:?}")
        });

    let rows = lines
        .map(|line| {
            let mut parts = line.split(' ');
            let id: u64 = parts
                .next()
                .and_then(|p| p.strip_prefix("id="))
                .and_then(|v| v.parse().ok())
                .unwrap_or_else(|| panic!("malformed golden row: {line:?}"));
            let seed: u64 = parts
                .next()
                .and_then(|p| p.strip_prefix("seed="))
                .and_then(|v| v.parse().ok())
                .unwrap_or_else(|| panic!("malformed golden row: {line:?}"));
            let stream: Vec<u64> = parts
                .next()
                .and_then(|p| p.strip_prefix("stream="))
                .unwrap_or_else(|| panic!("malformed golden row: {line:?}"))
                .split(',')
                .map(|v| {
                    v.parse()
                        .unwrap_or_else(|_| panic!("malformed stream value in: {line:?}"))
                })
                .collect();
            GoldenRow { id, seed, stream }
        })
        .collect();

    (version, rows)
}

#[test]
fn rng_output_matches_committed_golden() {
    let (golden_version, golden_rows) = parse_golden(GOLDEN);

    assert_eq!(
        golden_version, RNG_VERSION,
        "tests/goldens/rng_v1.golden is keyed to version {golden_version} but sim::rng::RNG_VERSION is {RNG_VERSION} -- \
         regenerate the golden (and rename it) whenever RNG_VERSION changes"
    );

    assert_eq!(
        golden_rows.len(),
        IDS.len(),
        "golden has {} rows but this test now derives from {} ids -- regenerate the golden",
        golden_rows.len(),
        IDS.len()
    );

    for (id, row) in IDS.into_iter().zip(golden_rows.iter()) {
        assert_eq!(id, row.id, "golden row order does not match IDS");

        let seed = seed_from_ids(id, id.wrapping_mul(7).wrapping_add(1));
        assert_eq!(
            seed, row.seed,
            "seed diverged for id {id}: golden has {}, regeneration produced {seed}",
            row.seed
        );

        let mut rng = Rng::new(seed);
        for (i, expected) in row.stream.iter().enumerate() {
            let actual = rng.next_u64();
            assert_eq!(
                actual, *expected,
                "generation output moved: id {id}, output index {i}: golden has {expected}, regeneration produced {actual}"
            );
        }
    }

    assert_eq!(
        STREAM_LEN,
        golden_rows[0].stream.len(),
        "STREAM_LEN must match the golden's row length"
    );
}
