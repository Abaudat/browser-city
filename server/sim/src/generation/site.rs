//! Story 3.4 (FR112): `DistrictSite`, the one [`RuleSite`] a finished
//! [`super::District`]'s own verdict (`District::check_rules`) evaluates
//! `sim::rules::evaluate` against. The constructive pass
//! (`building_types::run`, over a partial district, before every
//! envelope has an assignment) shares only [`front_cell`] with this
//! module -- the same one subject-cell rule this type's own `build`
//! uses -- never a `DistrictSite` itself, since `evaluate` needs a
//! finished district's full tag/area index, not a partial one.
//!
//! One subject cell per typed building (its front-edge midpoint, floor
//! 0), one area per block (`AreaId` = [`super::rect_seed_key`] of the
//! block's own bounds) -- no site-wide area (it would make every
//! coherence row fire) and no per-envelope area (pass 6 does not exist
//! yet). Built once, like `sim::validation::PlacedSite`: every query is
//! `O(1)` off a map indexed here, never a rescan.

use std::collections::BTreeMap;

use crate::generated::defs;
use crate::rules::{AreaId, Cell, RuleSite, TagId};

use super::envelopes::EnvelopeMap;
use super::plots::PlotMap;
use super::rect_seed_key;
use super::streets::{Side, StreetNetwork};

/// The front-edge midpoint cell a building's own envelope hands the rule
/// engine as its one subject cell -- world-absolute, floor 0. `front`
/// steps inward from the block face the same way `sim::rules::Direction`
/// already does (`North` is `-y`).
pub fn front_cell(footprint: crate::world::Rect, front: Side) -> (i32, i32) {
    let mid_x = footprint.x0 + (footprint.x1 - footprint.x0 - 1) / 2;
    let mid_y = footprint.y0 + (footprint.y1 - footprint.y0 - 1) / 2;
    match front {
        Side::North => (mid_x, footprint.y0),
        Side::South => (mid_x, footprint.y1 - 1),
        Side::West => (footprint.x0, mid_y),
        Side::East => (footprint.x1 - 1, mid_y),
    }
}

pub struct DistrictSite {
    tags: BTreeMap<Cell, Vec<TagId>>,
    areas: BTreeMap<Cell, Vec<AreaId>>,
    subjects_index: BTreeMap<(Option<AreaId>, TagId), Vec<Cell>>,
    empty_tags: Vec<TagId>,
    empty_areas: Vec<AreaId>,
    empty_cells: Vec<Cell>,
}

impl DistrictSite {
    /// Builds the site from every placed envelope and its own assigned
    /// building type, in [`EnvelopeMap::envelopes`]/[`super::building_types::BuildingTypeMap::assignments`]'s
    /// shared order (one assignment per placed envelope -- `run`'s own
    /// contract). `building_types_by_id` is resolved once by the caller
    /// (`O(defs)`), never re-searched per envelope.
    pub fn build(
        envelopes: &EnvelopeMap,
        plots: &PlotMap,
        streets: &StreetNetwork,
        assignments: &[super::building_types::TypeAssignment],
        building_types_by_id: &BTreeMap<u32, &defs::BuildingTypeDef>,
    ) -> Self {
        let mut tags: BTreeMap<Cell, Vec<TagId>> = BTreeMap::new();
        let mut areas: BTreeMap<Cell, Vec<AreaId>> = BTreeMap::new();

        for (envelope, assignment) in envelopes.envelopes().zip(assignments) {
            debug_assert_eq!(
                envelope.plot, assignment.plot,
                "DistrictSite::build: assignments must align with EnvelopeMap::envelopes() one-for-one"
            );
            let def = building_types_by_id
                .get(&assignment.building_type)
                .expect("assignment names a real committed building type");
            let (x, y) = front_cell(envelope.footprint, envelope.front);
            let cell = Cell::new(x, y, 0);
            let entry = tags.entry(cell).or_default();
            for &t in def.tags {
                if !entry.contains(&t) {
                    entry.push(t);
                }
            }
            entry.sort_unstable();

            let plot = &plots.plots()[envelope.plot as usize];
            let block_bounds = streets.blocks()[plot.block as usize].bounds;
            let area_id = rect_seed_key(block_bounds);
            let area_entry = areas.entry(cell).or_default();
            if !area_entry.contains(&area_id) {
                area_entry.push(area_id);
                area_entry.sort_unstable();
            }
        }

        let mut subjects_index: BTreeMap<(Option<AreaId>, TagId), Vec<Cell>> = BTreeMap::new();
        for (&cell, cell_tags) in &tags {
            let cell_areas = areas.get(&cell).cloned().unwrap_or_default();
            for &tag in cell_tags {
                subjects_index.entry((None, tag)).or_default().push(cell);
                for &area in &cell_areas {
                    subjects_index
                        .entry((Some(area), tag))
                        .or_default()
                        .push(cell);
                }
            }
        }
        for v in subjects_index.values_mut() {
            v.sort_unstable();
            v.dedup();
        }

        DistrictSite {
            tags,
            areas,
            subjects_index,
            empty_tags: Vec::new(),
            empty_areas: Vec::new(),
            empty_cells: Vec::new(),
        }
    }
}

impl RuleSite for DistrictSite {
    fn tags_at(&self, cell: Cell) -> &[TagId] {
        self.tags.get(&cell).unwrap_or(&self.empty_tags)
    }

    fn areas_containing(&self, cell: Cell) -> &[AreaId] {
        self.areas.get(&cell).unwrap_or(&self.empty_areas)
    }

    fn subjects_in_area(&self, area: Option<AreaId>, tag: TagId) -> &[Cell] {
        self.subjects_index
            .get(&(area, tag))
            .unwrap_or(&self.empty_cells)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::defs;
    use crate::generation::building_types;
    use crate::generation::{GenerationConfig, GenerationContent, land_use, plots as plots_mod};
    use crate::generation::{envelopes, streets};
    use crate::world::Rect;
    use std::collections::BTreeMap as Map;

    #[test]
    fn front_cell_steps_to_the_midpoint_of_the_named_face() {
        let footprint = Rect {
            x0: 10,
            y0: 20,
            x1: 16,
            y1: 24,
        };
        assert_eq!(front_cell(footprint, Side::North), (12, 20));
        assert_eq!(front_cell(footprint, Side::South), (12, 23));
        assert_eq!(front_cell(footprint, Side::West), (10, 21));
        assert_eq!(front_cell(footprint, Side::East), (15, 21));
    }

    fn cfg() -> GenerationConfig {
        GenerationConfig::from_balance(defs::BALANCE).unwrap()
    }

    struct Built {
        site: DistrictSite,
        em: EnvelopeMap,
        pm: PlotMap,
        assignments: Vec<building_types::TypeAssignment>,
        by_id: Map<u32, &'static defs::BuildingTypeDef>,
    }

    fn built_site(seed: u64) -> Built {
        let c = cfg();
        let lu = land_use::run(seed, c.site(), &c).unwrap();
        let net = streets::run(seed, &lu, &c);
        let pm = plots_mod::run(seed, &lu, &net, &c);
        let em = envelopes::run(seed, &pm, &c);
        let content = GenerationContent::committed();
        let types = building_types::run(seed, &em, &pm, &net, &c, &content);
        let by_id: Map<u32, &defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();
        let site = DistrictSite::build(&em, &pm, &net, types.assignments(), &by_id);
        let assignments = types.assignments().to_vec();
        Built {
            site,
            em,
            pm,
            assignments,
            by_id,
        }
    }

    #[test]
    fn every_placed_envelopes_front_cell_carries_its_own_types_tags() {
        let b = built_site(41);
        for a in &b.assignments {
            let e = b.em.envelopes().find(|e| e.plot == a.plot).unwrap();
            let (x, y) = front_cell(e.footprint, e.front);
            let cell = Cell::new(x, y, 0);
            let def = b.by_id[&a.building_type];
            let mut expected: Vec<TagId> = def.tags.to_vec();
            expected.sort_unstable();
            let mut got: Vec<TagId> = b.site.tags_at(cell).to_vec();
            got.sort_unstable();
            assert_eq!(
                got, expected,
                "plot {}'s own front cell must carry exactly its assigned type's tags",
                a.plot
            );
        }
    }

    #[test]
    fn a_cell_with_no_placed_building_carries_no_tags_or_areas() {
        let b = built_site(41);
        // The site's own top-left corner is street/plot land, never a
        // building's own front-edge midpoint for any real seed.
        let cell = Cell::new(b.pm.site().x0, b.pm.site().y0, 0);
        assert!(b.site.tags_at(cell).is_empty());
        assert!(b.site.areas_containing(cell).is_empty());
    }

    #[test]
    fn subjects_in_area_none_returns_every_cell_with_that_tag_site_wide() {
        let b = built_site(41);
        // Pick a tag a real placed type actually carries.
        let (tag, cell, area) = b
            .assignments
            .iter()
            .find_map(|a| {
                let def = b.by_id[&a.building_type];
                let &tag = def.tags.first()?;
                let e = b.em.envelopes().find(|e| e.plot == a.plot)?;
                let (x, y) = front_cell(e.footprint, e.front);
                let cell = Cell::new(x, y, 0);
                let area = b.site.areas_containing(cell).first().copied();
                Some((tag, cell, area))
            })
            .expect("a real generated district places at least one tagged type");

        let site_wide = b.site.subjects_in_area(None, tag);
        assert!(
            site_wide.contains(&cell),
            "the site-wide subject list for a tag must include every cell carrying it"
        );

        if let Some(area) = area {
            let scoped = b.site.subjects_in_area(Some(area), tag);
            assert!(
                scoped.contains(&cell),
                "the area-scoped subject list must include a cell in that same area"
            );
            assert!(
                scoped.len() <= site_wide.len(),
                "an area-scoped subject list is never larger than the site-wide one"
            );
        }
    }

    #[test]
    fn subjects_in_area_for_an_unused_tag_is_empty() {
        let b = built_site(41);
        // TagId 999_999 is never a real committed tag.
        assert!(b.site.subjects_in_area(None, 999_999).is_empty());
    }
}
