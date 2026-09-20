//! The determinism harness for stories 3.2-3.4 (FR110 passes 1-5): same
//! idiom as `determinism_golden.rs`/`appearance_golden.rs`. Regenerates
//! all five passes for a fixed seed set and compares a readable summary
//! plus a digest against the committed `tests/goldens/generation_v6.
//! golden`, so a diff names what moved rather than just "hash differs".
//! Keyed by `sim::generation::GENERATION_VERSION`; `check-golden-version-
//! bump.sh` fails a PR that touches the golden without bumping that
//! constant. Built on `generation::plan` (no count verdict), with the
//! verdict itself reported as one `count_ok` field, so the summary line
//! still names every pass's own stats for an outlier seed.
//!
//! Pinned against a small, fixed, test-local [`frozen_config`] -- never
//! the live `defs::BALANCE` -- because a designer retuning `defs/balance/
//! generation.toml` (a data change, already covered by `defs_version`)
//! must never also force a `GENERATION_VERSION` bump (an algorithm/
//! seeding change) just because this golden ran against the live values.
//! The evidence SVGs (`bounds::generation_evidence`) keep using live
//! balance -- that is their own job, showing what actually ships.
//!
//! Story 3.4 extends the same discipline to content: [`frozen_content`]
//! freezes a tiny building-type table under deliberately unrelated
//! ids/keys (never `defs::BUILDING_TYPES`') and an empty rule set --
//! retuning `defs/building-types/*.toml` or `defs/rules/generation.toml`
//! (also covered by `defs_version`) must never force a version bump
//! either, and the generator producing the same shape of output against
//! a wholly different content table is itself proof it never branches on
//! a content key (Tim's direction).
//!
//! Also checks: the same seed twice in one process is byte-identical, and
//! running pass 2 twice over one pass-1 output is byte-identical (pass 2
//! never mutates its own input).

use sim::generated::defs::BuildingTypeDef;
use sim::generation::streets::DETOUR_SAMPLE_MAX_NODES;
use sim::generation::{
    GENERATION_VERSION, GenerationConfig, GenerationContent, LandUse, envelopes, land_use, plan,
    plots, streets,
};
use sim::rules::{CoherenceMode, RuleDef, RuleKind, RuleSet};

const SEEDS: [u64; 5] = [1, 2, 3, 42, 123_456_789];

const GOLDEN: &str = include_str!("goldens/generation_v6.golden");

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
        arterial_count_ns_min: 2,
        arterial_count_ns_max: 3,
        arterial_count_ew_min: 1,
        arterial_count_ew_max: 2,
        arterial_width_cells: 12,
        street_width_cells: 8,
        lane_width_cells: 4,
        arterial_jitter_pct: 60,
        block_size_min_cells: 40,
        block_size_max_cells: 96,
        min_block_depth_cells: 16,
        max_block_depth_min_cells: 40,
        max_block_depth_max_cells: 80,
        split_jitter_pct: 25,
        max_recursion_depth: 12,
        max_lane_splits: 4,
        max_street_splits_per_superblock: 1,
        junction_min_separation_cells: 28,
        detour_long_pair_cells: 128,
        max_detour_percent: 200,
        max_detour_excess_cells: 80,
        p99_detour_percent: 160,
        min_distinct_block_sizes: 3,
        peripheral_low_band_floor_percent: 70,
        peripheral_pooled_min_ratio_percent: 150,
        institutional_min_pockets: 3,
        institutional_max_pocket_share_percent: 6,
        plot_frontage_min_cells: 3,
        plot_high_density_threshold: 55,
        plot_setback_periphery_cells: 2,
        plot_width_min_cells: [8, 10, 12, 12],
        plot_width_max_cells: [12, 16, 20, 20],
        plot_row_depth_cells: [14, 12, 18, 18],
        plot_max_core_depth_cells: 8,
        plot_max_core_depth_periphery_cells: 32,
        plot_open_min_side_cells: 8,
        plot_max_open_percent_by_count: 15,
        plot_max_open_percent_by_area: 15,
        plot_max_unplotted_percent: 20,
        envelope_wall_thickness_cells: 1,
        envelope_min_interior_width_cells: [4, 6, 8, 8],
        envelope_min_interior_depth_cells: [4, 6, 8, 8],
        envelope_max_width_cells: 20,
        envelope_max_depth_cells: 16,
        envelope_side_gap_periphery_cells: 2,
        envelope_size_trim_max_cells: 2,
        envelope_mean_width_cells: 12,
        envelope_mean_width_tolerance_cells: 3,
        envelope_mean_depth_cells: 11,
        envelope_mean_depth_tolerance_cells: 3,
        envelope_min_distinct_sizes: 6,
        envelope_target_count_per_million_cells: 3418,
        envelope_count_tolerance_percent: 21,
        envelope_mean_count_tolerance_percent: 3,
        envelope_max_rejected_plot_percent: 5,
        workplace_target_count_per_million_cells: 1312,
        workplace_count_tolerance_percent: 30,
        workplace_mean_count_tolerance_percent: 5,
        building_type_catchment_extent_cells: 256,
    }
}

/// Deliberately unrelated ids/keys and shape from the real committed
/// `defs/building-types/*.toml` (Tim's direction) -- covering `frozen_
/// config`'s own full density range. Never `defs::BUILDING_TYPES`.
/// Two residential rows (`frozen_res`/`frozen_res_b`, distinct form
/// tags) so the frozen coherence row below has real subject material,
/// and a weight-0 institutional row (`frozen_inst_subject`) so the
/// frozen distribution row's own override half is exercised too -- an
/// empty rule set (as this golden shipped at first, PR #317 cycle 1)
/// left the override half of the pass, and the content-key proof, both
/// unexercised (Tim's direction).
const FROZEN_BUILDING_TYPES: &[BuildingTypeDef] = &[
    BuildingTypeDef {
        id: 9001,
        key: "frozen_res",
        tags: &[9101, 9105],
        land_uses: [true, false, false, false],
        density_min: 0,
        density_max: 100,
        min_interior_width_cells: 4,
        min_interior_depth_cells: 4,
        weight: 1,
        requires_site: [false, false, false, false],
        prefers_site: [false, false, false, false],
        density_affinity: 0,
        professions: &[],
    },
    BuildingTypeDef {
        id: 9005,
        key: "frozen_res_b",
        tags: &[9101, 9106],
        land_uses: [true, false, false, false],
        density_min: 0,
        density_max: 100,
        min_interior_width_cells: 4,
        min_interior_depth_cells: 4,
        weight: 1,
        requires_site: [false, false, false, false],
        prefers_site: [false, false, false, false],
        density_affinity: 0,
        professions: &[],
    },
    BuildingTypeDef {
        id: 9002,
        key: "frozen_com",
        tags: &[9102],
        land_uses: [false, true, false, false],
        density_min: 0,
        density_max: 100,
        min_interior_width_cells: 6,
        min_interior_depth_cells: 6,
        weight: 1,
        requires_site: [false, false, false, false],
        prefers_site: [false, false, false, false],
        density_affinity: 0,
        professions: &["frozen_clerk"],
    },
    BuildingTypeDef {
        id: 9003,
        key: "frozen_ind",
        tags: &[9103],
        land_uses: [false, false, true, false],
        density_min: 0,
        density_max: 100,
        min_interior_width_cells: 8,
        min_interior_depth_cells: 8,
        weight: 1,
        requires_site: [false, false, false, false],
        prefers_site: [false, false, false, false],
        density_affinity: 0,
        professions: &[],
    },
    BuildingTypeDef {
        id: 9004,
        key: "frozen_inst",
        tags: &[9104],
        land_uses: [false, false, false, true],
        density_min: 0,
        density_max: 100,
        min_interior_width_cells: 8,
        min_interior_depth_cells: 8,
        weight: 1,
        requires_site: [false, false, false, false],
        prefers_site: [false, false, false, false],
        density_affinity: 0,
        professions: &[],
    },
    BuildingTypeDef {
        id: 9006,
        key: "frozen_inst_subject",
        tags: &[9107],
        land_uses: [false, false, false, true],
        density_min: 0,
        density_max: 100,
        min_interior_width_cells: 8,
        min_interior_depth_cells: 8,
        weight: 0,
        requires_site: [false, false, false, false],
        prefers_site: [false, false, false, false],
        density_affinity: 0,
        professions: &[],
    },
];

const FROZEN_RULES: &[RuleDef] = &[
    RuleDef {
        id: 9201,
        key: "frozen_coherence",
        kind: RuleKind::Coherence {
            subject: 9106,
            within: 9105,
            mode: CoherenceMode::Forbid,
        },
    },
    RuleDef {
        id: 9202,
        key: "frozen_distribution",
        kind: RuleKind::Distribution {
            subject: 9107,
            per: 9101,
            ratio: 50,
            tolerance_percent: 20,
            min_spacing: 10,
            max_distance: 2000,
        },
    },
];

fn frozen_content() -> GenerationContent<'static> {
    GenerationContent {
        rules: RuleSet::for_test(FROZEN_RULES),
        building_types: FROZEN_BUILDING_TYPES,
    }
}

/// A small, hand-rolled FNV-1a (test-only -- `sim` itself never depends
/// on a hashing crate, NFR28) over the whole plan's own canonical text:
/// every land-use cell's use and density, every block's bounds, every
/// edge's axis/coord/range/class, every plot's own bounds/front/use/
/// density/open, and every envelope outcome, in the deterministic order
/// each already returns them.
fn fnv1a(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in text.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn plan_digest(
    lu: &land_use::LandUseMap,
    net: &streets::StreetNetwork,
    pm: &plots::PlotMap,
    em: &envelopes::EnvelopeMap,
    bt: &sim::generation::BuildingTypeMap,
) -> u64 {
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
    for p in pm.plots() {
        text.push_str(&format!(
            "plot {},{},{},{} block={} front={:?} use={:?} density={} open={}\n",
            p.bounds.x0,
            p.bounds.y0,
            p.bounds.x1,
            p.bounds.y1,
            p.block,
            p.front,
            p.land_use,
            p.density,
            p.open
        ));
    }
    for o in em.outcomes() {
        match o {
            envelopes::EnvelopeOutcome::Placed(e) => text.push_str(&format!(
                "envelope placed plot={} {},{},{},{} front={:?}\n",
                e.plot, e.footprint.x0, e.footprint.y0, e.footprint.x1, e.footprint.y1, e.front
            )),
            envelopes::EnvelopeOutcome::Rejected {
                plot,
                class,
                reason,
            } => {
                text.push_str(&format!(
                    "envelope rejected plot={plot} class={class:?} reason={reason:?}\n"
                ));
            }
        }
    }
    let mut assignments: Vec<_> = bt.assignments().to_vec();
    assignments.sort();
    for a in &assignments {
        text.push_str(&format!(
            "type plot={} building_type={}\n",
            a.plot, a.building_type
        ));
    }
    fnv1a(&text)
}

fn summary_line(seed: u64, cfg: &GenerationConfig) -> String {
    let content = frozen_content();
    let d = plan(seed, cfg, &content).expect("frozen_config's own site is always valid");
    let (lu, net, pm, em, bt) = (
        &d.land_use,
        &d.streets,
        &d.plots,
        &d.envelopes,
        &d.building_types,
    );
    let count_verdict = d.check_building_count(cfg).is_ok();

    let regions = lu.regions();
    let count = |u: LandUse| regions.iter().filter(|r| r.use_ == u).count();

    let dead_ends = net.dead_end_nodes().len();
    let node_count = net.nodes().len();
    let samples = net.detour_samples(DETOUR_SAMPLE_MAX_NODES);
    let max_detour_pct = samples.iter().map(|s| s.ratio_pct()).max().unwrap_or(0);
    let p99_samples = net.detour_samples(streets::DETOUR_P99_SAMPLE_MAX_NODES);
    let p99_detour_pct = streets::p99_ratio_pct(&p99_samples);

    // Real ring averages (innermost, mid, outermost of 3), from the
    // field's own density peak -- not a fixed "centre"/"corner" sample,
    // which the falloff's own real shape has no reason to agree with
    // once the peak is off-centre.
    let rings = lu.ring_averages(3);

    let open_plots = pm.plots().iter().filter(|p| p.open).count();
    let (placed, rejected) = (em.placed_count(), em.rejected_count());
    let types_placed = bt.assignments().len();
    let distinct_types = bt.distinct_types().len();

    format!(
        "seed={seed} regions=res:{},com:{},ind:{},inst:{} nodes={node_count} edges={} blocks={} dead_ends={dead_ends} max_detour_pct={max_detour_pct} p99_detour_pct={p99_detour_pct} density_rings={rings:?} plots={} open_plots={open_plots} envelopes_placed={placed} envelopes_rejected={rejected} types_placed={types_placed} distinct_types={distinct_types} count_ok={count_verdict} digest={:016x}",
        count(LandUse::Residential),
        count(LandUse::Commercial),
        count(LandUse::Industrial),
        count(LandUse::Institutional),
        net.edges().len(),
        net.blocks().len(),
        pm.plots().len(),
        plan_digest(lu, net, pm, em, bt),
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
        "tests/goldens/generation_v6.golden is keyed to version {golden_version} but \
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
            "generation output moved for seed {seed}. frozen_config() never reads live \
             defs::BALANCE, so a defs/balance/generation.toml retune alone cannot move this \
             golden at all -- this diff can only be sim::generation's own algorithm or seeding \
             changing. Bump GENERATION_VERSION and regenerate the golden."
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
    let content = frozen_content();
    let lu = land_use::run(SEEDS[0], cfg.site(), &cfg).unwrap();
    let net_a = streets::run(SEEDS[0], &lu, &cfg);
    let net_b = streets::run(SEEDS[0], &lu, &cfg);
    let pm_a = plots::run(SEEDS[0], &lu, &net_a, &cfg); // generation-entry-point: allow
    let pm_b = plots::run(SEEDS[0], &lu, &net_b, &cfg); // generation-entry-point: allow
    let em_a = envelopes::run(SEEDS[0], &pm_a, &cfg); // generation-entry-point: allow
    let em_b = envelopes::run(SEEDS[0], &pm_b, &cfg); // generation-entry-point: allow
    let bt_a = sim::generation::building_types::run(SEEDS[0], &em_a, &pm_a, &net_a, &cfg, &content); // generation-entry-point: allow
    let bt_b = sim::generation::building_types::run(SEEDS[0], &em_b, &pm_b, &net_b, &cfg, &content); // generation-entry-point: allow
    assert_eq!(
        plan_digest(&lu, &net_a, &pm_a, &em_a, &bt_a),
        plan_digest(&lu, &net_b, &pm_b, &em_b, &bt_b)
    );
}
