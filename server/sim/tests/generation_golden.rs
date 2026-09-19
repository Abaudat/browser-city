//! The determinism harness for story 3.2 (FR110 passes 1-2), Quentin's
//! direction -- same idiom as `determinism_golden.rs`/`appearance_golden.
//! rs`: regenerates both passes for a fixed seed set and compares a
//! readable summary plus a digest against the committed
//! `tests/goldens/generation_v1.golden`, so a diff names what moved
//! rather than just "hash differs". Keyed by `sim::generation::
//! GENERATION_VERSION`; `check-golden-version-bump.sh` fails a PR that
//! touches the golden without bumping that constant.
//!
//! Also checks: the same seed twice in one process is byte-identical, and
//! running pass 2 twice over one pass-1 output is byte-identical (pass 2
//! never mutates its own input).

use sim::generated::defs;
use sim::generation::{GENERATION_VERSION, GenerationConfig, LandUse, land_use, streets};

const SEEDS: [u64; 5] = [1, 2, 3, 42, 123_456_789];

const GOLDEN: &str = include_str!("goldens/generation_v1.golden");

/// A small, hand-rolled FNV-1a (test-only -- `sim` itself never depends
/// on a hashing crate, NFR28) over the whole plan's own canonical text:
/// every land-use cell's use and density, every block's bounds, every
/// edge's axis/coord/range/class, in the deterministic order each
/// already returns them.
fn fnv1a(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in text.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn plan_digest(lu: &land_use::LandUseMap, net: &streets::StreetNetwork) -> u64 {
    let mut text = String::new();
    for cy in 0..lu.rows() {
        for cx in 0..lu.cols() {
            let c = lu.coarse_at(cx, cy).unwrap();
            text.push_str(&format!("{cx},{cy},{:?},{}\n", c.use_, c.density));
        }
    }
    for b in net.blocks() {
        text.push_str(&format!(
            "block {},{},{},{}\n",
            b.bounds.x0, b.bounds.y0, b.bounds.x1, b.bounds.y1
        ));
    }
    for e in net.edges() {
        text.push_str(&format!(
            "edge {:?} {} {} {} {:?} {}\n",
            e.axis, e.coord, e.from, e.to, e.class, e.width_cells
        ));
    }
    fnv1a(&text)
}

fn summary_line(seed: u64, cfg: &GenerationConfig) -> String {
    let lu = land_use::run(seed, cfg.site(), cfg);
    let net = streets::run(seed, &lu, cfg);

    let regions = lu.regions();
    let count = |u: LandUse| regions.iter().filter(|r| r.use_ == u).count();

    let dead_ends = net.dead_end_nodes().len();
    let node_count = net.nodes().len();
    let samples = net.detour_samples(14, cfg.detour_min_manhattan_cells as i64);
    let max_detour_pct = samples
        .iter()
        .map(|s| s.network * 100 / s.manhattan)
        .max()
        .unwrap_or(0);

    // Ring densities: centre, mid-radius, outer ring -- three coarse
    // cells along the diagonal from centre to corner.
    let cx = lu.cols() / 2;
    let cy = lu.rows() / 2;
    let centre_density = lu.coarse_at(cx, cy).unwrap().density;
    let mid_density = lu
        .coarse_at(cx / 2 + cx / 2, cy / 2 + cy / 2 / 2)
        .unwrap_or(lu.coarse_at(0, 0).unwrap())
        .density;
    let corner_density = lu.coarse_at(0, 0).unwrap().density;

    format!(
        "seed={seed} regions=res:{},com:{},ind:{},inst:{} nodes={node_count} edges={} blocks={} dead_ends={dead_ends} max_detour_pct={max_detour_pct} density=centre:{centre_density},mid:{mid_density},corner:{corner_density} digest={:016x}",
        count(LandUse::Residential),
        count(LandUse::Commercial),
        count(LandUse::Industrial),
        count(LandUse::Institutional),
        net.edges().len(),
        net.blocks().len(),
        plan_digest(&lu, &net),
    )
}

#[test]
fn generation_output_matches_committed_golden() {
    let mut lines = GOLDEN.lines();
    let version_line = lines.next().expect("golden file is empty");
    let golden_version: u32 = version_line
        .strip_prefix("version=")
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(|| {
            panic!("golden's first line must be 'version=<n>', got {version_line:?}")
        });
    assert_eq!(
        golden_version, GENERATION_VERSION,
        "tests/goldens/generation_v1.golden is keyed to version {golden_version} but \
         sim::generation::GENERATION_VERSION is {GENERATION_VERSION} -- regenerate the golden \
         whenever GENERATION_VERSION changes"
    );

    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let golden_lines: Vec<&str> = lines.collect();
    assert_eq!(
        golden_lines.len(),
        SEEDS.len(),
        "golden has {} rows but this test derives from {} seeds -- regenerate the golden",
        golden_lines.len(),
        SEEDS.len()
    );

    for (seed, golden_line) in SEEDS.into_iter().zip(golden_lines) {
        let actual = summary_line(seed, &cfg);
        assert_eq!(
            actual, golden_line,
            "generation output moved for seed {seed} -- if this is a deliberate change to \
             sim::generation's own algorithm or seeding, bump GENERATION_VERSION and regenerate \
             the golden"
        );
    }
}

#[test]
fn the_same_seed_twice_in_one_process_is_byte_identical() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    for seed in SEEDS {
        let a = summary_line(seed, &cfg);
        let b = summary_line(seed, &cfg);
        assert_eq!(a, b);
    }
}

#[test]
fn running_pass_2_twice_over_one_pass_1_output_is_byte_identical() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let lu = land_use::run(SEEDS[0], cfg.site(), &cfg);
    let net_a = streets::run(SEEDS[0], &lu, &cfg);
    let net_b = streets::run(SEEDS[0], &lu, &cfg);
    assert_eq!(plan_digest(&lu, &net_a), plan_digest(&lu, &net_b));
}
