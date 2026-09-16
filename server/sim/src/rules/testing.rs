//! A small builder for [`super::RuleSite`] fixtures (Quentin's direction:
//! "build fixtures with a small builder helper, not huge struct
//! literals"). Gated behind the `fixture` feature exactly like
//! `world::fixture` -- hand-authored test geometry never reaches the
//! published wasm module, but is reachable from this crate's own `tests/`
//! (which link the library built for `[dependencies]`, not
//! `[dev-dependencies]`) via `sim`'s own self-referential dev-dependency.

use std::collections::BTreeMap;

use super::{AreaId, Cell, RuleSite, TagId};

/// Declares a small, in-memory site: which tags each cell carries, and
/// which real areas each cell sits inside. `build()` computes the
/// reverse `(area, tag) -> cells` index [`Site::subjects_in_area`]
/// answers from, once, so a real `RuleSite` implementation (a generator,
/// a harness) has a concrete example of "index once, do not rescan" to
/// follow.
#[derive(Debug, Default, Clone)]
pub struct SiteBuilder {
    tags: BTreeMap<Cell, Vec<TagId>>,
    areas: BTreeMap<Cell, Vec<AreaId>>,
}

impl SiteBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Declares that `cell` carries every tag in `tags` (merged with any
    /// already declared for that cell).
    pub fn cell(mut self, cell: Cell, tags: &[TagId]) -> Self {
        let entry = self.tags.entry(cell).or_default();
        for &t in tags {
            if !entry.contains(&t) {
                entry.push(t);
            }
        }
        entry.sort_unstable();
        self
    }

    /// Declares that `cell` sits inside real area `area`.
    pub fn area(mut self, cell: Cell, area: AreaId) -> Self {
        let entry = self.areas.entry(cell).or_default();
        if !entry.contains(&area) {
            entry.push(area);
        }
        entry.sort_unstable();
        self
    }

    pub fn build(self) -> Site {
        let mut subjects_index: BTreeMap<(Option<AreaId>, TagId), Vec<Cell>> = BTreeMap::new();
        for (&cell, tags) in &self.tags {
            let areas_of_cell = self.areas.get(&cell).cloned().unwrap_or_default();
            for &tag in tags {
                subjects_index.entry((None, tag)).or_default().push(cell);
                for &area in &areas_of_cell {
                    subjects_index
                        .entry((Some(area), tag))
                        .or_default()
                        .push(cell);
                }
            }
        }
        for cells in subjects_index.values_mut() {
            cells.sort_unstable();
        }
        Site {
            tags: self.tags,
            areas: self.areas,
            subjects_index,
            empty_tags: Vec::new(),
            empty_areas: Vec::new(),
            empty_cells: Vec::new(),
        }
    }
}

/// A built, queryable [`RuleSite`] -- immutable once built.
#[derive(Debug, Clone)]
pub struct Site {
    tags: BTreeMap<Cell, Vec<TagId>>,
    areas: BTreeMap<Cell, Vec<AreaId>>,
    subjects_index: BTreeMap<(Option<AreaId>, TagId), Vec<Cell>>,
    empty_tags: Vec<TagId>,
    empty_areas: Vec<AreaId>,
    empty_cells: Vec<Cell>,
}

impl RuleSite for Site {
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
