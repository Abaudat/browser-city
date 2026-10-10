//! The per-seed guard figures the any-seed proptests and
//! `measure-generation` both read, so a sweep measures exactly what CI
//! asserts and never a second hand-written copy. Each function returns the
//! measured figure; the caller compares it with its balance key.

use std::collections::BTreeMap;

use super::land_use::{LandUse, LandUseMap};
use super::neighbourhoods::{Dials, corner};
use super::{DistrictSite, GenerationConfig, GenerationContent, Skeleton, site};
use crate::rules::RuleSite as _;
use crate::world::Rect;

fn adjacent(a: Rect, b: Rect) -> bool {
    let overlap_y = a.y1.min(b.y1) - a.y0.max(b.y0);
    let overlap_x = a.x1.min(b.x1) - a.x0.max(b.x0);
    ((a.x1 == b.x0 || b.x1 == a.x0) && overlap_y > 0)
        || ((a.y1 == b.y0 || b.y1 == a.y0) && overlap_x > 0)
}

/// Distinct patches with their dials, in patch order.
pub fn patches(d: &Skeleton) -> Vec<(usize, Dials, Vec<Rect>)> {
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

/// The balance values the district-character guard reads.
#[derive(Debug, Clone, Copy)]
pub struct CharacterParams {
    pub legible_step: i32,
    pub min_corners: usize,
    pub min_apart_neighbourhoods: usize,
    pub poor_band_max: i32,
}

/// The first way `d` fails to show its guaranteed character (somewhere
/// affordable that holds dwellings, a legible step between adjacent patches
/// on each dial, enough corners, enough patches pairwise a legible step
/// apart), `None` when it shows all of it.
pub fn character_violation(
    d: &Skeleton,
    cfg: &GenerationConfig,
    content: &GenerationContent,
    p: &CharacterParams,
) -> Option<String> {
    let nc = cfg.neighbourhood;
    let ps = patches(d);
    let step = p.legible_step;
    let mut aff_step = false;
    let mut age_step = false;
    for (i, (_, a, ra)) in ps.iter().enumerate() {
        for (_, b, rb) in &ps[i + 1..] {
            if patches_adjacent(ra, rb) {
                aff_step |= (a.affluence <= nc.poor_to() && b.affluence >= nc.rich_from())
                    || (b.affluence <= nc.poor_to() && a.affluence >= nc.rich_from());
                age_step |= (a.building_age - b.building_age).abs() >= step;
            }
        }
    }
    if !aff_step {
        return Some("no adjacent pair in opposite end thirds on affluence".into());
    }
    if !age_step {
        return Some("no adjacent pair a legible step apart on age".into());
    }
    let corners: std::collections::BTreeSet<_> = ps
        .iter()
        .filter_map(|(_, dials, _)| corner(*dials, &nc))
        .collect();
    if corners.len() < p.min_corners {
        return Some(format!("only {} of the four corners", corners.len()));
    }
    // The largest set of patches pairwise a legible step apart on some dial.
    let far = |a: &Dials, b: &Dials| {
        (a.affluence - b.affluence).abs() >= step || (a.building_age - b.building_age).abs() >= step
    };
    let n = ps.len();
    let mut apart = 0usize;
    for mask in 0u32..(1 << n) {
        let members: Vec<usize> = (0..n).filter(|i| mask >> i & 1 == 1).collect();
        if members.len() > apart
            && members
                .iter()
                .enumerate()
                .all(|(i, &a)| members[i + 1..].iter().all(|&b| far(&ps[a].1, &ps[b].1)))
        {
            apart = members.len();
        }
    }
    if apart < p.min_apart_neighbourhoods {
        return Some(format!("only {apart} neighbourhoods a legible step apart"));
    }
    let by_id: BTreeMap<u32, &crate::generated::defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let homes_in_poor_band = d
        .envelopes
        .envelopes()
        .zip(d.building_types.assignments())
        .any(|(e, a)| {
            let (x, y) = site::front_cell(e.footprint, e.front);
            let params = d.land_use.at_world(x, y).unwrap();
            params.affluence <= p.poor_band_max
                && by_id[&a.building_type].land_uses[LandUse::Residential as usize]
        });
    if !homes_in_poor_band {
        return Some("no dwelling in the bottom affluence band".into());
    }
    None
}

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

/// The total-variation distance (percent) of the closest qualifying pair
/// for each carrier, with the patch pair that attains it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Legibility {
    /// Pairs a legible step apart on affluence, shop mix.
    pub affluence_shop_mix: Option<(i64, usize, usize)>,
    /// Pairs in opposite end thirds of affluence, realised shop mix.
    pub pole_shop_mix: Option<(i64, usize, usize)>,
    /// Pairs a legible step apart on age, building-age mix.
    pub age_distance: Option<(i64, usize, usize)>,
}

fn keep_min(slot: &mut Option<(i64, usize, usize)>, v: i64, p: usize, q: usize) {
    if slot.is_none_or(|(m, _, _)| v < m) {
        *slot = Some((v, p, q));
    }
}

/// Two neighbourhoods a legible step apart differ, without any label, in a
/// carrier a player can see: the minimum over qualifying pairs of each
/// carrier's total-variation distance. A pair counts for the shop-mix
/// carriers only when both patches hold at least `min_shops` commercial
/// frontages.
pub fn legibility(
    d: &Skeleton,
    cfg: &GenerationConfig,
    content: &GenerationContent,
    step: i32,
    min_shops: u64,
) -> Legibility {
    type Histograms = BTreeMap<usize, BTreeMap<i64, u64>>;
    let by_id: BTreeMap<u32, &crate::generated::defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let (mut frontage, mut ages): (Histograms, Histograms) = Default::default();
    for (e, a, s) in d
        .envelopes
        .envelopes()
        .zip(d.building_types.assignments())
        .zip(d.building_types.states())
        .map(|((e, a), s)| (e, a, s))
    {
        let (x, y) = site::front_cell(e.footprint, e.front);
        let patch = d.land_use.neighbourhood_at(x, y).unwrap().patch;
        *ages
            .entry(patch)
            .or_default()
            .entry((s.building_age / 10) as i64)
            .or_insert(0) += 1;
        if by_id[&a.building_type].land_uses[LandUse::Commercial as usize] {
            *frontage
                .entry(patch)
                .or_default()
                .entry(a.building_type as i64)
                .or_insert(0) += 1;
        }
    }
    let nc = cfg.neighbourhood;
    let empty = BTreeMap::new();
    let count = |p: usize| {
        frontage
            .get(&p)
            .map(|m| m.values().sum::<u64>())
            .unwrap_or(0)
    };
    let mut out = Legibility::default();
    let ps = patches(d);
    for (i, (p, a, _)) in ps.iter().enumerate() {
        for (q, b, _) in &ps[i + 1..] {
            let tv = |h: &Histograms| {
                total_variation(h.get(p).unwrap_or(&empty), h.get(q).unwrap_or(&empty))
            };
            let both_shopped = count(*p) >= min_shops && count(*q) >= min_shops;
            if (a.affluence - b.affluence).abs() >= step && both_shopped {
                keep_min(&mut out.affluence_shop_mix, tv(&frontage), *p, *q);
            }
            let poles = (a.affluence <= nc.poor_to() && b.affluence >= nc.rich_from())
                || (b.affluence <= nc.poor_to() && a.affluence >= nc.rich_from());
            if poles && both_shopped {
                keep_min(&mut out.pole_shop_mix, tv(&frontage), *p, *q);
            }
            if (a.building_age - b.building_age).abs() >= step {
                keep_min(&mut out.age_distance, tv(&ages), *p, *q);
            }
        }
    }
    out
}

/// The citizens one screen supports at the district's commercial core (the
/// top density third) and at its residential edge (the bottom third).
pub fn core_and_edge(
    d: &Skeleton,
    cfg: &GenerationConfig,
    content: &GenerationContent,
) -> (u64, u64) {
    let span = cfg.density_max - cfg.density_min;
    let core = d
        .citizens_per_screen(
            LandUse::Commercial,
            cfg.density_max - span / 3..=cfg.density_max,
            cfg,
            content,
        )
        .expect("every district has a commercial core");
    let edge = d
        .citizens_per_screen(
            LandUse::Residential,
            cfg.density_min..=cfg.density_min + span / 3,
            cfg,
            content,
        )
        .expect("every district has a residential edge");
    (core, edge)
}

/// The institutional pockets of a land-use map.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pockets {
    /// Institutional components.
    pub count: usize,
    /// The largest component's coarse cells, and the site's coarse cells.
    pub largest_cells: i64,
    pub total_cells: i64,
    /// Two different components touching (edge or corner): where.
    pub touching: Option<((i32, i32), (i32, i32))>,
}

impl Pockets {
    /// The largest pocket's share of the site, in hundredths of a percent.
    pub fn largest_share_basis_points(&self) -> i64 {
        self.largest_cells * 10_000 / self.total_cells.max(1)
    }
}

/// The institutional components of `lu`: count, largest, and whether two
/// touch by real per-cell adjacency (not bounding boxes).
pub fn institutional_pockets(lu: &LandUseMap) -> Pockets {
    let total_cells = i64::from(lu.cols()) * i64::from(lu.rows());
    let (regions, labels) = lu.labeled_regions();
    let inst: Vec<_> = regions
        .iter()
        .filter(|r| r.use_ == LandUse::Institutional)
        .collect();
    let mut touching = None;
    'scan: for cy in 0..lu.rows() {
        for cx in 0..lu.cols() {
            let label = labels[(cy * lu.cols() + cx) as usize];
            if regions[label as usize].use_ != LandUse::Institutional {
                continue;
            }
            for (nx, ny) in [
                (cx - 1, cy - 1),
                (cx, cy - 1),
                (cx + 1, cy - 1),
                (cx - 1, cy),
                (cx + 1, cy),
                (cx - 1, cy + 1),
                (cx, cy + 1),
                (cx + 1, cy + 1),
            ] {
                if nx < 0 || ny < 0 || nx >= lu.cols() || ny >= lu.rows() {
                    continue;
                }
                let other = labels[(ny * lu.cols() + nx) as usize];
                if other != label && regions[other as usize].use_ == LandUse::Institutional {
                    touching = Some(((cx, cy), (nx, ny)));
                    break 'scan;
                }
            }
        }
    }
    Pockets {
        count: inst.len(),
        largest_cells: inst.iter().map(|r| r.cell_count as i64).max().unwrap_or(0),
        total_cells,
        touching,
    }
}

/// The number of professions held by at least `min_employers` distinct
/// placed workplaces in one city.
pub fn profession_depth(d: &Skeleton, content: &GenerationContent, min_employers: u64) -> i64 {
    let by_id: BTreeMap<u32, &crate::generated::defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let mut employers: BTreeMap<&str, u64> = BTreeMap::new();
    for a in d.building_types.assignments() {
        let def = by_id[&a.building_type];
        if super::building_types::is_workplace(def) {
            for &p in def.professions {
                *employers.entry(p).or_insert(0) += 1;
            }
        }
    }
    employers.values().filter(|&&c| c >= min_employers).count() as i64
}

/// Commercial frontage counts by affluence third: `(shuttered, frontage)`
/// for the bottom and top thirds, accumulated over districts.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Shuttered {
    pub poor: (u64, u64),
    pub rich: (u64, u64),
}

impl Shuttered {
    /// Adds `d`'s commercial frontage; a frontage carrying no post is
    /// shuttered.
    pub fn add(&mut self, d: &Skeleton, cfg: &GenerationConfig, content: &GenerationContent) {
        let nc = cfg.neighbourhood;
        let by_id: BTreeMap<u32, &crate::generated::defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();
        for (e, a) in d.envelopes.envelopes().zip(d.building_types.assignments()) {
            let def = by_id[&a.building_type];
            if !def.land_uses[LandUse::Commercial as usize] {
                continue;
            }
            let (x, y) = site::front_cell(e.footprint, e.front);
            let affluence = d.land_use.at_world(x, y).unwrap().affluence;
            let bucket = if affluence <= nc.poor_to() {
                &mut self.poor
            } else if affluence >= nc.rich_from() {
                &mut self.rich
            } else {
                continue;
            };
            bucket.1 += 1;
            bucket.0 += u64::from(def.professions.is_empty());
        }
    }
}

/// `(biting, pairs)` over the (catchment, subject) targets `row` owes in
/// `site`: how many have a lower bound of at least one.
pub fn catchment_bite(site: &DistrictSite, row: &crate::rules::DistributionRow) -> (u64, u64) {
    let read = match row.ratio {
        crate::rules::RowRatio::Read(r) => Some(r.parameter),
        crate::rules::RowRatio::Fixed(_) => None,
    };
    let (mut biting, mut pairs) = (0u64, 0u64);
    for t in row
        .targets(
            site.subjects_in_area(None, row.per)
                .iter()
                .map(|&c| (c, read.and_then(|p| site.parameter_at(c, p)))),
        )
        .values()
    {
        pairs += 1;
        biting += u64::from(t.lower >= 1);
    }
    (biting, pairs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::defs;
    use crate::generation::land_use::{LandUseCell, LandUseMap};
    use crate::generation::{plan, plan_skeleton};

    fn setup() -> (GenerationConfig, GenerationContent<'static>) {
        (
            GenerationConfig::from_balance(defs::BALANCE).unwrap(),
            GenerationContent::committed(),
        )
    }

    fn n(name: &str) -> i64 {
        crate::balance::value(defs::BALANCE, &format!("generation.neighbourhood.{name}"))
    }

    fn committed_params() -> CharacterParams {
        CharacterParams {
            legible_step: n("legible_step") as i32,
            min_corners: n("min_corners") as usize,
            min_apart_neighbourhoods: n("min_apart_neighbourhoods") as usize,
            poor_band_max: n("poor_band_max") as i32,
        }
    }

    #[test]
    fn character_violation_is_none_at_the_committed_params_and_names_each_impossible_demand() {
        let (cfg, content) = setup();
        let d = plan_skeleton(1, &cfg, &content).unwrap();
        let p = committed_params();
        assert_eq!(character_violation(&d, &cfg, &content, &p), None);
        let corners = character_violation(
            &d,
            &cfg,
            &content,
            &CharacterParams {
                min_corners: 5,
                ..p
            },
        );
        assert!(corners.unwrap().contains("corners"));
        let apart = character_violation(
            &d,
            &cfg,
            &content,
            &CharacterParams {
                min_apart_neighbourhoods: 99,
                ..p
            },
        );
        assert!(apart.unwrap().contains("legible step apart"));
        let step = character_violation(
            &d,
            &cfg,
            &content,
            &CharacterParams {
                legible_step: 10_000,
                ..p
            },
        );
        assert!(step.unwrap().contains("age"));
        let poor = character_violation(
            &d,
            &cfg,
            &content,
            &CharacterParams {
                poor_band_max: i32::MIN,
                ..p
            },
        );
        assert!(poor.unwrap().contains("bottom affluence band"));
    }

    #[test]
    fn legibility_reports_figures_a_threshold_can_fall_under() {
        let (cfg, content) = setup();
        let (step, shops) = (n("legible_step") as i32, n("legibility_min_shops") as u64);
        let mut shop = Vec::new();
        for seed in 1..=3u64 {
            let d = plan_skeleton(seed, &cfg, &content).unwrap();
            let l = legibility(&d, &cfg, &content, step, shops);
            if let Some((v, _, _)) = l.affluence_shop_mix {
                shop.push(v);
            }
            let (age, _, _) = l.age_distance.expect("a pair a legible step apart on age");
            assert!((0..=100).contains(&age));
        }
        assert!(!shop.is_empty(), "no seed had a qualifying shop-mix pair");
        // The figure is a real distance: under 100 for some pair, so a
        // threshold of 101 would be missed and one of 0 never.
        assert!(shop.iter().any(|&v| v < 100), "{shop:?}");
        // No pair qualifies once the legible step is out of range.
        let d = plan_skeleton(1, &cfg, &content).unwrap();
        let none = legibility(&d, &cfg, &content, 10_000, shops);
        assert_eq!(none.affluence_shop_mix, None);
        assert_eq!(none.age_distance, None);
    }

    #[test]
    fn core_and_edge_are_busy_and_quieter_on_the_evidence_seeds() {
        let (cfg, content) = setup();
        for seed in 1..=3u64 {
            let d = plan_skeleton(seed, &cfg, &content).unwrap();
            let (core, edge) = core_and_edge(&d, &cfg, &content);
            assert!(core > 0, "seed {seed}");
            assert!(edge < core, "seed {seed}: edge {edge} core {core}");
        }
    }

    fn pocket_map() -> LandUseMap {
        let (mut cfg, _) = setup();
        cfg.site_extent_cells = 50 * 4;
        cfg.coarse_cell_size_cells = 50;
        let u = LandUse::Institutional;
        let r = LandUse::Residential;
        // 4 x 3: A at (0,0) touches B at (1,1) by a corner; C is the
        // whole right column.
        #[rustfmt::skip]
        let uses = [
            u, r, r, u,
            r, u, r, u,
            r, r, r, u,
        ];
        let cells = uses
            .iter()
            .map(|&use_| LandUseCell { use_, density: 50 })
            .collect();
        LandUseMap::test_fixture(cfg.site(), 50, 4, 3, 0, 0, cells)
    }

    #[test]
    fn institutional_pockets_reports_the_touch_the_count_and_the_largest_share() {
        let p = institutional_pockets(&pocket_map());
        assert_eq!(p.count, 3);
        assert_eq!(p.largest_cells, 3);
        assert_eq!(p.total_cells, 12);
        assert_eq!(p.largest_share_basis_points(), 2500);
        assert_eq!(p.touching, Some(((0, 0), (1, 1))));
    }

    #[test]
    fn institutional_pockets_sees_no_touch_on_a_committed_seed() {
        let (cfg, content) = setup();
        let d = plan_skeleton(1, &cfg, &content).unwrap();
        let p = institutional_pockets(&d.land_use);
        assert!(p.touching.is_none());
        assert!(p.count as i64 >= cfg.institutional_min_pockets);
    }

    #[test]
    fn profession_depth_counts_professions_held_by_enough_workplaces() {
        let (cfg, content) = setup();
        let d = plan_skeleton(1, &cfg, &content).unwrap();
        assert_eq!(profession_depth(&d, &content, 1_000_000), 0);
        let at_one = profession_depth(&d, &content, 1);
        let at_committed = profession_depth(
            &d,
            &content,
            crate::balance::value(
                defs::BALANCE,
                "generation.building_types.min_employers_per_profession",
            ) as u64,
        );
        assert!(at_one >= at_committed && at_committed > 0);
        assert_eq!((at_one, at_committed), (67, 60));
    }

    #[test]
    fn catchment_bite_is_a_known_count_on_one_row_of_one_seed() {
        let (cfg, content) = setup();
        let d = plan(1, &cfg, &content).unwrap();
        let row = content
            .rules
            .iter()
            .filter_map(|r| r.as_distribution())
            .find(|r| matches!(r.scope, crate::rules::DistributionScope::Catchment { .. }))
            .expect("a scoped row");
        let (biting, pairs) = catchment_bite(&d.site(&content), &row);
        assert!(pairs > 0 && biting <= pairs);
        assert_eq!((biting, pairs), (4, 4));
    }
}
