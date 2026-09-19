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
//! would be the thing that catches it, not a stopwatch. Story 3.3 (Tim's
//! direction) extends this to plots and envelopes: their own ceilings are
//! derived from `block area / minimum plot area`, still linear, and
//! neither pass carries an `O(n^2)` risk of its own (plots cuts a fixed
//! `FACE_PRIORITY` strip set per block; envelopes sizes one plot at a
//! time).

use sim::generated::defs;
use sim::generation::{GenerationConfig, envelopes, land_use, plots, streets};

#[test]
fn generation_at_the_1024_growth_target_stays_within_structural_bounds() {
    let mut cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    // NFR14's own growth target -- 1024 is a multiple of coarse_cell_size_
    // cells (16), same divisibility rule `from_balance` enforces for the
    // live 512 value.
    cfg.site_extent_cells = 1024;

    let lu = land_use::run(7, cfg.site(), &cfg).unwrap();
    let net = streets::run(7, &lu, &cfg);

    // Tim's direction, cycle 1: the checkers, not just `run` -- every
    // graph query now routes through the adjacency index built once at
    // construction (`StreetNetwork::degree`/`reachable_from`/`dijkstra_
    // from`), so this exercises that it stays cheap at the growth
    // target too, not only that `run` itself does.
    let reachable = net.reachable_from_first_node().unwrap();
    assert_eq!(reachable.len(), net.nodes().len());
    assert!(net.stranded_regions(&lu).is_empty());
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

    let pm = plots::run(7, &lu, &net, &cfg);
    // Every plot is at least `width_min * row_depth` world cells for its
    // own land use -- the smallest such product over every land use
    // bounds total plot count the same way `min_block_depth_cells^2`
    // bounds block count above.
    let min_plot_area = (0..4)
        .map(|i| cfg.plot_width_min_cells[i] as u64 * cfg.plot_row_depth_cells[i] as u64)
        .min()
        .unwrap_or(1)
        .max(1);
    let max_plots = world_cells / min_plot_area;
    assert!(
        pm.plots().len() as u64 <= max_plots,
        "plot count {} exceeds the structural ceiling {max_plots} derived from plot width/row-depth minimums",
        pm.plots().len()
    );
    assert!(!pm.plots().is_empty());
    assert!(
        pm.landlocked_plots(net.blocks(), cfg.plot_frontage_min_cells)
            .is_empty()
    );

    let em = envelopes::run(7, &pm, &cfg)
        .unwrap_or_else(|e| panic!("the 1024 growth target must still clear AC4's tolerance: {e}"));
    // Envelopes never outnumber the plots they were sized from -- no
    // separate ceiling needed beyond `max_plots` above.
    assert!(em.outcomes().len() as u64 <= max_plots);
    assert!(!em.outcomes().is_empty());
}
