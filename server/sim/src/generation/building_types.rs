//! Pass 5 (FR110/FR116): the building-type pass. Receives every sealed
//! envelope pass 4 handed down; hands down what each building *is* -- a
//! `defs::BuildingTypeDef` id, never a Rust category. "Institution",
//! "workplace" and "residential" are all *derived* from a type's own
//! `tags`/`professions`, never stored here or branched on by key: this
//! module never contains a quoted building-type, tag, profession or
//! rule key literal (`check-generator-no-content-keys.sh`).
//!
//! Two passes over the placed envelopes, in this fixed order
//! ("constrained/distributed types first, then the weighted fill"),
//! practically resolved by computing the fill baseline first and letting
//! distribution overrides win: the baseline weighted fill gives every
//! envelope a type eligible for its own plot (land use, density band,
//! minimum interior, [`Context::site_context`]); the distribution rows
//! -- read generically through [`sim::rules::RuleDef::as_distribution`],
//! never by matching on the rule engine's own closed kind enum -- then
//! override a subset of envelopes onto a named institution, one row at a
//! time in ascending rule id order (a stable priority, never list
//! position). Each row's own `per`-tag basis is recomputed from the
//! placement so far immediately before that row runs, so a later row
//! always reads a real count, never an assumption about which types
//! carry which tag.
//!
//! AC2/story statement ("sited rather than sprinkled", Derek's
//! direction, PR #317 cycle 2): eligibility and siting are two
//! different questions. *Hard* eligibility ([`hard_eligible`]) is land
//! use, density band, minimum interior and `requires_site` -- a closed
//! structural vocabulary a candidate either has or does not
//! ([`Context::site_context`]: `corner`, and the street tier its own
//! front faces). *Soft* siting ([`rank_key`]) ranks otherwise-eligible
//! candidates for a distribution override by how many of the subject
//! type's own `prefers_site` contexts they match, then by
//! `density_affinity`, then by a seeded draw key -- ties are broken by
//! that draw key alone (effectively total, since it is a distinct
//! pseudo-random hash per envelope), never by a distance search ahead of
//! ranking.
//!
//! AC3 (even spread): a row's own site-wide target (`total per-tag count
//! / ratio`, the same figure `sim::rules::evaluate`'s own Distribution
//! check computes) is split into a *floor* per catchment -- a fixed-
//! extent square tiling the site (`GenerationConfig::building_type_
//! catchment_extent_cells`) -- and a *remainder* ([`catchment_floors`]):
//! each catchment owes exactly `floor(per-tag count in that catchment /
//! ratio)` and nothing else, so a catchment's own share is never
//! inflated by how many dwellings it happens to hold (Derek's direction,
//! cycle 2: proportional remainder allocation dragged civic buildings
//! toward the dwelling periphery, the opposite of "sited toward the
//! peak"). The remainder -- the units the floors do not account for --
//! is placed site-wide, by the same ranking. Both the per-catchment
//! floor and the site-wide remainder call the one [`place_row`], which
//! only ever removes a candidate for a real `min_spacing` violation --
//! never a reason to strand a catchment's own guaranteed floor below
//! what its own real, unused candidates could still satisfy, but also
//! never a reason to inflate one catchment's own share at another's
//! expense.
//!
//! Infallible, like passes 2-4: AC2/AC3's own presence/spread verdict is
//! a property of the finished district (`District::check_rules`, via
//! `sim::rules::evaluate`), never folded into placement -- an outlier
//! city's own placement can still be inspected.

use std::collections::BTreeMap;

use crate::generated::defs;
use crate::rng::{Rng, seed_from_ids};
use crate::rules::TagId;
use crate::world::Rect;

use super::envelopes::{Envelope, EnvelopeMap, row_bounds_by_block_front};
use super::plots::PlotMap;
use super::rect_seed_key;
use super::site::front_cell;
use super::streets::{self, Side, StreetNetwork};
use super::{GenerationConfig, SiteBounds};

pub const PASS_ID: u64 = super::PASS_BUILDING_TYPE;

/// One placed envelope's own assigned type -- `plot` is the same
/// [`super::plots::PlotMap`] index [`Envelope::plot`] carries, so a
/// caller can always join the two back up; `building_type` is a
/// `defs::BuildingTypeDef::id`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct TypeAssignment {
    pub plot: u32,
    pub building_type: u32,
}

/// Pass 5's own output: one [`TypeAssignment`] per placed envelope, in
/// exactly [`EnvelopeMap::envelopes`]'s own order -- [`DistrictSite::
/// build`](super::site::DistrictSite::build) zips the two rather than
/// re-joining by a lookup.
#[derive(Debug, Clone)]
pub struct BuildingTypeMap {
    assignments: Vec<TypeAssignment>,
}

impl BuildingTypeMap {
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn test_fixture(assignments: Vec<TypeAssignment>) -> Self {
        BuildingTypeMap { assignments }
    }

    pub fn assignments(&self) -> &[TypeAssignment] {
        &self.assignments
    }

    /// Every distinct building type this district places at least once,
    /// sorted and deduplicated.
    pub fn distinct_types(&self) -> Vec<u32> {
        let mut ids: Vec<u32> = self.assignments.iter().map(|a| a.building_type).collect();
        ids.sort_unstable();
        ids.dedup();
        ids
    }
}

/// The closed structural-vocabulary index [`Context::site_context`],
/// `defs::BuildingTypeDef::requires_site`/`prefers_site` all share --
/// `tools/defs-build`'s own `RawSiteContext::index` in the same order,
/// never a second ordering to keep in sync by hand.
mod site_context_index {
    pub const CORNER: usize = 0;
    pub const ARTERIAL: usize = 1;
    pub const STREET: usize = 2;
    pub const LANE: usize = 3;
}

/// One placed envelope's own structural context: everything eligibility
/// and siting read, computed once per envelope. Never a content key --
/// `land_use_idx` is [`super::LandUse as usize`], not a string.
#[derive(Debug, Clone, Copy)]
struct Context {
    land_use_idx: usize,
    density: i32,
    interior_width: i32,
    interior_depth: i32,
    /// `[corner, arterial, street, lane]` -- [`site_context_index`]'s
    /// own order. A plot geometry fact (`corner`) and the street tier
    /// this envelope's own front faces (at most one of the other three,
    /// `None` of them if that face touches no street edge at all, which
    /// a real placed envelope's own front never does).
    site_context: [bool; 4],
    x: i32,
    y: i32,
    catchment: (i32, i32),
}

/// The fixed-extent square [`Context::catchment`] an envelope's own
/// front cell falls in -- integer floor division, so every cell belongs
/// to exactly one catchment and no cell can land ambiguously on a
/// dividing line. At the committed 512-cell site and a 256-cell extent
/// this *is* AC3's own four quadrants; shared by the generator and
/// `inv_generation_no_quadrant_lacks_its_required_services` so the two
/// never compute it two different ways.
pub fn catchment_of(x: i32, y: i32, site: SiteBounds, extent: i32) -> (i32, i32) {
    let extent = extent.max(1);
    (
        (x - site.x0).div_euclid(extent),
        (y - site.y0).div_euclid(extent),
    )
}

/// Whether `plot_bounds`' own row-axis edge is a corner: the outer edge
/// of its own row (the union of every plot sharing its block and front)
/// *and* that perpendicular block side is itself street-abutting -- the
/// same "flush to both streets' own build lines" condition pass 4's own
/// corner handling already argues, read here rather than re-derived.
fn is_corner_envelope(
    plot_bounds: Rect,
    row_bounds: Rect,
    front: Side,
    sides: streets::Sides,
) -> bool {
    let (lo_is_row_edge, hi_is_row_edge, lo_side, hi_side) = match front {
        Side::North | Side::South => (
            plot_bounds.x0 == row_bounds.x0,
            plot_bounds.x1 == row_bounds.x1,
            Side::West,
            Side::East,
        ),
        Side::East | Side::West => (
            plot_bounds.y0 == row_bounds.y0,
            plot_bounds.y1 == row_bounds.y1,
            Side::North,
            Side::South,
        ),
    };
    (lo_is_row_edge && sides.get(lo_side)) || (hi_is_row_edge && sides.get(hi_side))
}

/// The [`streets::StreetClass`] of the one street edge touching
/// `block_bounds`' own `front` side along `footprint`'s own span on that
/// side -- `None` if no edge does (never true of a real placed
/// envelope's own front, since pass 3 only assigns a front to a street-
/// abutting plot side, but a hand-built fixture may leave it so). A
/// block face can carry more than one edge along its own length (a lane
/// split partway along it); the first match, in `edges`' own stable
/// order, is deterministic and -- since an envelope's own frontage is a
/// handful of cells against a street segment's own much longer run --
/// never ambiguous for a real generated footprint.
fn front_street_class(
    footprint: Rect,
    front: Side,
    block_bounds: Rect,
    edges: &[streets::StreetEdge],
) -> Option<streets::StreetClass> {
    for e in edges {
        let r = e.rect();
        let touches = match front {
            Side::North => r.y1 == block_bounds.y0 && r.x0 < footprint.x1 && footprint.x0 < r.x1,
            Side::South => r.y0 == block_bounds.y1 && r.x0 < footprint.x1 && footprint.x0 < r.x1,
            Side::West => r.x1 == block_bounds.x0 && r.y0 < footprint.y1 && footprint.y0 < r.y1,
            Side::East => r.x0 == block_bounds.x1 && r.y0 < footprint.y1 && footprint.y0 < r.y1,
        };
        if touches {
            return Some(e.class);
        }
    }
    None
}

fn site_context_of(corner: bool, street_class: Option<streets::StreetClass>) -> [bool; 4] {
    let mut ctx = [false; 4];
    ctx[site_context_index::CORNER] = corner;
    if let Some(class) = street_class {
        let idx = match class {
            streets::StreetClass::Arterial => site_context_index::ARTERIAL,
            streets::StreetClass::Street => site_context_index::STREET,
            streets::StreetClass::Lane => site_context_index::LANE,
        };
        ctx[idx] = true;
    }
    ctx
}

fn chebyshev(a: (i32, i32), b: (i32, i32)) -> u32 {
    (a.0 - b.0).unsigned_abs().max((a.1 - b.1).unsigned_abs())
}

/// Hard eligibility: land use, density band, minimum interior (checked
/// against the envelope's own interior net, footprint minus the wall
/// ring -- pass 4's own definition) and every `requires_site` context
/// the type demands (a subset check against [`Context::site_context`]:
/// every context the type sets must also be set on the envelope). Shared
/// by the baseline fill and every distribution override.
fn hard_eligible(b: &defs::BuildingTypeDef, ctx: &Context) -> bool {
    b.land_uses[ctx.land_use_idx]
        && ctx.density >= b.density_min
        && ctx.density <= b.density_max
        && (b.min_interior_width_cells as i32) <= ctx.interior_width
        && (b.min_interior_depth_cells as i32) <= ctx.interior_depth
        && (0..4).all(|i| !b.requires_site[i] || ctx.site_context[i])
}

fn recompute_per_counts(
    final_type: &[u32],
    by_id: &BTreeMap<u32, &defs::BuildingTypeDef>,
) -> BTreeMap<TagId, u64> {
    let mut per_counts: BTreeMap<TagId, u64> = BTreeMap::new();
    for &id in final_type {
        for &t in by_id[&id].tags {
            *per_counts.entry(t).or_insert(0) += 1;
        }
    }
    per_counts
}

/// Every placed envelope's own [`Context`], computed once -- corner-ness
/// and each envelope's own street-tier frontage read `streets` and
/// `plots` together, exactly the fields the doc comment above promises.
fn build_context(
    placed: &[&Envelope],
    plots: &PlotMap,
    streets: &StreetNetwork,
    cfg: &GenerationConfig,
) -> Vec<Context> {
    let site = plots.site();
    let row_bounds = row_bounds_by_block_front(plots.plots());
    let wall = cfg.envelope_wall_thickness_cells;
    placed
        .iter()
        .map(|e| {
            let plot = &plots.plots()[e.plot as usize];
            let block = streets.blocks()[plot.block as usize];
            let sides = streets::block_sides(block.bounds, site);
            let rb = row_bounds
                .get(&(plot.block, e.front))
                .copied()
                .unwrap_or(plot.bounds);
            let (x, y) = front_cell(e.footprint, e.front);
            let corner = is_corner_envelope(plot.bounds, rb, e.front, sides);
            let street_class =
                front_street_class(e.footprint, e.front, block.bounds, streets.edges());
            Context {
                land_use_idx: plot.land_use as usize,
                density: plot.density,
                interior_width: (e.along_face_cells() - 2 * wall as i64) as i32,
                interior_depth: (e.depth_cells() - 2 * wall as i64) as i32,
                site_context: site_context_of(corner, street_class),
                x,
                y,
                catchment: catchment_of(x, y, site, cfg.building_type_catchment_extent_cells),
            }
        })
        .collect()
}

/// The ordinary weighted fill: one draw per envelope among every
/// `weight > 0` type hard-eligible for its own plot, seeded from the
/// envelope's own footprint (`rect_seed_key`, never list position or a
/// draw-order-dependent stream) -- never consults `prefers_site`/
/// `density_affinity`, which are a distribution override's own siting
/// step alone.
fn weighted_fill(
    pass_seed: u64,
    placed: &[&Envelope],
    ctx: &[Context],
    content: &super::GenerationContent,
) -> Vec<u32> {
    let mut final_type: Vec<u32> = Vec::with_capacity(placed.len());
    for (i, e) in placed.iter().enumerate() {
        let c = &ctx[i];
        let mut eligible: Vec<&defs::BuildingTypeDef> = content
            .building_types
            .iter()
            .filter(|b| b.weight > 0 && hard_eligible(b, c))
            .collect();
        eligible.sort_by_key(|b| b.id);
        let total_weight: u64 = eligible.iter().map(|b| b.weight as u64).sum();
        if eligible.is_empty() || total_weight == 0 {
            unreachable!(
                "building_types::run: no fill-weighted building type is eligible for plot {} (land use index {}, density {}, interior {}x{}, site_context {:?}) -- tools/defs-build's own check_building_type_density_coverage guarantees this cannot happen for committed content",
                e.plot,
                c.land_use_idx,
                c.density,
                c.interior_width,
                c.interior_depth,
                c.site_context
            );
        }
        let mut rng = Rng::new(seed_from_ids(pass_seed, rect_seed_key(e.footprint)));
        let mut roll = rng.next_u64() % total_weight;
        let mut pick = eligible[0];
        for b in &eligible {
            if roll < b.weight as u64 {
                pick = b;
                break;
            }
            roll -= b.weight as u64;
        }
        final_type.push(pick.id);
    }
    final_type
}

/// Floor-only catchment apportionment (Derek's direction, PR #317 cycle
/// 2): every catchment owes exactly `floor(per-tag count in that
/// catchment / ratio)`, never a remainder-inflated share. Pure and
/// unit-tested: the sum of the returned floors, plus the returned
/// remainder, always equals `site_target`.
fn catchment_floors(
    per_by_catchment: &BTreeMap<(i32, i32), u64>,
    ratio: u64,
    site_target: u64,
) -> (BTreeMap<(i32, i32), u64>, u64) {
    let mut floors: BTreeMap<(i32, i32), u64> = BTreeMap::new();
    let mut base_sum = 0u64;
    for (&c, &p) in per_by_catchment {
        let f = p / ratio;
        floors.insert(c, f);
        base_sum += f;
    }
    let remainder = site_target.saturating_sub(base_sum);
    (floors, remainder)
}

/// Picks up to `target` indices from `pool` (already ranked by
/// [`rank_key`], best first), skipping anything within `min_spacing` of
/// an already-chosen cell -- shared by both the per-catchment floor
/// placement and the site-wide remainder placement, so the two are one
/// code path, never a duplicated filter/assign block. Never removes a
/// candidate for any reason but a real spacing violation: a floor or a
/// remainder that cannot be filled from a starved or exhausted pool is
/// left short, not padded from elsewhere.
fn place_row(
    pool: &[usize],
    target: u64,
    min_spacing: u32,
    ctx: &[Context],
    chosen_cells: &mut Vec<(i32, i32)>,
) -> Vec<usize> {
    let mut chosen = Vec::new();
    for &i in pool {
        if chosen.len() as u64 >= target {
            break;
        }
        let cell = (ctx[i].x, ctx[i].y);
        let too_close = min_spacing > 0
            && chosen_cells
                .iter()
                .any(|&other| chebyshev(cell, other) < min_spacing);
        if too_close {
            continue;
        }
        chosen.push(i);
        chosen_cells.push(cell);
    }
    chosen
}

/// Runs pass 5. `envelopes`/`plots`/`streets` are pass 4's/3's/2's own
/// outputs (corner-ness and each envelope's own street-tier frontage
/// reads `streets` and `plots` together); `cfg` supplies the wall-ring
/// thickness (the interior-net check) and the catchment extent;
/// `content` is [`super::GenerationContent`] -- content is an input,
/// never a literal read from `defs::` directly by this function.
pub fn run(
    city_seed: u64,
    envelopes: &EnvelopeMap,
    plots: &PlotMap,
    streets: &StreetNetwork,
    cfg: &GenerationConfig,
    content: &super::GenerationContent,
) -> BuildingTypeMap {
    let pass_seed = seed_from_ids(city_seed, PASS_ID);
    let placed: Vec<&Envelope> = envelopes.envelopes().collect();
    let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();

    let ctx = build_context(&placed, plots, streets, cfg);
    let mut final_type = weighted_fill(pass_seed, &placed, &ctx, content);

    // -- distribution overrides, ascending rule id -----------------------
    let mut dist_rows: Vec<crate::rules::DistributionRow> = content
        .rules
        .iter()
        .filter_map(|r| r.as_distribution())
        .collect();
    dist_rows.sort_by_key(|d| d.id);

    let mut overridden: Vec<bool> = vec![false; placed.len()];

    for row in &dist_rows {
        // Recomputed fresh, immediately before this row runs: a prior
        // row's own overrides may have changed which envelopes carry
        // which tag, so this row's own basis is always the real count,
        // never an assumption about the committed content's own shape.
        let per_counts = recompute_per_counts(&final_type, &by_id);

        let mut per_by_catchment: BTreeMap<(i32, i32), u64> = BTreeMap::new();
        for (i, &id) in final_type.iter().enumerate() {
            if by_id[&id].tags.contains(&row.per) {
                *per_by_catchment.entry(ctx[i].catchment).or_insert(0) += 1;
            }
        }
        let total_per = per_counts.get(&row.per).copied().unwrap_or(0);
        let ratio = row.ratio.max(1) as u64;
        let site_target = total_per / ratio;
        if site_target == 0 {
            continue;
        }

        let (floors, remainder) = catchment_floors(&per_by_catchment, ratio, site_target);

        // The subject type's own siting preferences -- a property of
        // the type, read once per row, never per candidate.
        let subject_def = content
            .building_types
            .iter()
            .find(|b| b.tags.contains(&row.subject));
        let prefers_site = subject_def.map(|b| b.prefers_site).unwrap_or([false; 4]);
        let affinity = subject_def.map(|b| b.density_affinity).unwrap_or(0);

        let draw_key = |i: usize| -> u64 {
            seed_from_ids(
                seed_from_ids(pass_seed, row.id as u64),
                rect_seed_key(placed[i].footprint),
            )
        };

        // Best first: most `prefers_site` matches, then `density_
        // affinity`'s own direction, then the seeded draw key -- a
        // distance search never enters this ranking (Derek's direction:
        // "farthest-point is a tie-break at most, never ahead of
        // affinity"), and the draw key alone already totally orders any
        // real candidate set, so a distance tie-break would never fire.
        let rank_key = |i: usize| -> (i64, i64, u64) {
            let match_count = (0..4)
                .filter(|&k| prefers_site[k] && ctx[i].site_context[k])
                .count() as i64;
            let density_score = match affinity {
                a if a > 0 => -(ctx[i].density as i64),
                a if a < 0 => ctx[i].density as i64,
                _ => 0,
            };
            (-match_count, density_score, draw_key(i))
        };

        let eligible_for_subject = |i: usize| -> bool {
            content
                .building_types
                .iter()
                .any(|b| b.tags.contains(&row.subject) && hard_eligible(b, &ctx[i]))
        };

        let resolve = |i: usize| -> u32 {
            content
                .building_types
                .iter()
                .filter(|b| b.tags.contains(&row.subject) && hard_eligible(b, &ctx[i]))
                .min_by_key(|b| b.id)
                .expect("candidate was pre-filtered to carry an eligible subject-tagged type")
                .id
        };

        let mut chosen_cells: Vec<(i32, i32)> = Vec::new();
        let mut catchments: Vec<(i32, i32)> = per_by_catchment.keys().copied().collect();
        catchments.sort();

        for &c in &catchments {
            let target = floors.get(&c).copied().unwrap_or(0);
            if target == 0 {
                continue;
            }
            let mut pool: Vec<usize> = (0..placed.len())
                .filter(|&i| !overridden[i] && ctx[i].catchment == c && eligible_for_subject(i))
                .collect();
            pool.sort_by_key(|&i| rank_key(i));
            let chosen = place_row(&pool, target, row.min_spacing, &ctx, &mut chosen_cells);
            for &i in &chosen {
                final_type[i] = resolve(i);
                overridden[i] = true;
            }
        }

        if remainder > 0 {
            let mut pool: Vec<usize> = (0..placed.len())
                .filter(|&i| !overridden[i] && eligible_for_subject(i))
                .collect();
            pool.sort_by_key(|&i| rank_key(i));
            let chosen = place_row(&pool, remainder, row.min_spacing, &ctx, &mut chosen_cells);
            for &i in &chosen {
                final_type[i] = resolve(i);
                overridden[i] = true;
            }
        }
    }

    let assignments = placed
        .iter()
        .zip(final_type)
        .map(|(e, building_type)| TypeAssignment {
            plot: e.plot,
            building_type,
        })
        .collect();
    BuildingTypeMap { assignments }
}

/// A building type is a workplace iff its own `professions` list is
/// non-empty (Tim's direction) -- never a second stored boolean. The
/// district's own workplace count (AC4) is the count of placed envelopes
/// whose assigned type satisfies this.
pub fn is_workplace(def: &defs::BuildingTypeDef) -> bool {
    !def.professions.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::defs;
    use crate::generation::{GenerationConfig, GenerationContent, land_use, plots as plots_mod};
    use crate::generation::{envelopes, streets};

    fn cfg() -> GenerationConfig {
        GenerationConfig::from_balance(defs::BALANCE).unwrap()
    }

    fn district_for(seed: u64) -> (EnvelopeMap, PlotMap, StreetNetwork) {
        let c = cfg();
        let lu = land_use::run(seed, c.site(), &c).unwrap();
        let net = streets::run(seed, &lu, &c);
        let pm = plots_mod::run(seed, &lu, &net, &c);
        let em = envelopes::run(seed, &pm, &c);
        (em, pm, net)
    }

    #[test]
    fn run_is_deterministic_for_the_same_seed() {
        let (em, pm, net) = district_for(11);
        let c = cfg();
        let content = GenerationContent::committed();
        let a = run(11, &em, &pm, &net, &c, &content);
        let b = run(11, &em, &pm, &net, &c, &content);
        assert_eq!(
            a.assignments().to_vec(),
            b.assignments().to_vec(),
            "same seed must draw the same type per envelope"
        );
    }

    #[test]
    fn every_placed_envelope_gets_exactly_one_assignment() {
        let (em, pm, net) = district_for(23);
        let c = cfg();
        let content = GenerationContent::committed();
        let map = run(23, &em, &pm, &net, &c, &content);
        assert_eq!(map.assignments().len(), em.placed_count() as usize);
    }

    #[test]
    fn every_assignment_names_a_type_that_resolves_and_is_eligible_for_its_own_plot() {
        let (em, pm, net) = district_for(23);
        let c = cfg();
        let content = GenerationContent::committed();
        let map = run(23, &em, &pm, &net, &c, &content);
        let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();
        let site = pm.site();
        let row_bounds = row_bounds_by_block_front(pm.plots());
        for a in map.assignments() {
            let def = by_id.get(&a.building_type).unwrap_or_else(|| {
                panic!(
                    "plot {} names unresolvable type {}",
                    a.plot, a.building_type
                )
            });
            let plot = &pm.plots()[a.plot as usize];
            assert!(
                def.land_uses[plot.land_use as usize],
                "plot {} does not carry type {}'s own land use",
                a.plot, def.key
            );
            assert!(
                plot.density >= def.density_min && plot.density <= def.density_max,
                "plot {} density {} outside type {}'s own band [{}, {}]",
                a.plot,
                plot.density,
                def.key,
                def.density_min,
                def.density_max
            );
            let e = em.envelopes().find(|e| e.plot == a.plot).unwrap();
            let interior_w = e.along_face_cells() - 2 * c.envelope_wall_thickness_cells as i64;
            let interior_d = e.depth_cells() - 2 * c.envelope_wall_thickness_cells as i64;
            assert!(
                def.min_interior_width_cells as i64 <= interior_w
                    && def.min_interior_depth_cells as i64 <= interior_d,
                "plot {} interior {interior_w}x{interior_d} is under type {}'s own minimum {}x{}",
                a.plot,
                def.key,
                def.min_interior_width_cells,
                def.min_interior_depth_cells
            );
            if def.requires_site.iter().any(|&r| r) {
                let block = net.blocks()[plot.block as usize];
                let sides = streets::block_sides(block.bounds, site);
                let rb = row_bounds[&(plot.block, e.front)];
                let corner = is_corner_envelope(plot.bounds, rb, e.front, sides);
                let street_class =
                    front_street_class(e.footprint, e.front, block.bounds, net.edges());
                let ctx = site_context_of(corner, street_class);
                assert!(
                    (0..4).all(|i| !def.requires_site[i] || ctx[i]),
                    "plot {} got a requires_site-restricted type {} but does not satisfy it",
                    a.plot,
                    def.key
                );
            }
        }
    }

    #[test]
    fn changing_one_envelopes_own_bounds_never_moves_another_envelopes_draw() {
        // Same shape as envelopes.rs's own independence property: two
        // different seeds necessarily perturb the whole upstream chain,
        // so this instead re-runs pass 5 alone over a hand-perturbed
        // envelope map and checks every *other* plot's own draw is
        // unaffected by one envelope's footprint moving.
        let (em, pm, net) = district_for(7);
        let c = cfg();
        let content = GenerationContent::committed();
        let before = run(7, &em, &pm, &net, &c, &content);

        let mut outcomes: Vec<envelopes::EnvelopeOutcome> = em.outcomes().to_vec();
        if let Some(first_placed) = outcomes.iter_mut().find_map(|o| match o {
            envelopes::EnvelopeOutcome::Placed(e) => Some(e),
            envelopes::EnvelopeOutcome::Rejected { .. } => None,
        }) {
            first_placed.footprint.x0 += 1;
            first_placed.footprint.x1 += 1;
        }
        let perturbed = envelopes::EnvelopeMap::test_fixture(outcomes);
        let after = run(7, &perturbed, &pm, &net, &c, &content);

        let before_by_plot: BTreeMap<u32, u32> = before
            .assignments()
            .iter()
            .map(|a| (a.plot, a.building_type))
            .collect();
        let after_by_plot: BTreeMap<u32, u32> = after
            .assignments()
            .iter()
            .map(|a| (a.plot, a.building_type))
            .collect();
        let moved_plot = em
            .envelopes()
            .next()
            .map(|e| e.plot)
            .expect("at least one placed envelope at this committed seed");
        for (&plot, &ty) in &before_by_plot {
            if plot == moved_plot {
                continue;
            }
            assert_eq!(
                after_by_plot.get(&plot),
                Some(&ty),
                "plot {plot}'s own draw moved when only plot {moved_plot}'s footprint changed"
            );
        }
    }

    #[test]
    fn a_committed_distribution_row_never_exceeds_its_own_site_wide_target() {
        let (em, pm, net) = district_for(3);
        let c = cfg();
        let content = GenerationContent::committed();
        let map = run(3, &em, &pm, &net, &c, &content);
        let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();

        let mut per_counts: BTreeMap<TagId, u64> = BTreeMap::new();
        for a in map.assignments() {
            for &t in by_id[&a.building_type].tags {
                *per_counts.entry(t).or_insert(0) += 1;
            }
        }
        let mut dist_rows: Vec<crate::rules::DistributionRow> = content
            .rules
            .iter()
            .filter_map(|r| r.as_distribution())
            .collect();
        dist_rows.sort_by_key(|d| d.id);
        for row in &dist_rows {
            let actual = per_counts.get(&row.subject).copied().unwrap_or(0);
            let target = per_counts.get(&row.per).copied().unwrap_or(0) / (row.ratio.max(1) as u64);
            assert!(
                actual <= target,
                "rule {} placed {actual} subjects, its own site-wide target is {target}",
                row.key
            );
        }
    }

    #[test]
    fn catchment_of_a_512_site_at_a_256_extent_is_exactly_the_four_quadrants() {
        let site = SiteBounds {
            x0: 0,
            y0: 0,
            x1: 512,
            y1: 512,
        };
        assert_eq!(catchment_of(0, 0, site, 256), (0, 0));
        assert_eq!(catchment_of(255, 255, site, 256), (0, 0));
        assert_eq!(catchment_of(256, 0, site, 256), (1, 0));
        assert_eq!(catchment_of(0, 256, site, 256), (0, 1));
        assert_eq!(catchment_of(511, 511, site, 256), (1, 1));
    }

    #[test]
    fn catchment_floors_sum_plus_remainder_always_equals_the_site_target() {
        let mut per_by_catchment: BTreeMap<(i32, i32), u64> = BTreeMap::new();
        per_by_catchment.insert((0, 0), 149);
        per_by_catchment.insert((0, 1), 172);
        per_by_catchment.insert((1, 0), 133);
        per_by_catchment.insert((1, 1), 156);
        let total: u64 = per_by_catchment.values().sum();
        let ratio = 50u64;
        let site_target = total / ratio;
        let (floors, remainder) = catchment_floors(&per_by_catchment, ratio, site_target);
        let floor_sum: u64 = floors.values().sum();
        assert_eq!(floor_sum + remainder, site_target);
        // Every floor really is a floor -- never more than the exact
        // division.
        for (&c, &f) in &floors {
            assert!(f <= per_by_catchment[&c] / ratio);
        }
    }

    #[test]
    fn catchment_floors_never_inflates_a_catchment_by_its_own_dwelling_share() {
        // The largest-remainder algorithm this replaced would have
        // handed a lopsided catchment's own entire target to it; the
        // floor-only version never gives a catchment more than its own
        // exact-division floor.
        let mut per_by_catchment: BTreeMap<(i32, i32), u64> = BTreeMap::new();
        per_by_catchment.insert((0, 0), 10); // floor(10/300) = 0
        per_by_catchment.insert((0, 1), 290); // floor(290/300) = 0
        let ratio = 300u64;
        let site_target = 1u64; // (10+290)/300 = 1
        let (floors, remainder) = catchment_floors(&per_by_catchment, ratio, site_target);
        assert_eq!(floors[&(0, 0)], 0);
        assert_eq!(floors[&(0, 1)], 0);
        assert_eq!(
            remainder, 1,
            "the one unit is the site-wide remainder, never handed to (0,1) for holding more dwellings"
        );
    }

    #[test]
    fn place_row_never_places_two_chosen_cells_closer_than_min_spacing() {
        let footprint_at = |x: i32| Rect {
            x0: x,
            y0: 100,
            x1: x + 5,
            y1: 105,
        };
        let ctx: Vec<Context> = (0..5)
            .map(|i| Context {
                land_use_idx: 0,
                density: 50,
                interior_width: 5,
                interior_depth: 5,
                site_context: [false; 4],
                x: footprint_at(i * 8).x0,
                y: 100,
                catchment: (0, 0),
            })
            .collect();
        let pool: Vec<usize> = (0..5).collect();
        let mut chosen_cells = Vec::new();
        let chosen = place_row(&pool, 5, 20, &ctx, &mut chosen_cells);
        for i in 0..chosen.len() {
            for j in (i + 1)..chosen.len() {
                let a = (ctx[chosen[i]].x, ctx[chosen[i]].y);
                let b = (ctx[chosen[j]].x, ctx[chosen[j]].y);
                assert!(
                    chebyshev(a, b) >= 20,
                    "two chosen cells {a:?}/{b:?} are within min_spacing"
                );
            }
        }
    }
}
