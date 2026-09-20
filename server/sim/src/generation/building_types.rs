//! Pass 5 (FR110/FR116, story 3.4): the building-type pass. Receives
//! every sealed envelope pass 4 handed down; hands down what each
//! building *is* -- a `defs::BuildingTypeDef` id, never a Rust category.
//! "Institution", "workplace" and "residential" are all *derived* from a
//! type's own `tags`/`professions` (Derek's direction), never stored
//! here or branched on by key: this module never contains a quoted
//! building-type, tag, profession or rule key literal
//! (`check-generator-no-content-keys.sh`).
//!
//! Two passes over the placed envelopes, in this fixed order (Tim's
//! direction: "constrained/distributed types first, then the weighted
//! fill"), practically resolved by computing the fill baseline first and
//! letting distribution overrides win: the baseline weighted fill gives
//! every envelope a type eligible for its own plot's land use and
//! density band; the distribution rows -- read generically through
//! [`sim::rules::RuleDef::as_distribution`], never by matching on the
//! rule engine's own closed kind enum -- then override a subset of
//! envelopes onto a named institution, in ascending rule id order (a
//! stable priority, never
//! list position). The committed content keeps a dwelling-tagged
//! envelope's own land use disjoint from every institution's, so the
//! baseline's own dwelling count -- a distribution row's own `per` basis
//! -- never moves once an override is applied.
//!
//! Infallible, like passes 2-4: AC2's own presence/spacing verdict is a
//! property of the finished district (`District::check_rules`, via
//! `sim::rules::evaluate`), never folded into placement -- an outlier
//! city's own placement can still be inspected.

use std::collections::BTreeMap;

use crate::generated::defs;
use crate::rng::{Rng, seed_from_ids};
use crate::rules::TagId;

use super::envelopes::{Envelope, EnvelopeMap};
use super::plots::PlotMap;
use super::rect_seed_key;
use super::site::front_cell;

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

fn eligible_types<'a>(
    building_types: &'a [defs::BuildingTypeDef],
    land_use_key: &str,
    density: i32,
) -> impl Iterator<Item = &'a defs::BuildingTypeDef> {
    building_types.iter().filter(move |b| {
        b.land_uses.contains(&land_use_key)
            && density >= b.density_min
            && density <= b.density_max
    })
}

/// Runs pass 5. `envelopes`/`plots` are pass 4's/3's own outputs;
/// `content` is [`super::GenerationContent`] (Tim's direction: content is
/// an input, never a literal read from `defs::` directly by this
/// function).
pub fn run(
    city_seed: u64,
    envelopes: &EnvelopeMap,
    plots: &PlotMap,
    content: &super::GenerationContent,
) -> BuildingTypeMap {
    let pass_seed = seed_from_ids(city_seed, PASS_ID);
    let placed: Vec<&Envelope> = envelopes.envelopes().collect();
    let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();

    // -- baseline: one weighted draw per envelope, fill types only ------
    let mut final_type: Vec<u32> = Vec::with_capacity(placed.len());
    for e in &placed {
        let plot = &plots.plots()[e.plot as usize];
        let key = super::land_use_key(plot.land_use);
        let mut eligible: Vec<&defs::BuildingTypeDef> =
            eligible_types(content.building_types, key, plot.density)
                .filter(|b| b.weight > 0)
                .collect();
        eligible.sort_by_key(|b| b.id);
        let total_weight: u64 = eligible.iter().map(|b| b.weight as u64).sum();
        let picked = if total_weight == 0 || eligible.is_empty() {
            panic!(
                "building_types::run: no fill-weighted building type covers land use {key:?} at density {} -- a defs-authoring gap, not a real generated seed",
                plot.density
            );
        } else {
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
            pick
        };
        final_type.push(picked.id);
    }

    // The distribution rows' own `per` basis, read from the baseline
    // fill before any override -- stable because the committed content
    // never lets an institution's own `land_uses` overlap a dwelling
    // type's.
    let mut per_counts: BTreeMap<TagId, u64> = BTreeMap::new();
    for &id in &final_type {
        for &t in by_id[&id].tags {
            *per_counts.entry(t).or_insert(0) += 1;
        }
    }

    // -- distribution overrides, ascending rule id ----------------------
    let mut dist_rows: Vec<crate::rules::DistributionRow> = content
        .rules
        .iter()
        .filter_map(|r| r.as_distribution())
        .collect();
    dist_rows.sort_by_key(|d| d.id);

    let mut overridden: Vec<bool> = vec![false; placed.len()];

    for row in &dist_rows {
        let basis = per_counts.get(&row.per).copied().unwrap_or(0);
        let target = basis / (row.ratio.max(1) as u64);
        if target == 0 {
            continue;
        }

        let mut candidates: Vec<usize> = Vec::new();
        for (i, e) in placed.iter().enumerate() {
            if overridden[i] {
                continue;
            }
            let plot = &plots.plots()[e.plot as usize];
            let key = super::land_use_key(plot.land_use);
            let has_subject_type = eligible_types(content.building_types, key, plot.density)
                .any(|b| b.tags.contains(&row.subject));
            if has_subject_type {
                candidates.push(i);
            }
        }
        // A stable, seed-derived draw order -- never list position
        // (Tim's direction): keyed by this row's own id (so two rows
        // never draw the same permutation) and each candidate's own
        // envelope footprint.
        let draw_key = |i: usize| -> u64 {
            seed_from_ids(
                seed_from_ids(pass_seed, row.id as u64),
                rect_seed_key(placed[i].footprint),
            )
        };
        candidates.sort_by_key(|&i| draw_key(i));

        let mut chosen: Vec<usize> = Vec::new();
        let mut chosen_cells: Vec<(i32, i32)> = Vec::new();
        for &i in &candidates {
            if chosen.len() as u64 >= target {
                break;
            }
            let (x, y) = front_cell(placed[i].footprint, placed[i].front);
            let too_close = row.min_spacing > 0
                && chosen_cells.iter().any(|&(cx, cy)| {
                    let d = (x - cx).unsigned_abs().max((y - cy).unsigned_abs());
                    d < row.min_spacing
                });
            if too_close {
                continue;
            }
            chosen.push(i);
            chosen_cells.push((x, y));
        }

        for &i in &chosen {
            let plot = &plots.plots()[placed[i].plot as usize];
            let key = super::land_use_key(plot.land_use);
            let def = eligible_types(content.building_types, key, plot.density)
                .filter(|b| b.tags.contains(&row.subject))
                .min_by_key(|b| b.id)
                .expect("candidate was pre-filtered to carry an eligible subject-tagged type");
            final_type[i] = def.id;
            overridden[i] = true;
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

    fn district_for(seed: u64) -> (EnvelopeMap, PlotMap) {
        let c = cfg();
        let lu = land_use::run(seed, c.site(), &c).unwrap();
        let net = streets::run(seed, &lu, &c);
        let pm = plots_mod::run(seed, &lu, &net, &c);
        let em = envelopes::run(seed, &pm, &c);
        (em, pm)
    }

    #[test]
    fn run_is_deterministic_for_the_same_seed() {
        let (em, pm) = district_for(11);
        let content = GenerationContent::committed();
        let a = run(11, &em, &pm, &content);
        let b = run(11, &em, &pm, &content);
        assert_eq!(
            a.assignments().to_vec(),
            b.assignments().to_vec(),
            "same seed must draw the same type per envelope"
        );
    }

    #[test]
    fn every_placed_envelope_gets_exactly_one_assignment() {
        let (em, pm) = district_for(23);
        let content = GenerationContent::committed();
        let map = run(23, &em, &pm, &content);
        assert_eq!(map.assignments().len(), em.placed_count() as usize);
    }

    #[test]
    fn every_assignment_names_a_type_eligible_for_its_own_plot() {
        let (em, pm) = district_for(23);
        let content = GenerationContent::committed();
        let map = run(23, &em, &pm, &content);
        let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();
        for a in map.assignments() {
            let plot = &pm.plots()[a.plot as usize];
            let def = by_id[&a.building_type];
            let key = super::super::land_use_key(plot.land_use);
            assert!(
                def.land_uses.contains(&key),
                "plot {} (use {key}) got type {} which does not carry that land use",
                a.plot,
                def.key
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
        }
    }

    #[test]
    fn changing_one_envelopes_own_bounds_never_moves_another_envelopes_draw() {
        // Same shape as envelopes.rs's own independence property: two
        // different seeds necessarily perturb the whole upstream chain,
        // so this instead re-runs pass 5 alone over a hand-perturbed
        // envelope map and checks every *other* plot's own draw is
        // unaffected by one envelope's footprint moving.
        let (em, pm) = district_for(7);
        let content = GenerationContent::committed();
        let before = run(7, &em, &pm, &content);

        let mut outcomes: Vec<envelopes::EnvelopeOutcome> = em.outcomes().to_vec();
        if let Some(first_placed) = outcomes.iter_mut().find_map(|o| match o {
            envelopes::EnvelopeOutcome::Placed(e) => Some(e),
            envelopes::EnvelopeOutcome::Rejected { .. } => None,
        }) {
            first_placed.footprint.x0 += 1;
            first_placed.footprint.x1 += 1;
        }
        let perturbed = envelopes::EnvelopeMap::test_fixture(outcomes);
        let after = run(7, &perturbed, &pm, &content);

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
    fn a_committed_distribution_row_never_selects_more_than_its_own_target() {
        let (em, pm) = district_for(3);
        let content = GenerationContent::committed();
        let map = run(3, &em, &pm, &content);
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
                "rule {} placed {actual} subjects, its own target is {target}",
                row.key
            );
        }
    }
}
