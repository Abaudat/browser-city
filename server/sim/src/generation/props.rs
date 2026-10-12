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
//! footprints leave a pocket the player body cannot reach is re-placed at
//! compact. [`reach_findings`] is the one windowed verdict
//! ([`super::District::check_reachability`] runs it over the finished
//! district). The collision map is built once, here, as one
//! [`FloorCollision`] per floor, and cached on [`PropMap`]; nothing
//! recomputes it.
//!
//! **Carriers, never consequence.** Every prop is placed in its empty,
//! default state; no pass-6 anchor tag is ever carried by a dressing def
//! (`tools/defs-build`'s requirement rows own that).
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
    /// A fixture whose natural footprint did not fit and stood at the
    /// tag's compact variant instead.
    pub compact_fallbacks: u32,
    /// A building re-placed entirely at compact footprints because the
    /// natural ones left a pocket the player body could not reach.
    pub buildings_replaced: u32,
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
    /// Tags a distribution row is subject of.
    subjects: BTreeSet<TagId>,
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
        let mut subjects = BTreeSet::new();
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
            if let Some(d) = r.as_distribution() {
                subjects.insert(d.subject);
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
        Ok(Catalogue {
            parts,
            street_tags,
            objects,
            forbid,
            side_tags,
            subjects,
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
    let (body_w, body_h) = player_body_subcells(defs::BALANCE);

    for (env, outcome) in skeleton.envelopes.envelopes().zip(interiors.outcomes()) {
        match outcome {
            InteriorOutcome::Laid { interior, .. } => {
                let mut b = dress_building(seed, &cat, cfg, interior, false, &mut skips)?;
                if reach_findings(interior, &b, &cat, (body_w, body_h)) {
                    skips.buildings_replaced += 1;
                    b = dress_building(seed, &cat, cfg, interior, true, &mut skips)?;
                }
                props.extend(b);
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
    compact_only: bool,
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
            if rank >= natural.len() && !compact_only && max_area > 1 {
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
    // The whole-cell reading first: a window whose every cell no collider
    // touches is reachable from the seed over whole cells needs no
    // sub-cell grid at all -- each such cell is a full body wide, so
    // sharing an edge with the next is a passage the body fits through,
    // and a nook a collider leaves inside a blocked cell is part of its
    // prop. Only a window the whole-cell reading cannot clear is
    // rasterised at sub-cell resolution.
    if whole_cells_open(window, seed_cell, rows, objects) {
        return Ok((Vec::new(), Vec::new()));
    }
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
        let x1 = (f.bounds.x1 + pad.0 - 1).div_euclid(s);
        let y1 = (f.bounds.y1 + pad.1 - 1).div_euclid(s);
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
fn whole_cells_open(
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
/// the building's window reachable over whole cells -- the cheap reading
/// [`window_findings`] opens with. A building that fails it is placed
/// again at compact footprints, which stand inside the whole cells pass 6
/// already proved a lane through, rather than judged at sub-cell
/// resolution; the district verdict ([`check_reachability`]) still judges
/// whatever stands.
fn reach_findings(interior: &Interior, props: &[Prop], cat: &Catalogue, _body: (i32, i32)) -> bool {
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
    /// Whether a free ground cell off the carriageway will do where there
    /// is no pavement (a lamp completing a catchment's lighting).
    ground_ok: bool,
}

impl Spacing {
    fn none() -> Self {
        Spacing {
            subject: 0,
            cells: 0,
            keep_walkable: true,
            need_block: true,
            ground_ok: false,
        }
    }
}

/// What one placement added, to take it back: its cells and the function
/// tags it registered.
type Undo = (Vec<(i32, i32)>, Vec<TagId>);

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
    /// Undo log for a cluster that cannot be completed: the cells and
    /// tags each placement added, newest last.
    undo: Vec<Undo>,
    /// Placed anchors, with the block they front, by function tag.
    placed: BTreeMap<TagId, Vec<Anchor>>,
}

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
    let mut st = StreetState {
        grid,
        taken: BTreeSet::new(),
        furniture: BTreeSet::new(),
        reserved: BTreeSet::new(),
        undo: Vec::new(),
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
    // Every cell a building's own props already cover is not pavement,
    // but a plot's setback strip may be: keep street furniture off any
    // footprint.
    for e in skeleton.envelopes.envelopes() {
        for y in e.footprint.y0..e.footprint.y1 {
            for x in e.footprint.x0..e.footprint.x1 {
                st.taken.insert((x, y));
            }
        }
    }

    let edges = skeleton.streets.edges();
    let pavement = cat.parts.pavement;
    let _ = pavement;

    // Lamps: every distribution row over pavement.
    for d in cat
        .distributions
        .iter()
        .filter(|d| cat.street_tags.contains(&d.per))
    {
        let cands = cat.carrying(d.subject, Place::Pavement);
        if cands.is_empty() {
            continue;
        }
        // `cadence` is per side; the two sides of a street are staggered
        // half a cadence, so the street reads as a lamp every half
        // cadence and each side is its own regular row.
        let cadence = cfg.props_lamp_cadence_cells.max(d.min_spacing).max(2);
        for e in edges {
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
                            ground_ok: false,
                        };
                        if try_place(&mut st, cat, &band, def, (x, y), spacing, props) {
                            break;
                        }
                    }
                }
            }
        }
    }

    // Coverage, completed from the row itself: any pavement cell with no
    // street lamp within `max_distance` in its own catchment (a street the
    // site edge or a catchment line cuts short, a junction's furniture
    // having taken the offered cell) gets one at the nearest free pavement
    // cell of that catchment.
    for d in cat
        .distributions
        .iter()
        .filter(|d| cat.street_tags.contains(&d.per))
    {
        let cands = cat.carrying(d.subject, Place::Pavement);
        if cands.is_empty() {
            continue;
        }
        let extent = cfg.catchment_extent_cells;
        let reach = d.max_distance.max(1);
        let catchment = |x: i32, y: i32| crate::rules::catchment_of(x, y, extent);
        let bucket = |x: i32, y: i32| (x.div_euclid(reach), y.div_euclid(reach));
        let mut lamps: BTreeMap<(i32, i32), Vec<(i32, i32)>> = BTreeMap::new();
        for &(c, _) in st.placed.get(&d.subject).map(Vec::as_slice).unwrap_or(&[]) {
            lamps.entry(bucket(c.0, c.1)).or_default().push(c);
        }
        let covered = |lamps: &BTreeMap<(i32, i32), Vec<(i32, i32)>>, x: i32, y: i32| {
            let (bx, by) = bucket(x, y);
            let cx = catchment(x, y);
            (-1..=1).any(|dx| {
                (-1..=1).any(|dy| {
                    lamps.get(&(bx + dx, by + dy)).is_some_and(|v| {
                        v.iter().any(|l| {
                            (l.0 - x).abs().max((l.1 - y).abs()) <= d.max_distance
                                && catchment(l.0, l.1) == cx
                        })
                    })
                })
            })
        };
        let spacing = Spacing {
            subject: d.subject,
            cells: d.min_spacing,
            keep_walkable: false,
            need_block: false,
            ground_ok: true,
        };
        // The pavement tag is on every street pavement cell and on every
        // building's approach: both owe a lamp in their own catchment.
        let mut owed: BTreeSet<(i32, i32)> =
            grid.pavement_cells().map(|(x, y, _)| (y, x)).collect();
        if d.per == pavement {
            for (_, _, interior) in interiors.laid() {
                for &(x, y) in &interior.approach {
                    owed.insert((y, x));
                }
            }
        }
        let cells: Vec<(i32, i32)> = owed.into_iter().map(|(y, x)| (x, y)).collect();
        for (x, y) in cells {
            if covered(&lamps, x, y) {
                continue;
            }
            let home = catchment(x, y);
            let mut placed = false;
            'rings: for r in 0..=d.max_distance {
                for dy in -r..=r {
                    for dx in -r..=r {
                        if dx.abs().max(dy.abs()) != r {
                            continue;
                        }
                        let (cx, cy) = (x + dx, y + dy);
                        if catchment(cx, cy) != home || grid.is_road(cx, cy) {
                            continue;
                        }
                        let band = Band {
                            vertical: true,
                            outer: cx,
                            kerb: cx,
                            outward: 1,
                            from: cy,
                            to: cy + 1,
                            pave: 1,
                            edge_key: 0,
                        };
                        let def = cands[((cx as i64 * 31 + cy as i64) as usize) % cands.len()];
                        if try_place(&mut st, cat, &band, def, (cx, cy), spacing, props) {
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

    // Ambient furniture and the companions its rows owe.
    let per100_lo = cfg.props_ambient_per_100_min as i64;
    let per100_hi = cfg.props_ambient_per_100_max as i64;
    let ambient: Vec<&defs::ObjectDef> = {
        let mut v: Vec<&defs::ObjectDef> = cat
            .objects
            .iter()
            .filter(|o| {
                cat.eligible(o, Place::Pavement)
                    && !o.tags.contains(&cat.parts.wall)
                    && !o.tags.iter().any(|t| cat.subjects.contains(t))
            })
            .collect();
        v.sort_by_key(|o| o.id);
        v
    };
    let companions: Vec<Dist> = cat
        .distributions
        .iter()
        .copied()
        .filter(|d| d.per != pavement)
        .collect();
    if ambient.is_empty() {
        return;
    }
    for e in edges {
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
                let companion = companions
                    .iter()
                    .find(|c| def.tags.contains(&c.per))
                    .copied();
                let count = companion.map_or(1, |c| c.ratio.max(1) as i32);
                let (mark_props, mark_undo) = (props.len(), st.undo.len());
                let mut cursor = t;
                let mut first_def = def.id;
                let mut placed_cells: Vec<((i32, i32), Option<Rect>)> = Vec::new();
                let mut along: Vec<i32> = Vec::new();
                for _ in 0..count {
                    let d = if let Some(c) = companion {
                        let pool: Vec<&defs::ObjectDef> = ambient
                            .iter()
                            .copied()
                            .filter(|o| o.tags.contains(&c.per))
                            .collect();
                        let alt: Vec<&defs::ObjectDef> =
                            pool.iter().copied().filter(|o| o.id != first_def).collect();
                        let pool = if alt.is_empty() { pool } else { alt };
                        pool[rng.below(pool.len() as u64) as usize]
                    } else {
                        def
                    };
                    first_def = d.id;
                    let at = band.cell(cursor, band.outer);
                    if try_place(&mut st, cat, &band, d, at, Spacing::none(), props) {
                        placed_cells.push((at, st.grid.block_at(at.0, at.1)));
                        along.push(cursor);
                    }
                    cursor += d.width as i32 + 1;
                }
                let mut ok = placed_cells.len() as i32 == count;
                if let (Some(c), true) = (companion, ok) {
                    // Every block the cluster stands in holds a bin within
                    // `max_distance` of every seat of the cluster in it.
                    let mut blocks: Vec<Option<Rect>> =
                        placed_cells.iter().map(|&(_, b)| b).collect();
                    blocks.sort();
                    blocks.dedup();
                    let cands = cat.carrying(c.subject, Place::Pavement);
                    for blk in blocks {
                        let near = st.placed.get(&c.subject).cloned().unwrap_or_default();
                        let covered =
                            placed_cells
                                .iter()
                                .filter(|(_, b)| *b == blk)
                                .all(|&(p, _)| {
                                    near.iter().any(|&(n, nb)| {
                                        nb == blk
                                            && (n.0 - p.0).abs().max((n.1 - p.1).abs())
                                                <= c.max_distance
                                    })
                                });
                        if covered {
                            continue;
                        }
                        if cands.is_empty() {
                            ok = false;
                            break;
                        }
                        let bin = cands[rng.below(cands.len() as u64) as usize];
                        // From the cluster's middle outward, only where every
                        // seat of it stays within the row's own distance.
                        let lo = along.iter().copied().min().unwrap_or(t);
                        let hi = along.iter().copied().max().unwrap_or(t);
                        let mid = (lo + hi) / 2;
                        let mut spots: Vec<i32> = Vec::new();
                        for k in 0..=c.max_distance {
                            for sp in [mid + k, mid - k] {
                                if along.iter().all(|&a| (sp - a).abs() <= c.max_distance)
                                    && !spots.contains(&sp)
                                {
                                    spots.push(sp);
                                }
                            }
                        }
                        let mut placed_bin = false;
                        for sp in spots {
                            let at = band.cell(sp, band.outer);
                            if st.grid.block_at(at.0, at.1) != blk {
                                continue;
                            }
                            let spacing = Spacing {
                                subject: c.subject,
                                cells: c.min_spacing,
                                keep_walkable: true,
                                need_block: true,
                                ground_ok: false,
                            };
                            if try_place(&mut st, cat, &band, bin, at, spacing, props) {
                                placed_bin = true;
                                break;
                            }
                        }
                        if !placed_bin {
                            ok = false;
                            break;
                        }
                    }
                }
                if !ok {
                    skips.street_unplaced += 1;
                    rollback(&mut st, props, mark_props, mark_undo);
                }
            }
        }
    }
}

/// Takes back everything placed since `(mark_props, mark_undo)`.
fn rollback(st: &mut StreetState, props: &mut Vec<Prop>, mark_props: usize, mark_undo: usize) {
    props.truncate(mark_props);
    while st.undo.len() > mark_undo {
        let (cells, tags) = st.undo.pop().expect("length checked");
        for c in cells {
            st.taken.remove(&c);
            st.furniture.remove(&c);
        }
        for t in tags {
            if let Some(v) = st.placed.get_mut(&t) {
                v.pop();
            }
        }
    }
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
        ground_ok,
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
            let standable = st.grid.is_pavement(x, y)
                || (ground_ok && st.grid.in_site(x, y) && !st.grid.is_road(x, y));
            if !standable || st.taken.contains(&(x, y)) || st.reserved.contains(&(x, y)) {
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
            let free = band.rows().any(|r| {
                let (cx, cy) = band.cell(t, r);
                st.grid.is_pavement(cx, cy) && !st.taken.contains(&(cx, cy)) && !inside(cx, cy)
            });
            if !free {
                return false;
            }
        }
    }
    let mut cells = Vec::new();
    for y in fp.y0..fp.y1 {
        for x in fp.x0..fp.x1 {
            st.taken.insert((x, y));
            st.furniture.insert((x, y));
            cells.push((x, y));
        }
    }
    let fronted = block.flatten();
    let mut tags = Vec::new();
    // Every function tag of the def is a placed anchor of its own, so a
    // companion row can find it.
    for t in def.tags {
        if cat
            .distributions
            .iter()
            .any(|d| d.subject == *t || d.per == *t)
        {
            st.placed.entry(*t).or_default().push((at, fronted));
            tags.push(*t);
        }
    }
    st.undo.push((cells, tags));
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
        let (enclosed, narrow) =
            window_findings(window, seed, rows, objects).map_err(GenerationError::InvalidConfig)?;
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
        let (enclosed, narrow) = window_findings(window, seed, &rows, objects)
            .map_err(GenerationError::InvalidConfig)?;
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
        dress_building(seed, cat, &cfg(), interior, compact, &mut skips)
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
}
