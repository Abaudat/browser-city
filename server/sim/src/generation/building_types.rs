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
//! minimum interior, corner-ness); the distribution rows -- read
//! generically through [`sim::rules::RuleDef::as_distribution`], never
//! by matching on the rule engine's own closed kind enum -- then
//! override a subset of envelopes onto a named institution, one row at a
//! time in ascending rule id order (a stable priority, never list
//! position). Each row's own `per`-tag basis is recomputed from the
//! placement so far immediately before that row runs, so a later row
//! always reads a real count, never an assumption about which types
//! carry which tag.
//!
//! AC3 (even spread): a row's own site-wide target (`total per-tag count
//! / ratio`, the same figure `sim::rules::evaluate`'s own Distribution
//! check computes) is allocated per catchment -- a fixed-extent square
//! tiling the site (`GenerationConfig::building_type_catchment_extent_
//! cells`) -- proportional to the `per`-tag count in that catchment,
//! rounded down, with the site's own remaining budget apportioned to the
//! catchments with the largest remainder first (the standard largest-
//! remainder apportionment), so the sum across catchments always equals
//! the site-wide target. Within a catchment, candidates are chosen by a
//! deterministic farthest-point search (never a shuffled list taken
//! greedily): the first pick is the best-ranked by the subject type's
//! own `density_affinity`, tie-broken by a seeded draw key; every
//! following pick maximises its own minimum Chebyshev distance to
//! whatever is already chosen, so placement actively spreads rather than
//! merely avoiding overlap, while a real `min_spacing` violation still
//! removes a candidate from consideration.
//!
//! Infallible, like passes 2-4: AC2/AC3's own presence/spread verdict is
//! a property of the finished district (`District::check_rules`, via
//! `sim::rules::evaluate`), never folded into placement -- an outlier
//! city's own placement can still be inspected.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use crate::generated::defs;
use crate::rng::{Rng, seed_from_ids};
use crate::rules::TagId;

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

/// One placed envelope's own structural context: everything eligibility
/// and siting read, computed once per envelope. Never a content key --
/// `land_use_idx` is [`super::LandUse as usize`], not a string.
#[derive(Debug, Clone, Copy)]
struct Context {
    land_use_idx: usize,
    density: i32,
    interior_width: i32,
    interior_depth: i32,
    corner: bool,
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
    plot_bounds: crate::world::Rect,
    row_bounds: crate::world::Rect,
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

fn chebyshev(a: (i32, i32), b: (i32, i32)) -> u32 {
    (a.0 - b.0).unsigned_abs().max((a.1 - b.1).unsigned_abs())
}

/// Hard eligibility: land use, density band, minimum interior (checked
/// against the envelope's own interior net, footprint minus the wall
/// ring -- pass 4's own definition) and, when the type demands it, a
/// corner. Shared by the baseline fill and every distribution override.
fn hard_eligible(b: &defs::BuildingTypeDef, ctx: &Context) -> bool {
    b.land_uses[ctx.land_use_idx]
        && ctx.density >= b.density_min
        && ctx.density <= b.density_max
        && (b.min_interior_width_cells as i32) <= ctx.interior_width
        && (b.min_interior_depth_cells as i32) <= ctx.interior_depth
        && (!b.requires_corner || ctx.corner)
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

/// Runs pass 5. `envelopes`/`plots`/`streets` are pass 4's/3's/2's own
/// outputs (corner-ness and each envelope's own block reads `streets`
/// and `plots` together); `cfg` supplies the wall-ring thickness (the
/// interior-net check) and the catchment extent; `content` is
/// [`super::GenerationContent`] -- content is an input, never a literal
/// read from `defs::` directly by this function.
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
    let site = plots.site();
    let row_bounds = row_bounds_by_block_front(plots.plots());
    let wall = cfg.envelope_wall_thickness_cells;

    let ctx: Vec<Context> = placed
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
            Context {
                land_use_idx: plot.land_use as usize,
                density: plot.density,
                interior_width: (e.along_face_cells() - 2 * wall as i64) as i32,
                interior_depth: (e.depth_cells() - 2 * wall as i64) as i32,
                corner: is_corner_envelope(plot.bounds, rb, e.front, sides),
                x,
                y,
                catchment: catchment_of(x, y, site, cfg.building_type_catchment_extent_cells),
            }
        })
        .collect();

    // -- baseline: one weighted draw per envelope, fill types only ------
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
                "building_types::run: no fill-weighted building type is eligible for plot {} (land use index {}, density {}, interior {}x{}, corner {}) -- tools/defs-build's own check_building_type_density_coverage guarantees this cannot happen for committed content",
                e.plot, c.land_use_idx, c.density, c.interior_width, c.interior_depth, c.corner
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

        // Largest-remainder apportionment: every catchment's own floor
        // is guaranteed, and the site's own remaining budget goes to the
        // catchments owed the most first, so the sum across catchments
        // always equals `site_target` -- the same figure the whole-site
        // engine check computes.
        let mut catchments: Vec<(i32, i32)> = per_by_catchment.keys().copied().collect();
        catchments.sort();
        let mut target_c: BTreeMap<(i32, i32), u64> = BTreeMap::new();
        let mut remainder_c: BTreeMap<(i32, i32), u64> = BTreeMap::new();
        let mut base_sum = 0u64;
        for &c in &catchments {
            let p = per_by_catchment[&c];
            target_c.insert(c, p / ratio);
            remainder_c.insert(c, p % ratio);
            base_sum += p / ratio;
        }
        let mut remaining = site_target.saturating_sub(base_sum);
        let mut by_remainder = catchments.clone();
        by_remainder.sort_by(|a, b| remainder_c[b].cmp(&remainder_c[a]).then(a.cmp(b)));
        for &c in &by_remainder {
            if remaining == 0 {
                break;
            }
            *target_c.get_mut(&c).unwrap() += 1;
            remaining -= 1;
        }

        // The subject type's own siting preference -- a property of the
        // type, read once per row, never per candidate.
        let affinity = content
            .building_types
            .iter()
            .find(|b| b.tags.contains(&row.subject))
            .map(|b| b.density_affinity)
            .unwrap_or(0);

        let draw_key = |i: usize| -> u64 {
            seed_from_ids(
                seed_from_ids(pass_seed, row.id as u64),
                rect_seed_key(placed[i].footprint),
            )
        };

        // Farthest-point-first selection of up to `target` indices from
        // `pool` (already ranked: `density_affinity` first, the seeded
        // draw key as tie-break), skipping anything within `min_spacing`
        // of an already-chosen cell -- never a shuffled list taken
        // greedily. `chosen_cells` seeds the spread from whatever this
        // row already placed earlier in the run (a spillover pass, below,
        // must not cluster next to a catchment's own picks).
        fn select(
            mut pool: Vec<usize>,
            target: usize,
            min_spacing: u32,
            ctx: &[Context],
            chosen_cells: &mut Vec<(i32, i32)>,
        ) -> Vec<usize> {
            let mut chosen: Vec<usize> = Vec::new();
            while chosen.len() < target && !pool.is_empty() {
                let pick_pos = if chosen_cells.is_empty() {
                    0
                } else {
                    pool.iter()
                        .enumerate()
                        .max_by_key(|&(_, &i)| {
                            chosen_cells
                                .iter()
                                .map(|&cell| chebyshev((ctx[i].x, ctx[i].y), cell))
                                .min()
                                .unwrap_or(u32::MAX)
                        })
                        .map(|(pos, _)| pos)
                        .expect("pool is non-empty by the while condition")
                };
                let i = pool.remove(pick_pos);
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

        let rank = |pool: &mut [usize]| {
            pool.sort_by(|&a, &b| {
                if affinity != 0 {
                    let cmp = if affinity > 0 {
                        ctx[b].density.cmp(&ctx[a].density)
                    } else {
                        ctx[a].density.cmp(&ctx[b].density)
                    };
                    if cmp != Ordering::Equal {
                        return cmp;
                    }
                }
                draw_key(a).cmp(&draw_key(b))
            });
        };

        let mut chosen_cells: Vec<(i32, i32)> = Vec::new();
        let mut placed_this_row = 0u64;
        for &c in &catchments {
            let target = target_c[&c];
            if target == 0 {
                continue;
            }
            let mut pool: Vec<usize> = (0..placed.len())
                .filter(|&i| !overridden[i] && ctx[i].catchment == c)
                .filter(|&i| {
                    content
                        .building_types
                        .iter()
                        .any(|b| b.tags.contains(&row.subject) && hard_eligible(b, &ctx[i]))
                })
                .collect();
            rank(&mut pool);
            let chosen = select(
                pool,
                target as usize,
                row.min_spacing,
                &ctx,
                &mut chosen_cells,
            );
            placed_this_row += chosen.len() as u64;
            for &i in &chosen {
                let def = content
                    .building_types
                    .iter()
                    .filter(|b| b.tags.contains(&row.subject) && hard_eligible(b, &ctx[i]))
                    .min_by_key(|b| b.id)
                    .expect("candidate was pre-filtered to carry an eligible subject-tagged type");
                final_type[i] = def.id;
                overridden[i] = true;
            }
        }

        // A per-catchment shortfall (its own eligible candidates ran out,
        // or its own land use is concentrated in a catchment the `per`
        // tag barely reaches) is filled from the whole site's remaining
        // candidates -- the per-catchment floor is a guaranteed
        // *minimum* where the land exists to support it, never a reason
        // to strand the site-wide total below what real, unused
        // candidates elsewhere could still satisfy.
        if placed_this_row < site_target {
            let mut pool: Vec<usize> = (0..placed.len())
                .filter(|&i| !overridden[i])
                .filter(|&i| {
                    content
                        .building_types
                        .iter()
                        .any(|b| b.tags.contains(&row.subject) && hard_eligible(b, &ctx[i]))
                })
                .collect();
            rank(&mut pool);
            let remaining_target = (site_target - placed_this_row) as usize;
            let chosen = select(
                pool,
                remaining_target,
                row.min_spacing,
                &ctx,
                &mut chosen_cells,
            );
            for &i in &chosen {
                let def = content
                    .building_types
                    .iter()
                    .filter(|b| b.tags.contains(&row.subject) && hard_eligible(b, &ctx[i]))
                    .min_by_key(|b| b.id)
                    .expect("candidate was pre-filtered to carry an eligible subject-tagged type");
                final_type[i] = def.id;
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
            if def.requires_corner {
                let block = net.blocks()[plot.block as usize];
                let sides = streets::block_sides(block.bounds, site);
                let rb = row_bounds[&(plot.block, e.front)];
                assert!(
                    is_corner_envelope(plot.bounds, rb, e.front, sides),
                    "plot {} got corner-requiring type {} but is not a corner",
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
}
