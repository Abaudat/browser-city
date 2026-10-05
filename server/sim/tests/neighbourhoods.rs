//! Story 3.7 (FR113, NFR8): neighbourhood character comes from four
//! generator parameters -- density, building age, affluence and land-use
//! mix -- and nothing else. These tests hold the field's shape (plateaus
//! that step only at arterials), its independence from density and from
//! itself, the readable quantities the gentrification loop will later
//! read, the legibility of a step, and the crowding a core and an edge
//! support. Every threshold is a `generation.neighbourhood.*` balance key,
//! never a literal here.

use std::collections::BTreeMap;

use proptest::prelude::*;
use sim::generated::defs;
use sim::generation::neighbourhoods::{
    Dials, corner, desirability_of, initial_physical_state, raw_dials,
};
use sim::generation::{
    District, GenerationConfig, GenerationContent, LandUse, NeighbourhoodParams, plan,
};
use sim::rng::seed_from_ids;
use sim::world::Rect;

/// A `generation.neighbourhood.<key>` balance value.
fn key(name: &str) -> i32 {
    let full = format!("generation.neighbourhood.{name}");
    defs::BALANCE
        .iter()
        .find(|b| b.key == full)
        .unwrap_or_else(|| panic!("defs/balance/generation.toml carries '{full}'"))
        .value as i32
}

fn setup() -> (GenerationConfig, GenerationContent<'static>) {
    (
        GenerationConfig::from_balance(defs::BALANCE).unwrap(),
        GenerationContent::committed(),
    )
}

/// The three evidence seeds `bounds::generation_evidence` renders.
const EVIDENCE_SEEDS: [u64; 3] = [1, 2, 3];

fn district(seed: u64) -> District {
    let (cfg, content) = setup();
    plan(seed, &cfg, &content).unwrap()
}

fn adjacent(a: Rect, b: Rect) -> bool {
    let overlap_y = a.y1.min(b.y1) - a.y0.max(b.y0);
    let overlap_x = a.x1.min(b.x1) - a.x0.max(b.x0);
    ((a.x1 == b.x0 || b.x1 == a.x0) && overlap_y > 0)
        || ((a.y1 == b.y0 || b.y1 == a.y0) && overlap_x > 0)
}

/// Distinct patches with their dials, in patch order.
fn patches(d: &District) -> Vec<(usize, Dials, Vec<Rect>)> {
    let mut by: BTreeMap<usize, (Dials, Vec<Rect>)> = BTreeMap::new();
    for h in d.land_use.neighbourhoods() {
        by.entry(h.patch)
            .or_insert((
                Dials {
                    building_age: h.building_age,
                    affluence: h.affluence,
                },
                Vec::new(),
            ))
            .1
            .push(h.bounds);
    }
    by.into_iter().map(|(p, (d, r))| (p, d, r)).collect()
}

fn patches_adjacent(a: &[Rect], b: &[Rect]) -> bool {
    a.iter().any(|x| b.iter().any(|y| adjacent(*x, *y)))
}

// --- AC1: four dials, no fifth mechanism ---------------------------------

/// `NeighbourhoodParams` has exactly the four dials: the exhaustive
/// destructure stops compiling the moment a fifth field is added.
#[test]
fn the_parameter_field_carries_exactly_four_dials() {
    let p = district(1)
        .land_use
        .at_world(10, 10)
        .expect("inside the site");
    let NeighbourhoodParams {
        use_: _,
        density: _,
        building_age: _,
        affluence: _,
    } = p;
}

// --- the field: plateaus that step only at arterials ---------------------

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, failure_persistence: None, ..ProptestConfig::default() })]

    /// A neighbourhood is the ground between arterials: they partition the
    /// site, and every block lies wholly inside one -- so a dial can step
    /// only at an arterial, never through a block interior.
    #[test]
    fn neighbourhoods_partition_the_site_and_no_block_straddles_two(seed in any::<u64>()) {
        let d = district(seed);
        let site = d.land_use.site();
        let hoods = d.land_use.neighbourhoods();
        let area: i64 = hoods
            .iter()
            .map(|h| (h.bounds.x1 - h.bounds.x0) as i64 * (h.bounds.y1 - h.bounds.y0) as i64)
            .sum();
        prop_assert_eq!(area, (site.x1 - site.x0) as i64 * (site.y1 - site.y0) as i64);
        for (i, a) in hoods.iter().enumerate() {
            for b in &hoods[i + 1..] {
                let overlap = a.bounds.x1.min(b.bounds.x1) > a.bounds.x0.max(b.bounds.x0)
                    && a.bounds.y1.min(b.bounds.y1) > a.bounds.y0.max(b.bounds.y0);
                prop_assert!(!overlap, "seed {seed}: two neighbourhoods overlap");
            }
        }
        for block in d.streets.blocks() {
            let b = block.bounds;
            let corners = [(b.x0, b.y0), (b.x1 - 1, b.y0), (b.x0, b.y1 - 1), (b.x1 - 1, b.y1 - 1)];
            let owners: std::collections::BTreeSet<usize> = corners
                .iter()
                .map(|&(x, y)| {
                    let h = d.land_use.neighbourhood_at(x, y).expect("a block is on the site");
                    hoods.iter().position(|o| o == h).unwrap()
                })
                .collect();
            prop_assert_eq!(owners.len(), 1, "seed {}: block {:?} changes a dial through its interior", seed, b);
        }
    }

    /// Every plot carries its neighbourhood's own two dials.
    #[test]
    fn every_plot_carries_its_neighbourhoods_dials(seed in any::<u64>()) {
        let d = district(seed);
        for plot in d.plots.plots() {
            let p = d
                .land_use
                .at_world(plot.bounds.x0, plot.bounds.y0)
                .expect("a plot is on the site");
            prop_assert_eq!((plot.building_age, plot.affluence), (p.building_age, p.affluence));
        }
    }

    /// The district-level guarantees: somewhere affordable that holds
    /// dwellings, a legible step between adjacent patches on each dial,
    /// at least `min_corners` of the four corners, and at least
    /// `min_apart_neighbourhoods` patches pairwise a legible step apart.
    #[test]
    fn every_district_shows_its_guaranteed_character(seed in any::<u64>()) {
        let (cfg, content) = setup();
        let d = plan(seed, &cfg, &content).unwrap();
        let nc = cfg.neighbourhood;
        let ps = patches(&d);

        let step = key("legible_step");
        let mut aff_step = false;
        let mut age_step = false;
        for (i, (_, a, ra)) in ps.iter().enumerate() {
            for (_, b, rb) in &ps[i + 1..] {
                if patches_adjacent(ra, rb) {
                    aff_step |= (a.affluence - b.affluence).abs() >= step;
                    age_step |= (a.building_age - b.building_age).abs() >= step;
                }
            }
        }
        prop_assert!(aff_step, "seed {seed}: no adjacent pair a legible step apart on affluence");
        prop_assert!(age_step, "seed {seed}: no adjacent pair a legible step apart on age");

        let corners: std::collections::BTreeSet<_> =
            ps.iter().filter_map(|(_, dials, _)| corner(*dials, &nc)).collect();
        prop_assert!(
            corners.len() >= key("min_corners") as usize,
            "seed {seed}: only {} of the four corners", corners.len()
        );

        // The largest set of patches pairwise a legible step apart on some
        // dial (a clique; a district has a handful of patches).
        let far = |a: &Dials, b: &Dials| {
            (a.affluence - b.affluence).abs() >= step
                || (a.building_age - b.building_age).abs() >= step
        };
        let n = ps.len();
        let mut apart: Vec<usize> = Vec::new();
        for mask in 0u32..(1 << n) {
            let members: Vec<usize> = (0..n).filter(|i| mask >> i & 1 == 1).collect();
            if members.len() > apart.len()
                && members.iter().enumerate().all(|(i, &a)| {
                    members[i + 1..].iter().all(|&b| far(&ps[a].1, &ps[b].1))
                })
            {
                apart = members;
            }
        }
        prop_assert!(
            apart.len() >= key("min_apart_neighbourhoods") as usize,
            "seed {seed}: only {} neighbourhoods a legible step apart", apart.len()
        );

        // Somewhere affordable to begin: a bottom-band place that holds homes.
        let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();
        let homes_in_poor_band = d
            .envelopes
            .envelopes()
            .zip(d.building_types.assignments())
            .any(|(e, a)| {
                let (x, y) = sim::generation::site::front_cell(e.footprint, e.front);
                let params = d.land_use.at_world(x, y).unwrap();
                params.affluence <= key("poor_band_max")
                    && by_id[&a.building_type].land_uses[LandUse::Residential as usize]
            });
        prop_assert!(homes_in_poor_band, "seed {seed}: no dwelling in the bottom affluence band");
    }

    /// No patch is narrower than `min_patch_span_viewports` viewports,
    /// either way -- unless merging further would leave fewer patches than
    /// the corner guarantee needs (a district at its minimum patch count).
    #[test]
    fn no_patch_is_narrower_than_the_minimum_span(seed in any::<u64>()) {
        let d = district(seed);
        let ps = patches(&d);
        let min_w = key("min_patch_span_viewports") * key("viewport_width_cells");
        let min_h = key("min_patch_span_viewports") * key("viewport_height_cells");
        for (_, _, rects) in &ps {
            let x0 = rects.iter().map(|r| r.x0).min().unwrap();
            let x1 = rects.iter().map(|r| r.x1).max().unwrap();
            let y0 = rects.iter().map(|r| r.y0).min().unwrap();
            let y1 = rects.iter().map(|r| r.y1).max().unwrap();
            let narrow = x1 - x0 < min_w || y1 - y0 < min_h;
            prop_assert!(
                !narrow || ps.len() <= key("min_corners") as usize,
                "seed {seed}: a {}x{} patch is narrower than {min_w}x{min_h} though {} patches exist",
                x1 - x0, y1 - y0, ps.len()
            );
        }
    }
}

// --- the dials are independent of density and of each other -------------

/// Pooled over the fixed seed range, old and new, poor and rich each occur
/// at both the dense and the sparse end of the density field: age and
/// affluence are not one more reading of density.
#[test]
fn age_and_affluence_each_occur_at_both_the_dense_and_the_sparse_end() {
    let (cfg, content) = setup();
    let span = cfg.density_max - cfg.density_min;
    let dense_from = cfg.density_max - span / 3;
    let sparse_to = cfg.density_min + span / 3;
    let nc = cfg.neighbourhood;
    // (dense?, label) seen
    let mut seen: std::collections::BTreeSet<(bool, &str)> = Default::default();
    for seed in 0..256u64 {
        let d = plan(seed, &cfg, &content).unwrap();
        for h in d.land_use.neighbourhoods() {
            let cx = (h.bounds.x0 + h.bounds.x1) / 2;
            let cy = (h.bounds.y0 + h.bounds.y1) / 2;
            let density = d.land_use.at_world(cx, cy).unwrap().density;
            let end = if density >= dense_from {
                true
            } else if density <= sparse_to {
                false
            } else {
                continue;
            };
            if h.building_age >= nc.old_from() {
                seen.insert((end, "old"));
            }
            if h.building_age <= nc.new_to() {
                seen.insert((end, "new"));
            }
            if h.affluence >= nc.rich_from() {
                seen.insert((end, "rich"));
            }
            if h.affluence <= nc.poor_to() {
                seen.insert((end, "poor"));
            }
        }
    }
    for end in [true, false] {
        for label in ["old", "new", "rich", "poor"] {
            assert!(
                seen.contains(&(end, label)),
                "never saw a {label} neighbourhood at the {} end over seeds 0..256",
                if end { "dense" } else { "sparse" }
            );
        }
    }
}

/// The city grows by whole neighbourhoods: a neighbourhood's raw dials are
/// a pure function of `(city_seed, its own corner, cfg)` -- the site's
/// extent and every other neighbourhood are not inputs -- so ground added
/// elsewhere leaves an existing neighbourhood's value unchanged.
#[test]
fn a_neighbourhoods_raw_dials_ignore_the_site_and_every_other_neighbourhood() {
    let (cfg, _) = setup();
    let nc = cfg.neighbourhood;
    for seed in 0..64u64 {
        for corner in [(0, 0), (130, 0), (0, 255), (302, 377), (-512, 1024)] {
            let base = raw_dials(seed, corner, &nc);
            // A grown site (twice the extent) asks the same question.
            let mut grown = cfg;
            grown.site_extent_cells *= 2;
            assert_eq!(base, raw_dials(seed, corner, &grown.neighbourhood));
            // Asking about other neighbourhoods first changes nothing.
            let _ = raw_dials(seed, (corner.0 + 1000, corner.1 + 1000), &nc);
            assert_eq!(base, raw_dials(seed, corner, &nc));
            assert!((nc.building_age_min..=nc.building_age_max).contains(&base.building_age));
            assert!((nc.affluence_min..=nc.affluence_max).contains(&base.affluence));
        }
    }
}

/// Same-seed purity: a district's dials are a pure function of its seed.
#[test]
fn the_dials_are_deterministic() {
    let (a, b) = (district(7), district(7));
    assert_eq!(a.land_use.neighbourhoods(), b.land_use.neighbourhoods());
}

// --- AC3: readable quantities -------------------------------------------

/// Each dial reads back, typed, at a known point of a fixed-seed field:
/// land use and density from the coarse cell, age and affluence from the
/// neighbourhood the point sits in.
#[test]
fn each_dial_reads_back_at_known_points_of_a_fixed_seed_field() {
    let d = district(1);
    let cell = d.land_use.cell_size();
    for h in d.land_use.neighbourhoods() {
        let (x, y) = (
            (h.bounds.x0 + h.bounds.x1) / 2,
            (h.bounds.y0 + h.bounds.y1) / 2,
        );
        let p = d.land_use.at_world(x, y).expect("inside the site");
        let coarse = d.land_use.coarse_at(x / cell, y / cell).unwrap();
        assert_eq!(
            p,
            NeighbourhoodParams {
                use_: coarse.use_,
                density: coarse.density,
                building_age: h.building_age,
                affluence: h.affluence,
            }
        );
    }
    assert_eq!(
        d.land_use.at_world(-1, 0),
        None,
        "outside the site reads nothing"
    );
}

/// Physical state is per building, derived once from its age and its
/// neighbourhood's affluence, and old and poor is worn where old and rich
/// is kept.
#[test]
fn physical_state_is_per_building_and_old_and_poor_is_worn() {
    let (cfg, content) = setup();
    let d = plan(1, &cfg, &content).unwrap();
    let nc = cfg.neighbourhood;
    for (e, s) in d.envelopes.envelopes().zip(d.building_types.states()) {
        let (x, y) = sim::generation::site::front_cell(e.footprint, e.front);
        let hood = d.land_use.at_world(x, y).unwrap();
        assert_eq!(s.plot, e.plot);
        assert!((s.building_age - hood.building_age).abs() <= nc.building_age_spread);
        assert_eq!(
            s.physical_state,
            initial_physical_state(s.building_age, hood.affluence, &nc)
        );
        assert_eq!(d.building_state(e.plot), Some(*s));
        assert!((0..=100).contains(&s.physical_state));
    }
    let worn = initial_physical_state(nc.building_age_max, nc.affluence_min, &nc);
    let kept = initial_physical_state(nc.building_age_max, nc.affluence_max, &nc);
    let fresh_kept = initial_physical_state(nc.building_age_min, nc.affluence_max, &nc);
    assert!(
        worn < kept && kept <= fresh_kept,
        "{worn} < {kept} <= {fresh_kept}"
    );
}

/// Desirability is one pure function of a block's mean physical state --
/// affluence is not an input -- exposed on the district and never stored.
#[test]
fn desirability_is_a_pure_function_of_block_mean_physical_state() {
    let (cfg, content) = setup();
    let d = plan(2, &cfg, &content).unwrap();
    let nc = cfg.neighbourhood;
    let mut seen = 0;
    for block in 0..d.streets.blocks().len() as u32 {
        let Some(mean) = d.block_mean_physical_state(block) else {
            assert_eq!(d.block_desirability(block, &cfg), None);
            continue;
        };
        assert_eq!(
            d.block_desirability(block, &cfg),
            Some(desirability_of(mean, &nc))
        );
        seen += 1;
    }
    assert!(seen > 0);
    // Monotone in state, zero at or under the floor, and reads nothing else.
    let mut last = 0;
    for state in 0..=100 {
        let v = desirability_of(state, &nc);
        assert!(v >= last && (0..=100).contains(&v));
        last = v;
    }
    assert_eq!(desirability_of(nc.desirability_state_floor, &nc), 0);
    assert_eq!(desirability_of(100, &nc), 100);
}

// --- AC2: legible without a label ---------------------------------------

fn total_variation(a: &BTreeMap<i64, u64>, b: &BTreeMap<i64, u64>) -> i64 {
    let (sa, sb): (i64, i64) = (
        a.values().sum::<u64>() as i64,
        b.values().sum::<u64>() as i64,
    );
    if sa == 0 || sb == 0 {
        return 0;
    }
    let keys: std::collections::BTreeSet<i64> = a.keys().chain(b.keys()).copied().collect();
    let sum: i64 = keys
        .iter()
        .map(|k| {
            let pa = *a.get(k).unwrap_or(&0) as i64 * sb;
            let pb = *b.get(k).unwrap_or(&0) as i64 * sa;
            (pa - pb).abs()
        })
        .sum();
    sum * 50 / (sa * sb)
}

type Histograms = BTreeMap<usize, BTreeMap<i64, u64>>;

proptest! {
    #![proptest_config(ProptestConfig { cases: 48, failure_persistence: None, ..ProptestConfig::default() })]

    /// Two neighbourhoods a legible step apart on a dial differ, without
    /// any label, in what they hold: the total-variation distance between
    /// their placed building types, building ages, physical states or shop
    /// types is at least the balance threshold on one of them.
    #[test]
    fn neighbourhoods_a_legible_step_apart_differ_in_what_they_hold(seed in any::<u64>()) {
        let (cfg, content) = setup();
        let d = plan(seed, &cfg, &content).unwrap();
        let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();
        let shop_types: std::collections::BTreeSet<u32> = {
            let shop_tag = defs::TAGS.iter().find(|t| t.key == "shop").unwrap().id;
            content
                .building_types
                .iter()
                .filter(|b| b.tags.contains(&shop_tag))
                .map(|b| b.id)
                .collect()
        };
        let (mut types, mut ages, mut states, mut shops): (Histograms, Histograms, Histograms, Histograms) =
            Default::default();
        for ((e, a), s) in d
            .envelopes
            .envelopes()
            .zip(d.building_types.assignments())
            .zip(d.building_types.states())
        {
            let (x, y) = sim::generation::site::front_cell(e.footprint, e.front);
            let patch = d.land_use.neighbourhood_at(x, y).unwrap().patch;
            *types.entry(patch).or_default().entry(a.building_type as i64).or_insert(0) += 1;
            *ages.entry(patch).or_default().entry((s.building_age / 10) as i64).or_insert(0) += 1;
            *states.entry(patch).or_default().entry((s.physical_state / 10) as i64).or_insert(0) += 1;
            if shop_types.contains(&by_id[&a.building_type].id) {
                *shops.entry(patch).or_default().entry(a.building_type as i64).or_insert(0) += 1;
            }
        }
        let step = key("legible_step");
        let min_buildings = key("legibility_min_buildings") as u64;
        let threshold = key("legibility_min_distance_percent") as i64;
        let empty = BTreeMap::new();
        let count = |p: usize| types.get(&p).map(|m| m.values().sum::<u64>()).unwrap_or(0);
        let ps = patches(&d);
        for (i, (p, a, _)) in ps.iter().enumerate() {
            for (q, b, _) in &ps[i + 1..] {
                let apart = (a.affluence - b.affluence).abs() >= step
                    || (a.building_age - b.building_age).abs() >= step;
                if !apart || count(*p) < min_buildings || count(*q) < min_buildings {
                    continue;
                }
                let tv = |h: &Histograms| {
                    total_variation(h.get(p).unwrap_or(&empty), h.get(q).unwrap_or(&empty))
                };
                let best = tv(&types).max(tv(&ages)).max(tv(&states)).max(tv(&shops));
                prop_assert!(
                    best >= threshold,
                    "seed {seed}: patches {p} and {q} are a legible step apart but differ by only {best}% (< {threshold}%)"
                );
            }
        }
    }
}

/// Four dials and no fifth mechanism, shown by sufficiency: neighbourhoods
/// with identical dials and density hold statistically the same buildings
/// wherever they sit. Pooled over seeds, the placed building types of a
/// (affluence band, density third, land use) class on the west half of the
/// site and on the east half differ by at most the balance threshold.
#[test]
fn identical_dials_hold_the_same_buildings_wherever_they_sit() {
    let (cfg, content) = setup();
    let span = cfg.density_max - cfg.density_min;
    let third = |density: i32| ((density - cfg.density_min) * 3 / span.max(1)).min(2);
    let site = cfg.site();
    let mid_x = (site.x0 + site.x1) / 2;
    let mut pooled: BTreeMap<(i32, i32, usize), [BTreeMap<i64, u64>; 2]> = BTreeMap::new();
    for i in 0..200u64 {
        let seed = seed_from_ids(0x7137, i);
        let d = plan(seed, &cfg, &content).unwrap();
        for (e, a) in d.envelopes.envelopes().zip(d.building_types.assignments()) {
            let (x, y) = sim::generation::site::front_cell(e.footprint, e.front);
            let p = d.land_use.at_world(x, y).unwrap();
            let class = (p.affluence / 20, third(p.density), p.use_ as usize);
            let side = usize::from(x >= mid_x);
            *pooled.entry(class).or_default()[side]
                .entry(a.building_type as i64)
                .or_insert(0) += 1;
        }
    }
    let threshold = key("position_independence_max_distance_percent") as i64;
    let mut compared = 0;
    for (class, [west, east]) in &pooled {
        let (nw, ne): (u64, u64) = (west.values().sum(), east.values().sum());
        if nw < 1000 || ne < 1000 {
            continue;
        }
        compared += 1;
        let tv = total_variation(west, east);
        assert!(
            tv <= threshold,
            "class {class:?}: west and east differ by {tv}% (> {threshold}%) with identical dials and density"
        );
    }
    assert!(
        compared >= 6,
        "only {compared} classes were populated enough to compare"
    );
}

// --- AC4: density --------------------------------------------------------

/// A commercial core at the top of the density range supports the citizen
/// density a busy screen requires, and a residential edge at the bottom far
/// less. Both bounds are balance keys; the figure is derived from placed
/// buildings, never stored.
fn core_and_edge(seed: u64) -> (u64, u64) {
    let (cfg, content) = setup();
    let d = plan(seed, &cfg, &content).unwrap();
    let span = cfg.density_max - cfg.density_min;
    let core = d
        .citizens_per_screen(
            LandUse::Commercial,
            cfg.density_max - span / 3..=cfg.density_max,
            &cfg,
            &content,
        )
        .expect("every district has a commercial core");
    let edge = d
        .citizens_per_screen(
            LandUse::Residential,
            cfg.density_min..=cfg.density_min + span / 3,
            &cfg,
            &content,
        )
        .expect("every district has a residential edge");
    (core, edge)
}

#[test]
fn a_commercial_core_is_busy_and_a_residential_edge_is_quiet_on_the_evidence_seeds() {
    for seed in EVIDENCE_SEEDS {
        let (core, edge) = core_and_edge(seed);
        assert!(
            core >= key("busy_screen_min_citizens") as u64,
            "seed {seed}: the core supports {core} citizens a screen"
        );
        assert!(
            edge * 100 <= core * key("quiet_edge_max_percent_of_core") as u64,
            "seed {seed}: the edge supports {edge} against the core's {core}"
        );
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 48, failure_persistence: None, ..ProptestConfig::default() })]

    #[test]
    fn a_core_is_busy_and_an_edge_quiet_for_any_seed(seed in any::<u64>()) {
        let (core, edge) = core_and_edge(seed);
        prop_assert!(core >= key("busy_screen_min_citizens") as u64, "seed {seed}: core {core}");
        prop_assert!(
            edge * 100 <= core * key("quiet_edge_max_percent_of_core") as u64,
            "seed {seed}: edge {edge} against core {core}"
        );
    }
}

// --- the affluence band, end to end -------------------------------------

/// Affluence carries the shop mix: vacant units and launderettes are the
/// poor end only, bookshops the rich end only -- read off the committed
/// bands, never a literal in the generator.
#[test]
fn banded_types_appear_only_inside_their_affluence_band() {
    let (cfg, content) = setup();
    let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    for seed in 0..32u64 {
        let d = plan(seed, &cfg, &content).unwrap();
        for (e, a) in d.envelopes.envelopes().zip(d.building_types.assignments()) {
            let (x, y) = sim::generation::site::front_cell(e.footprint, e.front);
            let affluence = d.land_use.at_world(x, y).unwrap().affluence;
            let def = by_id[&a.building_type];
            assert!(
                affluence >= def.affluence_min && affluence <= def.affluence_max,
                "seed {seed}: {} sits at affluence {affluence}, outside [{}, {}]",
                def.key,
                def.affluence_min,
                def.affluence_max
            );
        }
    }
}
