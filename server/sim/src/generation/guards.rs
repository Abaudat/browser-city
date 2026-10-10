//! The per-seed guard figures the any-seed proptests and
//! `measure-generation` both read, so a sweep measures exactly what CI
//! asserts and never a second hand-written copy. Each function returns the
//! measured figure; the caller compares it with its balance key.

use std::collections::BTreeMap;

use super::land_use::{LandUse, LandUseMap};
use super::neighbourhoods::{Dials, corner};
use super::{District, GenerationConfig, GenerationContent, site};
use crate::rules::RuleSite as _;
use crate::world::Rect;

fn adjacent(a: Rect, b: Rect) -> bool {
    let overlap_y = a.y1.min(b.y1) - a.y0.max(b.y0);
    let overlap_x = a.x1.min(b.x1) - a.x0.max(b.x0);
    ((a.x1 == b.x0 || b.x1 == a.x0) && overlap_y > 0)
        || ((a.y1 == b.y0 || b.y1 == a.y0) && overlap_x > 0)
}

/// Distinct patches with their dials, in patch order.
pub fn patches(d: &District) -> Vec<(usize, Dials, Vec<Rect>)> {
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
    d: &District,
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
    d: &District,
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
    d: &District,
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
pub fn profession_depth(d: &District, content: &GenerationContent, min_employers: u64) -> i64 {
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
    pub fn add(&mut self, d: &District, cfg: &GenerationConfig, content: &GenerationContent) {
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
/// `d`: how many have a lower bound of at least one.
pub fn catchment_bite(
    d: &District,
    content: &GenerationContent,
    row: &crate::rules::DistributionRow,
) -> (u64, u64) {
    let site = d.site(content);
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
