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
//! coherence row fire). Every laid-out building (pass 6) adds its own
//! cells: walls, floors, thresholds, fixtures and the entrance's
//! approach, each in the building area and, for a room's cells, the room
//! area ([`super::interiors::add_building`], the one adapter this and
//! the pass's own per-building verdict share -- the same type over one
//! building's own bounds).
//!
//! Built once, dense: a grid over the site's own bounds (floor 0 only,
//! the one floor generation lays out) holds one interned *profile* -- a
//! sorted tag list and a sorted area list -- per cell, so every query is
//! `O(1)` (tags, areas) or one binary search (subjects), and the
//! subject index is filled by one scan of the grid in `(x, y)` order,
//! which is exactly [`Cell`]'s own order, so every list comes out sorted
//! and deduplicated with no sort at all. Interning keeps a district's
//! worth of cells down to a few thousand distinct profiles: a wall cell
//! of one building is one profile, not one allocation per cell.

use std::collections::BTreeMap;

use crate::generated::defs;
use crate::rules::{AreaId, Cell, RuleSite, TagId};
use crate::world::Rect;

use super::envelopes::EnvelopeMap;
use super::interiors::{InteriorMap, InteriorOutcome, Vocabulary, add_building};
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

const NONE: u32 = u32::MAX;

/// A profile id handed out by [`SiteBuilder`]; `0` is the empty cell and
/// is never a real profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProfileId(u32);

/// A dense slot for one area id, handed out by [`SiteBuilder::area`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AreaSlot(u32);

/// `(start, len)` into one of the pools below -- a profile owns no
/// allocation of its own, so a district's worth of them is a handful of
/// big vectors, not tens of thousands of small ones.
#[derive(Debug, Clone, Copy, Default)]
struct Span {
    start: u32,
    len: u32,
}

#[derive(Debug, Clone, Copy, Default)]
struct Profile {
    tags: Span,
    areas: Span,
    area_slots: Span,
    tag_slots: Span,
    pair_slots: Span,
}

#[derive(Debug, Default)]
struct Pools {
    tags: Vec<TagId>,
    areas: Vec<AreaId>,
    area_slots: Vec<u32>,
    tag_slots: Vec<u32>,
    pair_slots: Vec<u32>,
}

fn span<T>(pool: &[T], s: Span) -> &[T] {
    &pool[s.start as usize..(s.start + s.len) as usize]
}

/// Sorts and deduplicates the tail of `pool` from `start`, returning its
/// span.
fn close_sorted<T: Ord + Copy>(pool: &mut Vec<T>, start: usize) -> Span {
    pool[start..].sort_unstable();
    let mut w = start;
    for r in start..pool.len() {
        if w == start || pool[r] != pool[w - 1] {
            pool[w] = pool[r];
            w += 1;
        }
    }
    pool.truncate(w);
    Span {
        start: start as u32,
        len: (w - start) as u32,
    }
}

/// Accumulates a [`DistrictSite`]: a grid over `bounds` (floor 0) of
/// profiles. `set` replaces a cell's profile, `merge` unions into it (a
/// building's entrance cell is both its type's subject cell and its
/// doorway).
pub struct SiteBuilder {
    x0: i32,
    y0: i32,
    w: i32,
    h: i32,
    grid: Vec<u32>,
    profiles: Vec<Profile>,
    pools: Pools,
    intern: BTreeMap<(Vec<TagId>, Vec<u32>), u32>,
    merged: BTreeMap<(u32, u32), u32>,
    area_ids: Vec<AreaId>,
    area_index: BTreeMap<AreaId, u32>,
}

impl SiteBuilder {
    pub fn new(bounds: Rect) -> Self {
        let w = bounds.width() as i32;
        let h = bounds.height() as i32;
        SiteBuilder {
            x0: bounds.x0,
            y0: bounds.y0,
            w,
            h,
            grid: vec![0; (w as usize) * (h as usize)],
            profiles: {
                let mut v = Vec::with_capacity(32);
                v.push(Profile::default());
                v
            },
            pools: Pools {
                tags: Vec::with_capacity(96),
                areas: Vec::with_capacity(48),
                area_slots: Vec::with_capacity(48),
                tag_slots: Vec::with_capacity(96),
                pair_slots: Vec::with_capacity(256),
            },
            intern: BTreeMap::new(),
            merged: BTreeMap::new(),
            area_ids: Vec::new(),
            area_index: BTreeMap::new(),
        }
    }

    /// The slot of `id`, assigned on first use.
    pub fn area(&mut self, id: AreaId) -> AreaSlot {
        if let Some(&s) = self.area_index.get(&id) {
            return AreaSlot(s);
        }
        let s = self.area_ids.len() as u32;
        self.area_ids.push(id);
        self.area_index.insert(id, s);
        AreaSlot(s)
    }

    /// A new profile for `tags` (any order, duplicates ignored) and
    /// `areas`, never shared -- what a building's own cells use, since
    /// every one carries an area no other building has.
    pub fn profile(&mut self, tags: &[TagId], areas: &[AreaSlot]) -> ProfileId {
        let ts = self.pools.tags.len();
        self.pools.tags.extend_from_slice(tags);
        let tags_span = close_sorted(&mut self.pools.tags, ts);
        let ss = self.pools.area_slots.len();
        self.pools.area_slots.extend(areas.iter().map(|a| a.0));
        let slots_span = close_sorted(&mut self.pools.area_slots, ss);
        let ars = self.pools.areas.len();
        for i in 0..slots_span.len as usize {
            let slot = self.pools.area_slots[slots_span.start as usize + i];
            self.pools.areas.push(self.area_ids[slot as usize]);
        }
        let areas_span = close_sorted(&mut self.pools.areas, ars);
        self.profiles.push(Profile {
            tags: tags_span,
            areas: areas_span,
            area_slots: slots_span,
            ..Profile::default()
        });
        ProfileId(self.profiles.len() as u32 - 1)
    }

    /// Like [`Self::profile`] but interned: asking twice for the same
    /// tags and areas gives one profile -- what shared profiles (a
    /// block's subject cell, pavement, a merged cell) use.
    pub fn shared_profile(&mut self, tags: &[TagId], areas: &[AreaSlot]) -> ProfileId {
        let mut t = tags.to_vec();
        t.sort_unstable();
        t.dedup();
        let mut a: Vec<u32> = areas.iter().map(|s| s.0).collect();
        a.sort_unstable();
        a.dedup();
        if let Some(&p) = self.intern.get(&(t.clone(), a.clone())) {
            return ProfileId(p);
        }
        let slots: Vec<AreaSlot> = a.iter().map(|&s| AreaSlot(s)).collect();
        let id = self.profile(&t, &slots);
        self.intern.insert((t, a), id.0);
        id
    }

    fn index(&self, x: i32, y: i32) -> Option<usize> {
        let (dx, dy) = (x - self.x0, y - self.y0);
        if dx < 0 || dy < 0 || dx >= self.w || dy >= self.h {
            return None;
        }
        Some(dx as usize * self.h as usize + dy as usize)
    }

    /// Replaces the cell's profile (ignored outside the bounds).
    pub fn set(&mut self, x: i32, y: i32, p: ProfileId) {
        if let Some(i) = self.index(x, y) {
            self.grid[i] = p.0;
        }
    }

    /// Replaces every cell of `r` (clipped to the bounds).
    pub fn set_rect(&mut self, r: Rect, p: ProfileId) {
        for x in r.x0.max(self.x0)..r.x1.min(self.x0 + self.w) {
            for y in r.y0.max(self.y0)..r.y1.min(self.y0 + self.h) {
                let i = (x - self.x0) as usize * self.h as usize + (y - self.y0) as usize;
                self.grid[i] = p.0;
            }
        }
    }

    /// Unions `p` into the cell's profile (ignored outside the bounds).
    pub fn merge(&mut self, x: i32, y: i32, p: ProfileId) {
        let Some(i) = self.index(x, y) else {
            return;
        };
        let existing = self.grid[i];
        if existing == 0 || existing == p.0 {
            self.grid[i] = p.0;
            return;
        }
        let key = (existing.min(p.0), existing.max(p.0));
        if let Some(&m) = self.merged.get(&key) {
            self.grid[i] = m;
            return;
        }
        let (a, b) = (
            self.profiles[existing as usize],
            self.profiles[p.0 as usize],
        );
        let mut tags: Vec<TagId> = span(&self.pools.tags, a.tags).to_vec();
        tags.extend_from_slice(span(&self.pools.tags, b.tags));
        let mut slots: Vec<AreaSlot> = span(&self.pools.area_slots, a.area_slots)
            .iter()
            .chain(span(&self.pools.area_slots, b.area_slots))
            .map(|&s| AreaSlot(s))
            .collect();
        slots.sort_unstable_by_key(|s| s.0);
        let m = self.shared_profile(&tags, &slots).0;
        self.merged.insert(key, m);
        self.grid[i] = m;
    }

    /// Indexes everything once: tag slots, `(area, tag)` pair slots, and
    /// the subject lists (flat, offset-indexed), by two scans of the grid
    /// in `(x, y)` order.
    pub fn finish(mut self) -> DistrictSite {
        let mut tag_keys: Vec<TagId> = self.pools.tags.clone();
        tag_keys.sort_unstable();
        tag_keys.dedup();
        let t = tag_keys.len();
        let area_count = self.area_ids.len();
        let mut pair_table: Vec<u32> = vec![NONE; area_count * t];
        let mut pair_count = 0u32;
        for pi in 1..self.profiles.len() {
            let p = self.profiles[pi];
            let ts = self.pools.tag_slots.len();
            for k in 0..p.tags.len as usize {
                let tag = self.pools.tags[p.tags.start as usize + k];
                let slot = tag_keys.binary_search(&tag).expect("collected above");
                self.pools.tag_slots.push(slot as u32);
            }
            let tag_span = Span {
                start: ts as u32,
                len: p.tags.len,
            };
            let ps = self.pools.pair_slots.len();
            for ai in 0..p.area_slots.len as usize {
                let a = self.pools.area_slots[p.area_slots.start as usize + ai] as usize;
                for ki in 0..p.tags.len as usize {
                    let slot = self.pools.tag_slots[ts + ki] as usize;
                    let cell = &mut pair_table[a * t + slot];
                    if *cell == NONE {
                        *cell = pair_count;
                        pair_count += 1;
                    }
                    self.pools.pair_slots.push(*cell);
                }
            }
            self.profiles[pi].tag_slots = tag_span;
            self.profiles[pi].pair_slots = Span {
                start: ps as u32,
                len: (self.pools.pair_slots.len() - ps) as u32,
            };
        }

        // Pass 1: counts. Pass 2: fill, in grid order = `Cell` order.
        let mut tag_off: Vec<u32> = vec![0; t + 1];
        let mut pair_off: Vec<u32> = vec![0; pair_count as usize + 1];
        for &pid in &self.grid {
            if pid == 0 {
                continue;
            }
            let p = self.profiles[pid as usize];
            for &s in span(&self.pools.tag_slots, p.tag_slots) {
                tag_off[s as usize + 1] += 1;
            }
            for &s in span(&self.pools.pair_slots, p.pair_slots) {
                pair_off[s as usize + 1] += 1;
            }
        }
        for i in 0..t {
            tag_off[i + 1] += tag_off[i];
        }
        for i in 0..pair_count as usize {
            pair_off[i + 1] += pair_off[i];
        }
        let blank = Cell::new(0, 0, 0);
        let mut tag_cells = vec![blank; tag_off[t] as usize];
        let mut pair_cells = vec![blank; pair_off[pair_count as usize] as usize];
        let mut tag_cursor = tag_off.clone();
        let mut pair_cursor = pair_off.clone();
        for (i, &pid) in self.grid.iter().enumerate() {
            if pid == 0 {
                continue;
            }
            let cell = Cell::new(
                self.x0 + (i / self.h as usize) as i32,
                self.y0 + (i % self.h as usize) as i32,
                0,
            );
            let p = self.profiles[pid as usize];
            for &s in span(&self.pools.tag_slots, p.tag_slots) {
                tag_cells[tag_cursor[s as usize] as usize] = cell;
                tag_cursor[s as usize] += 1;
            }
            for &s in span(&self.pools.pair_slots, p.pair_slots) {
                pair_cells[pair_cursor[s as usize] as usize] = cell;
                pair_cursor[s as usize] += 1;
            }
        }
        DistrictSite {
            x0: self.x0,
            y0: self.y0,
            w: self.w,
            h: self.h,
            grid: self.grid,
            profiles: self.profiles,
            pools: self.pools,
            tag_keys,
            tag_off,
            tag_cells,
            area_index: self.area_index,
            pair_table,
            pair_off,
            pair_cells,
        }
    }
}

/// The one [`RuleSite`] over generated geometry -- see the module docs.
pub struct DistrictSite {
    x0: i32,
    y0: i32,
    w: i32,
    h: i32,
    grid: Vec<u32>,
    profiles: Vec<Profile>,
    pools: Pools,
    tag_keys: Vec<TagId>,
    tag_off: Vec<u32>,
    tag_cells: Vec<Cell>,
    area_index: BTreeMap<AreaId, u32>,
    pair_table: Vec<u32>,
    pair_off: Vec<u32>,
    pair_cells: Vec<Cell>,
}

impl DistrictSite {
    /// Builds the site from every placed envelope and its own assigned
    /// building type, in [`EnvelopeMap::envelopes`]/[`super::building_types::BuildingTypeMap::assignments`]'s
    /// shared order (one assignment per placed envelope -- `run`'s own
    /// contract). `building_types_by_id` is resolved once by the caller
    /// (`O(defs)`), never re-searched per envelope.
    #[allow(clippy::too_many_arguments)]
    pub fn build(
        envelopes: &EnvelopeMap,
        plots: &PlotMap,
        streets: &StreetNetwork,
        assignments: &[super::building_types::TypeAssignment],
        building_types_by_id: &BTreeMap<u32, &defs::BuildingTypeDef>,
        interiors: &InteriorMap,
        vocab: &Vocabulary,
    ) -> Self {
        // Two cells of margin: an entrance on the site's own edge still
        // has its approach's street cell inside the grid.
        let site = plots.site();
        let mut builder = SiteBuilder::new(Rect {
            x0: site.x0 - 2,
            y0: site.y0 - 2,
            x1: site.x1 + 2,
            y1: site.y1 + 2,
        });

        // One outcome per placed envelope, in the same order: a laid-out
        // building's own cells first (its entrance cell is also the cell
        // the type's own tags sit on, merged below).
        debug_assert_eq!(interiors.outcomes().len(), assignments.len());
        for outcome in interiors.outcomes() {
            if let InteriorOutcome::Laid { interior, .. } = outcome {
                add_building(&mut builder, interior, vocab);
            }
        }

        for (envelope, assignment) in envelopes.envelopes().zip(assignments) {
            debug_assert_eq!(
                envelope.plot, assignment.plot,
                "DistrictSite::build: assignments must align with EnvelopeMap::envelopes() one-for-one"
            );
            let def = building_types_by_id
                .get(&assignment.building_type)
                .expect("assignment names a real committed building type");
            let (x, y) = front_cell(envelope.footprint, envelope.front);
            let plot = &plots.plots()[envelope.plot as usize];
            let block_bounds = streets.blocks()[plot.block as usize].bounds;
            let block = builder.area(rect_seed_key(block_bounds));
            let p = builder.shared_profile(def.tags, &[block]);
            builder.merge(x, y, p);
        }
        builder.finish()
    }

    /// Every occupied cell, in `(x, y)` order -- what a per-building
    /// verdict's own site holds, and what the perf ceiling counts.
    pub fn occupied_cells(&self) -> usize {
        self.grid.iter().filter(|&&p| p != 0).count()
    }

    fn profile_at(&self, cell: Cell) -> Option<&Profile> {
        if cell.floor != 0 {
            return None;
        }
        let (dx, dy) = (cell.x - self.x0, cell.y - self.y0);
        if dx < 0 || dy < 0 || dx >= self.w || dy >= self.h {
            return None;
        }
        let p = self.grid[dx as usize * self.h as usize + dy as usize];
        (p != 0).then(|| &self.profiles[p as usize])
    }
}

impl RuleSite for DistrictSite {
    fn tags_at(&self, cell: Cell) -> &[TagId] {
        self.profile_at(cell)
            .map_or(&[], |p| span(&self.pools.tags, p.tags))
    }

    fn areas_containing(&self, cell: Cell) -> &[AreaId] {
        self.profile_at(cell)
            .map_or(&[], |p| span(&self.pools.areas, p.areas))
    }

    fn subjects_in_area(&self, area: Option<AreaId>, tag: TagId) -> &[Cell] {
        let Ok(ts) = self.tag_keys.binary_search(&tag) else {
            return &[];
        };
        match area {
            None => &self.tag_cells[self.tag_off[ts] as usize..self.tag_off[ts + 1] as usize],
            Some(a) => {
                let Some(&slot) = self.area_index.get(&a) else {
                    return &[];
                };
                let pair = self.pair_table[slot as usize * self.tag_keys.len() + ts];
                if pair == NONE {
                    &[]
                } else {
                    &self.pair_cells[self.pair_off[pair as usize] as usize
                        ..self.pair_off[pair as usize + 1] as usize]
                }
            }
        }
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
        let interiors = crate::generation::interiors::run(seed, &em, &types, &pm, &c, &content);
        let vocab = crate::generation::interiors::Vocabulary::new(&content);
        let site = DistrictSite::build(
            &em,
            &pm,
            &net,
            types.assignments(),
            &by_id,
            &interiors,
            &vocab,
        );
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
            let got: Vec<TagId> = b.site.tags_at(cell).to_vec();
            // A laid-out building's entrance cell is also its doorway, so
            // it carries the structural tags too -- never fewer than the
            // type's own.
            for t in &expected {
                assert!(
                    got.contains(t),
                    "plot {}'s own front cell must carry its assigned type's tag {t}",
                    a.plot
                );
            }
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
