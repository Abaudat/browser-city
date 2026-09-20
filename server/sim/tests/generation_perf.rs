//! Generation runs once at world creation (Quentin's direction) -- not a
//! hot path, so this is not a wall-clock benchmark (it would flake on a
//! shared runner). The `world_perf.rs` idiom instead: prove the *shape*
//! of the cost structurally. `subdivide` (both passes) visits each leaf
//! once, bounded by `max_recursion_depth`; the one real quadratic risk is
//! `streets::build_graph`'s pairwise vertical x horizontal crossing scan
//! -- its cost is `O(segments^2)`, so segment count must stay linear in
//! site area, not explode. This test generates once at NFR14's
//! 1024-squared growth target (in release mode; `cargo test --release`)
//! and holds every output collection to an explicit ceiling derived from
//! `GenerationConfig` itself, never a literal -- if segment count ever
//! grew faster than the area, this ceiling (linear in coarse cell count)
//! would be the thing that catches it, not a stopwatch. Story 3.3 extends
//! this to plots and envelopes: their own ceilings are derived from
//! `block area / minimum plot area` plus a small, bounded per-block slack
//! for `open` plots (never more than a handful per block, whatever their
//! own size), still linear, and neither pass carries an `O(n^2)` risk of
//! its own (plots cuts a fixed `FACE_PRIORITY` strip set per block;
//! envelopes sizes one plot at a time).

use sim::generated::defs;
use sim::generation::{GenerationConfig, GenerationContent, LandUse, generate, land_use, streets};

#[test]
fn generation_at_the_1024_growth_target_stays_within_structural_bounds() {
    let mut cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    // NFR14's own growth target -- 1024 is a multiple of coarse_cell_size_
    // cells (16), same divisibility rule `from_balance` enforces for the
    // live 512 value.
    cfg.site_extent_cells = 1024;
    let content = GenerationContent::committed();

    // The one entry point, not a hand-chain (`docs/architecture.md`): at
    // the growth target the count band scales with site area, so a seed
    // that clears it at 512 clears it here too. Includes pass 5's own
    // `rules::evaluate` over the whole finished `DistrictSite` (story
    // 3.4) -- distribution's spacing/coverage checks are the first real
    // pairwise cost the generator pays, bucketed rather than all-pairs
    // (`sim::rules::mod.rs`), so this growth-target run is itself the
    // structural proof that stays linear too.
    let d = generate(7, &cfg, &content)
        .unwrap_or_else(|e| panic!("the 1024 growth target must still generate: {e}"));
    let lu = &d.land_use;
    let net = &d.streets;

    // Tim's direction, cycle 1: the checkers, not just `run` -- every
    // graph query now routes through the adjacency index built once at
    // construction (`StreetNetwork::degree`/`reachable_from`/`dijkstra_
    // from`), so this exercises that it stays cheap at the growth
    // target too, not only that `run` itself does.
    let reachable = net.reachable_from_first_node().unwrap();
    assert_eq!(reachable.len(), net.nodes().len());
    assert!(net.stranded_regions(lu).is_empty());
    assert!(net.dead_end_nodes().is_empty());
    let _ = net.junction_mix();
    let _ = net.detour_samples(streets::DETOUR_SAMPLE_MAX_NODES);

    let coarse_cells = (lu.cols() as u64) * (lu.rows() as u64);

    // Every leaf is at least `min_leaf_cells^2` coarse cells (`land_use::
    // guaranteed_min_region_cells`), so leaf count -- and therefore
    // region count -- cannot exceed total cells over that minimum.
    let max_regions = coarse_cells / land_use::guaranteed_min_region_cells(&cfg).max(1);
    assert!(
        lu.regions().len() as u64 <= max_regions,
        "region count {} exceeds the structural ceiling {max_regions} derived from min_leaf_cells",
        lu.regions().len()
    );

    // Every block is at least min_block_depth_cells^2 world cells --
    // bounds block count the same way, and transitively bounds the
    // segment/node count build_graph's O(segments^2) crossing scan pays
    // for, since segments are produced one per split (one fewer than
    // block count within a superblock, plus the small fixed arterial
    // count).
    let world_cells = (cfg.site_extent_cells as u64) * (cfg.site_extent_cells as u64);
    let max_blocks =
        world_cells / (cfg.min_block_depth_cells as u64 * cfg.min_block_depth_cells as u64).max(1);
    assert!(
        net.blocks().len() as u64 <= max_blocks,
        "block count {} exceeds the structural ceiling {max_blocks} derived from min_block_depth_cells",
        net.blocks().len()
    );
    assert!(
        net.edges().len() as u64 <= max_blocks * 4,
        "edge count {} is not linear in block count {} (over 4x)",
        net.edges().len(),
        net.blocks().len()
    );
    assert!(
        net.nodes().len() as u64 <= max_blocks * 4,
        "node count {} is not linear in block count {} (over 4x)",
        net.nodes().len(),
        net.blocks().len()
    );

    // Totality: reaching here at all, over four times 512's own cell
    // count, with every collection inside its linear ceiling, is most of
    // the property this test exists to pin.
    assert!(!net.blocks().is_empty());

    let pm = &d.plots;
    // Every non-`open` plot is at least `width_min * envelope_limits(use)
    // .min_depth_cells` world cells for its own land use -- `plots::run`'s
    // own `axis_rows` never hands a real row less depth than that (its
    // own `min_needed` floor) -- so the smallest such product over every
    // land use bounds non-`open` plot count the same way `min_block_
    // depth_cells^2` bounds block count above. `open` plots are not
    // bounded by area (a sliver can be 1 cell), but are bounded in count:
    // at most one per block face plus one core, so a small constant slack
    // per block.
    let min_plot_area = (0..4)
        .map(|i| {
            let limits = cfg.envelope_limits(LandUse::ALL[i]);
            cfg.plot_width_min_cells[i] as u64 * limits.min_depth_cells as u64
        })
        .min()
        .unwrap_or(1)
        .max(1);
    let max_open_plots_per_block = 5u64; // 4 faces + 1 core, generously.
    let max_plots = world_cells / min_plot_area + max_blocks * max_open_plots_per_block;
    assert!(
        pm.plots().len() as u64 <= max_plots,
        "plot count {} exceeds the structural ceiling {max_plots} derived from plot width/envelope-depth minimums",
        pm.plots().len()
    );
    assert!(!pm.plots().is_empty());
    assert!(
        pm.landlocked_plots(net.blocks(), cfg.plot_frontage_min_cells)
            .is_empty()
    );
    // The ceiling's own derivation, true rather than merely loose: every
    // non-`open` plot really does clear its own land use's minimum area.
    for p in pm.plots() {
        if p.open {
            continue;
        }
        let limits = cfg.envelope_limits(p.land_use);
        let area = p.bounds.width() * p.bounds.height();
        let min_area =
            cfg.plot_width_min_cells[p.land_use as usize] as i64 * limits.min_depth_cells as i64;
        assert!(
            area >= min_area,
            "non-open plot {:?} (use {:?}) has area {area} under its own minimum {min_area}",
            p.bounds,
            p.land_use
        );
    }

    let em = &d.envelopes;
    // Envelopes never outnumber the plots they were sized from -- no
    // separate ceiling needed beyond `max_plots` above.
    assert!(em.outcomes().len() as u64 <= max_plots);
    assert!(!em.outcomes().is_empty());

    // Story 3.4: one type assignment per placed envelope, never more --
    // pass 5's own candidate-pair cost (the distribution overrides'
    // greedy spacing scan) is linear in envelope count times institution
    // count, never envelopes squared: every candidate list is built in
    // one pass over `placed`, and the spacing check compares only
    // against this row's own already-chosen set, never all pairs.
    assert_eq!(
        d.building_types.assignments().len(),
        em.placed_count() as usize
    );
}
