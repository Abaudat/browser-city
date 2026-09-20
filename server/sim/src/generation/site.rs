//! Story 3.4 (FR112): `DistrictSite`, the one [`RuleSite`] a generated
//! [`super::District`] presents to `sim::rules::evaluate` -- both the
//! constructive pass (`building_types::run`, over a partial district) and
//! the finished-district verdict (`District::check_rules`) build this
//! same type from the same fields, never a second adapter.
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
