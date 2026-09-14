//! The "a week later" guarantee (FR61): a fixed set of citizen ids must
//! always derive the same five-integer tuple, checked against a committed
//! golden rather than merely against another derivation in the same
//! process (which would prove nothing about next week). Keyed by
//! `sim::appearance::APPEARANCE_VERSION`; `check-golden-version-bump.sh`
//! forces a deliberate bump whenever this golden moves.

use sim::appearance::{APPEARANCE_VERSION, Appearance, generate};
use sim::generated::defs::Family;

const IDS: [u64; 5] = [0, 1, 42, 1_000_000, u64::MAX];

const GOLDEN: &str = include_str!("goldens/appearance_v1.golden");

struct GoldenRow {
    id: u64,
    family: Family,
    tuple: Appearance,
}

fn parse_family(s: &str) -> Family {
    match s {
        "adult" => Family::Adult,
        "kid" => Family::Kid,
        other => panic!("unknown family '{other}' in golden"),
    }
}

fn parse_golden(text: &str) -> (u32, Vec<GoldenRow>) {
    let mut lines = text.lines();
    let version_line = lines.next().expect("golden file is empty");
    let version: u32 = version_line
        .strip_prefix("version=")
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(|| {
            panic!("golden's first line must be 'version=<n>', got {version_line:?}")
        });

    let rows = lines
        .map(|line| {
            let mut parts = line.split(' ');
            let id: u64 = parts
                .next()
                .and_then(|p| p.strip_prefix("id="))
                .and_then(|v| v.parse().ok())
                .unwrap_or_else(|| panic!("malformed golden row: {line:?}"));
            let family = parts
                .next()
                .and_then(|p| p.strip_prefix("family="))
                .map(parse_family)
                .unwrap_or_else(|| panic!("malformed golden row: {line:?}"));
            let tuple_str = parts
                .next()
                .and_then(|p| p.strip_prefix("tuple="))
                .unwrap_or_else(|| panic!("malformed golden row: {line:?}"));
            let nums: Vec<u16> = tuple_str
                .split(',')
                .map(|v| {
                    v.parse()
                        .unwrap_or_else(|_| panic!("bad tuple value in: {line:?}"))
                })
                .collect();
            assert_eq!(nums.len(), 5, "malformed golden row: {line:?}");
            GoldenRow {
                id,
                family,
                tuple: Appearance {
                    body: nums[0],
                    eyes: nums[1],
                    outfit: nums[2],
                    hairstyle: nums[3],
                    accessory: nums[4],
                },
            }
        })
        .collect();

    (version, rows)
}

#[test]
fn appearance_output_matches_committed_golden() {
    let (golden_version, golden_rows) = parse_golden(GOLDEN);

    assert_eq!(
        golden_version, APPEARANCE_VERSION,
        "tests/goldens/appearance_v1.golden is keyed to version {golden_version} but \
         sim::appearance::APPEARANCE_VERSION is {APPEARANCE_VERSION} -- regenerate the golden \
         (and rename it) whenever APPEARANCE_VERSION changes"
    );

    assert_eq!(
        golden_rows.len(),
        IDS.len() * 2,
        "golden has {} rows but this test derives {} (one per id, per family) -- regenerate the golden",
        golden_rows.len(),
        IDS.len() * 2
    );

    let mut row_iter = golden_rows.iter();
    for id in IDS {
        for family in [Family::Adult, Family::Kid] {
            let row = row_iter
                .next()
                .expect("golden has fewer rows than expected");
            assert_eq!(row.id, id, "golden row order does not match IDS x families");
            assert_eq!(
                row.family, family,
                "golden row order does not match IDS x families"
            );

            let actual = generate(id, family);
            assert_eq!(
                actual, row.tuple,
                "appearance output moved for id {id}, family {family:?}: golden has {:?}, regeneration produced {actual:?}",
                row.tuple
            );
        }
    }
}
