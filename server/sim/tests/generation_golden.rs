//! The determinism harness for story 3.2 (FR110 passes 1-2), Quentin's
//! direction -- same idiom as `determinism_golden.rs`/`appearance_golden.
//! rs`: regenerates both passes for a fixed seed set and compares a
//! readable summary plus a digest against the committed
//! `tests/goldens/generation_v1.golden`, so a diff names what moved
//! rather than just "hash differs". Keyed by `sim::generation::
//! GENERATION_VERSION`; `check-golden-version-bump.sh` fails a PR that
//! touches the golden without bumping that constant.
//!
//! Pinned against a small, fixed, test-local [`frozen_config`] -- never
//! the live `defs::BALANCE` -- because a designer retuning `defs/balance/
//! generation.toml` (a data change, already covered by `defs_version`)
//! must never also force a `GENERATION_VERSION` bump (an algorithm/
//! seeding change) just because this golden ran against the live values
//! (Tim's direction, cycle 1). The evidence SVGs (`bounds::generation_
//! evidence`) keep using live balance -- that is their own job, showing
//! what actually ships.
//!
//! Also checks: the same seed twice in one process is byte-identical, and
//! running pass 2 twice over one pass-1 output is byte-identical (pass 2
//! never mutates its own input).

use sim::generation::{GENERATION_VERSION, GenerationConfig, LandUse, land_use, streets};

const SEEDS: [u64; 5] = [1, 2, 3, 42, 123_456_789];

const GOLDEN: &str = include_str!("goldens/generation_v1.golden");

/// A frozen snapshot of `defs/balance/generation.toml`'s own values at
/// the time this golden was last regenerated -- never read from `defs::
/// BALANCE`. If `generation.toml` and this snapshot drift, that is
/// expected and fine (that is exactly the point): only a change to
/// `sim::generation`'s own algorithm or seeding is supposed to move this
/// golden.
fn frozen_config() -> GenerationConfig {
    GenerationConfig {
        site_extent_cells: 512,
        coarse_cell_size_cells: 16,
        land_use_min_leaf_cells: 4,
        land_use_max_leaf_cells: 10,
        land_use_split_jitter_pct: 30,
        land_use_max_recursion_depth: 8,
        density_min: 10,
        density_max: 100,
        density_peak_offset_min_pct: 15,
        density_peak_offset_max_pct: 40,
        share_residential_pct: 58,
        share_commercial_pct: 18,
        share_industrial_pct: 14,
        share_institutional_pct: 10,
        arterial_count_ns: 3,
        arterial_count_ew: 2,
        arterial_width_cells: 12,
        street_width_cells: 8,
        lane_width_cells: 4,
        arterial_jitter_pct: 20,
        boundary_snap_tolerance_cells: 24,
        block_size_min_cells: 24,
        block_size_max_cells: 96,
        min_block_depth_cells: 16,
        max_block_depth_cells: 40,
        split_jitter_pct: 25,
        max_recursion_depth: 12,
        max_lane_splits: 4,
        max_street_splits_per_superblock: 1,
        junction_min_separation_cells: 28,
        max_detour_percent: 350,
        detour_min_manhattan_cells: 64,
        min_distinct_block_sizes: 3,
    }
}

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
    let lu =
        land_use::run(seed, cfg.site(), cfg).expect("frozen_config's own site is always valid");
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

    // Real ring averages (innermost, mid, outermost of 3), from the
    // field's own density peak -- not a fixed "centre"/"corner" sample,
    // which the falloff's own real shape has no reason to agree with
    // once the peak is off-centre (Quentin's direction, cycle 1).
    let rings = lu.ring_averages(3);

    format!(
        "seed={seed} regions=res:{},com:{},ind:{},inst:{} nodes={node_count} edges={} blocks={} dead_ends={dead_ends} max_detour_pct={max_detour_pct} density_rings={rings:?} digest={:016x}",
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

    let cfg = frozen_config();
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
             the golden. If it is only defs/balance/generation.toml being retuned, update \
             frozen_config() in this file to match instead -- the golden pins the algorithm, \
             never the data (Tim's direction, cycle 1)."
        );
    }
}

#[test]
fn the_same_seed_twice_in_one_process_is_byte_identical() {
    let cfg = frozen_config();
    for seed in SEEDS {
        let a = summary_line(seed, &cfg);
        let b = summary_line(seed, &cfg);
        assert_eq!(a, b);
    }
}

#[test]
fn running_pass_2_twice_over_one_pass_1_output_is_byte_identical() {
    let cfg = frozen_config();
    let lu = land_use::run(SEEDS[0], cfg.site(), &cfg).unwrap();
    let net_a = streets::run(SEEDS[0], &lu, &cfg);
    let net_b = streets::run(SEEDS[0], &lu, &cfg);
    assert_eq!(plan_digest(&lu, &net_a), plan_digest(&lu, &net_b));
}
