//! The per-seed guard figures the any-seed proptests and
//! `measure-generation` both read, so a sweep measures exactly what CI
//! asserts and never a second hand-written copy. Each function returns the
//! measured figure; the caller compares it with its balance key.

use std::collections::BTreeMap;

use super::interiors::{Interior, Vocabulary};
use super::land_use::{LandUse, LandUseMap};
use super::neighbourhoods::{Dials, corner};
use super::{District, DistrictSite, GenerationConfig, GenerationContent, Skeleton, site};
use crate::rules::RuleSite as _;
use crate::world::Rect;

/// The cities the pool-based invariants judge per run by default
/// (`GENERATION_CITY_POOL` overrides it); the sweep blocks that stand in
/// for them size their implied failure probability by it.
pub const CITY_POOL_SIZE: u32 = 96;

/// The pooled enterable-share band `(lo, hi)` in thousandths of a percent
/// at `pool` cities. `tolerance` is the committed half-width at
/// [`CITY_POOL_SIZE`] cities; a smaller pool's share is noisier by
/// `sqrt(CITY_POOL_SIZE / pool)`, so the half-width widens by the same
/// factor and the band stays the same number of standard errors wide at
/// every pool size CI judges it at. Never narrower than committed.
pub fn pooled_share_band_x1000(target: i64, tolerance: i64, pool: u64) -> (i64, i64) {
    let scaled = (u64::from(CITY_POOL_SIZE) * 1_000_000 / pool.max(1)).isqrt() as i64;
    let half = tolerance * scaled.max(1000);
    (target * 1000 - half, target * 1000 + half)
}

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

// --- pass 6 (story 3.5): the per-city interior guards -----------------

/// The tag ids of the four required kinds (dwelling, shop, cafe and the
/// staff room that makes an institutional back room), resolved by the
/// caller: the generator names no content key.
#[derive(Debug, Clone, Copy)]
pub struct KindTags {
    pub dwelling: u32,
    pub shop: u32,
    pub cafe: u32,
    pub staff: u32,
}

/// The cells a body can stand on -- room floor not holding a fixture,
/// every threshold and every approach cell -- as a dense grid over the
/// footprint and its approach, and a flood fill from the street. Only
/// what the sub-cell walkability check cannot say: whether a fixture has
/// a cell beside it to act from.
pub struct Walk {
    pub x0: i32,
    y0: i32,
    w: usize,
    h: usize,
    walkable: Vec<bool>,
    reached: Vec<bool>,
}

impl Walk {
    pub fn of(i: &Interior) -> Walk {
        let b = interior_bounds(i);
        let (w, h) = (b.width() as usize, b.height() as usize);
        let mut walk = Walk {
            x0: b.x0,
            y0: b.y0,
            w,
            h,
            walkable: vec![false; w * h],
            reached: vec![false; w * h],
        };
        for r in &i.rooms {
            for y in r.rect.y0..r.rect.y1 {
                for x in r.rect.x0..r.rect.x1 {
                    let ix = walk.ix(x, y).unwrap();
                    walk.walkable[ix] = true;
                }
            }
        }
        for f in &i.fixtures {
            let ix = walk.ix(f.x, f.y).unwrap();
            walk.walkable[ix] = false;
        }
        for t in &i.thresholds {
            let ix = walk.ix(t.x, t.y).unwrap();
            walk.walkable[ix] = true;
        }
        for &(x, y) in &i.approach {
            let ix = walk.ix(x, y).unwrap();
            walk.walkable[ix] = true;
        }
        if let Some(&(sx, sy)) = i.approach.first() {
            walk.flood(sx, sy);
        }
        walk
    }

    fn ix(&self, x: i32, y: i32) -> Option<usize> {
        let (dx, dy) = (x - self.x0, y - self.y0);
        (dx >= 0 && dy >= 0 && (dx as usize) < self.w && (dy as usize) < self.h)
            .then(|| dy as usize * self.w + dx as usize)
    }

    fn flood(&mut self, sx: i32, sy: i32) {
        let Some(start) = self.ix(sx, sy) else {
            return;
        };
        if !self.walkable[start] {
            return;
        }
        let mut stack = vec![start];
        self.reached[start] = true;
        while let Some(i) = stack.pop() {
            let (x, y) = (self.x0 + (i % self.w) as i32, self.y0 + (i / self.w) as i32);
            for (nx, ny) in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] {
                if let Some(n) = self.ix(nx, ny)
                    && self.walkable[n]
                    && !self.reached[n]
                {
                    self.reached[n] = true;
                    stack.push(n);
                }
            }
        }
    }

    /// Whether a body walking from the street reaches `(x, y)`.
    pub fn reaches(&self, x: i32, y: i32) -> bool {
        self.ix(x, y).is_some_and(|i| self.reached[i])
    }

    /// Whether `(x, y)` has a reachable walkable cell beside it.
    pub fn reachable_beside(&self, x: i32, y: i32) -> bool {
        [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
            .iter()
            .any(|&(nx, ny)| self.reaches(nx, ny))
    }

    pub fn reaches_any_of(&self, r: Rect) -> bool {
        (r.y0..r.y1).any(|y| (r.x0..r.x1).any(|x| self.reaches(x, y)))
    }
}

/// The footprint and its approach, plus one cell of margin.
pub fn interior_bounds(i: &Interior) -> Rect {
    let mut b = i.footprint;
    for &(x, y) in &i.approach {
        b.x0 = b.x0.min(x);
        b.y0 = b.y0.min(y);
        b.x1 = b.x1.max(x + 1);
        b.y1 = b.y1.max(y + 1);
    }
    Rect {
        x0: b.x0 - 1,
        y0: b.y0 - 1,
        x1: b.x1 + 1,
        y1: b.y1 + 1,
    }
}

/// The test's own enterable predicate, computed from emitted cells and
/// never from a flag the generator sets on itself: a body can walk from
/// the pavement cell outside the entrance to a floor cell of every room,
/// beside every fixture, and every fixture a room owes is present.
pub fn is_enterable(i: &Interior, content: &GenerationContent, vocab: &Vocabulary) -> bool {
    let walk = Walk::of(i);
    if i.approach.is_empty() {
        return false;
    }
    for r in &i.rooms {
        if !walk.reaches_any_of(r.rect) {
            return false;
        }
    }
    for f in &i.fixtures {
        if !walk.reachable_beside(f.x, f.y) {
            return false;
        }
    }
    let parts = vocab.parts;
    let structural = [
        parts.wall,
        parts.wall_run,
        parts.floor,
        parts.threshold,
        parts.entrance,
        parts.pavement,
        parts.fixture,
    ];
    for (idx, r) in i.rooms.iter().enumerate() {
        let room_def = content
            .room_types
            .iter()
            .find(|d| d.id == r.room_type)
            .unwrap();
        for row in content.rules.iter().filter_map(|r| r.as_requirement()) {
            let carried = room_def.tags.contains(&row.container) || row.container == parts.floor;
            if !carried || structural.contains(&row.requires) {
                continue;
            }
            let have = i
                .fixtures
                .iter()
                .filter(|f| f.room == idx && f.tag == row.requires)
                .count() as u32;
            if have < row.min {
                return false;
            }
        }
    }
    true
}

/// AC3's kind-spread verdict over counts the caller computed from emitted
/// output: kind order dwelling, shop, cafe, back room. Per kind: how many
/// pass 5 placed, how many are enterable. A pure function so the negative
/// case ("97 flats and one of each other kind") is exercised without a
/// city.
pub fn kind_spread_verdict(
    placed: [i64; 4],
    enterable: [i64; 4],
    total_enterable: i64,
    cfg: &GenerationConfig,
) -> Result<(), String> {
    // Kind order is the caller's `KindTags`: dwelling, shop, cafe, back
    // room -- the generator names no content key.
    let names = ["kind 0", "kind 1", "kind 2", "kind 3"];
    for k in 0..4 {
        if enterable[k] < 1 {
            return Err(format!("no enterable {}", names[k]));
        }
        if enterable[k] * 100 < placed[k] * cfg.interior_kind_min_enterable_percent[k] {
            return Err(format!(
                "only {} of {} {}s are enterable, under {}%",
                enterable[k], placed[k], names[k], cfg.interior_kind_min_enterable_percent[k]
            ));
        }
        if enterable[k] * 100 > total_enterable * cfg.interior_max_kind_share_percent {
            return Err(format!(
                "{} is {} of {} enterable, over the {}% share ceiling",
                names[k], enterable[k], total_enterable, cfg.interior_max_kind_share_percent
            ));
        }
    }
    Ok(())
}

/// Per kind: (placed, enterable) over one district, plus whether any
/// enterable dwelling sits in the lowest density band.
pub fn kind_counts(
    d: &District,
    content: &GenerationContent,
    cfg: &GenerationConfig,
    tags: &KindTags,
) -> ([i64; 4], [i64; 4], bool) {
    let by_id: std::collections::BTreeMap<u32, &crate::generated::defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let (dwelling, shop, cafe, staff) = (tags.dwelling, tags.shop, tags.cafe, tags.staff);
    let room_tags: std::collections::BTreeMap<u32, &[u32]> =
        content.room_types.iter().map(|r| (r.id, r.tags)).collect();
    let span = (cfg.density_max - cfg.density_min).max(1);
    let low_max = cfg.density_min + span / 3;
    let enterable_plots: std::collections::BTreeMap<u32, &Interior> =
        d.interiors.laid().map(|(plot, _, i)| (plot, i)).collect();
    let (mut placed, mut enterable) = ([0i64; 4], [0i64; 4]);
    let mut low_band_dwelling = false;
    for a in d.skeleton.building_types.assignments() {
        let def = by_id[&a.building_type];
        // A type with no room program is a deliberate Shell (a vacant
        // unit carries the shop tag and no posts): it is nobody's
        // enterable kind, so it is not "placed" for the share either.
        if def.rooms.is_empty() {
            continue;
        }
        let interior = enterable_plots.get(&a.plot);
        let kinds = [
            def.tags.contains(&dwelling),
            def.tags.contains(&shop),
            def.tags.contains(&cafe),
            // An institutional back room: a staff room in a type sited on
            // institutional land use.
            def.land_uses[3]
                && interior.is_some_and(|i| {
                    i.rooms
                        .iter()
                        .any(|r| room_tags[&r.room_type].contains(&staff))
                }),
        ];
        let sited_institutional = def.land_uses[3];
        for k in 0..4 {
            if kinds[k] {
                placed[k] += 1;
                if interior.is_some() {
                    enterable[k] += 1;
                }
            } else if k == 3 && sited_institutional {
                // A rejected or shell institutional-land type still counts
                // as placed for the back-room share.
                placed[3] += 1;
            }
        }
        if kinds[0]
            && interior.is_some()
            && d.skeleton.plots.plots()[a.plot as usize].density <= low_max
        {
            low_band_dwelling = true;
        }
    }
    (placed, enterable, low_band_dwelling)
}

/// Every figure the per-city interior invariants judge, for one district.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InteriorFigures {
    /// Most layout attempts any building used.
    pub max_attempts: u32,
    /// The rejected share of attempted layouts, percent.
    pub rejected_percent: i64,
    /// Interiors that are enterable by their own cells.
    pub enterable: i64,
    /// Per kind (dwelling, shop, cafe, back room): placed and enterable.
    pub placed: [i64; 4],
    pub kind_enterable: [i64; 4],
    /// Interiors laid out (the set the share ceiling is a share of).
    pub laid: i64,
    pub low_band_dwelling: bool,
    /// The largest room aspect, `long * 100 / short`.
    pub max_room_aspect_x100: i64,
}

/// Measures `d` for every per-city interior key.
pub fn interior_figures(
    d: &District,
    content: &GenerationContent,
    cfg: &GenerationConfig,
    tags: &KindTags,
) -> InteriorFigures {
    let vocab = Vocabulary::new(content);
    let mut max_attempts = 0u32;
    for o in d.interiors.outcomes() {
        if let super::interiors::InteriorOutcome::Laid { attempts, .. }
        | super::interiors::InteriorOutcome::Rejected { attempts, .. } = o
        {
            max_attempts = max_attempts.max(*attempts);
        }
    }
    let enterable = d
        .interiors
        .laid()
        .filter(|(_, _, i)| is_enterable(i, content, &vocab))
        .count() as i64;
    let (placed, kind_enterable, low_band_dwelling) = kind_counts(d, content, cfg, tags);
    let mut max_room_aspect_x100 = 0i64;
    for (_, _, i) in d.interiors.laid() {
        for r in &i.rooms {
            let (w, h) = (r.rect.width(), r.rect.height());
            max_room_aspect_x100 = max_room_aspect_x100.max(w.max(h) * 100 / w.min(h).max(1));
        }
    }
    InteriorFigures {
        max_attempts,
        rejected_percent: d.interiors.rejected_percent(),
        enterable,
        placed,
        kind_enterable,
        laid: d.interiors.enterable_count(),
        low_band_dwelling,
        max_room_aspect_x100,
    }
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

    #[test]
    fn is_enterable_reads_the_emitted_cells_and_fails_on_a_broken_interior() {
        let (cfg, content) = setup();
        let d = plan(1, &cfg, &content).unwrap();
        let vocab = Vocabulary::new(&content);
        let laid: Vec<_> = d.interiors.laid().collect();
        assert!(!laid.is_empty());
        assert!(
            laid.iter()
                .all(|(_, _, i)| is_enterable(i, &content, &vocab)),
            "every laid interior of a committed seed is enterable"
        );
        let (_, _, i) = laid[0];
        let mut no_approach = i.clone();
        no_approach.approach.clear();
        assert!(!is_enterable(&no_approach, &content, &vocab));
        let mut no_fixtures = i.clone();
        no_fixtures.fixtures.clear();
        assert!(
            !is_enterable(&no_fixtures, &content, &vocab),
            "a room owing a fixture without it is not enterable"
        );
    }

    #[test]
    fn the_pooled_band_is_the_committed_one_at_the_ci_pool_and_wider_below_it() {
        assert_eq!(pooled_share_band_x1000(98, 1, 96), (97_000, 99_000));
        assert_eq!(pooled_share_band_x1000(98, 1, 8), (94_536, 101_464));
        assert_eq!(pooled_share_band_x1000(98, 1, 1000), (97_000, 99_000));
        let (lo, hi) = pooled_share_band_x1000(98, 1, 8);
        assert!(lo < 97_000 && hi > 99_000);
    }

    #[test]
    fn kind_spread_verdict_names_each_way_a_city_fails() {
        let (cfg, _) = setup();
        let ok = kind_spread_verdict([50, 30, 10, 10], [50, 30, 10, 10], 100, &cfg);
        assert_eq!(ok, Ok(()));
        let missing = kind_spread_verdict([50, 30, 10, 10], [50, 30, 10, 0], 90, &cfg);
        assert!(missing.unwrap_err().contains("no enterable kind 3"));
        let thin = kind_spread_verdict([50, 30, 10, 10], [50, 30, 10, 5], 95, &cfg);
        assert!(thin.unwrap_err().contains("under"));
        let dominant = kind_spread_verdict([97, 1, 1, 1], [97, 1, 1, 1], 100, &cfg);
        assert!(dominant.unwrap_err().contains("share ceiling"));
    }
}
