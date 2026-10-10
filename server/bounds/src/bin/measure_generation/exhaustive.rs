use std::collections::BTreeMap;

use sim::generated::defs;
use sim::generation::{GenerationConfig, GenerationContent, building_types, envelopes, streets};

use crate::common::*;

/// The default run: envelope, detour-excess, building-type and missing-tag
/// statistics over mixed seeds.
pub fn run(cfg: &GenerationConfig, content: &GenerationContent) {
    let site = cfg.site();
    println!(
        "{}: {SEED_COUNT} seeds at {}x{} cells",
        bounds::generation_stamp::stamp(&bounds::generation_stamp::EXHAUSTIVE_LOOP),
        site.width(),
        site.height()
    );

    let mut building_count = Vec::with_capacity(SEED_COUNT as usize);
    let mut rejected_percent = Vec::with_capacity(SEED_COUNT as usize);
    let mut open_percent_by_count = Vec::with_capacity(SEED_COUNT as usize);
    let mut open_percent_by_area = Vec::with_capacity(SEED_COUNT as usize);
    let mut unplotted_percent = Vec::with_capacity(SEED_COUNT as usize);
    let mut mean_width_x10 = Vec::with_capacity(SEED_COUNT as usize);
    let mut mean_depth_x10 = Vec::with_capacity(SEED_COUNT as usize);
    let (mut too_narrow, mut too_shallow) = (0u64, 0u64);
    let (mut min_count, mut max_count) = ((i64::MAX, 0u64), (i64::MIN, 0u64));
    let mut open_slivers = 0u64;
    let mut sliver_blocks = 0u64;
    // The detour-excess ceiling's own worst-case statistic (PR #317
    // cycle 5, Quentin's direction: "put the worst-excess statistic in
    // measure-generation so the number in the comment can be
    // re-derived", never a temporary, uncommitted property). One entry
    // per sampled pair, every seed -- `DetourSample::excess_cells()`,
    // the same additive Manhattan-fitness overshoot `generation.
    // streets.max_detour_excess_cells` bounds.
    let mut detour_excess: Vec<i64> = Vec::new();
    let mut detour_excess_max: DetourWorst = (i64::MIN, 0, (0, 0), (0, 0));
    // The exhaustive-pair statistic `max_detour_excess_cells` is actually
    // keyed against (this module's own doc comment): every non-both-
    // boundary pair, not the cheap `DETOUR_SAMPLE_MAX_NODES` sample above.
    // `detour_excess_worst.0` is the running max; `detour_excess_top10`
    // holds the ten largest *per-seed* worsts seen so far, ascending, so
    // the tail beyond the single maximum is visible too.
    let mut detour_excess_worst: DetourWorst = (i64::MIN, 0, (0, 0), (0, 0));
    let mut detour_excess_top10: Vec<DetourWorst> = Vec::new();
    // Artie's direction, story 3.18 cycle 1: the player-felt figure is the
    // worst pair with *both* endpoints off the boundary -- every drawn
    // worst case so far has one foot on the site edge, where the city
    // stops and almost nobody stands.
    let mut detour_excess_both_interior_max: DetourWorst = (i64::MIN, 0, (0, 0), (0, 0));
    // Story 15.10 (Derek's direction): the exhaustive-pair worst ratio
    // among pairs at or beyond `GenerationConfig::detour_ratio_takeover_
    // distance_cells` -- the only range where the ratio term is the
    // binding half of the max()-contract, so the only figure `max_
    // detour_percent` owes margin over. The exhaustive pairing this
    // needs is too slow for the 1,000,000-seed detour-bounds sweep
    // below, so it rides this existing 50,000-seed loop instead.
    // `DetourWorst.0` holds `ratio_pct()`, not excess, here.
    let mut detour_ratio_exhaustive_worst: DetourWorst = (i64::MIN, 0, (0, 0), (0, 0));
    let mut detour_ratio_exhaustive_top10: Vec<DetourWorst> = Vec::new();
    let detour_takeover_distance = cfg.detour_ratio_takeover_distance_cells();

    for i in 0..SEED_COUNT {
        let seed = mixed_seed(i);
        let d = sim::generation::plan(seed, cfg, content).expect("pass 1 is total");
        let (net, pm, em) = (&d.streets, &d.plots, &d.envelopes);

        for s in net.detour_samples(streets::DETOUR_SAMPLE_MAX_NODES) {
            let excess = s.excess_cells();
            detour_excess.push(excess);
            if excess > detour_excess_max.0 {
                detour_excess_max = (excess, seed, s.a, s.b);
            }
        }

        let exhaustive = net.detour_samples(usize::MAX);
        let seed_worst = exhaustive
            .iter()
            .map(|s| (s.excess_cells(), seed, s.a, s.b))
            .max_by_key(|&(excess, ..)| excess);
        if let Some(w) = seed_worst {
            if w.0 > detour_excess_worst.0 {
                detour_excess_worst = w;
            }
            detour_excess_top10.push(w);
            detour_excess_top10.sort_unstable_by_key(|&(excess, ..)| excess);
            if detour_excess_top10.len() > 10 {
                detour_excess_top10.remove(0);
            }
        }
        let seed_both_interior_worst = exhaustive
            .iter()
            .filter(|s| !net.is_on_boundary(s.a) && !net.is_on_boundary(s.b))
            .map(|s| (s.excess_cells(), seed, s.a, s.b))
            .max_by_key(|&(excess, ..)| excess);
        if let Some(w) = seed_both_interior_worst
            && w.0 > detour_excess_both_interior_max.0
        {
            detour_excess_both_interior_max = w;
        }
        let seed_ratio_worst = exhaustive
            .iter()
            .filter(|s| s.manhattan >= detour_takeover_distance)
            .map(|s| (s.ratio_pct(), seed, s.a, s.b))
            .max_by_key(|&(ratio, ..)| ratio);
        if let Some(w) = seed_ratio_worst {
            if w.0 > detour_ratio_exhaustive_worst.0 {
                detour_ratio_exhaustive_worst = w;
            }
            detour_ratio_exhaustive_top10.push(w);
            detour_ratio_exhaustive_top10.sort_unstable_by_key(|&(ratio, ..)| ratio);
            if detour_ratio_exhaustive_top10.len() > 10 {
                detour_ratio_exhaustive_top10.remove(0);
            }
        }

        let placed = em.placed_count();
        if placed < min_count.0 {
            min_count = (placed, seed);
        }
        if placed > max_count.0 {
            max_count = (placed, seed);
        }
        building_count.push(placed);
        for p in pm.plots() {
            let short = p.bounds.width().min(p.bounds.height());
            if p.open && short < cfg.plot_open_min_side_cells as i64 {
                open_slivers += 1;
                if p.bounds == net.blocks()[p.block as usize].bounds {
                    sliver_blocks += 1;
                }
            }
        }
        rejected_percent.push(em.rejected_percent());
        for o in em.outcomes() {
            if let envelopes::EnvelopeOutcome::Rejected { reason, .. } = o {
                match reason {
                    envelopes::RejectReason::PlotTooNarrow => too_narrow += 1,
                    envelopes::RejectReason::PlotTooShallow => too_shallow += 1,
                }
            }
        }
        open_percent_by_count.push(pm.open_count_percent());
        open_percent_by_area.push(pm.open_area_percent());
        unplotted_percent.push(pm.unplotted_percent(net.blocks()));

        let (mut sum_w, mut sum_d, mut n) = (0i64, 0i64, 0i64);
        for e in em.envelopes() {
            sum_w += e.along_face_cells();
            sum_d += e.depth_cells();
            n += 1;
        }
        if n > 0 {
            mean_width_x10.push(sum_w * 10 / n);
            mean_depth_x10.push(sum_d * 10 / n);
        }
    }

    Stats::new(building_count).print("building_count");
    println!(
        "building_count extremes: min {} at seed {}, max {} at seed {} (pin both in invariants.rs's PINNED_BUILDING_COUNT_SEEDS)",
        min_count.0, min_count.1, max_count.0, max_count.1
    );
    Stats::new(rejected_percent).print("rejected_percent");
    println!("rejections by reason: too_narrow={too_narrow} too_shallow={too_shallow}");
    println!(
        "open plots with a short side under open_min_side_cells: {open_slivers} ({sliver_blocks} of them whole sliver blocks from pass 2)"
    );
    Stats::new(open_percent_by_count).print("open_percent_by_count");
    Stats::new(open_percent_by_area).print("open_percent_by_area");
    Stats::new(unplotted_percent).print("unplotted_percent");
    Stats::new(mean_width_x10).print("mean_width_cells_x10");
    Stats::new(mean_depth_x10).print("mean_depth_cells_x10");
    Stats::new(detour_excess).print("detour_excess_cells_sampled_14node");
    println!(
        "detour_excess_cells_sampled_14node worst: {} at seed {} ({:?}-{:?})",
        detour_excess_max.0, detour_excess_max.1, detour_excess_max.2, detour_excess_max.3
    );
    println!(
        "detour_excess_cells_exhaustive max: {} at seed {} ({:?}-{:?}) -- the number max_detour_excess_cells's own margin rule is applied to; pin the seed (with this exhaustive figure) in streets::PINNED_DETOUR_SEEDS if it moves",
        detour_excess_worst.0, detour_excess_worst.1, detour_excess_worst.2, detour_excess_worst.3
    );
    println!("detour_excess_cells_exhaustive top 10 per-seed worsts (ascending):");
    for (excess, seed, a, b) in &detour_excess_top10 {
        println!("  {excess} at seed {seed} ({a:?}-{b:?})");
    }
    println!(
        "detour_excess_cells_exhaustive_both_endpoints_interior max: {} at seed {} ({:?}-{:?}) -- the player-felt figure: the worst pair with neither endpoint on the site boundary",
        detour_excess_both_interior_max.0,
        detour_excess_both_interior_max.1,
        detour_excess_both_interior_max.2,
        detour_excess_both_interior_max.3
    );
    println!(
        "detour_ratio_pct_exhaustive_at_or_beyond_takeover ({detour_takeover_distance} cells) max: {}% at seed {} ({:?}-{:?}) -- the only range where the ratio term is the binding half of the max()-contract, so the only figure max_detour_percent owes margin over (story 15.10, Derek's direction)",
        detour_ratio_exhaustive_worst.0,
        detour_ratio_exhaustive_worst.1,
        detour_ratio_exhaustive_worst.2,
        detour_ratio_exhaustive_worst.3
    );
    println!(
        "detour_ratio_pct_exhaustive_at_or_beyond_takeover top 10 per-seed worsts (ascending):"
    );
    for (ratio, seed, a, b) in &detour_ratio_exhaustive_top10 {
        println!("  {ratio}% at seed {seed} ({a:?}-{b:?})");
    }

    // -- story 3.4: building types -------------------------------------
    let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let mut dwelling_count = Vec::with_capacity(BUILDING_TYPE_SEED_COUNT as usize);
    let mut workplace_count = Vec::with_capacity(BUILDING_TYPE_SEED_COUNT as usize);
    let mut per_tag_min: BTreeMap<u32, i64> = BTreeMap::new();
    let mut per_tag_sum: BTreeMap<u32, i64> = BTreeMap::new();
    let mut rule_violation_seeds = 0u64;
    // Per seed: how many distinct professions this one city employs at
    // >=5 distinct workplaces -- pooled (meaned) over every seed below,
    // the same two-step AC4 shape as building/workplace count.
    let mut deep_profession_count = Vec::with_capacity(BUILDING_TYPE_SEED_COUNT as usize);
    // Story 15.9: the per-city barista employer count (an FR14 launch job,
    // posted only at cafes) -- its own minimum is what `cafe_present`'s
    // comment and `inv_generation_barista_has_at_least_min_employers` hold.
    let mut barista_employers = Vec::with_capacity(BUILDING_TYPE_SEED_COUNT as usize);
    let mut profession_sum: BTreeMap<&str, u64> = BTreeMap::new();

    // Every committed distribution row's own actual/expected ratio
    // (`sim::rules::evaluate`'s own tolerance-band check), pooled and
    // per-seed-worst -- the same figures `welfare_office_present`'s and
    // `shelter_present`'s own comments were measured with (Tim's
    // direction, story 15.9), re-derivable for every row rather than
    // hand-copied from a one-off scan. Only seeds with a nonzero
    // expected count enter this (a row with `expected == 0` never has
    // a tolerance band to be inside or outside of).
    let mut dist_rows_for_ratio: Vec<sim::rules::DistributionRow> = content
        .rules
        .iter()
        .filter_map(|r| r.as_distribution())
        .filter(|row| {
            content
                .building_types
                .iter()
                .any(|b| b.tags.contains(&row.per))
        })
        .collect();
    dist_rows_for_ratio.sort_by_key(|d| d.id);
    let mut ratio_actual_sum: BTreeMap<&str, u64> = BTreeMap::new();
    let mut ratio_expected_sum: BTreeMap<&str, u64> = BTreeMap::new();
    let mut ratio_min_percent: BTreeMap<&str, f64> = BTreeMap::new();
    let mut ratio_min_percent_seed: BTreeMap<&str, u64> = BTreeMap::new();

    for i in 0..BUILDING_TYPE_SEED_COUNT {
        let seed = mixed_building_type_seed(i);
        let d = sim::generation::plan(seed, cfg, content).expect("pass 1 is total");
        let mut tag_counts: BTreeMap<u32, i64> = BTreeMap::new();
        let mut workplaces = 0i64;
        let mut employers_this_city: BTreeMap<&str, u64> = BTreeMap::new();
        for a in d.building_types.assignments() {
            let def = by_id[&a.building_type];
            for &t in def.tags {
                *tag_counts.entry(t).or_insert(0) += 1;
            }
            if building_types::is_workplace(def) {
                workplaces += 1;
                for &p in def.professions {
                    *employers_this_city.entry(p).or_insert(0) += 1;
                }
            }
        }
        dwelling_count.push(*tag_counts.get(&18).unwrap_or(&0)); // "dwelling" tag id
        workplace_count.push(workplaces);
        for (&tag, &count) in &tag_counts {
            per_tag_sum
                .entry(tag)
                .and_modify(|s| *s += count)
                .or_insert(count);
            per_tag_min
                .entry(tag)
                .and_modify(|m| *m = (*m).min(count))
                .or_insert(count);
        }
        barista_employers.push(employers_this_city.get("barista").copied().unwrap_or(0) as i64);
        deep_profession_count
            .push(employers_this_city.values().filter(|&&c| c >= 5).count() as i64);
        for (&p, &c) in &employers_this_city {
            *profession_sum.entry(p).or_insert(0) += c;
        }
        for row in &dist_rows_for_ratio {
            let basis = tag_counts.get(&row.per).copied().unwrap_or(0).max(0) as u64;
            let expected = basis / (row.ratio.smallest() as u64);
            if expected == 0 {
                continue;
            }
            let actual = tag_counts.get(&row.subject).copied().unwrap_or(0).max(0) as u64;
            *ratio_actual_sum.entry(row.key).or_insert(0) += actual;
            *ratio_expected_sum.entry(row.key).or_insert(0) += expected;
            let percent = actual as f64 * 100.0 / expected as f64;
            let slot = ratio_min_percent.entry(row.key).or_insert(f64::MAX);
            if percent < *slot {
                *slot = percent;
                ratio_min_percent_seed.insert(row.key, seed);
            }
        }
        if let Err(e) = d.check_rules(content) {
            rule_violation_seeds += 1;
            eprintln!("seed {seed}: real rule violation: {e:?}");
        }
    }

    Stats::new(dwelling_count).print("dwelling_count");
    Stats::new(workplace_count).print("workplace_count");
    println!(
        "seeds (0..{BUILDING_TYPE_SEED_COUNT}) with a real rule violation: {rule_violation_seeds}"
    );
    println!(
        "distribution row actual/expected ratio, pooled and per-seed worst, over seeds with a nonzero expected count (0..{BUILDING_TYPE_SEED_COUNT}):"
    );
    for row in &dist_rows_for_ratio {
        let (Some(&actual_sum), Some(&expected_sum)) = (
            ratio_actual_sum.get(row.key),
            ratio_expected_sum.get(row.key),
        ) else {
            println!("  {}: expected is 0 for every seed in this range", row.key);
            continue;
        };
        let pooled_percent = actual_sum as f64 * 100.0 / expected_sum as f64;
        println!(
            "  {}: pooled actual/expected {pooled_percent:.1}% (actual sum {actual_sum}, expected sum {expected_sum}), worst single seed {:.1}% at seed {} (committed tolerance_percent allows down to {}%)",
            row.key,
            ratio_min_percent[row.key],
            ratio_min_percent_seed[row.key],
            100u32.saturating_sub(row.tolerance_percent),
        );
    }
    println!("per-tag placed count, min and pooled mean over 0..{BUILDING_TYPE_SEED_COUNT}:");
    for (&tag, &min) in &per_tag_min {
        let mean = per_tag_sum[&tag] as f64 / BUILDING_TYPE_SEED_COUNT as f64;
        println!("  tag {tag}: min={min} mean={mean:.2}");
    }
    let mut by_mean: Vec<(&str, f64)> = profession_sum
        .iter()
        .map(|(&p, &s)| (p, s as f64 / BUILDING_TYPE_SEED_COUNT as f64))
        .collect();
    by_mean.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    println!("per-profession pooled mean employer count (below 5 shown first):");
    for (p, mean) in &by_mean {
        if *mean < 8.0 {
            println!("  {p}: {mean:.2}");
        }
    }
    Stats::new(barista_employers).print("barista_employers_per_city");
    Stats::new(deep_profession_count)
        .print("professions_employed_by_5_plus_workplaces_per_city (Scale Baseline target ~69)");

    // -- story 15.9: the missing-cafe flake, generalised -----------------
    let missing_tag_seed_count: u64 = std::env::args()
        .nth(1)
        .map(|s| {
            s.parse()
                .unwrap_or_else(|e| panic!("seed count argument {s:?} is not a u64: {e}"))
        })
        .unwrap_or(MISSING_TAG_SEED_COUNT_DEFAULT);
    // Mirrors `inv_generation_required_institutions_are_present_when_
    // their_own_target_is_nonzero`'s own generic distribution loop, plus
    // its hand-named list of tags no `[[distribution]]` row covers --
    // `cafe` left that list in story 15.9 (it is a distribution row now)
    // so only `shop` remains.
    const AD_HOC_PRESENCE_TAGS: &[&str] = &["shop"];
    let dist_rows = &dist_rows_for_ratio[..];
    let ad_hoc_tag_ids: Vec<(&str, u32)> = AD_HOC_PRESENCE_TAGS
        .iter()
        .map(|&key| {
            let id = defs::TAGS
                .iter()
                .find(|t| t.key == key)
                .unwrap_or_else(|| panic!("committed tags must carry a '{key}' entry"))
                .id;
            (key, id)
        })
        .collect();

    println!(
        "\nmissing-tag sweep: {missing_tag_seed_count} seeds (distinct from every sweep above -- \
         `cargo run -p bounds --release --bin measure-generation -- <n>` to change the count)"
    );
    let mut dist_misses: BTreeMap<&str, (u64, Vec<u64>)> = dist_rows
        .iter()
        .map(|r| (r.key, (0u64, Vec::new())))
        .collect();
    let mut ad_hoc_misses: BTreeMap<&str, (u64, Vec<u64>)> = ad_hoc_tag_ids
        .iter()
        .map(|&(key, _)| (key, (0u64, Vec::new())))
        .collect();

    for i in 0..missing_tag_seed_count {
        let seed = mixed_missing_tag_seed(i);
        let d = sim::generation::plan(seed, cfg, content).expect("pass 1 is total");
        let mut tag_counts: BTreeMap<u32, u64> = BTreeMap::new();
        for a in d.building_types.assignments() {
            for &t in by_id[&a.building_type].tags {
                *tag_counts.entry(t).or_insert(0) += 1;
            }
        }
        for row in dist_rows {
            let basis = tag_counts.get(&row.per).copied().unwrap_or(0);
            let target = basis / (row.ratio.smallest() as u64);
            if target == 0 {
                continue;
            }
            let actual = tag_counts.get(&row.subject).copied().unwrap_or(0);
            if actual == 0 {
                let entry = dist_misses.get_mut(row.key).unwrap();
                entry.0 += 1;
                if entry.1.len() < 10 {
                    entry.1.push(seed);
                }
            }
        }
        for &(key, tag_id) in &ad_hoc_tag_ids {
            if tag_counts.get(&tag_id).copied().unwrap_or(0) == 0 {
                let entry = ad_hoc_misses.get_mut(key).unwrap();
                entry.0 += 1;
                if entry.1.len() < 10 {
                    entry.1.push(seed);
                }
            }
        }
    }

    println!("distribution rows -- seeds with target >= 1 but 0 actually placed:");
    for row in dist_rows {
        let (count, seeds) = &dist_misses[row.key];
        println!(
            "  {}: {count} of {missing_tag_seed_count} (rate {:.6}%), offending seeds: {:?}",
            row.key,
            *count as f64 * 100.0 / missing_tag_seed_count as f64,
            seeds
        );
    }
    println!("ad hoc presence tags (never distributed) -- seeds with 0 placed:");
    for &(key, _) in &ad_hoc_tag_ids {
        let (count, seeds) = &ad_hoc_misses[key];
        println!(
            "  {key}: {count} of {missing_tag_seed_count} (rate {:.6}%), offending seeds: {:?}",
            *count as f64 * 100.0 / missing_tag_seed_count as f64,
            seeds
        );
    }

    // -- story 15.10: the detour-ratio flake, generalised -----------------
}
