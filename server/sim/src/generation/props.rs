//! Pass 7 (FR110, story 3.6): prop placement. Receives passes 1-6 (every
//! envelope, its interior, the street network) and hands down the one
//! thing the earlier passes never made: [`PlacedRow`]s -- an object def id
//! at an anchor cell on a floor, exactly the columns of `placed_object`
//! (FR126) minus the surrogate id and the chunk key. A prop's extent is
//! never stored on its row: it is read back through its [`defs::ObjectDef`]
//! ([`extent`]), and its collision is that def's `collider`
//! rasterised, nothing else (FR128).
//!
//! **One emitter.** Walls (a building's footprint minus its rooms and
//! thresholds), every pass-6 fixture resolved from its tag to an object
//! def that carries it, the shopfront glazing a counter owes, and the
//! street furniture are all rows in one list, so the district's collision
//! is judged over the objects it will really have. Defs are chosen by tag
//! through [`GenerationContent::objects`], never by key: which side of the
//! door a def belongs to is the pair of `[[coherence]]` rows over `indoor`
//! / `outdoor`, how a street is lit and where a bin stands are the
//! `[[distribution]]` rows this pass reads the same way the harness judges
//! them.
//!
//! **Constructive, then judged.** A multi-cell def is anchored where its
//! whole footprint stands on its room's floor, clear of every doorway,
//! its approach and every other fixture, never clipped; a def that does not
//! fit falls back to the tag's compact variant. A building whose natural
//! placement leaves a free cell unreachable over whole cells
//! ([`needs_compact`], the cheap reading) is placed again at compact. The
//! verdict over what stands is [`super::District::check_reachability`]:
//! the whole-cell reading where it clears a window (sound under two
//! tested conditions, see [`whole_cells_open`]), the exact sub-cell check
//! ([`window_findings`]) everywhere else. The collision map is built
//! once, here, as one [`FloorCollision`] per floor, and cached on
//! [`PropMap`]; nothing recomputes it.
//!
//! **Carriers, never consequence.** Every prop is placed in its empty,
//! default state. A def carrying a tag any row owes -- a distribution
//! subject or a required fixture -- is placed only where its row asks
//! ([`Catalogue::ambient`] never offers it as dressing), so a pass-6
//! anchor tag never turns up on street furniture.
//!
//! **Seeding.** `seed_from_ids(city_seed, PASS_ID)`, then one stream per
//! building keyed by [`rect_seed_key`] of its footprint and its fixture's
//! cell, and one per street band keyed by the edge's own rect: never a
//! list position, so dressing one building never reshuffles its
//! neighbour's draws.

use std::collections::{BTreeMap, BTreeSet};

use crate::generated::defs;
use crate::rng::{Rng, seed_from_ids};
use crate::rules::{CoherenceMode, RowRatio, TagId};
use crate::world::walkability::{
    self, Finding, Placement, WalkabilityGrid, enclosed_regions, footprint_origin, narrow_passages,
    player_body_subcells,
};
use crate::world::{FloorCollision, Rect};

use super::interiors::{Interior, InteriorMap, InteriorOutcome, Parts, Vocabulary};
use super::streets::{Axis, Side, StreetClass, StreetEdge};
use super::{GenerationConfig, GenerationContent, GenerationError, Skeleton, rect_seed_key};

pub const PASS_ID: u64 = super::PASS_PROP_PLACEMENT;

/// One placed prop: an object def at its anchor cell (the footprint's
/// south-west corner) on a floor. No width, height or collider -- those
/// are the def's ([`extent`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct PlacedRow {
    pub floor: i8,
    pub y: i32,
    pub x: i32,
    pub def_id: u32,
    pub layer: u32,
    pub orientation: u8,
}

/// What a placed row is, for the adapters that stamp it into a rule site
/// and for the windowed verdicts -- never part of the row itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// A wall cell of a building (or a whole solid cell of a shell).
    Wall,
    /// A pass-6 fixture, resolved to an object: the cell it was owed on,
    /// its tag and the index of its room.
    Fixture {
        cell: (i32, i32),
        tag: TagId,
        room: usize,
    },
    /// A glazing unit standing in a building's street wall.
    Shopfront,
    /// Street furniture on the pavement; `block` is the bounds of the
    /// block the pavement fronts, when it fronts one.
    Street { block: Option<Rect> },
}

/// One placed prop with what owns it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Prop {
    pub row: PlacedRow,
    /// The footprint of the building the row belongs to; `None` for
    /// street furniture.
    pub building: Option<Rect>,
    pub role: Role,
}

/// What the pass could not place and moved on from, counted by kind --
/// never an error: a prop with no fitting cell is a typed skip.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PropSkips {
    /// A fixture that stands at a smaller footprint than its tag's
    /// largest, because the natural one did not fit or left a pocket.
    pub compact_fallbacks: u32,
    /// A building re-placed with some of its fixtures at compact
    /// footprints because the natural ones left a pocket the player body
    /// could not reach.
    pub buildings_replaced: u32,
    /// A def owed beside another (a table's chair) with no free floor
    /// cell within its row's reach.
    pub attendants_unplaced: u32,
    /// A building owed a shopfront that had no fitting stretch of
    /// street wall.
    pub shopfronts_unplaced: u32,
    /// An ambient or companion prop with no fitting cell.
    pub street_unplaced: u32,
}

const CLS_NONE: u8 = 0;
const CLS_ROAD: u8 = 1;
const CLS_PAVEMENT: u8 = 2;
const NO_BLOCK: u32 = u32::MAX;

/// The street's cells over the site: carriageway or pavement, and for a
/// pavement cell the block it fronts. Derived once from the street edges
/// ([`StreetGrid::build`]); the pavement tag the rule site stamps and the
/// bands street furniture stands on both come from it.
#[derive(Debug, Clone)]
pub struct StreetGrid {
    bounds: Rect,
    cls: Vec<u8>,
    block: Vec<u32>,
    blocks: Vec<Rect>,
}

impl StreetGrid {
    fn index(&self, x: i32, y: i32) -> Option<usize> {
        if !self.bounds.contains(x, y) {
            return None;
        }
        let w = self.bounds.width() as usize;
        Some((y - self.bounds.y0) as usize * w + (x - self.bounds.x0) as usize)
    }

    pub fn is_pavement(&self, x: i32, y: i32) -> bool {
        self.index(x, y)
            .is_some_and(|i| self.cls[i] == CLS_PAVEMENT)
    }

    /// Whether `(x, y)` is inside the site the grid covers.
    pub fn in_site(&self, x: i32, y: i32) -> bool {
        self.bounds.contains(x, y)
    }

    pub fn is_road(&self, x: i32, y: i32) -> bool {
        self.index(x, y).is_some_and(|i| self.cls[i] == CLS_ROAD)
    }

    /// The bounds of the block the pavement cell at `(x, y)` fronts.
    pub fn block_at(&self, x: i32, y: i32) -> Option<Rect> {
        let i = self.index(x, y)?;
        (self.block[i] != NO_BLOCK).then(|| self.blocks[self.block[i] as usize])
    }

    /// Every pavement cell in `(y, x)` order with the block it fronts.
    pub fn pavement_cells(&self) -> impl Iterator<Item = (i32, i32, Option<Rect>)> + '_ {
        let w = self.bounds.width() as usize;
        self.cls
            .iter()
            .enumerate()
            .filter(|&(_, &c)| c == CLS_PAVEMENT)
            .map(move |(i, _)| {
                let x = self.bounds.x0 + (i % w) as i32;
                let y = self.bounds.y0 + (i / w) as i32;
                let b = (self.block[i] != NO_BLOCK).then(|| self.blocks[self.block[i] as usize]);
                (x, y, b)
            })
    }

    /// The number of pavement cells.
    pub fn pavement_count(&self) -> usize {
        self.cls.iter().filter(|&&c| c == CLS_PAVEMENT).count()
    }

    /// The pavement cells' memory, in bytes: one byte class and one
    /// `u32` block index per site cell.
    pub fn storage_bytes(&self) -> usize {
        self.cls.len() + self.block.len() * 4
    }

    pub fn build(skeleton: &Skeleton, cfg: &GenerationConfig) -> StreetGrid {
        let bounds = skeleton.plots.site();
        let n = (bounds.width() * bounds.height()).max(0) as usize;
        let mut g = StreetGrid {
            bounds,
            cls: vec![CLS_NONE; n],
            block: vec![NO_BLOCK; n],
            blocks: skeleton.streets.blocks().iter().map(|b| b.bounds).collect(),
        };
        let mut block_of = vec![NO_BLOCK; n];
        for (bi, b) in g.blocks.clone().iter().enumerate() {
            for y in b.y0.max(bounds.y0)..b.y1.min(bounds.y1) {
                for x in b.x0.max(bounds.x0)..b.x1.min(bounds.x1) {
                    if let Some(i) = g.index(x, y) {
                        block_of[i] = bi as u32;
                    }
                }
            }
        }
        let edges = skeleton.streets.edges();
        // Pavement is each edge's bands wherever no edge's carriageway
        // covers the cell.
        let mut road = vec![false; n];
        for e in edges {
            let r = e.carriageway(cfg);
            for y in r.y0.max(bounds.y0)..r.y1.min(bounds.y1) {
                for x in r.x0.max(bounds.x0)..r.x1.min(bounds.x1) {
                    if let Some(i) = g.index(x, y) {
                        road[i] = true;
                    }
                }
            }
        }
        for e in edges {
            for band in bands(e, cfg) {
                for t in band.from..band.to {
                    for r in band.rows() {
                        let (x, y) = band.cell(t, r);
                        let Some(i) = g.index(x, y) else { continue };
                        if road[i] {
                            continue;
                        }
                        g.cls[i] = CLS_PAVEMENT;
                        if g.block[i] == NO_BLOCK {
                            let (ox, oy) = band.cell(t, band.outer + band.outward);
                            if let Some(oi) = g.index(ox, oy) {
                                g.block[i] = block_of[oi];
                            }
                        }
                    }
                }
            }
        }
        for (cls, &is_road) in g.cls.iter_mut().zip(&road) {
            if is_road {
                *cls = CLS_ROAD;
            }
        }
        g
    }
}

/// One side of one street edge: a run of pavement rows along the
/// edge, `pave` rows deep, outermost row (against the block) `outer`
/// and kerb-side row `kerb`, with `outward` stepping away from the
/// carriageway.
#[derive(Debug, Clone, Copy)]
struct Band {
    vertical: bool,
    outer: i32,
    kerb: i32,
    outward: i32,
    from: i32,
    to: i32,
    pave: i32,
    edge_key: u64,
}

impl Band {
    fn rows(&self) -> std::ops::RangeInclusive<i32> {
        self.outer.min(self.kerb)..=self.outer.max(self.kerb)
    }

    /// The world cell at along-coordinate `t` on row `r`.
    fn cell(&self, t: i32, r: i32) -> (i32, i32) {
        if self.vertical { (r, t) } else { (t, r) }
    }
}

fn class_index(c: StreetClass) -> usize {
    match c {
        StreetClass::Arterial => 0,
        StreetClass::Street => 1,
        StreetClass::Lane => 2,
    }
}

impl StreetEdge {
    /// The pavement band depth on each side of this edge, in cells.
    fn pavement_cells(&self, cfg: &GenerationConfig) -> i32 {
        let want = cfg.props_pavement_cells[class_index(self.class)];
        want.min((self.width_cells / 2 - 1).max(0))
    }

    /// The carriageway: the edge's rect less its pavement bands.
    fn carriageway(&self, cfg: &GenerationConfig) -> Rect {
        let r = self.rect();
        let p = self.pavement_cells(cfg);
        match self.axis {
            Axis::Vertical => Rect {
                x0: r.x0 + p,
                y0: r.y0,
                x1: r.x1 - p,
                y1: r.y1,
            },
            Axis::Horizontal => Rect {
                x0: r.x0,
                y0: r.y0 + p,
                x1: r.x1,
                y1: r.y1 - p,
            },
        }
    }
}

/// The two pavement bands of `e`: low-coordinate side first.
fn bands(e: &StreetEdge, cfg: &GenerationConfig) -> Vec<Band> {
    let p = e.pavement_cells(cfg);
    if p == 0 {
        return Vec::new();
    }
    let r = e.rect();
    let edge_key = rect_seed_key(r);
    let vertical = e.axis == Axis::Vertical;
    let (lo, hi) = if vertical { (r.x0, r.x1) } else { (r.y0, r.y1) };
    vec![
        Band {
            vertical,
            outer: lo,
            kerb: lo + p - 1,
            outward: -1,
            from: e.from,
            to: e.to,
            pave: p,
            edge_key,
        },
        Band {
            vertical,
            outer: hi - 1,
            kerb: hi - p,
            outward: 1,
            from: e.from,
            to: e.to,
            pave: p,
            edge_key,
        },
    ]
}

/// Pass 7's output: every placed row, the street it stands on and the
/// district's collision, built once.
#[derive(Debug, Clone)]
pub struct PropMap {
    props: Vec<Prop>,
    street: StreetGrid,
    collision: BTreeMap<i8, FloorCollision>,
    skips: PropSkips,
    /// The tags every cell of the street's pavement carries besides the
    /// pavement part (what a distribution row is judged `per`).
    street_tags: Vec<TagId>,
    /// One `(window, seed cell)` per pavement band that carries furniture:
    /// what [`check_reachability`] judges, derived while placing.
    windows: Vec<(Rect, (i32, i32))>,
}

impl PropMap {
    /// An empty map over a site with no street -- a hand-built district's
    /// stand-in for harnesses that never run pass 7.
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn test_fixture(
        site: Rect,
        props: Vec<Prop>,
        objects: &[defs::ObjectDef],
    ) -> Result<Self, GenerationError> {
        let n = (site.width() * site.height()).max(0) as usize;
        let street = StreetGrid {
            bounds: site,
            cls: vec![CLS_NONE; n],
            block: vec![NO_BLOCK; n],
            blocks: Vec::new(),
        };
        let mut props = props;
        props.sort_by_key(|p| p.row);
        let collision = build_collision(site, &props, objects)?;
        Ok(PropMap {
            props,
            street,
            collision,
            skips: PropSkips::default(),
            street_tags: Vec::new(),
            windows: Vec::new(),
        })
    }

    /// Every placed prop, sorted by row `(floor, y, x, def)`.
    pub fn props(&self) -> &[Prop] {
        &self.props
    }

    /// The placed rows alone: exactly `placed_object`'s columns minus the
    /// surrogate id and the chunk key.
    pub fn rows(&self) -> impl Iterator<Item = &PlacedRow> {
        self.props.iter().map(|p| &p.row)
    }

    pub fn street(&self) -> &StreetGrid {
        &self.street
    }

    /// The cached collision of floor `floor`: a cell is blocked iff a
    /// placed collider touches it. Built once in [`run`].
    pub fn collision(&self, floor: i8) -> Option<&FloorCollision> {
        self.collision.get(&floor)
    }

    pub fn skips(&self) -> PropSkips {
        self.skips
    }

    /// One `(window, seed cell)` per pavement band that carries
    /// furniture -- what the street half of [`check_reachability`]
    /// judges.
    pub fn windows(&self) -> &[(Rect, (i32, i32))] {
        &self.windows
    }
}

/// The cells a row claims: its anchor plus the extent of its def --
/// `x` from the anchor east, `y` from the anchor north (the anchor is the
/// footprint's south-west corner).
pub fn extent(row: &PlacedRow, def: &defs::ObjectDef) -> Rect {
    let (ox, oy) = footprint_origin(row.x, row.y, def.height);
    Rect {
        x0: ox,
        y0: oy,
        x1: ox + def.width as i32,
        y1: oy + def.height as i32,
    }
}

/// The def of `id` among `objects`.
pub fn def_of(objects: &[defs::ObjectDef], id: u32) -> Option<&defs::ObjectDef> {
    objects.iter().find(|o| o.id == id)
}

/// The cell range a def's collider touches, in world cells, for a row:
/// blocked iff the sub-cell rect overlaps the cell at all.
pub fn collider_cells(row: &PlacedRow, def: &defs::ObjectDef) -> Option<Rect> {
    let c = def.collider?;
    let s = defs::COLLIDER_SUBCELLS_PER_CELL;
    let (ox, oy) = footprint_origin(row.x, row.y, def.height);
    Some(Rect {
        x0: ox + c.x0.div_euclid(s),
        y0: oy + c.y0.div_euclid(s),
        x1: ox + (c.x1 + s - 1).div_euclid(s),
        y1: oy + (c.y1 + s - 1).div_euclid(s),
    })
}

fn build_collision(
    bounds: Rect,
    props: &[Prop],
    objects: &[defs::ObjectDef],
) -> Result<BTreeMap<i8, FloorCollision>, GenerationError> {
    let by_id: BTreeMap<u32, &defs::ObjectDef> = objects.iter().map(|o| (o.id, o)).collect();
    let mut per_floor: BTreeMap<i8, Vec<Rect>> = BTreeMap::new();
    for p in props {
        let def = by_id.get(&p.row.def_id).ok_or_else(|| {
            GenerationError::InvalidConfig(format!("props: unknown def {}", p.row.def_id))
        })?;
        if let Some(c) = collider_cells(&p.row, def) {
            per_floor.entry(p.row.floor).or_default().push(c);
        }
    }
    per_floor.entry(0).or_default();
    // A little margin: a prop may overhang the site's own edge.
    let padded = Rect {
        x0: bounds.x0 - 2,
        y0: bounds.y0 - 2,
        x1: bounds.x1 + 2,
        y1: bounds.y1 + 2,
    };
    let mut out = BTreeMap::new();
    for (floor, colliders) in per_floor {
        let fc =
            FloorCollision::build(padded, &colliders).map_err(GenerationError::InvalidConfig)?;
        out.insert(floor, fc);
    }
    Ok(out)
}

// --- the catalogue ----------------------------------------------------

/// Everything the pass reads from content, resolved once.
struct Catalogue<'a> {
    parts: Parts,
    objects: &'a [defs::ObjectDef],
    /// `(subject, within)` of every forbid coherence row.
    forbid: Vec<(TagId, TagId)>,
    /// Subjects of coherence rows: a def carrying one declares which
    /// side of the door it belongs to.
    side_tags: BTreeSet<TagId>,
    /// Tags a row owes somewhere: every distribution row's subject and
    /// every requirement row's `requires`. A def carrying one stands only
    /// where a row asks for it, never as ambient dressing.
    owed: BTreeSet<TagId>,
    /// `(per, subject, rows)` of the distribution rows judged over an
    /// object def's tag: what a placed def owes beside itself (a table
    /// set's chairs, one per row).
    attendants: Vec<(TagId, TagId, u32, i32)>,
    /// `(subject, per, min_spacing, max_distance, ratio)` of every
    /// distribution row.
    distributions: Vec<Dist>,
    /// The tags a distribution row is judged `per` that are cells of the
    /// street itself: the pavement part, and any tag no object, building
    /// type or room type carries and no structural part names -- a tag
    /// that can only be a property of a cell of the street's own grid.
    street_tags: BTreeSet<TagId>,
    /// Requirement rows whose container a wall-run def carries: the
    /// facade dressing a building holding the required fixture owes.
    facade: Vec<(TagId, TagId)>,
    wall: &'a defs::ObjectDef,
}

#[derive(Debug, Clone, Copy)]
struct Dist {
    subject: TagId,
    per: TagId,
    min_spacing: i32,
    max_distance: i32,
    ratio: u32,
    tolerance_percent: u32,
}

/// Where a candidate def would stand, as the tags of the place.
#[derive(Clone, Copy)]
enum Place {
    Floor,
    Pavement,
}

impl<'a> Catalogue<'a> {
    fn new(content: &GenerationContent<'a>) -> Result<Self, GenerationError> {
        let vocab = Vocabulary::new(content);
        let parts = vocab.parts;
        let objects = content.objects;
        let mut forbid = Vec::new();
        let mut side_tags = BTreeSet::new();
        let mut distributions = Vec::new();
        let mut owed: BTreeSet<TagId> = BTreeSet::new();
        for r in content.rules.iter() {
            if let Some(c) = r.as_coherence() {
                // Only the rows that bar a prop from a floor or a street
                // say which side of the door a def is on.
                if c.within == parts.floor || c.within == parts.pavement {
                    side_tags.insert(c.subject);
                    if c.mode == CoherenceMode::Forbid {
                        forbid.push((c.subject, c.within));
                    }
                }
            }
            if let Some(r) = r.as_requirement() {
                owed.insert(r.requires);
            }
            if let Some(d) = r.as_distribution() {
                owed.insert(d.subject);
                let ratio = match d.ratio {
                    RowRatio::Fixed(n) => n,
                    RowRatio::Read(_) => d.ratio.smallest(),
                };
                distributions.push(Dist {
                    subject: d.subject,
                    per: d.per,
                    min_spacing: d.min_spacing as i32,
                    max_distance: d.max_distance as i32,
                    ratio,
                    tolerance_percent: d.tolerance_percent,
                });
            }
        }
        // A plain wall carries the wall parts and nothing else; the one
        // with the lowest id is what a wall cell is.
        let wall = objects
            .iter()
            .filter(|o| {
                o.tags.contains(&parts.wall)
                    && o.collider.is_some()
                    && o.tags
                        .iter()
                        .all(|t| *t == parts.wall || *t == parts.wall_run)
            })
            .min_by_key(|o| o.id)
            .ok_or_else(|| {
                GenerationError::InvalidConfig(
                    "generation::props: no object carries the wall part alone".to_string(),
                )
            })?;
        let wall_defs: Vec<&defs::ObjectDef> = objects
            .iter()
            .filter(|o| o.tags.contains(&parts.wall))
            .collect();
        let mut facade = Vec::new();
        for r in content.rules.iter().filter_map(|r| r.as_requirement()) {
            if wall_defs.iter().any(|o| o.tags.contains(&r.container)) {
                facade.push((r.container, r.requires));
            }
        }
        let mut street_tags: BTreeSet<TagId> = BTreeSet::new();
        for d in &distributions {
            let carried = objects.iter().any(|o| o.tags.contains(&d.per))
                || content
                    .building_types
                    .iter()
                    .any(|b| b.tags.contains(&d.per))
                || content.room_types.iter().any(|r| r.tags.contains(&d.per));
            if d.per == parts.pavement || (!carried && !parts.is_part(d.per)) {
                street_tags.insert(d.per);
            }
        }
        // What a placed def owes beside itself: a distribution row over a
        // tag an object def (no room, no street cell) carries, whose
        // subject an object def carries too -- one subject per row.
        let mut attendants: Vec<(TagId, TagId, u32, i32)> = Vec::new();
        for d in &distributions {
            let object_per = objects.iter().any(|o| o.tags.contains(&d.per));
            let room_per = content
                .room_types
                .iter()
                .any(|room| room.tags.contains(&d.per));
            let object_subject = objects.iter().any(|o| o.tags.contains(&d.subject));
            if object_per && !room_per && !parts.is_part(d.per) && object_subject {
                match attendants
                    .iter_mut()
                    .find(|(c, r, _, _)| *c == d.per && *r == d.subject)
                {
                    Some(a) => {
                        a.2 += 1;
                        a.3 = a.3.min(d.max_distance);
                    }
                    None => attendants.push((d.per, d.subject, 1, d.max_distance)),
                }
            }
        }
        Ok(Catalogue {
            parts,
            street_tags,
            attendants,
            objects,
            forbid,
            side_tags,
            owed,
            distributions,
            facade,
            wall,
        })
    }

    /// Whether `d` may stand where `place` says: it declares its side of
    /// the door (carries a coherence subject) and no forbid row bars it
    /// from the place.
    fn eligible(&self, d: &defs::ObjectDef, place: Place) -> bool {
        let at = match place {
            Place::Floor => self.parts.floor,
            Place::Pavement => self.parts.pavement,
        };
        d.tags.iter().any(|t| self.side_tags.contains(t))
            && !self
                .forbid
                .iter()
                .any(|(s, w)| *w == at && d.tags.contains(s))
    }

    /// Defs carrying `tag` that may stand at `place`, sorted by id.
    fn carrying(&self, tag: TagId, place: Place) -> Vec<&'a defs::ObjectDef> {
        let mut v: Vec<&defs::ObjectDef> = self
            .objects
            .iter()
            .filter(|o| o.tags.contains(&tag) && self.eligible(o, place))
            .collect();
        v.sort_by_key(|o| o.id);
        v
    }

    /// Every outdoor def that may stand on the pavement and that no row
    /// names as a subject or a required fixture, sorted by id: the pool
    /// ambient dressing draws from.
    fn ambient(&self) -> Vec<&'a defs::ObjectDef> {
        let mut v: Vec<&defs::ObjectDef> = self
            .objects
            .iter()
            .filter(|o| {
                self.eligible(o, Place::Pavement)
                    && !o.tags.contains(&self.parts.wall)
                    && !o.tags.iter().any(|t| self.owed.contains(t))
            })
            .collect();
        v.sort_by_key(|o| o.id);
        v
    }

    fn area(d: &defs::ObjectDef) -> u32 {
        d.width * d.height
    }
}

// --- the pass ---------------------------------------------------------

fn pack(x: i32, y: i32) -> u64 {
    seed_from_ids(x as u32 as u64, y as u32 as u64)
}

/// Runs pass 7. `Err` only when an owed fixture's tag has no def that may
/// stand on a floor, or no def of it fits even at its smallest footprint
/// -- the loud failure the leads asked for, never a quiet gap.
pub fn run(
    city_seed: u64,
    skeleton: &Skeleton,
    interiors: &InteriorMap,
    cfg: &GenerationConfig,
    content: &GenerationContent,
) -> Result<PropMap, GenerationError> {
    let cat = Catalogue::new(content)?;
    let seed = seed_from_ids(city_seed, PASS_ID);
    let mut props: Vec<Prop> = Vec::new();
    let mut skips = PropSkips::default();

    for (env, outcome) in skeleton.envelopes.envelopes().zip(interiors.outcomes()) {
        match outcome {
            InteriorOutcome::Laid { interior, .. } => {
                props.extend(dress_one(seed, &cat, cfg, interior, &mut skips)?);
            }
            InteriorOutcome::Shell { .. } | InteriorOutcome::Rejected { .. } => {
                // Solid: the whole footprint is wall.
                let fp = env.footprint;
                for y in fp.y0..fp.y1 {
                    for x in fp.x0..fp.x1 {
                        props.push(wall_prop(&cat, fp, x, y));
                    }
                }
            }
        }
    }

    let street = StreetGrid::build(skeleton, cfg);
    street_furniture(
        seed, &cat, cfg, skeleton, interiors, &street, &mut props, &mut skips,
    );
    let windows = windows_of(cfg, skeleton, &street, &props);

    props.sort_by_key(|p| p.row);
    let collision = build_collision(skeleton.plots.site(), &props, cat.objects)?;
    Ok(PropMap {
        props,
        street,
        collision,
        skips,
        street_tags: cat
            .street_tags
            .iter()
            .copied()
            .filter(|t| *t != cat.parts.pavement)
            .collect(),
        windows,
    })
}

/// One laid building, dressed. When its natural placement leaves a free
/// cell unreachable, the fixtures that stand on more than a cell go
/// compact one at a time -- the one whose compacting alone clears it,
/// else each in turn until it is clear -- so a single awkward bed does not
/// turn the whole house compact. Fixtures are tried in the order pass 6
/// emitted them (`Interior::fixtures`): the first that clears alone wins,
/// and the cumulative run stops at the first fixture that clears.
fn dress_one(
    seed: u64,
    cat: &Catalogue,
    cfg: &GenerationConfig,
    interior: &Interior,
    skips: &mut PropSkips,
) -> Result<Vec<Prop>, GenerationError> {
    let mut first = *skips;
    let b = dress_building(seed, cat, cfg, interior, &BTreeSet::new(), &mut first)?;
    if !needs_compact(interior, &b, cat) {
        *skips = first;
        return Ok(b);
    }
    skips.buildings_replaced += 1;
    // What stood at its natural footprint (a candidate to go compact) and
    // what had already fallen back (kept compact, so that compacting a
    // neighbour never frees room for it to grow into a new pocket).
    let mut natural: Vec<(i32, i32)> = Vec::new();
    let mut pinned: BTreeSet<(i32, i32)> = BTreeSet::new();
    for p in &b {
        let Role::Fixture { cell, tag, .. } = p.role else {
            continue;
        };
        let Some(d) = def_of(cat.objects, p.row.def_id) else {
            continue;
        };
        let largest = cat
            .carrying(tag, Place::Floor)
            .iter()
            .map(|c| Catalogue::area(c))
            .max()
            .unwrap_or(1);
        if Catalogue::area(d) < largest {
            pinned.insert(cell);
        } else if largest > 1 {
            natural.push(cell);
        }
    }
    // The one fixture whose compact variant alone clears the building.
    for &c in &natural {
        let mut one = pinned.clone();
        one.insert(c);
        let t = dress_building(seed, cat, cfg, interior, &one, &mut PropSkips::default())?;
        if !needs_compact(interior, &t, cat) {
            return dress_building(seed, cat, cfg, interior, &one, skips);
        }
    }
    // Else each in turn, until clear; every fixture compact is the last
    // resort, the placement pass 6 proved a lane through.
    let mut forced = pinned;
    for &c in &natural {
        forced.insert(c);
        let t = dress_building(seed, cat, cfg, interior, &forced, &mut PropSkips::default())?;
        if !needs_compact(interior, &t, cat) {
            break;
        }
    }
    dress_building(seed, cat, cfg, interior, &forced, skips)
}

fn wall_prop(cat: &Catalogue, building: Rect, x: i32, y: i32) -> Prop {
    Prop {
        row: PlacedRow {
            floor: 0,
            y,
            x,
            def_id: cat.wall.id,
            layer: cat.wall.layer,
            orientation: 0,
        },
        building: Some(building),
        role: Role::Wall,
    }
}

/// A grid of one room's cells for fit tests.
struct Occupied {
    cells: BTreeSet<(i32, i32)>,
}

fn dress_building(
    seed: u64,
    cat: &Catalogue,
    cfg: &GenerationConfig,
    interior: &Interior,
    forced_compact: &BTreeSet<(i32, i32)>,
    skips: &mut PropSkips,
) -> Result<Vec<Prop>, GenerationError> {
    let fp = interior.footprint;
    let key = rect_seed_key(fp);

    // Cells no extension may cover: doorways and the cell on every side
    // of one, the approach run, and every pass-6 fixture's own cell.
    let mut reserved: BTreeSet<(i32, i32)> = BTreeSet::new();
    for t in &interior.thresholds {
        reserved.insert((t.x, t.y));
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            reserved.insert((t.x + dx, t.y + dy));
        }
    }
    for &c in &interior.approach {
        reserved.insert(c);
    }
    let fixture_cells: BTreeSet<(i32, i32)> =
        interior.fixtures.iter().map(|f| (f.x, f.y)).collect();

    let mut taken = Occupied {
        cells: BTreeSet::new(),
    };
    let mut solid_per_room: BTreeMap<usize, i64> = BTreeMap::new();
    let mut out: Vec<Prop> = Vec::new();

    for f in &interior.fixtures {
        let room = &interior.rooms[f.room];
        let cands = cat.carrying(f.tag, Place::Floor);
        if cands.is_empty() {
            return Err(GenerationError::FixtureUnplaceable {
                x: f.x,
                y: f.y,
                tag: f.tag,
            });
        }
        let compact_only = forced_compact.contains(&(f.x, f.y));
        let max_area = cands.iter().map(|d| Catalogue::area(d)).max().unwrap_or(1);
        let mut rng = Rng::new(seed_from_ids(seed, seed_from_ids(key, pack(f.x, f.y))));
        // Natural variants in a seeded order, then the rest by area
        // descending: the compact fallback is never preferred.
        let mut natural: Vec<&defs::ObjectDef> = cands
            .iter()
            .copied()
            .filter(|d| Catalogue::area(d) == max_area)
            .collect();
        for i in (1..natural.len()).rev() {
            let j = rng.below(i as u64 + 1) as usize;
            natural.swap(i, j);
        }
        let mut rest: Vec<&defs::ObjectDef> = cands
            .iter()
            .copied()
            .filter(|d| Catalogue::area(d) != max_area)
            .collect();
        rest.sort_by_key(|d| (std::cmp::Reverse(Catalogue::area(d)), d.id));
        // Equal-area variants are drawn like the naturals: a shuffle
        // within each area tier, the tiers staying descending.
        let mut lo = 0;
        while lo < rest.len() {
            let tier = Catalogue::area(rest[lo]);
            let hi = lo
                + rest[lo..]
                    .iter()
                    .take_while(|d| Catalogue::area(d) == tier)
                    .count();
            for i in (lo + 1..hi).rev() {
                let j = lo + rng.below((i - lo) as u64 + 1) as usize;
                rest.swap(i, j);
            }
            lo = hi;
        }
        let order: Vec<&defs::ObjectDef> = if compact_only {
            let mut v = rest.clone();
            v.extend(natural.iter().copied());
            v
        } else {
            let mut v = natural.clone();
            v.extend(rest.iter().copied());
            v
        };

        let floor_cells = room.rect.width() * room.rect.height();
        let mut placed = false;
        for (rank, d) in order.iter().enumerate() {
            let (w, h) = (d.width as i32, d.height as i32);
            let solid_cells = if d.collider.is_some() {
                (w * h) as i64
            } else {
                0
            };
            let used = solid_per_room.get(&f.room).copied().unwrap_or(0);
            let is_natural_try = rank < natural.len() && !compact_only;
            if is_natural_try
                && (used + solid_cells) * 100 > floor_cells * cfg.props_max_solid_percent as i64
                && (w * h) > 1
            {
                continue;
            }
            let mut anchors: Vec<(i32, i32)> = Vec::new();
            for ax in (f.x - w + 1)..=f.x {
                for ay in f.y..=(f.y + h - 1) {
                    let fit = (ax..ax + w).all(|x| {
                        ((ay - h + 1)..=ay).all(|y| {
                            room.rect.contains(x, y)
                                && !taken.cells.contains(&(x, y))
                                && ((x, y) == (f.x, f.y)
                                    || (!reserved.contains(&(x, y))
                                        && !fixture_cells.contains(&(x, y))))
                        })
                    });
                    if fit {
                        anchors.push((ax, ay));
                    }
                }
            }
            if anchors.is_empty() {
                continue;
            }
            let (ax, ay) = anchors[rng.below(anchors.len() as u64) as usize];
            for x in ax..ax + w {
                for y in (ay - h + 1)..=ay {
                    taken.cells.insert((x, y));
                }
            }
            *solid_per_room.entry(f.room).or_insert(0) += solid_cells;
            if Catalogue::area(d) < max_area {
                skips.compact_fallbacks += 1;
            }
            out.push(Prop {
                row: PlacedRow {
                    floor: 0,
                    y: ay,
                    x: ax,
                    def_id: d.id,
                    layer: d.layer,
                    orientation: 0,
                },
                building: Some(fp),
                role: Role::Fixture {
                    cell: (f.x, f.y),
                    tag: f.tag,
                    room: f.room,
                },
            });
            placed = true;
            break;
        }
        if !placed {
            return Err(GenerationError::FixtureUnplaceable {
                x: f.x,
                y: f.y,
                tag: f.tag,
            });
        }
    }

    // What a placed def owes beside itself (a table set's chair): on a
    // free floor cell next to its footprint, one the building's cells stay
    // reachable around when one exists.
    let placed_now: Vec<Prop> = out.clone();
    for prop in &placed_now {
        let Role::Fixture { room, .. } = prop.role else {
            continue;
        };
        let Some(def) = def_of(cat.objects, prop.row.def_id) else {
            continue;
        };
        for &(container, requires, min, reach) in &cat.attendants {
            if !def.tags.contains(&container) {
                continue;
            }
            let cands: Vec<&defs::ObjectDef> = cat
                .carrying(requires, Place::Floor)
                .into_iter()
                .filter(|d| d.width == 1 && d.height == 1)
                .collect();
            if cands.is_empty() {
                continue;
            }
            let room_rect = interior.rooms[room].rect;
            let e = extent(&prop.row, def);
            for n in 0..min {
                let mut rng = Rng::new(seed_from_ids(
                    seed,
                    seed_from_ids(
                        key,
                        seed_from_ids(pack(prop.row.x, prop.row.y), 0xc4a1 + n as u64),
                    ),
                ));
                // Beside the footprint first; failing that, any free floor
                // cell of the room inside the row's own reach of it; never
                // on another prop's cell, never beside a doorway.
                let free = |c: (i32, i32)| {
                    room_rect.contains(c.0, c.1)
                        && !taken.cells.contains(&c)
                        && !reserved.contains(&c)
                        && !fixture_cells.contains(&c)
                };
                let mut spots: Vec<(i32, i32)> = Vec::new();
                for ring in 1..=reach.max(1) {
                    let mut layer: Vec<(i32, i32)> = Vec::new();
                    for y in (e.y0 - ring)..(e.y1 + ring) {
                        for x in (e.x0 - ring)..(e.x1 + ring) {
                            // Chebyshev distance from the footprint.
                            let dx = (e.x0 - x).max(x - (e.x1 - 1)).max(0);
                            let dy = (e.y0 - y).max(y - (e.y1 - 1)).max(0);
                            // Orthogonally beside it at ring 1.
                            let beside = ring > 1 || dx == 0 || dy == 0;
                            if dx.max(dy) == ring && beside && free((x, y)) {
                                layer.push((x, y));
                            }
                        }
                    }
                    for k in (1..layer.len()).rev() {
                        let j = rng.below(k as u64 + 1) as usize;
                        layer.swap(k, j);
                    }
                    spots.extend(layer);
                }
                let def_c = cands[rng.below(cands.len() as u64) as usize];
                let row_at = |c: (i32, i32)| PlacedRow {
                    floor: 0,
                    y: c.1,
                    x: c.0,
                    def_id: def_c.id,
                    layer: def_c.layer,
                    orientation: 0,
                };
                // Chairs are underfoot (no collider), so any free cell
                // will do and none can seal a pocket. None free within
                // reach is a counted skip, never a chair on a fixture.
                let pick = spots.first().copied();
                if pick.is_none() {
                    skips.attendants_unplaced += 1;
                }
                if let Some(c) = pick {
                    taken.cells.insert(c);
                    out.push(Prop {
                        row: row_at(c),
                        building: Some(fp),
                        role: Role::Fixture {
                            cell: c,
                            tag: requires,
                            room,
                        },
                    });
                }
            }
        }
    }

    // The shopfront: one glazing unit on the street wall of a building
    // holding the fixture a requirement row names for it.
    let shopfront = shopfront_prop(seed, cat, interior, &fixture_tags(&out));
    let mut window_cells: BTreeSet<(i32, i32)> = BTreeSet::new();
    let mut window: Option<Prop> = None;
    match shopfront {
        ShopfrontOutcome::Placed(p, cells) => {
            window_cells = cells;
            window = Some(p);
        }
        ShopfrontOutcome::NoFit => skips.shopfronts_unplaced += 1,
        ShopfrontOutcome::NotOwed => {}
    }

    for (x, y) in interior.walls() {
        if window_cells.contains(&(x, y)) {
            continue;
        }
        out.push(wall_prop(cat, fp, x, y));
    }
    out.extend(window);
    Ok(out)
}

fn fixture_tags(props: &[Prop]) -> BTreeSet<TagId> {
    props
        .iter()
        .filter_map(|p| match p.role {
            Role::Fixture { tag, .. } => Some(tag),
            _ => None,
        })
        .collect()
}

enum ShopfrontOutcome {
    Placed(Prop, BTreeSet<(i32, i32)>),
    NoFit,
    NotOwed,
}

/// Stands one facade def on the front wall: on a stretch clear of the
/// corners and of the entrance column and its neighbours, where every
/// cell is a wall cell. North and south fronts only -- a glazing unit is
/// drawn along `x`.
fn shopfront_prop(
    seed: u64,
    cat: &Catalogue,
    interior: &Interior,
    have: &BTreeSet<TagId>,
) -> ShopfrontOutcome {
    let owed: Vec<TagId> = cat
        .facade
        .iter()
        .filter(|(_, requires)| have.contains(requires))
        .map(|(container, _)| *container)
        .collect();
    let Some(&container) = owed.first() else {
        return ShopfrontOutcome::NotOwed;
    };
    let fp = interior.footprint;
    let Some(entrance) = interior.entrance() else {
        return ShopfrontOutcome::NoFit;
    };
    let row_y = match interior.front {
        Side::South => fp.y1 - 1,
        Side::North => fp.y0,
        Side::East | Side::West => return ShopfrontOutcome::NoFit,
    };
    let mut defs_: Vec<&defs::ObjectDef> = cat
        .objects
        .iter()
        .filter(|o| {
            o.tags.contains(&cat.parts.wall)
                && o.tags.contains(&container)
                && o.height == 1
                && o.collider.is_some()
        })
        .collect();
    defs_.sort_by_key(|d| d.id);
    if defs_.is_empty() {
        return ShopfrontOutcome::NoFit;
    }
    let walls: BTreeSet<(i32, i32)> = interior.walls().into_iter().collect();
    let mut rng = Rng::new(seed_from_ids(
        seed,
        seed_from_ids(rect_seed_key(fp), 0x5170_f407),
    ));
    let d = defs_[rng.below(defs_.len() as u64) as usize];
    let w = d.width as i32;
    let mut starts: Vec<i32> = Vec::new();
    for x0 in (fp.x0 + 1)..=(fp.x1 - 1 - w) {
        let clear = (x0..x0 + w).all(|x| (x - entrance.x).abs() > 1 && walls.contains(&(x, row_y)));
        if clear {
            starts.push(x0);
        }
    }
    if starts.is_empty() {
        return ShopfrontOutcome::NoFit;
    }
    let x0 = starts[rng.below(starts.len() as u64) as usize];
    let cells = (x0..x0 + w).map(|x| (x, row_y)).collect();
    ShopfrontOutcome::Placed(
        Prop {
            row: PlacedRow {
                floor: 0,
                y: row_y,
                x: x0,
                def_id: d.id,
                layer: d.layer,
                orientation: 0,
            },
            building: Some(fp),
            role: Role::Shopfront,
        },
        cells,
    )
}

// --- the windowed verdict ---------------------------------------------

/// The one reachability verdict over a window of placed rows: rasterises
/// them through [`walkability::rasterise`] and the real object colliders,
/// seeds in `seed_cell`'s first sub-cell quarter and reports
/// `(enclosed, narrow)` findings at the player body. Over a building the
/// window is its footprint plus the street cell its door opens onto; over
/// a street frontage, the pavement band, the face row behind it and one
/// carriageway row.
pub fn window_findings(
    window: Rect,
    seed_cell: (i32, i32),
    rows: &[PlacedRow],
    objects: &[defs::ObjectDef],
) -> Result<(Vec<Finding>, Vec<Finding>), String> {
    let s = defs::COLLIDER_SUBCELLS_PER_CELL;
    let placements: Vec<Placement> = rows
        .iter()
        .map(|r| Placement {
            def_id: r.def_id,
            anchor_x: r.x,
            anchor_y: r.y,
            floor: r.floor,
        })
        .collect();
    let grid: WalkabilityGrid = walkability::rasterise(
        Rect {
            x0: window.x0 * s,
            y0: window.y0 * s,
            x1: window.x1 * s,
            y1: window.y1 * s,
        },
        0,
        &placements,
        objects,
    )?;
    let (sx, sy) = (seed_cell.0 * s + s / 4, seed_cell.1 * s + s / 4);
    let (bw, bh) = player_body_subcells(defs::BALANCE);
    // A region the body cannot stand in is not a walkable region: a
    // sliver left between a prop's collider and a wall is judged on the
    // body-eroded grid, so only room for a body counts as enclosed.
    let enclosed = enclosed_regions(&walkability::erode(&grid, bw, bh), sx, sy)?;
    let narrow = narrow_passages(&grid, sx, sy, bw, bh)?;
    // A pocket every cell of which is a placed prop's own footprint is
    // part of that prop -- the nook a collider leaves inside its own cell
    // -- not a region of the building.
    let mut owned: BTreeSet<(i32, i32)> = BTreeSet::new();
    for r in rows {
        if let Some(def) = def_of(objects, r.def_id) {
            let e = extent(r, def);
            for y in e.y0..e.y1 {
                for x in e.x0..e.x1 {
                    owned.insert((x, y));
                }
            }
        }
    }
    let part_of_a_prop = |f: &Finding, pad: (i32, i32)| {
        let (x0, y0) = (f.bounds.x0.div_euclid(s), f.bounds.y0.div_euclid(s));
        // `bounds` is exclusive: the last origin is `x1 - 1`, and a body
        // from it covers `pad - 1` sub-cells further.
        let x1 = (f.bounds.x1 + pad.0 - 2).div_euclid(s);
        let y1 = (f.bounds.y1 + pad.1 - 2).div_euclid(s);
        (y0..=y1).all(|y| (x0..=x1).all(|x| owned.contains(&(x, y))))
    };
    // On the eroded grid the origins stop a body short of the east and
    // south edges, so a region running off those edges would read as
    // interior: judged by the cells the body covers, as `narrow_passages`
    // does.
    let edge = Rect {
        x0: window.x0 * s,
        y0: window.y0 * s,
        x1: window.x1 * s,
        y1: window.y1 * s,
    };
    let enclosed = enclosed
        .into_iter()
        .filter(|f| f.bounds.x1 + bw - 1 < edge.x1 && f.bounds.y1 + bh - 1 < edge.y1)
        .filter(|f| !part_of_a_prop(f, (bw, bh)))
        .collect();
    let narrow = narrow
        .into_iter()
        .filter(|f| !part_of_a_prop(f, (bw, bh)))
        .collect();
    Ok((enclosed, narrow))
}

/// Whether every cell of `window` that no collider touches is reachable
/// from `seed_cell` over whole cells -- and the seed itself is one.
///
/// Sound as a shortcut for [`window_findings`] under two conditions, both
/// tested: the player body is no bigger than one cell on either axis (so a
/// free cell is a full body wide and sharing an edge with the next is a
/// passage the body fits), and no collider reaches outside its def's own
/// footprint (so a cell no footprint covers is wholly free). When it holds
/// the exact check reports nothing; a differential test holds the two
/// together.
pub fn whole_cells_open(
    window: Rect,
    seed_cell: (i32, i32),
    rows: &[PlacedRow],
    objects: &[defs::ObjectDef],
) -> bool {
    let (w, h) = (window.width() as usize, window.height() as usize);
    if w == 0 || h == 0 || !window.contains(seed_cell.0, seed_cell.1) {
        return false;
    }
    let idx = |x: i32, y: i32| (y - window.y0) as usize * w + (x - window.x0) as usize;
    let mut blocked = vec![false; w * h];
    for r in rows {
        let Some(def) = def_of(objects, r.def_id) else {
            return false;
        };
        if let Some(c) = collider_cells(r, def) {
            for y in c.y0.max(window.y0)..c.y1.min(window.y1) {
                for x in c.x0.max(window.x0)..c.x1.min(window.x1) {
                    blocked[idx(x, y)] = true;
                }
            }
        }
    }
    if blocked[idx(seed_cell.0, seed_cell.1)] {
        return false;
    }
    let free = blocked.iter().filter(|b| !**b).count();
    let mut seen = vec![false; w * h];
    let mut stack = vec![seed_cell];
    seen[idx(seed_cell.0, seed_cell.1)] = true;
    let mut reached = 1usize;
    while let Some((x, y)) = stack.pop() {
        for (nx, ny) in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] {
            if window.contains(nx, ny) && !blocked[idx(nx, ny)] && !seen[idx(nx, ny)] {
                seen[idx(nx, ny)] = true;
                reached += 1;
                stack.push((nx, ny));
            }
        }
    }
    reached == free
}

/// A building's window and its seed: the footprint plus its first
/// approach cell, seeded in that cell.
pub fn building_window(interior: &Interior) -> Option<(Rect, (i32, i32))> {
    let &(sx, sy) = interior.approach.first()?;
    let fp = interior.footprint;
    Some((
        Rect {
            x0: fp.x0.min(sx),
            y0: fp.y0.min(sy),
            x1: fp.x1.max(sx + 1),
            y1: fp.y1.max(sy + 1),
        },
        (sx, sy),
    ))
}

/// Whether `props` (one building's rows) fail to leave every free cell of
/// the building's window reachable over whole cells. A building that does
/// is placed again at compact footprints, which stand inside the whole
/// cells pass 6 already proved a lane through; the district verdict
/// ([`check_reachability`]) judges whatever stands.
fn needs_compact(interior: &Interior, props: &[Prop], cat: &Catalogue) -> bool {
    let Some((window, seed)) = building_window(interior) else {
        return true;
    };
    let rows: Vec<PlacedRow> = props.iter().map(|p| p.row).collect();
    !whole_cells_open(window, seed, &rows, cat.objects)
}

// --- street furniture --------------------------------------------------

/// How a placement keeps clear of its own kind: the subject tag, the
/// least distance to another and whether the cross-section must keep a
/// walkable pavement cell (ambient furniture and bins; not a lamp).
#[derive(Clone, Copy)]
struct Spacing {
    subject: TagId,
    cells: i32,
    keep_walkable: bool,
    /// Whether the piece must front a block: a seat or a bin outside every
    /// area could never be judged against the bin it owes.
    need_block: bool,
}

impl Spacing {
    fn none() -> Self {
        Spacing {
            subject: 0,
            cells: 0,
            keep_walkable: true,
            need_block: true,
        }
    }
}

/// A placed anchor cell and the block it fronts.
type Anchor = ((i32, i32), Option<Rect>);

struct StreetState<'a> {
    grid: &'a StreetGrid,
    taken: BTreeSet<(i32, i32)>,
    /// The cells street furniture covers: a later piece keeps a whole
    /// cell clear of every one, so two pieces never leave a nook between
    /// them.
    furniture: BTreeSet<(i32, i32)>,
    reserved: BTreeSet<(i32, i32)>,
    /// The object table, to take a piece back by its own extent.
    defs: &'a [defs::ObjectDef],
    /// Placed anchors, with the block they front, by function tag.
    placed: BTreeMap<TagId, Vec<Anchor>>,
}

impl<'a> StreetState<'a> {
    /// A fresh state over `grid`: every building footprint is taken and
    /// every approach cell, with the ring around it, is kept clear.
    fn new(
        grid: &'a StreetGrid,
        defs: &'a [defs::ObjectDef],
        skeleton: &Skeleton,
        interiors: &InteriorMap,
    ) -> Self {
        let mut st = StreetState {
            grid,
            taken: BTreeSet::new(),
            furniture: BTreeSet::new(),
            reserved: BTreeSet::new(),
            defs,
            placed: BTreeMap::new(),
        };
        for (_, _, interior) in interiors.laid() {
            for &(x, y) in &interior.approach {
                for dx in -1..=1 {
                    for dy in -1..=1 {
                        st.reserved.insert((x + dx, y + dy));
                    }
                }
            }
        }
        for e in skeleton.envelopes.envelopes() {
            for y in e.footprint.y0..e.footprint.y1 {
                for x in e.footprint.x0..e.footprint.x1 {
                    st.taken.insert((x, y));
                }
            }
        }
        st
    }
}

/// The street's furniture, in order: lamps on a cadence, the lighting
/// row completed, ambient pieces by density, then the bins the companion
/// rows owe.
#[allow(clippy::too_many_arguments)]
fn street_furniture(
    seed: u64,
    cat: &Catalogue,
    cfg: &GenerationConfig,
    skeleton: &Skeleton,
    interiors: &InteriorMap,
    grid: &StreetGrid,
    props: &mut Vec<Prop>,
    skips: &mut PropSkips,
) {
    let mut st = StreetState::new(grid, cat.objects, skeleton, interiors);
    place_lamps(&mut st, cat, cfg, skeleton, seed, props);
    complete_lighting(&mut st, cat, props, skips);
    place_ambient(&mut st, cat, cfg, skeleton, seed, props, skips);
    allocate_companions(&mut st, cat, props, skips);
}

/// Lamps: every distribution row judged over the street's own cells.
/// `cadence` is per side; the two sides of a street are staggered half a
/// cadence, so the street reads as a lamp every half cadence and each
/// side is its own regular row.
fn place_lamps(
    st: &mut StreetState,
    cat: &Catalogue,
    cfg: &GenerationConfig,
    skeleton: &Skeleton,
    seed: u64,
    props: &mut Vec<Prop>,
) {
    for d in cat
        .distributions
        .iter()
        .filter(|d| cat.street_tags.contains(&d.per))
    {
        let cands = cat.carrying(d.subject, Place::Pavement);
        if cands.is_empty() {
            continue;
        }
        let cadence = cfg.props_lamp_cadence_cells.max(d.min_spacing).max(2);
        for e in skeleton.streets.edges() {
            for (side, band) in bands(e, cfg).into_iter().enumerate() {
                let len = band.to - band.from;
                let mut rng = Rng::new(seed_from_ids(
                    seed,
                    seed_from_ids(band.edge_key, side as u64),
                ));
                // Every `cadence` cells from half a cadence in (the far
                // side half a cadence further), and once more near the
                // far end so the run is lit to its last cell; each
                // offered position may give way a few cells to a
                // junction's furniture or an approach.
                let mut at: Vec<i32> = Vec::new();
                let mut t = band.from + (cadence.min(len) / 2).max(0) + side as i32 * (cadence / 2);
                while t < band.to {
                    at.push(t);
                    t += cadence;
                }
                at.push(band.to - 2);
                for t in at {
                    let def = cands[rng.below(cands.len() as u64) as usize];
                    for off in [0, -1, 1, -2, 2, -3, 3] {
                        let tt = t + off;
                        if tt < band.from || tt >= band.to {
                            continue;
                        }
                        let (x, y) = band.cell(tt, band.kerb);
                        let spacing = Spacing {
                            subject: d.subject,
                            cells: d.min_spacing,
                            keep_walkable: false,
                            need_block: false,
                        };
                        if try_place(st, cat, &band, def, (x, y), spacing, props) {
                            break;
                        }
                    }
                }
            }
        }
    }
}

/// Coverage completed from the row itself, judged as the row judges it:
/// a footway cell with no lamp within `max_distance` (a street the site
/// edge cut short, a junction's furniture having taken the offered cell)
/// gets one on the nearest free footway cell. A cell no footway cell can
/// cover is a counted skip -- the row's numbers, not a lamp in a yard.
fn complete_lighting(
    st: &mut StreetState,
    cat: &Catalogue,
    props: &mut Vec<Prop>,
    skips: &mut PropSkips,
) {
    for d in cat
        .distributions
        .iter()
        .filter(|d| cat.street_tags.contains(&d.per))
    {
        let cands = cat.carrying(d.subject, Place::Pavement);
        if cands.is_empty() {
            continue;
        }
        let reach = d.max_distance.max(1);
        let bucket = |x: i32, y: i32| (x.div_euclid(reach), y.div_euclid(reach));
        let mut lamps: BTreeMap<(i32, i32), Vec<(i32, i32)>> = BTreeMap::new();
        for &(c, _) in st.placed.get(&d.subject).map(Vec::as_slice).unwrap_or(&[]) {
            lamps.entry(bucket(c.0, c.1)).or_default().push(c);
        }
        let covered = |lamps: &BTreeMap<(i32, i32), Vec<(i32, i32)>>, x: i32, y: i32| {
            let (bx, by) = bucket(x, y);
            (-1..=1).any(|dx| {
                (-1..=1).any(|dy| {
                    lamps.get(&(bx + dx, by + dy)).is_some_and(|v| {
                        v.iter()
                            .any(|l| (l.0 - x).abs().max((l.1 - y).abs()) <= d.max_distance)
                    })
                })
            })
        };
        let spacing = Spacing {
            subject: d.subject,
            cells: d.min_spacing,
            keep_walkable: false,
            need_block: false,
        };
        let cells: Vec<(i32, i32)> = st.grid.pavement_cells().map(|(x, y, _)| (x, y)).collect();
        for (x, y) in cells {
            if covered(&lamps, x, y) {
                continue;
            }
            let mut placed = false;
            'rings: for r in 0..=d.max_distance {
                for dy in -r..=r {
                    for dx in -r..=r {
                        if dx.abs().max(dy.abs()) != r {
                            continue;
                        }
                        let (cx, cy) = (x + dx, y + dy);
                        if !st.grid.is_pavement(cx, cy) {
                            continue;
                        }
                        let band = single_cell_band(cx, cy);
                        let def = cands
                            [((cx as i64 * 31 + cy as i64).unsigned_abs() as usize) % cands.len()];
                        if try_place(st, cat, &band, def, (cx, cy), spacing, props) {
                            lamps.entry(bucket(cx, cy)).or_default().push((cx, cy));
                            placed = true;
                            break 'rings;
                        }
                    }
                }
            }
            if !placed {
                skips.street_unplaced += 1;
            }
        }
    }
}

/// A one-cell stand-in band for a piece offered at an arbitrary
/// pavement cell (no cross-section to keep: it is a lamp).
fn single_cell_band(x: i32, y: i32) -> Band {
    Band {
        vertical: true,
        outer: x,
        kerb: x,
        outward: 1,
        from: y,
        to: y + 1,
        pave: 0,
        edge_key: 0,
    }
}

/// Ambient pieces: singles, and now and then a pair, offered per 100
/// cells of building-side run at the density of the street, drawn from
/// every outdoor def no row owes (a bench, a tree, a planter). Never a
/// def carrying a tag a row names as subject or as a required fixture.
fn place_ambient(
    st: &mut StreetState,
    cat: &Catalogue,
    cfg: &GenerationConfig,
    skeleton: &Skeleton,
    seed: u64,
    props: &mut Vec<Prop>,
    skips: &mut PropSkips,
) {
    let per100_lo = cfg.props_ambient_per_100_min as i64;
    let per100_hi = cfg.props_ambient_per_100_max as i64;
    let ambient = cat.ambient();
    if ambient.is_empty() {
        return;
    }
    for e in skeleton.streets.edges() {
        for (si, band) in bands(e, cfg).into_iter().enumerate() {
            if band.pave < 2 {
                continue;
            }
            let len = (band.to - band.from) as i64;
            let mid = {
                let (x, y) = band.cell((band.from + band.to) / 2, band.outer);
                skeleton
                    .land_use
                    .at_world(x, y)
                    .map(|p| p.density)
                    .unwrap_or(cfg.density_min)
            };
            let span = (cfg.density_max - cfg.density_min).max(1) as i64;
            let per100 = per100_lo
                + (per100_hi - per100_lo) * (mid - cfg.density_min).clamp(0, span as i32) as i64
                    / span;
            let mut rng = Rng::new(seed_from_ids(
                seed,
                seed_from_ids(band.edge_key, 100 + si as u64),
            ));
            let mut n = len * per100 / 100;
            if rng.below(100) < ((len * per100) % 100) as u64 {
                n += 1;
            }
            for _ in 0..n {
                let t = band.from + rng.below(len.max(1) as u64) as i32;
                let def = ambient[rng.below(ambient.len() as u64) as usize];
                let at = band.cell(t, band.outer);
                if !try_place(st, cat, &band, def, at, Spacing::none(), props) {
                    skips.street_unplaced += 1;
                    continue;
                }
                // Now and then a pair: a different def beside the first.
                if rng.below(4) == 0 {
                    let other: Vec<&defs::ObjectDef> =
                        ambient.iter().copied().filter(|o| o.id != def.id).collect();
                    if !other.is_empty() {
                        let d2 = other[rng.below(other.len() as u64) as usize];
                        let at2 = band.cell(t + def.width as i32 + 1, band.outer);
                        try_place(st, cat, &band, d2, at2, Spacing::none(), props);
                    }
                }
            }
        }
    }
}

/// Companion rows (`waste` per `seating`): the way pass 5 places a
/// distributed institution from its row. Every seat is covered by a bin
/// within the row's `max_distance` in its own block; each bin stands where
/// it covers the most uncovered seats, kept `min_spacing` from the others;
/// and when the count would pass the row's own upper bound
/// ([`crate::rules::distribution_target`] over the seats standing), the
/// bins covering the fewest seats go, with the seats nothing else covers.
fn allocate_companions(
    st: &mut StreetState,
    cat: &Catalogue,
    props: &mut Vec<Prop>,
    skips: &mut PropSkips,
) {
    let companions: Vec<Dist> = cat
        .distributions
        .iter()
        .copied()
        .filter(|d| !cat.street_tags.contains(&d.per))
        .collect();
    for c in companions {
        let bins_def = cat.carrying(c.subject, Place::Pavement);
        if bins_def.is_empty() {
            continue;
        }
        let spacing = Spacing {
            subject: c.subject,
            cells: c.min_spacing,
            keep_walkable: true,
            need_block: true,
        };
        let seats_of = |st: &StreetState| -> Vec<Anchor> {
            let mut v = st.placed.get(&c.per).cloned().unwrap_or_default();
            v.sort_by_key(|&((x, y), _)| (y, x));
            v
        };
        let near = |a: (i32, i32), b: (i32, i32)| {
            (a.0 - b.0).abs().max((a.1 - b.1).abs()) <= c.max_distance
        };
        let bins_of = |st: &StreetState| -> Vec<Anchor> {
            st.placed.get(&c.subject).cloned().unwrap_or_default()
        };
        // Cover every seat.
        loop {
            let bins = bins_of(st);
            let seats = seats_of(st);
            let uncovered: Vec<Anchor> = seats
                .iter()
                .copied()
                .filter(|&(s, b)| !bins.iter().any(|&(n, nb)| nb == b && near(n, s)))
                .collect();
            let Some(&(first, block)) = uncovered.first() else {
                break;
            };
            let mut cands: Vec<(usize, i32, i32, i32)> = Vec::new();
            for dy in -c.max_distance..=c.max_distance {
                for dx in -c.max_distance..=c.max_distance {
                    let (x, y) = (first.0 + dx, first.1 + dy);
                    if !st.grid.is_pavement(x, y) || st.grid.block_at(x, y) != block {
                        continue;
                    }
                    let gain = uncovered
                        .iter()
                        .filter(|&&(s, b)| b == block && near((x, y), s))
                        .count();
                    cands.push((usize::MAX - gain, dx.abs().max(dy.abs()), y, x));
                }
            }
            cands.sort();
            let mut placed = false;
            for (_, _, y, x) in cands {
                let def =
                    bins_def[((x as i64 * 31 + y as i64).unsigned_abs() as usize) % bins_def.len()];
                let band = single_cell_band(x, y);
                if try_place(st, cat, &band, def, (x, y), spacing, props) {
                    placed = true;
                    break;
                }
            }
            if !placed {
                // No bin can stand within reach: the seat goes.
                skips.street_unplaced += 1;
                remove_at(st, props, first);
            }
        }
        // Trim to the row's own ratio band.
        loop {
            let seats = seats_of(st);
            let bins = bins_of(st);
            let (_, _, upper) = crate::rules::distribution_target(
                seats.len() as u64,
                c.ratio.max(1),
                c.tolerance_percent,
            );
            if (bins.len() as u64) <= upper || bins.is_empty() {
                break;
            }
            // The bin whose own seats are fewest.
            let cover = |bin: &Anchor| -> Vec<Anchor> {
                seats
                    .iter()
                    .copied()
                    .filter(|&(s, b)| b == bin.1 && near(bin.0, s))
                    .collect()
            };
            let victim = *bins
                .iter()
                .min_by_key(|b| {
                    let ((x, y), _) = **b;
                    (cover(b).len(), y, x)
                })
                .expect("non-empty");
            let sole: Vec<Anchor> = cover(&victim)
                .into_iter()
                .filter(|&(s, b)| {
                    !bins
                        .iter()
                        .any(|o| *o != victim && o.1 == b && near(o.0, s))
                })
                .collect();
            remove_at(st, props, victim.0);
            for (s, _) in sole {
                remove_at(st, props, s);
                skips.street_unplaced += 1;
            }
        }
    }
}

/// Takes back the street piece anchored at `at` -- its row, its cells and
/// the anchors it registered -- leaving the state as if it had never been
/// placed. Returns whether a piece stood there.
fn remove_at(st: &mut StreetState, props: &mut Vec<Prop>, at: (i32, i32)) -> bool {
    let Some(i) = props
        .iter()
        .position(|p| matches!(p.role, Role::Street { .. }) && (p.row.x, p.row.y) == at)
    else {
        return false;
    };
    let p = props.remove(i);
    if let Some(def) = def_of(st.defs, p.row.def_id) {
        let e = extent(&p.row, def);
        for y in e.y0..e.y1 {
            for x in e.x0..e.x1 {
                st.taken.remove(&(x, y));
                st.furniture.remove(&(x, y));
            }
        }
        for t in def.tags {
            if let Some(v) = st.placed.get_mut(t)
                && let Some(k) = v.iter().position(|&(c, _)| c == at)
            {
                v.remove(k);
            }
        }
    }
    true
}

/// The window of every pavement band that carries a placed prop: the
/// band's rows, the face row behind it and the first carriageway row in
/// front of it, along the whole edge, seeded in a carriageway cell.
fn windows_of(
    cfg: &GenerationConfig,
    skeleton: &Skeleton,
    grid: &StreetGrid,
    props: &[Prop],
) -> Vec<(Rect, (i32, i32))> {
    let street: Vec<(i32, i32)> = props
        .iter()
        .filter(|p| matches!(p.role, Role::Street { .. }))
        .map(|p| (p.row.x, p.row.y))
        .collect();
    let mut out = Vec::new();
    for e in skeleton.streets.edges() {
        for band in bands(e, cfg) {
            let rows = [
                band.outer + band.outward,
                band.outer,
                band.kerb,
                band.kerb - band.outward,
            ];
            let lo = *rows.iter().min().unwrap();
            let hi = *rows.iter().max().unwrap();
            let rect = if band.vertical {
                Rect {
                    x0: lo,
                    y0: band.from,
                    x1: hi + 1,
                    y1: band.to,
                }
            } else {
                Rect {
                    x0: band.from,
                    y0: lo,
                    x1: band.to,
                    y1: hi + 1,
                }
            };
            if !street.iter().any(|&(x, y)| rect.contains(x, y)) {
                continue;
            }
            let mid = (band.from + band.to) / 2;
            let seed = (0..(band.to - band.from)).find_map(|k| {
                let t = mid + if k % 2 == 0 { k / 2 } else { -(k / 2 + 1) };
                let (x, y) = band.cell(t, band.kerb - band.outward);
                (t >= band.from && t < band.to && grid.is_road(x, y)).then_some((x, y))
            });
            if let Some(seed) = seed {
                out.push((rect, seed));
            }
        }
    }
    out
}

/// Stands `def` with its anchor at `at` on a pavement band when its whole
/// footprint is free pavement of one block, off every reserved cell,
/// at least `spacing` from a placed `subject`, and leaves a walkable
/// pavement cell in each cross-section it touches.
fn try_place(
    st: &mut StreetState,
    cat: &Catalogue,
    band: &Band,
    def: &defs::ObjectDef,
    at: (i32, i32),
    spacing: Spacing,
    props: &mut Vec<Prop>,
) -> bool {
    let Spacing {
        subject,
        cells: spacing,
        keep_walkable,
        need_block,
    } = spacing;
    let row = PlacedRow {
        floor: 0,
        y: at.1,
        x: at.0,
        def_id: def.id,
        layer: def.layer,
        orientation: 0,
    };
    let fp = extent(&row, def);
    let mut block: Option<Option<Rect>> = None;
    for y in fp.y0..fp.y1 {
        for x in fp.x0..fp.x1 {
            if !st.grid.is_pavement(x, y)
                || st.taken.contains(&(x, y))
                || st.reserved.contains(&(x, y))
            {
                return false;
            }
            let b = st.grid.block_at(x, y);
            match block {
                None => block = Some(b),
                Some(prev) if prev != b => return false,
                _ => {}
            }
        }
    }
    if need_block && block.flatten().is_none() {
        return false;
    }
    if spacing > 0
        && let Some(cells) = st.placed.get(&subject)
        && cells
            .iter()
            .any(|(c, _)| (c.0 - at.0).abs().max((c.1 - at.1).abs()) < spacing)
    {
        return false;
    }
    for y in fp.y0 - 1..fp.y1 + 1 {
        for x in fp.x0 - 1..fp.x1 + 1 {
            if st.furniture.contains(&(x, y)) {
                return false;
            }
        }
    }
    // The cross-section keeps one walkable pavement cell.
    let inside = |x: i32, y: i32| fp.contains(x, y);
    for y in fp.y0..fp.y1 {
        for x in fp.x0..fp.x1 {
            let t = if band.vertical { y } else { x };
            // Lamps (not `keep_walkable`) may stand on a one-cell lane
            // pavement: the carriageway beside it is walkable.
            if !keep_walkable && band.pave < 2 {
                continue;
            }
            // A stand-in band (`pave == 0`: a piece offered at an arbitrary
            // cell) has no rows of its own: a walkable pavement cell must
            // stay beside it.
            let free = if band.pave == 0 {
                [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
                    .into_iter()
                    .any(|(cx, cy)| {
                        st.grid.is_pavement(cx, cy)
                            && !st.taken.contains(&(cx, cy))
                            && !inside(cx, cy)
                    })
            } else {
                band.rows().any(|r| {
                    let (cx, cy) = band.cell(t, r);
                    st.grid.is_pavement(cx, cy) && !st.taken.contains(&(cx, cy)) && !inside(cx, cy)
                })
            };
            if !free {
                return false;
            }
        }
    }
    for y in fp.y0..fp.y1 {
        for x in fp.x0..fp.x1 {
            st.taken.insert((x, y));
            st.furniture.insert((x, y));
        }
    }
    let fronted = block.flatten();
    // Every function tag of the def is a placed anchor of its own, so a
    // companion row can find it.
    for t in def.tags {
        if cat
            .distributions
            .iter()
            .any(|d| d.subject == *t || d.per == *t)
        {
            st.placed.entry(*t).or_default().push((at, fronted));
        }
    }
    props.push(Prop {
        row,
        building: None,
        role: Role::Street { block: fronted },
    });
    true
}

// --- verdict and rule-site adapter -------------------------------------

/// The finished district's reachability verdict ([`super::District::
/// check_reachability`]).
pub(super) fn check_reachability(
    d: &super::District,
    content: &GenerationContent,
) -> Result<(), GenerationError> {
    let objects = content.objects;
    let mut by_building: BTreeMap<Rect, Vec<PlacedRow>> = BTreeMap::new();
    let mut by_chunk: BTreeMap<(i32, i32), Vec<usize>> = BTreeMap::new();
    let chunk = crate::world::CHUNK_SIZE;
    for (i, p) in d.props.props().iter().enumerate() {
        if let Some(b) = p.building {
            by_building.entry(b).or_default().push(p.row);
        }
        by_chunk
            .entry((p.row.x.div_euclid(chunk), p.row.y.div_euclid(chunk)))
            .or_default()
            .push(i);
    }
    let fail = |window: Rect, enclosed: Vec<Finding>, narrow: Vec<Finding>| {
        let (first, is_narrow) = match (enclosed.first(), narrow.first()) {
            (Some(f), _) => (f.bounds, false),
            (None, Some(f)) => (f.bounds, true),
            (None, None) => return None,
        };
        Some(GenerationError::Unreachable {
            count: enclosed.len() + narrow.len(),
            window,
            first,
            narrow: is_narrow,
        })
    };
    for (_, _, interior) in d.interiors.laid() {
        let Some((window, seed)) = building_window(interior) else {
            continue;
        };
        let rows = by_building
            .get(&interior.footprint)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        if whole_cells_open(window, seed, rows, objects) {
            continue;
        }
        let (enclosed, narrow) = window_findings(window, seed, rows, objects)
            .map_err(|reason| GenerationError::WindowUnreadable { window, reason })?;
        if let Some(e) = fail(window, enclosed, narrow) {
            return Err(e);
        }
    }
    for &(window, seed) in &d.props.windows {
        let mut rows: Vec<PlacedRow> = Vec::new();
        for cx in (window.x0 - chunk).div_euclid(chunk)..=(window.x1 + chunk).div_euclid(chunk) {
            for cy in (window.y0 - chunk).div_euclid(chunk)..=(window.y1 + chunk).div_euclid(chunk)
            {
                for &i in by_chunk.get(&(cx, cy)).map(Vec::as_slice).unwrap_or(&[]) {
                    let row = d.props.props()[i].row;
                    let Some(def) = def_of(objects, row.def_id) else {
                        continue;
                    };
                    if extent(&row, def).overlaps(&window) {
                        rows.push(row);
                    }
                }
            }
        }
        if whole_cells_open(window, seed, &rows, objects) {
            continue;
        }
        let (enclosed, narrow) = window_findings(window, seed, &rows, objects)
            .map_err(|reason| GenerationError::WindowUnreadable { window, reason })?;
        if let Some(e) = fail(window, enclosed, narrow) {
            return Err(e);
        }
    }
    Ok(())
}

/// Stamps the street's pavement into a rule site, each cell in the block
/// it fronts -- before any building, so a building's own approach cells
/// then overwrite theirs.
pub(super) fn stamp_street(
    builder: &mut super::site::SiteBuilder,
    map: &PropMap,
    vocab: &Vocabulary,
) {
    let mut street_tags: Vec<TagId> = vec![vocab.parts.pavement];
    street_tags.extend_from_slice(&map.street_tags);
    let mut by_block: BTreeMap<Option<Rect>, super::site::ProfileId> = BTreeMap::new();
    for (x, y, block) in map.street.pavement_cells() {
        let prof = match by_block.get(&block) {
            Some(p) => *p,
            None => {
                let areas: Vec<_> = block
                    .map(|b| builder.area(rect_seed_key(b)))
                    .into_iter()
                    .collect();
                let p = builder.shared_profile(&street_tags, &areas);
                by_block.insert(block, p);
                p
            }
        };
        builder.set(x, y, prof);
    }
}

/// Stamps every placed prop's tags into a rule site. A multi-cell prop's
/// function tags sit on one cell only (its fixture cell, or its anchor on
/// the street) so a count over a tag counts props; every other cell it
/// covers carries only the fixture role.
pub(super) fn stamp_props(
    builder: &mut super::site::SiteBuilder,
    map: &PropMap,
    interiors: &InteriorMap,
    objects: &[defs::ObjectDef],
    vocab: &Vocabulary,
) {
    let parts = vocab.parts;
    let laid: BTreeMap<Rect, &Interior> =
        interiors.laid().map(|(_, _, i)| (i.footprint, i)).collect();
    for p in map.props() {
        let Some(def) = def_of(objects, p.row.def_id) else {
            continue;
        };
        let fp = extent(&p.row, def);
        match p.role {
            Role::Wall => {}
            Role::Shopfront => {
                let Some(b) = p.building else { continue };
                let area = builder.area(super::interiors::building_area_id(b));
                let prof = builder.shared_profile(def.tags, &[area]);
                for y in fp.y0..fp.y1 {
                    for x in fp.x0..fp.x1 {
                        builder.merge(x, y, prof);
                    }
                }
            }
            Role::Fixture { cell, room, .. } => {
                let Some(b) = p.building else { continue };
                let Some(interior) = laid.get(&b) else {
                    continue;
                };
                let building = builder.area(super::interiors::building_area_id(b));
                let room_area =
                    builder.area(super::interiors::room_area_id(interior.rooms[room].rect));
                let mut tags: Vec<TagId> = def.tags.to_vec();
                tags.push(parts.floor);
                let at = builder.shared_profile(&tags, &[building, room_area]);
                let rest =
                    builder.shared_profile(&[parts.floor, parts.fixture], &[building, room_area]);
                for y in fp.y0..fp.y1 {
                    for x in fp.x0..fp.x1 {
                        builder.merge(x, y, if (x, y) == cell { at } else { rest });
                    }
                }
            }
            Role::Street { block } => {
                let areas: Vec<_> = block
                    .map(|b| builder.area(rect_seed_key(b)))
                    .into_iter()
                    .collect();
                let mut tags: Vec<TagId> = def.tags.to_vec();
                tags.push(parts.pavement);
                let at = builder.shared_profile(&tags, &areas);
                let rest = builder.shared_profile(&[parts.fixture], &areas);
                for y in fp.y0..fp.y1 {
                    for x in fp.x0..fp.x1 {
                        builder.merge(
                            x,
                            y,
                            if (x, y) == (p.row.x, p.row.y) {
                                at
                            } else {
                                rest
                            },
                        );
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generation::interiors::{Fixture, Room, Threshold};
    use crate::world::walkability::{Placement, rasterise};

    fn cfg() -> GenerationConfig {
        GenerationConfig::from_balance(defs::BALANCE).unwrap()
    }

    /// An 8x8 footprint whose one 6x6 room has its street door in the south
    /// wall and a two-cell approach, `fixtures` stood on its floor.
    fn interior(fixtures: &[(i32, i32, TagId)]) -> Interior {
        let fp = Rect {
            x0: 100,
            y0: 100,
            x1: 108,
            y1: 108,
        };
        Interior {
            footprint: fp,
            front: Side::South,
            rooms: vec![Room {
                rect: Rect {
                    x0: 101,
                    y0: 101,
                    x1: 107,
                    y1: 107,
                },
                room_type: defs::ROOM_TYPES[0].id,
            }],
            thresholds: vec![Threshold {
                x: 104,
                y: 107,
                room: 0,
                entrance: true,
            }],
            fixtures: fixtures
                .iter()
                .map(|&(x, y, tag)| Fixture { x, y, tag, room: 0 })
                .collect(),
            approach: vec![(104, 108), (104, 109)],
        }
    }

    /// A wall-backed anchor tag with a multi-cell natural def, read off
    /// the committed tag table by its placement class.
    fn multi_cell_tag(cat: &Catalogue) -> TagId {
        defs::TAGS
            .iter()
            .filter(|t| t.placement == Some(defs::TagPlacement::WallBacked))
            .find(|t| {
                cat.carrying(t.id, Place::Floor)
                    .iter()
                    .any(|d| d.width * d.height > 1)
            })
            .map(|t| t.id)
            .expect("a wall-backed anchor with a multi-cell def")
    }

    fn catalogue() -> Catalogue<'static> {
        Catalogue::new(&GenerationContent::committed()).unwrap()
    }

    fn dress(
        cat: &Catalogue,
        seed: u64,
        interior: &Interior,
        compact: bool,
    ) -> Result<Vec<Prop>, GenerationError> {
        let mut skips = PropSkips::default();
        let forced: BTreeSet<(i32, i32)> = if compact {
            interior.fixtures.iter().map(|f| (f.x, f.y)).collect()
        } else {
            BTreeSet::new()
        };
        dress_building(seed, cat, &cfg(), interior, &forced, &mut skips)
    }

    fn def(id: u32) -> &'static defs::ObjectDef {
        defs::OBJECTS.iter().find(|o| o.id == id).unwrap()
    }

    #[test]
    fn a_placement_is_one_row_and_its_extent_is_its_defs() {
        let cat = catalogue();
        let tag = multi_cell_tag(&cat);
        let i = interior(&[(101, 101, tag)]);
        for seed in 0..32 {
            let props = dress(&cat, seed, &i, false).unwrap();
            let fixture: Vec<&Prop> = props
                .iter()
                .filter(|p| matches!(p.role, Role::Fixture { .. }))
                .collect();
            assert_eq!(fixture.len(), 1, "one owed fixture is one row");
            let row = fixture[0].row;
            let d = def(row.def_id);
            let e = extent(&row, d);
            assert_eq!(e.width(), d.width as i64);
            assert_eq!(e.height(), d.height as i64);
            // The anchor is the south-west corner.
            assert_eq!((e.x0, e.y1 - 1), (row.x, row.y));
            assert!(e.contains(101, 101), "the footprint holds the owed cell");
        }
    }

    #[test]
    fn a_multi_cell_def_is_refused_or_moved_never_clipped() {
        let cat = catalogue();
        let tag = multi_cell_tag(&cat);
        let room = Rect {
            x0: 101,
            y0: 101,
            x1: 107,
            y1: 107,
        };
        // A fixture in the room's corner (a footprint would overhang the
        // envelope one way), one beside the doorway's inside cell (it
        // would cover the cell in front of the threshold) and one at the
        // bottom row above the approach.
        for cell in [(101, 101), (106, 106), (103, 106), (105, 106), (104, 106)] {
            let i = interior(&[(cell.0, cell.1, tag)]);
            let reserved: Vec<(i32, i32)> = i
                .thresholds
                .iter()
                .flat_map(|t| {
                    [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)].map(|(dx, dy)| (t.x + dx, t.y + dy))
                })
                .chain(i.approach.iter().copied())
                .collect();
            for seed in 0..32 {
                let props = dress(&cat, seed, &i, false).unwrap();
                for p in props
                    .iter()
                    .filter(|p| matches!(p.role, Role::Fixture { .. }))
                {
                    let e = extent(&p.row, def(p.row.def_id));
                    for y in e.y0..e.y1 {
                        for x in e.x0..e.x1 {
                            assert!(room.contains(x, y), "{cell:?}: ({x}, {y}) clipped the room");
                            if (x, y) != cell {
                                assert!(
                                    !reserved.contains(&(x, y)),
                                    "{cell:?}: ({x}, {y}) covers a doorway or approach cell"
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn the_pass_picks_up_any_def_that_carries_the_tag() {
        // A def of the same tag under a key and id nothing names: the pass
        // reads tags, so a seeded draw reaches it.
        let content = GenerationContent::committed();
        let cat0 = Catalogue::new(&content).unwrap();
        let tag = multi_cell_tag(&cat0);
        let template = cat0
            .carrying(tag, Place::Floor)
            .into_iter()
            .max_by_key(|d| d.width * d.height)
            .unwrap();
        let fresh = defs::ObjectDef {
            id: 90_001,
            key: "an_unrelated_key",
            ..*template
        };
        let mut objects: Vec<defs::ObjectDef> = defs::OBJECTS
            .iter()
            .filter(|o| {
                !cat0
                    .carrying(tag, Place::Floor)
                    .iter()
                    .any(|d| d.id == o.id)
            })
            .copied()
            .collect();
        objects.push(fresh);
        let swapped = GenerationContent {
            objects: &objects,
            ..content
        };
        let cat = Catalogue::new(&swapped).unwrap();
        let i = interior(&[(101, 101, tag)]);
        let props = dress(&cat, 5, &i, false).unwrap();
        assert!(
            props
                .iter()
                .any(|p| matches!(p.role, Role::Fixture { .. }) && p.row.def_id == 90_001),
            "the only def carrying the tag is the one stood"
        );
    }

    #[test]
    fn dressing_one_building_never_moves_its_neighbours_draws() {
        let cat = catalogue();
        let tag = multi_cell_tag(&cat);
        let a1 = interior(&[(101, 101, tag)]);
        let a2 = interior(&[(101, 101, tag), (106, 101, tag)]);
        let mut b = interior(&[(102, 101, tag)]);
        b.footprint = Rect {
            x0: 120,
            y0: 100,
            x1: 128,
            y1: 108,
        };
        b.rooms[0].rect = Rect {
            x0: 121,
            y0: 101,
            x1: 127,
            y1: 107,
        };
        b.fixtures[0].x = 122;
        b.thresholds[0].x = 124;
        b.approach = vec![(124, 108), (124, 109)];
        let rows = |p: Vec<Prop>| p.into_iter().map(|p| p.row).collect::<Vec<_>>();
        let before = rows(dress(&cat, 77, &b, false).unwrap());
        let _ = (dress(&cat, 77, &a1, false), dress(&cat, 77, &a2, false));
        let after = rows(dress(&cat, 77, &b, false).unwrap());
        assert_eq!(before, after);
    }

    #[test]
    fn an_owed_fixture_no_def_carries_is_a_typed_error() {
        let content = GenerationContent::committed();
        let cat0 = Catalogue::new(&content).unwrap();
        let tag = multi_cell_tag(&cat0);
        let without: Vec<defs::ObjectDef> = defs::OBJECTS
            .iter()
            .filter(|o| !o.tags.contains(&tag))
            .copied()
            .collect();
        let bare = GenerationContent {
            objects: &without,
            ..content
        };
        let cat = Catalogue::new(&bare).unwrap();
        let i = interior(&[(101, 101, tag)]);
        assert!(matches!(
            dress(&cat, 1, &i, false),
            Err(GenerationError::FixtureUnplaceable { x: 101, y: 101, .. })
        ));
    }

    /// Props over a chunk boundary: overlapping solids, one straddling
    /// `x = 32`, and a def with no collider.
    fn collision_props() -> Vec<Prop> {
        let solid: Vec<&defs::ObjectDef> = defs::OBJECTS
            .iter()
            .filter(|o| o.collider.is_some() && o.width >= 2)
            .collect();
        let flat = defs::OBJECTS
            .iter()
            .find(|o| o.collider.is_none())
            .expect("a def with no collider");
        let at = |d: &defs::ObjectDef, x: i32, y: i32| Prop {
            row: PlacedRow {
                floor: 0,
                y,
                x,
                def_id: d.id,
                layer: d.layer,
                orientation: 0,
            },
            building: None,
            role: Role::Street { block: None },
        };
        vec![
            at(solid[0], 31, 10),
            at(solid[1 % solid.len()], 32, 10),
            at(solid[0], 40, 12),
            at(solid[0], 41, 12),
            at(flat, 10, 10),
        ]
    }

    #[test]
    fn the_collision_map_is_the_rows_rasterised_and_a_collider_less_prop_adds_nothing() {
        let site = Rect {
            x0: 0,
            y0: 0,
            x1: 64,
            y1: 32,
        };
        let props = collision_props();
        let map = PropMap::test_fixture(site, props.clone(), defs::OBJECTS).unwrap();
        let s = defs::COLLIDER_SUBCELLS_PER_CELL;
        let placements: Vec<Placement> = props
            .iter()
            .map(|p| Placement {
                def_id: p.row.def_id,
                anchor_x: p.row.x,
                anchor_y: p.row.y,
                floor: p.row.floor,
            })
            .collect();
        let grid = rasterise(
            Rect {
                x0: site.x0 * s,
                y0: site.y0 * s,
                x1: site.x1 * s,
                y1: site.y1 * s,
            },
            0,
            &placements,
            defs::OBJECTS,
        )
        .unwrap();
        let fc = map.collision(0).unwrap();
        let mut blocked = 0;
        for y in site.y0..site.y1 {
            for x in site.x0..site.x1 {
                let reference =
                    (0..s).any(|dy| (0..s).any(|dx| grid.is_blocked(x * s + dx, y * s + dy)));
                assert_eq!(fc.is_blocked(x, y), reference, "cell ({x}, {y})");
                blocked += reference as usize;
            }
        }
        assert!(blocked > 0, "the solid props block something");
        // The collider-less prop's own cell is open.
        let flat = props.last().unwrap().row;
        assert!(!fc.is_blocked(flat.x, flat.y));
    }

    #[test]
    fn the_collision_map_is_built_once_and_read_from_the_same_allocation() {
        let site = Rect {
            x0: 0,
            y0: 0,
            x1: 64,
            y1: 32,
        };
        let map = PropMap::test_fixture(site, collision_props(), defs::OBJECTS).unwrap();
        let a = map.collision(0).unwrap() as *const FloorCollision;
        let b = map.collision(0).unwrap() as *const FloorCollision;
        assert!(std::ptr::eq(a, b));
    }

    #[test]
    fn the_rows_are_sorted_and_carry_no_extent_of_their_own() {
        // `PlacedRow` is exactly floor, anchor, def, layer, orientation.
        let site = Rect {
            x0: 0,
            y0: 0,
            x1: 64,
            y1: 32,
        };
        let map = PropMap::test_fixture(site, collision_props(), defs::OBJECTS).unwrap();
        let rows: Vec<PlacedRow> = map.rows().copied().collect();
        let mut sorted = rows.clone();
        sorted.sort();
        assert_eq!(rows, sorted);
        assert_eq!(std::mem::size_of::<PlacedRow>(), 20);
    }

    // --- the whole-cell shortcut ---------------------------------------

    #[test]
    fn the_player_body_is_never_bigger_than_one_cell_so_the_shortcut_is_sound() {
        // `whole_cells_open` reads a free cell as a full body wide: it is
        // sound only while the body fits a cell on both axes. Raising the
        // balance range past a cell must fail here, naming why.
        for key in [
            "movement.player_body_width_subcells",
            "movement.player_body_height_subcells",
        ] {
            let row = defs::BALANCE.iter().find(|b| b.key == key).unwrap();
            assert!(
                row.max <= defs::COLLIDER_SUBCELLS_PER_CELL as i64,
                "{key} may reach {} sub-cells, more than a cell: props::whole_cells_open treats a free cell as a full body wide and is no longer sound",
                row.max
            );
        }
    }

    #[test]
    fn every_def_collider_lies_inside_its_own_footprint() {
        // The other half of the shortcut's soundness: a cell no footprint
        // covers is wholly free.
        let s = defs::COLLIDER_SUBCELLS_PER_CELL;
        for o in defs::OBJECTS {
            if let Some(c) = o.collider {
                assert!(
                    c.x0 >= 0
                        && c.y0 >= 0
                        && c.x1 <= o.width as i32 * s
                        && c.y1 <= o.height as i32 * s
                        && c.x0 < c.x1
                        && c.y0 < c.y1,
                    "{}: collider {c:?} outside its {}x{} footprint",
                    o.key,
                    o.width,
                    o.height
                );
            }
        }
    }

    use proptest::prelude::*;

    proptest! {
        /// Differential: whenever the whole-cell reading says a window is
        /// open, the exact sub-cell path reports nothing, over real defs at
        /// random anchors and a random seed cell.
        #[test]
        fn whole_cells_open_implies_the_exact_check_reports_nothing(
            placements in proptest::collection::vec((0usize..1000, 0i32..9, 0i32..9), 0..9),
            seed_x in 0i32..9,
            seed_y in 0i32..9,
        ) {
            let solid: Vec<&defs::ObjectDef> = defs::OBJECTS
                .iter()
                .filter(|o| o.collider.is_some())
                .collect();
            let rows: Vec<PlacedRow> = placements
                .iter()
                .map(|&(i, x, y)| {
                    let d = solid[i % solid.len()];
                    PlacedRow { floor: 0, y, x, def_id: d.id, layer: d.layer, orientation: 0 }
                })
                .collect();
            let window = Rect { x0: 0, y0: 0, x1: 9, y1: 9 };
            if whole_cells_open(window, (seed_x, seed_y), &rows, defs::OBJECTS) {
                let (enclosed, narrow) =
                    window_findings(window, (seed_x, seed_y), &rows, defs::OBJECTS).unwrap();
                prop_assert!(enclosed.is_empty() && narrow.is_empty());
            }
        }
    }

    #[test]
    fn a_pocket_sealed_by_four_props_is_part_of_them() {
        // CI's minimal counterexample of the differential below: a bridge
        // abutment, a workbench, a bed and a bush leave a body-sized
        // pocket whose every covered cell is one of their own footprints.
        let by_id = |id: u32| defs::OBJECTS.iter().find(|o| o.id == id).unwrap();
        let rows: Vec<PlacedRow> = [(22, 4, 2), (43, 5, 2), (26, 6, 5), (58, 7, 2)]
            .iter()
            .map(|&(id, x, y)| {
                let d = by_id(id);
                PlacedRow {
                    floor: 0,
                    y,
                    x,
                    def_id: d.id,
                    layer: d.layer,
                    orientation: 0,
                }
            })
            .collect();
        let window = Rect {
            x0: 0,
            y0: 0,
            x1: 9,
            y1: 9,
        };
        assert!(whole_cells_open(window, (0, 0), &rows, defs::OBJECTS));
        let (enclosed, narrow) = window_findings(window, (0, 0), &rows, defs::OBJECTS).unwrap();
        assert!(enclosed.is_empty() && narrow.is_empty());
    }

    #[test]
    fn equal_area_compact_variants_are_both_drawn() {
        // A tag with two compact variants of one area stands each of them
        // across seeds, not only the lowest id.
        let cat = catalogue();
        let mut checked = 0;
        for t in defs::TAGS {
            let c = cat.carrying(t.id, Place::Floor);
            let max = c.iter().map(|d| Catalogue::area(d)).max().unwrap_or(0);
            let compact: Vec<u32> = c
                .iter()
                .filter(|d| Catalogue::area(d) == 1)
                .map(|d| d.id)
                .collect();
            // The role tag every fixture def carries is no anchor.
            if max <= 1 || compact.len() < 2 || c.len() > 8 {
                continue;
            }
            let i = interior(&[(101, 101, t.id)]);
            let mut seen: BTreeSet<u32> = BTreeSet::new();
            for seed in 0..64 {
                for p in dress(&cat, seed, &i, true).unwrap() {
                    if matches!(p.role, Role::Fixture { .. }) {
                        seen.insert(p.row.def_id);
                    }
                }
            }
            for id in &compact {
                assert!(
                    seen.contains(id),
                    "compact def {id} of tag {} never drawn (seen {seen:?})",
                    t.id
                );
            }
            checked += 1;
        }
        assert!(checked >= 1, "no tag has two compact variants");
    }

    // --- dress_one's search -------------------------------------------

    /// The committed content with the multi-cell anchor tag's defs
    /// replaced by a 3x1 solid and a 1x1 compact variant, both copied from
    /// a real def of the tag so everything else about them (layer,
    /// `indoor`, `fixture`) is the committed one.
    fn wide_content() -> (Vec<defs::ObjectDef>, TagId, u32, u32) {
        let content = GenerationContent::committed();
        let cat0 = Catalogue::new(&content).unwrap();
        let tag = multi_cell_tag(&cat0);
        let template = *cat0.carrying(tag, Place::Floor)[0];
        let mut objects: Vec<defs::ObjectDef> = defs::OBJECTS
            .iter()
            .filter(|o| !o.tags.contains(&tag))
            .copied()
            .collect();
        let (natural, compact) = (90_001, 90_002);
        objects.push(defs::ObjectDef {
            id: natural,
            key: "a_wide_natural",
            width: 3,
            height: 1,
            collider: Some(defs::ColliderRect {
                x0: 0,
                y0: 0,
                x1: 48,
                y1: 16,
            }),
            ..template
        });
        objects.push(defs::ObjectDef {
            id: compact,
            key: "a_compact",
            width: 1,
            height: 1,
            collider: Some(defs::ColliderRect {
                x0: 0,
                y0: 0,
                x1: 16,
                y1: 16,
            }),
            ..template
        });
        (objects, tag, natural, compact)
    }

    /// `(fixture cell, def)` in cell order, the skips, the plain skips.
    type Searched = (Vec<((i32, i32), u32)>, PropSkips, PropSkips);

    /// `dress_one` over `fixtures` with the 3x1/1x1 pair as the anchor's
    /// only defs: the placed fixtures' `(cell, def)` in cell order, the
    /// skips, and what a plain natural dressing of the same building gives.
    fn search(fixtures: &[(i32, i32)]) -> Searched {
        let (objects, tag, _, _) = wide_content();
        let content = GenerationContent::committed();
        let swapped = GenerationContent {
            objects: &objects,
            ..content
        };
        let cat = Catalogue::new(&swapped).unwrap();
        let i = interior(
            &fixtures
                .iter()
                .map(|&(x, y)| (x, y, tag))
                .collect::<Vec<_>>(),
        );
        let mut plain = PropSkips::default();
        let direct = dress_building(3, &cat, &cfg(), &i, &BTreeSet::new(), &mut plain).unwrap();
        let mut skips = PropSkips::default();
        let props = dress_one(3, &cat, &cfg(), &i, &mut skips).unwrap();
        if !needs_compact(&i, &direct, &cat) {
            let a: Vec<PlacedRow> = props.iter().map(|p| p.row).collect();
            let b: Vec<PlacedRow> = direct.iter().map(|p| p.row).collect();
            assert_eq!(a, b, "a clear natural dressing is kept as it is");
        }
        let mut placed: Vec<((i32, i32), u32)> = props
            .iter()
            .filter_map(|p| match p.role {
                Role::Fixture { cell, .. } => Some((cell, p.row.def_id)),
                _ => None,
            })
            .collect();
        placed.sort();
        (placed, skips, plain)
    }

    #[test]
    fn dress_one_keeps_a_natural_dressing_that_clears_and_its_skips_exactly() {
        let (_, _, natural, _) = wide_content();
        let (placed, skips, plain) = search(&[(101, 103)]);
        assert_eq!(placed, vec![((101, 103), natural)]);
        assert_eq!(skips, plain, "the skips are the plain dressing's own");
        assert_eq!(skips.buildings_replaced, 0);
        assert_eq!(skips.compact_fallbacks, 0);
    }

    #[test]
    fn dress_one_compacts_the_first_fixture_whose_compact_variant_alone_clears() {
        // Two 3-wide solids seal row 104 between them; compacting either
        // one opens a lane, so the first in fixture order is the one, and
        // the other stays natural.
        let (_, _, natural, compact) = wide_content();
        let (placed, skips, _) = search(&[(101, 104), (106, 104)]);
        assert_eq!(placed, vec![((101, 104), compact), ((106, 104), natural)]);
        assert_eq!(skips.buildings_replaced, 1);
        assert_eq!(skips.compact_fallbacks, 1);
    }

    #[test]
    fn dress_one_goes_compact_in_turn_only_as_far_as_it_must() {
        // Rows 103 and 105 are each sealed by a pair; no one fixture
        // clears both, so they go compact one at a time in fixture order
        // until the building clears -- the fourth is never touched.
        let (_, _, natural, compact) = wide_content();
        let (placed, skips, _) = search(&[(101, 103), (106, 103), (101, 105), (106, 105)]);
        assert_eq!(
            placed,
            vec![
                ((101, 103), compact),
                ((101, 105), compact),
                ((106, 103), compact),
                ((106, 105), natural),
            ]
        );
        assert_eq!(skips.buildings_replaced, 1);
        assert_eq!(skips.compact_fallbacks, 3);
    }

    #[test]
    fn a_table_with_no_free_cell_in_reach_gets_no_chair_and_a_counted_skip() {
        let cat = catalogue();
        let &(table, chair, _, _) = cat.attendants.first().expect("a chair row");
        let filler = defs::TAGS
            .iter()
            .map(|t| t.id)
            .find(|&t| {
                t != table && t != chair && {
                    let c = cat.carrying(t, Place::Floor);
                    !c.is_empty() && c.iter().all(|d| d.width == 1 && d.height == 1)
                }
            })
            .expect("a one-cell anchor tag");
        // The table in the room's corner; every other cell within reach of
        // it holds a fixture of its own, so no free floor cell is left.
        let mut fixtures = vec![(101, 101, table)];
        for y in 101..=105 {
            for x in 101..=105 {
                if (x, y) != (101, 101) && !(x <= 102 && y <= 102) {
                    fixtures.push((x, y, filler));
                }
            }
        }
        let i = interior(&fixtures);
        let mut skips = PropSkips::default();
        let props = dress_building(1, &cat, &cfg(), &i, &BTreeSet::new(), &mut skips).unwrap();
        let chairs = props
            .iter()
            .filter(|p| def_of(cat.objects, p.row.def_id).is_some_and(|d| d.tags.contains(&chair)))
            .count();
        assert_eq!(chairs, 0, "no chair stands on another prop");
        let owed: u32 = cat
            .attendants
            .iter()
            .filter(|a| a.0 == table)
            .map(|a| a.2)
            .sum();
        assert!(owed >= 1);
        assert_eq!(skips.attendants_unplaced, owed);
    }

    // --- the street half -----------------------------------------------

    use crate::generation::envelopes::EnvelopeMap;
    use crate::generation::land_use::{LandUseCell, LandUseMap};
    use crate::generation::plots::PlotMap;
    use crate::generation::streets::{Axis, Block, StreetEdge, StreetNetwork};
    use crate::generation::{BuildingTypeMap, LandUse};

    const SITE: Rect = Rect {
        x0: 0,
        y0: 0,
        x1: 64,
        y1: 64,
    };

    /// One vertical street-tier edge down the middle of a 64-cell site
    /// (carriageway x 30..34, pavement 28..30 and 34..36), a block each
    /// side, no buildings.
    fn street_skeleton(blocks: bool) -> Skeleton {
        let edge = StreetEdge {
            axis: Axis::Vertical,
            coord: 32,
            from: 0,
            to: 64,
            class: StreetClass::Street,
            width_cells: 8,
        };
        let blocks = if blocks {
            vec![
                Block {
                    bounds: Rect {
                        x0: 0,
                        y0: 0,
                        x1: 28,
                        y1: 64,
                    },
                },
                Block {
                    bounds: Rect {
                        x0: 36,
                        y0: 0,
                        x1: 64,
                        y1: 64,
                    },
                },
            ]
        } else {
            Vec::new()
        };
        Skeleton {
            land_use: LandUseMap::test_fixture(
                SITE,
                64,
                1,
                1,
                0,
                0,
                vec![LandUseCell {
                    use_: LandUse::Commercial,
                    density: 100,
                }],
            ),
            streets: StreetNetwork::test_fixture(SITE, vec![edge], blocks),
            plots: PlotMap::test_fixture(SITE, Vec::new()),
            envelopes: EnvelopeMap::test_fixture(Vec::new()),
            building_types: BuildingTypeMap::test_fixture(Vec::new()),
        }
    }

    fn lamp_def(cat: &Catalogue<'static>) -> &'static defs::ObjectDef {
        let d = cat
            .distributions
            .iter()
            .find(|d| cat.street_tags.contains(&d.per))
            .expect("the lighting row");
        cat.carrying(d.subject, Place::Pavement)[0]
    }

    fn lamp_anchors(st: &StreetState, cat: &Catalogue<'static>) -> Vec<(i32, i32)> {
        let d = cat
            .distributions
            .iter()
            .find(|d| cat.street_tags.contains(&d.per))
            .unwrap();
        let mut v: Vec<(i32, i32)> = st
            .placed
            .get(&d.subject)
            .map(|a| a.iter().map(|&(c, _)| c).collect())
            .unwrap_or_default();
        v.sort_by_key(|&(x, y)| (x, y));
        v
    }

    #[test]
    fn lamps_stand_every_cadence_and_the_two_sides_are_staggered_half_of_one() {
        let cat = catalogue();
        let cfg = cfg();
        let sk = street_skeleton(true);
        let grid = StreetGrid::build(&sk, &cfg);
        let empty = InteriorMap::test_fixture(Vec::new());
        let mut st = StreetState::new(&grid, cat.objects, &sk, &empty);
        let mut props = Vec::new();
        place_lamps(&mut st, &cat, &cfg, &sk, 7, &mut props);
        let lamps = lamp_anchors(&st, &cat);
        let west: Vec<i32> = lamps.iter().filter(|c| c.0 == 29).map(|c| c.1).collect();
        let east: Vec<i32> = lamps.iter().filter(|c| c.0 == 34).map(|c| c.1).collect();
        let cadence = cfg.props_lamp_cadence_cells;
        assert!(west.len() >= 4 && east.len() >= 4, "{west:?} {east:?}");
        // A lamp stands on the kerb row of each side, never elsewhere.
        assert_eq!(west.len() + east.len(), lamps.len());
        // First half a cadence in, the far side half a cadence further.
        assert_eq!(west[0], cadence / 2);
        assert_eq!(east[0], cadence / 2 + cadence / 2);
        for pair in west.windows(2).take(3) {
            assert_eq!(pair[1] - pair[0], cadence);
        }
        for pair in east.windows(2).take(3) {
            assert_eq!(pair[1] - pair[0], cadence);
        }
        assert!(lamps.iter().all(|&(x, y)| !grid.is_road(x, y)));
        assert_eq!(props.len(), lamps.len());
    }

    #[test]
    fn a_footway_cell_no_lamp_reaches_is_completed_on_footway_never_on_the_road() {
        let cat = catalogue();
        let cfg = cfg();
        let sk = street_skeleton(true);
        let grid = StreetGrid::build(&sk, &cfg);
        let empty = InteriorMap::test_fixture(Vec::new());
        let mut st = StreetState::new(&grid, cat.objects, &sk, &empty);
        let mut props = Vec::new();
        let mut skips = PropSkips::default();
        // No cadence pass at all: the completion alone lights the street.
        complete_lighting(&mut st, &cat, &mut props, &mut skips);
        let lamps = lamp_anchors(&st, &cat);
        assert!(!lamps.is_empty());
        let reach = cat
            .distributions
            .iter()
            .find(|d| cat.street_tags.contains(&d.per))
            .unwrap()
            .max_distance;
        for (x, y, _) in grid.pavement_cells() {
            assert!(
                lamps
                    .iter()
                    .any(|l| (l.0 - x).abs().max((l.1 - y).abs()) <= reach),
                "footway cell ({x}, {y}) is out of reach of every lamp"
            );
        }
        assert!(
            lamps
                .iter()
                .all(|&(x, y)| grid.is_pavement(x, y) && !grid.is_road(x, y)),
            "a lamp stands off the footway"
        );
        assert_eq!(skips.street_unplaced, 0);
    }

    #[test]
    fn a_piece_that_would_take_a_cross_sections_last_walkable_cell_is_refused() {
        let cat = catalogue();
        let cfg = cfg();
        let sk = street_skeleton(true);
        let grid = StreetGrid::build(&sk, &cfg);
        let empty = InteriorMap::test_fixture(Vec::new());
        let mut st = StreetState::new(&grid, cat.objects, &sk, &empty);
        let mut props = Vec::new();
        let bin = {
            let d = cat
                .distributions
                .iter()
                .find(|d| {
                    !cat.street_tags.contains(&d.per)
                        && !cat.carrying(d.subject, Place::Pavement).is_empty()
                })
                .unwrap();
            cat.carrying(d.subject, Place::Pavement)[0]
        };
        // The west band is x 28 and 29 deep: one bin leaves a cell.
        let band = bands(&sk.streets.edges()[0], &cfg)[0];
        let at = |x: i32, y: i32| (x, y);
        let keep = Spacing::none();
        assert!(try_place(
            &mut st,
            &cat,
            &band,
            bin,
            at(28, 20),
            keep,
            &mut props
        ));
        // A second beside it, on the other row of the same cross-section,
        // would leave none, and furniture also keeps a cell clear of any
        // other: refused.
        assert!(!try_place(
            &mut st,
            &cat,
            &band,
            bin,
            at(29, 20),
            keep,
            &mut props
        ));
        assert_eq!(props.len(), 1);
    }

    #[test]
    fn a_piece_with_no_block_is_refused_unless_it_is_a_lamp() {
        let cat = catalogue();
        let cfg = cfg();
        let sk = street_skeleton(false);
        let grid = StreetGrid::build(&sk, &cfg);
        let empty = InteriorMap::test_fixture(Vec::new());
        let mut st = StreetState::new(&grid, cat.objects, &sk, &empty);
        let mut props = Vec::new();
        let band = bands(&sk.streets.edges()[0], &cfg)[0];
        let ambient = cat.ambient();
        let piece = ambient.iter().find(|d| d.width == 1).copied().unwrap();
        assert!(!try_place(
            &mut st,
            &cat,
            &band,
            piece,
            (28, 10),
            Spacing::none(),
            &mut props
        ));
        let lamp = lamp_def(&cat);
        let spacing = Spacing {
            subject: 0,
            cells: 0,
            keep_walkable: false,
            need_block: false,
        };
        assert!(try_place(
            &mut st,
            &cat,
            &band,
            lamp,
            (29, 10),
            spacing,
            &mut props
        ));
    }

    #[test]
    fn taking_a_piece_back_leaves_the_state_as_if_it_was_never_placed() {
        let cat = catalogue();
        let cfg = cfg();
        let sk = street_skeleton(true);
        let grid = StreetGrid::build(&sk, &cfg);
        let empty = InteriorMap::test_fixture(Vec::new());
        let mut st = StreetState::new(&grid, cat.objects, &sk, &empty);
        let mut props = Vec::new();
        let band = bands(&sk.streets.edges()[0], &cfg)[0];
        let lamp = lamp_def(&cat);
        let spacing = Spacing {
            subject: cat
                .distributions
                .iter()
                .find(|d| cat.street_tags.contains(&d.per))
                .unwrap()
                .subject,
            cells: 6,
            keep_walkable: false,
            need_block: false,
        };
        assert!(try_place(
            &mut st,
            &cat,
            &band,
            lamp,
            (29, 5),
            spacing,
            &mut props
        ));
        let before = (
            st.taken.clone(),
            st.furniture.clone(),
            st.placed.clone(),
            props.len(),
        );
        assert!(try_place(
            &mut st,
            &cat,
            &band,
            lamp,
            (29, 30),
            spacing,
            &mut props
        ));
        assert_ne!(st.taken, before.0);
        assert!(remove_at(&mut st, &mut props, (29, 30)));
        assert_eq!(
            (
                st.taken.clone(),
                st.furniture.clone(),
                st.placed.clone(),
                props.len()
            ),
            before
        );
        assert!(!remove_at(&mut st, &mut props, (29, 30)));
    }

    #[test]
    fn ambient_never_offers_a_def_a_row_owes_somewhere() {
        // An outdoor def carrying an anchor tag a row requires (a market
        // stall's till) is never scattered as ambient.
        let content = GenerationContent::committed();
        let cat0 = Catalogue::new(&content).unwrap();
        let template = *cat0.ambient().first().expect("an ambient def");
        let anchor = defs::TAGS
            .iter()
            .find(|t| t.placement == Some(defs::TagPlacement::FacingDoor))
            .expect("an anchor tag")
            .id;
        assert!(cat0.owed.contains(&anchor));
        let tags: &'static [u32] = Box::leak(
            template
                .tags
                .iter()
                .copied()
                .chain([anchor])
                .collect::<Vec<u32>>()
                .into_boxed_slice(),
        );
        let stall = defs::ObjectDef {
            id: 90_002,
            key: "an_unrelated_stall",
            tags,
            ..*template
        };
        let mut objects: Vec<defs::ObjectDef> = defs::OBJECTS.to_vec();
        objects.push(stall);
        let planted = GenerationContent {
            objects: &objects,
            ..content
        };
        let cat = Catalogue::new(&planted).unwrap();
        assert!(cat.ambient().iter().all(|d| d.id != 90_002));
        assert!(cat.ambient().iter().any(|d| d.id == template.id));
    }
}
