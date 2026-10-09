//! Pass 6 (FR110, story 3.5): the interior layout. Receives every placed
//! envelope (pass 4), its assigned building type (pass 5) and its plot
//! (pass 3, for the street edge its entrance walks out to); hands down
//! one [`InteriorOutcome`] per placed envelope, in envelope order -- a
//! laid-out ground floor, a solid `Shell` (the type declares no room
//! program) or a typed, counted `Rejected` (never an `Option` that
//! disappears, never a half-emitted room).
//!
//! **An abstract plan, never a placement.** An [`Interior`] is rooms
//! (rects), thresholds, required fixtures and the entrance's approach --
//! tags and cells, no `ObjectDef` id and no sprite (which sprite dresses
//! a room is theme and affluence, 3.7). Walls are derived: the footprint
//! minus every room minus every threshold. Every coordinate is a world
//! coordinate on the same tilemap as the street (FR113): the type
//! carries no origin, offset or second frame, so the interior of a
//! building at `(x, y)` is found at `(x, y)`.
//!
//! **Constructive, then judged by the one engine.** The layout is built
//! from data: the type's room program (`rooms` core, `optional_rooms`
//! taken while the footprint holds them), a front band holding the front
//! room, a partition, and the back rooms side by side -- each back room
//! reached by its own door in the partition. For each room every
//! committed `[[requirement]]` row whose container is one of the room's
//! tags is read through `RuleDef::as_requirement` and its fixture placed
//! on a free floor cell. Then the candidate is handed to
//! [`crate::rules::evaluate_local`] over a site built by the same adapter
//! `DistrictSite` uses ([`add_building`]): any violation refuses the
//! attempt, a fresh stream (seeded from the building's own bounds plus
//! the attempt index) tries again, and after
//! `generation.interiors.max_layout_attempts` the building is `Rejected`.
//! There is no second validator here.
//!
//! **Ground floor only, one street entrance.** Upper storeys and back
//! doors are later additions. The entrance sits on the envelope's own
//! `front`, copied, never re-derived.
//!
//! **Ownership.** [`InteriorMap::building_areas`]/[`InteriorMap::
//! room_areas`] are `sim::world::AreaSpec` rows, produced only through
//! `clip_rect_to_chunks`. Owner ids are position-derived
//! ([`rect_seed_key`]) so growing the city next door never renumbers an
//! existing building; a building area covers the whole footprint, walls
//! included; a room area covers its floor and the thresholds it owns,
//! never a wall.

use std::collections::{BTreeMap, BTreeSet};

use crate::generated::defs;
use crate::rng::{Rng, seed_from_ids};
use crate::rules::{AreaId, RequirementRow, TagId};
use crate::world::{AreaSpec, Rect, clip_rect_to_chunks};

use super::building_types::BuildingTypeMap;
use super::envelopes::{Envelope, EnvelopeMap};
use super::plots::{Plot, PlotMap};
use super::site::{AreaSlot, DistrictSite, ProfileId, SiteBuilder, front_cell};
use super::streets::Side;
use super::{GenerationConfig, GenerationContent, GenerationError, rect_seed_key};

pub const PASS_ID: u64 = super::PASS_INTERIOR_LAYOUT;

/// The structural parts the layout builds from, each resolved through
/// `defs::TagDef::structure` -- never a quoted key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Parts {
    pub wall: TagId,
    pub wall_run: TagId,
    pub floor: TagId,
    pub threshold: TagId,
    pub entrance: TagId,
    pub pavement: TagId,
    pub fixture: TagId,
}

impl Parts {
    /// `None` when `tags` does not declare every structural part exactly
    /// once -- `tools/defs-build` refuses that tree, so a committed table
    /// always resolves.
    pub fn resolve(tags: &[defs::TagDef]) -> Option<Parts> {
        let find = |want: defs::TagStructure| {
            tags.iter()
                .find(|t| t.structure == Some(want))
                .map(|t| t.id)
        };
        Some(Parts {
            wall: find(defs::TagStructure::Wall)?,
            wall_run: find(defs::TagStructure::WallRun)?,
            floor: find(defs::TagStructure::Floor)?,
            threshold: find(defs::TagStructure::Threshold)?,
            entrance: find(defs::TagStructure::Entrance)?,
            pavement: find(defs::TagStructure::Pavement)?,
            fixture: find(defs::TagStructure::Fixture)?,
        })
    }

    fn is_part(&self, tag: TagId) -> bool {
        [
            self.wall,
            self.wall_run,
            self.floor,
            self.threshold,
            self.entrance,
            self.pavement,
            self.fixture,
        ]
        .contains(&tag)
    }
}

/// Everything the pass reads from content, resolved once: the structural
/// parts and the room-type rows by id.
pub struct Vocabulary<'a> {
    pub parts: Parts,
    rooms: BTreeMap<u32, &'a defs::RoomTypeDef>,
    placements: BTreeMap<TagId, defs::TagPlacement>,
    /// Every room type's owed fixture count, by id.
    owed: BTreeMap<u32, i32>,
}

impl<'a> Vocabulary<'a> {
    pub fn new(content: &GenerationContent<'a>) -> Self {
        let parts = Parts::resolve(content.tags)
            .expect("the committed tag table declares every structural part");
        let rows = requirement_rows(content);
        Vocabulary {
            parts,
            owed: content
                .room_types
                .iter()
                .map(|r| {
                    let n: u32 = fixtures_owed(r, &rows, &parts)
                        .iter()
                        .map(|&(_, n)| n)
                        .sum();
                    (r.id, n as i32)
                })
                .collect(),
            rooms: content.room_types.iter().map(|r| (r.id, r)).collect(),
            placements: content
                .tags
                .iter()
                .filter_map(|t| Some((t.id, t.placement?)))
                .collect(),
        }
    }

    /// A room's floor need in cells: what it owes, the cell inside its own
    /// door, the cell in front of each of `doors` doors into rooms behind
    /// it, and one cell of lane.
    fn need(&self, room: &defs::RoomTypeDef, doors: i32) -> i32 {
        self.owed.get(&room.id).copied().unwrap_or(0) + 2 + doors
    }

    /// How a fixture carrying `tag` is placed: its tag's own class
    /// (`tools/defs-build` gives every owed fixture one).
    fn placement(&self, tag: TagId) -> defs::TagPlacement {
        self.placements
            .get(&tag)
            .copied()
            .unwrap_or(defs::TagPlacement::WallBacked)
    }

    fn room(&self, id: u32) -> &'a defs::RoomTypeDef {
        self.rooms
            .get(&id)
            .copied()
            .expect("a building type's program names a committed room type")
    }
}

/// One room: a floor rect and its room-type id. Never a wall cell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Room {
    pub rect: Rect,
    pub room_type: u32,
}

/// One doorway cell, owned by exactly one room (`room` indexes
/// [`Interior::rooms`]): `entrance` marks the building's street door.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Threshold {
    pub x: i32,
    pub y: i32,
    pub room: usize,
    pub entrance: bool,
}

/// One required fixture: a tag (never an object) on one floor cell of
/// `room`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Fixture {
    pub x: i32,
    pub y: i32,
    pub tag: TagId,
    pub room: usize,
}

/// A laid-out ground floor: rooms, thresholds, required fixtures and the
/// entrance's approach -- the straight run of cells from the entrance
/// out to the street (the setback cells, then the street's own first
/// cell), presented as pavement. Walls are derived, never stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Interior {
    pub footprint: Rect,
    pub front: Side,
    pub rooms: Vec<Room>,
    pub thresholds: Vec<Threshold>,
    pub fixtures: Vec<Fixture>,
    pub approach: Vec<(i32, i32)>,
}

impl Interior {
    /// The building's street door.
    pub fn entrance(&self) -> Option<&Threshold> {
        self.thresholds.iter().find(|t| t.entrance)
    }

    /// The cells laying this interior out writes: every room's floor and
    /// every threshold.
    pub fn laid_cells(&self) -> u64 {
        let floors: i64 = self
            .rooms
            .iter()
            .map(|r| r.rect.width() * r.rect.height())
            .sum();
        floors as u64 + self.thresholds.len() as u64
    }

    /// Every wall cell: the footprint minus every room, every threshold.
    pub fn walls(&self) -> Vec<(i32, i32)> {
        let mut out = Vec::new();
        for y in self.footprint.y0..self.footprint.y1 {
            for x in self.footprint.x0..self.footprint.x1 {
                let in_room = self.rooms.iter().any(|r| r.rect.contains(x, y));
                let in_door = self.thresholds.iter().any(|t| t.x == x && t.y == y);
                if !in_room && !in_door {
                    out.push((x, y));
                }
            }
        }
        out
    }
}

/// Why a building with a room program came out with no interior.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RejectReason {
    /// The type's required core does not fit its own footprint.
    ProgramDoesNotFit,
    /// Every one of `max_layout_attempts` layouts was refused.
    NoValidLayout,
}

/// What laying one building out cost, counted by the pass as it works:
/// the cells every attempt laid (each sized room's floor and its door, as
/// [`Interior::laid_cells`] counts them) and the cells every verdict
/// handed `evaluate_local`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct LayoutWork {
    pub cells_laid: u64,
    pub cells_judged: u64,
}

/// One placed envelope's outcome, in envelope order. "Enterable" is
/// derived -- exactly `Laid` -- never a stored flag.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InteriorOutcome {
    Laid {
        plot: u32,
        building_type: u32,
        interior: Interior,
        attempts: u32,
        work: LayoutWork,
    },
    /// The type declares no room program: a solid, non-enterable
    /// building.
    Shell { plot: u32, building_type: u32 },
    Rejected {
        plot: u32,
        building_type: u32,
        reason: RejectReason,
        attempts: u32,
        work: LayoutWork,
    },
}

/// Pass 6's own output.
#[derive(Debug, Clone)]
pub struct InteriorMap {
    outcomes: Vec<InteriorOutcome>,
}

impl InteriorMap {
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn test_fixture(outcomes: Vec<InteriorOutcome>) -> Self {
        InteriorMap { outcomes }
    }

    pub fn outcomes(&self) -> &[InteriorOutcome] {
        &self.outcomes
    }

    /// Every laid-out interior with the plot and type it belongs to.
    pub fn laid(&self) -> impl Iterator<Item = (u32, u32, &Interior)> {
        self.outcomes.iter().filter_map(|o| match o {
            InteriorOutcome::Laid {
                plot,
                building_type,
                interior,
                ..
            } => Some((*plot, *building_type, interior)),
            _ => None,
        })
    }

    /// The enterable count: every building that was laid out.
    pub fn enterable_count(&self) -> i64 {
        self.laid().count() as i64
    }

    pub fn shell_count(&self) -> i64 {
        self.outcomes
            .iter()
            .filter(|o| matches!(o, InteriorOutcome::Shell { .. }))
            .count() as i64
    }

    pub fn rejected_count(&self) -> i64 {
        self.outcomes
            .iter()
            .filter(|o| matches!(o, InteriorOutcome::Rejected { .. }))
            .count() as i64
    }

    /// The share of attempted layouts (laid + rejected; a `Shell` never
    /// attempts one) that were rejected, rounded down; `0` when nothing
    /// was attempted.
    pub fn rejected_percent(&self) -> i64 {
        let attempted = self.enterable_count() + self.rejected_count();
        if attempted == 0 {
            return 0;
        }
        self.rejected_count() * 100 / attempted
    }

    /// Every laid-out building's footprint as `building_area` rows,
    /// clipped to chunks, in envelope order.
    pub fn building_areas(&self) -> Vec<AreaSpec> {
        let mut out = Vec::new();
        for (_, _, interior) in self.laid() {
            push_clipped(
                &mut out,
                rect_seed_key(interior.footprint),
                interior.footprint,
            );
        }
        out
    }

    /// Every room's floor, plus each threshold it owns, as `room_area`
    /// rows, clipped to chunks, in envelope then room order.
    pub fn room_areas(&self) -> Vec<AreaSpec> {
        let mut out = Vec::new();
        for (_, _, interior) in self.laid() {
            for (i, room) in interior.rooms.iter().enumerate() {
                let owner = rect_seed_key(room.rect);
                push_clipped(&mut out, owner, room.rect);
                for t in interior.thresholds.iter().filter(|t| t.room == i) {
                    push_clipped(&mut out, owner, cell_rect(t.x, t.y));
                }
            }
        }
        out
    }
}

fn cell_rect(x: i32, y: i32) -> Rect {
    Rect {
        x0: x,
        y0: y,
        x1: x + 1,
        y1: y + 1,
    }
}

fn push_clipped(out: &mut Vec<AreaSpec>, owner_id: u64, rect: Rect) {
    for (piece, chunk_key) in clip_rect_to_chunks(rect, 0) {
        out.push(AreaSpec {
            owner_id,
            floor: 0,
            rect: piece,
            chunk_key,
        });
    }
}

const AREA_KIND_BUILDING: u64 = 1;
const AREA_KIND_ROOM: u64 = 2;

/// The rule-site area id of a building's footprint -- disjoint from a
/// room's, and from a block's bare [`rect_seed_key`].
pub fn building_area_id(footprint: Rect) -> AreaId {
    seed_from_ids(AREA_KIND_BUILDING, rect_seed_key(footprint))
}

/// The rule-site area id of a room's floor rect.
pub fn room_area_id(rect: Rect) -> AreaId {
    seed_from_ids(AREA_KIND_ROOM, rect_seed_key(rect))
}

/// Adds every cell of `interior` the rule engine needs to `builder`,
/// floor 0 -- the one adapter `DistrictSite` and this pass's own
/// per-building verdict share. A wall cell carries the wall tags; a
/// floor cell the floor tag (a fixture cell adds the fixture tag and its
/// own required tag); a threshold the threshold and wall-run tags (and
/// `entrance` for the street door); the floor cell just inside each
/// room's own doorway additionally carries that room type's tags -- the
/// marker the requirement rows' containers match; the approach cells
/// carry pavement. Walls, floors and thresholds are in the building area;
/// floors, fixtures and a room's own doorway also in the room's.
pub fn add_building(builder: &mut SiteBuilder, interior: &Interior, vocab: &Vocabulary) {
    let p = vocab.parts;
    let fp = interior.footprint;
    let building = builder.area(building_area_id(fp));
    let room_areas: Vec<AreaSlot> = interior
        .rooms
        .iter()
        .map(|r| builder.area(room_area_id(r.rect)))
        .collect();

    let wall = builder.profile(&[p.wall, p.wall_run], &[building]);
    builder.set_rect(fp, wall);
    for (i, room) in interior.rooms.iter().enumerate() {
        let floor = builder.profile(&[p.floor], &[building, room_areas[i]]);
        builder.set_rect(room.rect, floor);
    }
    let mut fixture_profiles: Vec<((usize, TagId), ProfileId)> = Vec::new();
    for f in &interior.fixtures {
        let prof = match fixture_profiles.iter().find(|(k, _)| *k == (f.room, f.tag)) {
            Some(&(_, prof)) => prof,
            None => {
                let prof = builder.profile(
                    &[p.floor, p.fixture, f.tag],
                    &[building, room_areas[f.room]],
                );
                fixture_profiles.push(((f.room, f.tag), prof));
                prof
            }
        };
        builder.set(f.x, f.y, prof);
    }
    for t in &interior.thresholds {
        let mut tags = vec![p.threshold, p.wall_run];
        if t.entrance {
            tags.push(p.entrance);
        }
        let prof = builder.profile(&tags, &[building, room_areas[t.room]]);
        builder.set(t.x, t.y, prof);
    }
    // The room's own marker: the cell just inside the doorway it owns (a
    // floor cell, so only the building and room areas contain it -- never
    // the block area the street door's own cell also sits in, which would
    // owe the room's requirements to the whole block).
    for t in &interior.thresholds {
        let room = &interior.rooms[t.room];
        if let Some((x, y)) = [
            (t.x + 1, t.y),
            (t.x - 1, t.y),
            (t.x, t.y + 1),
            (t.x, t.y - 1),
        ]
        .into_iter()
        .find(|&(x, y)| room.rect.contains(x, y))
        {
            let mut tags = vec![p.floor];
            tags.extend_from_slice(vocab.room(room.room_type).tags);
            let prof = builder.profile(&tags, &[building, room_areas[t.room]]);
            builder.merge(x, y, prof);
        }
    }
    let pavement = builder.profile(&[p.pavement], &[]);
    for &(x, y) in &interior.approach {
        builder.set(x, y, pavement);
    }
}

/// The rule site of exactly one building: a [`DistrictSite`] over the
/// footprint and the approach, nothing else -- every per-building
/// verdict is windowed to its own building, never the district's.
pub fn building_site(interior: &Interior, vocab: &Vocabulary) -> DistrictSite {
    let fp = interior.footprint;
    let mut bounds = fp;
    for &(x, y) in &interior.approach {
        bounds.x0 = bounds.x0.min(x);
        bounds.y0 = bounds.y0.min(y);
        bounds.x1 = bounds.x1.max(x + 1);
        bounds.y1 = bounds.y1.max(y + 1);
    }
    let mut builder = SiteBuilder::new(bounds);
    add_building(&mut builder, interior, vocab);
    builder.finish()
}

/// The accept/reject step: `crate::rules::evaluate_local` over the site
/// of this one building, built by the same adapter `DistrictSite` uses.
/// Empty means the layout may be emitted.
#[cfg(any(test, feature = "test-fixtures"))]
pub fn check_layout(
    interior: &Interior,
    vocab: &Vocabulary,
    rules: crate::rules::RuleSet<'_>,
) -> Vec<crate::rules::Violation> {
    crate::rules::evaluate_local(rules, &building_site(interior, vocab))
}

/// The layout's own frame: local `(u, v)` with `u` along the front face
/// and `v` from the front wall inward, over the footprint's interior net
/// (the footprint minus its wall ring). `flip` mirrors `u`. `cell` maps
/// a local cell -- the wall ring included, at `-1` and `w`/`d` -- back to
/// world coordinates, so nothing downstream ever holds a second frame.
#[derive(Clone, Copy)]
struct Frame {
    net: Rect,
    front: Side,
    flip: bool,
    w: i32,
    d: i32,
}

impl Frame {
    fn new(footprint: Rect, front: Side, thickness: i32, flip: bool) -> Frame {
        let net = Rect {
            x0: footprint.x0 + thickness,
            y0: footprint.y0 + thickness,
            x1: footprint.x1 - thickness,
            y1: footprint.y1 - thickness,
        };
        let (w, d) = match front {
            Side::North | Side::South => (net.width() as i32, net.height() as i32),
            Side::East | Side::West => (net.height() as i32, net.width() as i32),
        };
        Frame {
            net,
            front,
            flip,
            w,
            d,
        }
    }

    fn cell(&self, u: i32, v: i32) -> (i32, i32) {
        let uu = if self.flip { self.w - 1 - u } else { u };
        match self.front {
            Side::South => (self.net.x0 + uu, self.net.y1 - 1 - v),
            Side::North => (self.net.x0 + uu, self.net.y0 + v),
            Side::East => (self.net.x1 - 1 - v, self.net.y0 + uu),
            Side::West => (self.net.x0 + v, self.net.y0 + uu),
        }
    }

    /// A local half-open rect as a world rect.
    fn rect(&self, u0: i32, v0: i32, u1: i32, v1: i32) -> Rect {
        let a = self.cell(u0, v0);
        let b = self.cell(u1 - 1, v1 - 1);
        Rect {
            x0: a.0.min(b.0),
            y0: a.1.min(b.1),
            x1: a.0.max(b.0) + 1,
            y1: a.1.max(b.1) + 1,
        }
    }
}

/// A room's floor need in cells, given how many doors open into it from
/// rooms behind: what it owes, its own door and a cell of lane each.
type Need<'n> = &'n dyn Fn(&defs::RoomTypeDef, i32) -> i32;

/// What sizing a plan reads beyond its frame: the partition thickness,
/// the aspect cap and each room's floor need.
#[derive(Clone, Copy)]
struct Sizing<'n> {
    t: i32,
    cap: i32,
    need: Need<'n>,
}

/// Whether a `a x b` rect keeps its long side within `cap` times its
/// short side.
pub fn within_aspect(a: i32, b: i32, cap: i32) -> bool {
    a.min(b) >= 1 && a.max(b) <= cap * a.min(b)
}

fn ceil_div(a: i32, b: i32) -> i32 {
    (a + b - 1) / b
}

/// Spreads `total` over the slots: every slot at least its `lower`, at
/// most its `upper`, the spare shared by `weights` (ties to the heaviest).
/// `None` when the bounds cannot sum to `total`.
fn spread(lower: &[i32], upper: &[i32], weights: &[u32], total: i32) -> Option<Vec<i32>> {
    let lo: i32 = lower.iter().sum();
    let hi: i32 = upper.iter().sum();
    if total < lo || total > hi {
        return None;
    }
    let mut out = lower.to_vec();
    let spare = total - lo;
    let mut left = spare;
    let weight_sum: i64 = weights.iter().map(|&w| w.max(1) as i64).sum();
    for i in 0..out.len() {
        let share = (spare as i64 * weights[i].max(1) as i64 / weight_sum) as i32;
        let add = share.min(upper[i] - out[i]).min(left);
        out[i] += add;
        left -= add;
    }
    let mut by_weight: Vec<usize> = (0..out.len()).collect();
    by_weight.sort_by_key(|&i| std::cmp::Reverse(weights[i]));
    while left > 0 {
        let mut moved = false;
        for &i in &by_weight {
            if left > 0 && out[i] < upper[i] {
                out[i] += 1;
                left -= 1;
                moved = true;
            }
        }
        if !moved {
            return None;
        }
    }
    Some(out)
}

/// One room of a plan in the frame's local cells: `(u0, v0, u1, v1)`, and
/// for every room but the front one its door -- the threshold cell, the
/// cell outside it in the room it opens from (`parent`, an index into the
/// plan's rooms) and the cell just inside.
struct LocalRoom<'a> {
    def: &'a defs::RoomTypeDef,
    rect: (i32, i32, i32, i32),
    door: Option<LocalDoor>,
}

#[derive(Clone, Copy)]
struct LocalDoor {
    cell: (i32, i32),
    outside: (i32, i32),
    inside: (i32, i32),
    parent: usize,
}

/// The band plan's sizes: the back rooms' widths (spread by weight) and
/// the front band's depth range under the aspect cap -- `None` when no
/// depth satisfies every room.
fn band_sizes(
    front: &defs::RoomTypeDef,
    back: &[&defs::RoomTypeDef],
    w: i32,
    d: i32,
    z: Sizing,
) -> Option<(Vec<i32>, i32, i32)> {
    let Sizing { t, cap, need } = z;
    if w < front.min_width_cells as i32 {
        return None;
    }
    if back.is_empty() {
        let ok = d >= front.min_depth_cells as i32
            && within_aspect(w, d, cap)
            && w * d >= need(front, 0);
        return ok.then(|| (Vec::new(), d, d));
    }
    let k = back.len() as i32;
    let lower: Vec<i32> = back.iter().map(|r| r.min_width_cells as i32).collect();
    let upper = vec![w; back.len()];
    let weights: Vec<u32> = back.iter().map(|r| r.weight).collect();
    let widths = spread(&lower, &upper, &weights, w - t * (k - 1))?;
    let db_lo = back
        .iter()
        .zip(&widths)
        .map(|(r, &wi)| {
            (r.min_depth_cells as i32)
                .max(ceil_div(wi, cap))
                .max(ceil_div(need(r, 0), wi))
        })
        .max()?;
    let db_hi = widths.iter().map(|&wi| cap * wi).min()?;
    let df_lo = (front.min_depth_cells as i32)
        .max(ceil_div(w, cap))
        .max(ceil_div(need(front, k), w));
    let df_hi = cap * w;
    let lo = (d - t - db_hi).max(df_lo);
    let hi = (d - t - db_lo).min(df_hi);
    (lo <= hi).then_some((widths, lo, hi))
}

/// The band plan: the front room across the full width, a partition,
/// and the back rooms side by side behind it, each with its own door
/// onto the front room.
fn band_rooms<'a>(
    rng: &mut Rng,
    front: &'a defs::RoomTypeDef,
    back: &[&'a defs::RoomTypeDef],
    w: i32,
    d: i32,
    z: Sizing,
) -> Option<Vec<LocalRoom<'a>>> {
    let t = z.t;
    let (widths, lo, hi) = band_sizes(front, back, w, d, z)?;
    let df = lo + rng.below((hi - lo + 1) as u64) as i32;
    let mut rooms = vec![LocalRoom {
        def: front,
        rect: (0, 0, w, df),
        door: None,
    }];
    let mut cursor = 0;
    for (room, &wi) in back.iter().zip(&widths) {
        let (u0, u1) = (cursor, cursor + wi);
        cursor = u1 + t;
        let door_u = u0 + rng.below(wi as u64) as i32;
        rooms.push(LocalRoom {
            def: room,
            rect: (u0, df + t, u1, d),
            door: Some(LocalDoor {
                cell: (door_u, df),
                outside: (door_u, df - 1),
                inside: (door_u, df + t),
                parent: 0,
            }),
        });
    }
    Some(rooms)
}

/// Every zone width `0..=w` a stack of `rooms` fits, one bit each: the
/// rooms stacked front to back along the full depth `d`, each within the
/// aspect cap.
fn zone_widths(rooms: &[&defs::RoomTypeDef], w: i32, d: i32, z: Sizing) -> u64 {
    let Sizing { t, cap, need } = z;
    let mut bits = 0u64;
    if rooms.is_empty() {
        return 1;
    }
    let n = rooms.len() as i32;
    let avail = d - t * (n - 1);
    let min_w = rooms
        .iter()
        .map(|r| r.min_width_cells as i32)
        .max()
        .unwrap_or(0);
    for wz in min_w.max(1)..=w.min(63) {
        let lo: i32 = rooms
            .iter()
            .map(|r| {
                (r.min_depth_cells as i32)
                    .max(ceil_div(wz, cap))
                    .max(ceil_div(need(r, 0), wz))
            })
            .sum();
        if lo <= avail && avail <= cap * wz * n {
            bits |= 1 << wz;
        }
    }
    bits
}

/// The column plan's options, visited in a fixed order: which back rooms
/// stack on the left of the front column (bit `i` of the mask) and the
/// column's own `[ua, ub)`. The column holds the entrance and runs the
/// full depth; a side with no rooms has no zone.
fn column_options(
    front: &defs::RoomTypeDef,
    back: &[&defs::RoomTypeDef],
    w: i32,
    d: i32,
    z: Sizing,
    entrance_u: i32,
    mut visit: impl FnMut(u32, i32, i32) -> bool,
) {
    let Sizing { t, cap, need } = z;
    let k = back.len();
    if k == 0 || k > 8 || d < front.min_depth_cells as i32 {
        return;
    }
    let subsets = 1u32 << k;
    let fits: Vec<u64> = (0..subsets)
        .map(|mask| {
            let rooms: Vec<&defs::RoomTypeDef> = (0..k)
                .filter(|i| mask & (1 << i) != 0)
                .map(|i| back[i])
                .collect();
            zone_widths(&rooms, w, d, z)
        })
        .collect();
    for mask in 0..subsets {
        let right = (subsets - 1) & !mask;
        for ua in 0..=entrance_u {
            let left_ok = if mask == 0 {
                ua == 0
            } else {
                ua - t >= 1 && fits[mask as usize] & (1 << (ua - t)) != 0
            };
            if !left_ok {
                continue;
            }
            for ub in entrance_u + 1..=w {
                let right_ok = if right == 0 {
                    ub == w
                } else {
                    w - ub - t >= 1 && fits[right as usize] & (1 << (w - ub - t)) != 0
                };
                let wc = ub - ua;
                if right_ok
                    && wc >= front.min_width_cells as i32
                    && within_aspect(wc, d, cap)
                    && wc * d >= need(front, k as i32)
                    && !visit(mask, ua, ub)
                {
                    return;
                }
            }
        }
    }
}

/// One side zone's rooms stacked front to back, each with its door in
/// the partition onto the front column at `door_u`.
#[allow(clippy::too_many_arguments)]
fn stack_zone<'a>(
    rng: &mut Rng,
    rooms: &[&'a defs::RoomTypeDef],
    (z0, z1): (i32, i32),
    door_u: i32,
    outside_u: i32,
    inside_u: i32,
    d: i32,
    z: Sizing,
    out: &mut Vec<LocalRoom<'a>>,
) -> Option<()> {
    let Sizing { t, cap, need } = z;
    if rooms.is_empty() {
        return Some(());
    }
    let wz = z1 - z0;
    let n = rooms.len() as i32;
    let lower: Vec<i32> = rooms
        .iter()
        .map(|r| {
            (r.min_depth_cells as i32)
                .max(ceil_div(wz, cap))
                .max(ceil_div(need(r, 0), wz))
        })
        .collect();
    let upper = vec![cap * wz; rooms.len()];
    let weights: Vec<u32> = rooms.iter().map(|r| r.weight).collect();
    let depths = spread(&lower, &upper, &weights, d - t * (n - 1))?;
    let mut v = 0;
    for (room, &di) in rooms.iter().zip(&depths) {
        let dv = v + rng.below(di as u64) as i32;
        out.push(LocalRoom {
            def: room,
            rect: (z0, v, z1, v + di),
            door: Some(LocalDoor {
                cell: (door_u, dv),
                outside: (outside_u, dv),
                inside: (inside_u, dv),
                parent: 0,
            }),
        });
        v += di + t;
    }
    Some(())
}

/// The column plan: the front room a full-depth column holding the
/// entrance, the back rooms stacked front to back in a zone on either
/// side of it, each with its own door onto the column. One option is
/// drawn uniformly from every one that fits.
#[allow(clippy::too_many_arguments)]
fn column_rooms<'a>(
    rng: &mut Rng,
    front: &'a defs::RoomTypeDef,
    back: &[&'a defs::RoomTypeDef],
    w: i32,
    d: i32,
    z: Sizing,
    entrance_u: i32,
) -> Option<Vec<LocalRoom<'a>>> {
    let t = z.t;
    let mut count = 0u64;
    column_options(front, back, w, d, z, entrance_u, |_, _, _| {
        count += 1;
        true
    });
    if count == 0 {
        return None;
    }
    let pick = rng.below(count);
    let mut seen = 0u64;
    let mut chosen = None;
    column_options(front, back, w, d, z, entrance_u, |mask, ua, ub| {
        if seen == pick {
            chosen = Some((mask, ua, ub));
            return false;
        }
        seen += 1;
        true
    });
    let (mask, ua, ub) = chosen?;
    let left: Vec<&defs::RoomTypeDef> = (0..back.len())
        .filter(|i| mask & (1 << i) != 0)
        .map(|i| back[i])
        .collect();
    let right: Vec<&defs::RoomTypeDef> = (0..back.len())
        .filter(|i| mask & (1 << i) == 0)
        .map(|i| back[i])
        .collect();
    let mut rooms = vec![LocalRoom {
        def: front,
        rect: (ua, 0, ub, d),
        door: None,
    }];
    stack_zone(
        rng,
        &left,
        (0, ua - t),
        ua - t,
        ua,
        ua - t - 1,
        d,
        z,
        &mut rooms,
    )?;
    stack_zone(
        rng,
        &right,
        (ub + t, w),
        ub,
        ub - 1,
        ub + t,
        d,
        z,
        &mut rooms,
    )?;
    Some(rooms)
}

/// One two-row assignment: for each back room, `None` for the first row
/// (a door onto the front room) or `Some(j)` for the second row behind
/// first-row room `j` (a door through it, only between rooms of one
/// access).
type Rows = Vec<Option<usize>>;

/// Visits every two-row assignment with at least one second-row room, in
/// a fixed order: a room either joins the first row or stands behind an
/// earlier first-row room of its own access.
fn two_row_assignments(back: &[&defs::RoomTypeDef], mut visit: impl FnMut(&Rows) -> bool) {
    fn go(
        back: &[&defs::RoomTypeDef],
        rows: &mut Rows,
        visit: &mut dyn FnMut(&Rows) -> bool,
    ) -> bool {
        let i = rows.len();
        if i == back.len() {
            return !rows.iter().any(Option::is_some) || visit(rows);
        }
        rows.push(None);
        if !go(back, rows, visit) {
            return false;
        }
        rows.pop();
        for j in 0..i {
            if rows[j].is_none() && back[j].access == back[i].access {
                rows.push(Some(j));
                if !go(back, rows, visit) {
                    return false;
                }
                rows.pop();
            }
        }
        true
    }
    if back.len() >= 2 && back.len() <= 8 {
        go(back, &mut Vec::new(), &mut visit);
    }
}

/// The two-row plan's sizes for one assignment: every room's width, and
/// the range of the two rows' summed depth -- `None` when no depths fit.
struct TwoRowSizes {
    widths: Vec<i32>,
    d1: (i32, i32),
    d2: (i32, i32),
    sum: (i32, i32),
}

#[allow(clippy::too_many_arguments)]
fn two_row_sizes(
    front: &defs::RoomTypeDef,
    back: &[&defs::RoomTypeDef],
    rows: &Rows,
    w: i32,
    d: i32,
    z: Sizing,
) -> Option<TwoRowSizes> {
    let Sizing { t, cap, need } = z;
    if w < front.min_width_cells as i32 {
        return None;
    }
    let first: Vec<usize> = (0..back.len()).filter(|&i| rows[i].is_none()).collect();
    let children =
        |j: usize| -> Vec<usize> { (0..back.len()).filter(|&i| rows[i] == Some(j)).collect() };
    let lower: Vec<i32> = first
        .iter()
        .map(|&j| {
            let kids = children(j);
            let need: i32 = kids
                .iter()
                .map(|&i| back[i].min_width_cells as i32)
                .sum::<i32>()
                + t * (kids.len() as i32 - 1).max(0);
            (back[j].min_width_cells as i32).max(need)
        })
        .collect();
    let weights: Vec<u32> = first.iter().map(|&j| back[j].weight).collect();
    let row_widths = spread(
        &lower,
        &vec![w; first.len()],
        &weights,
        w - t * (first.len() as i32 - 1),
    )?;
    let mut widths = vec![0; back.len()];
    let (mut lo2, mut hi2) = (0, i32::MAX);
    for (&j, &wj) in first.iter().zip(&row_widths) {
        widths[j] = wj;
        let kids = children(j);
        if kids.is_empty() {
            continue;
        }
        let kl: Vec<i32> = kids
            .iter()
            .map(|&i| back[i].min_width_cells as i32)
            .collect();
        let kw: Vec<u32> = kids.iter().map(|&i| back[i].weight).collect();
        let kid_widths = spread(
            &kl,
            &vec![wj; kids.len()],
            &kw,
            wj - t * (kids.len() as i32 - 1),
        )?;
        for (&i, &wi) in kids.iter().zip(&kid_widths) {
            widths[i] = wi;
            lo2 = lo2.max(
                (back[i].min_depth_cells as i32)
                    .max(ceil_div(wi, cap))
                    .max(ceil_div(need(back[i], 0), wi)),
            );
            hi2 = hi2.min(cap * wi);
        }
    }
    // A first-row room with a room behind it is one row deep; one with
    // nothing behind it runs the depth of both rows (`sum + t`).
    let depth_lo = |j: usize| {
        (back[j].min_depth_cells as i32)
            .max(ceil_div(widths[j], cap))
            .max(ceil_div(need(back[j], children(j).len() as i32), widths[j]))
    };
    let (parents, full): (Vec<usize>, Vec<usize>) =
        first.iter().partition(|&&j| !children(j).is_empty());
    let lo1 = parents.iter().map(|&j| depth_lo(j)).max()?;
    let hi1 = parents.iter().map(|&j| cap * widths[j]).min()?;
    let full_lo = full.iter().map(|&j| depth_lo(j) - t).max().unwrap_or(0);
    let full_hi = full
        .iter()
        .map(|&j| cap * widths[j] - t)
        .min()
        .unwrap_or(i32::MAX);
    let df_lo = (front.min_depth_cells as i32)
        .max(ceil_div(w, cap))
        .max(ceil_div(need(front, first.len() as i32), w));
    let df_hi = cap * w;
    let sum_lo = (lo1 + lo2).max(d - 2 * t - df_hi).max(full_lo);
    let sum_hi = (hi1.saturating_add(hi2))
        .min(d - 2 * t - df_lo)
        .min(full_hi);
    (lo1 <= hi1 && lo2 <= hi2 && sum_lo <= sum_hi).then_some(TwoRowSizes {
        widths,
        d1: (lo1, hi1),
        d2: (lo2, hi2),
        sum: (sum_lo, sum_hi),
    })
}

/// The two-row plan: the front band, a first row of back rooms each
/// opening onto it, and a second row behind -- each second-row room
/// reached through the first-row room in front of it, which shares its
/// access; a first-row room with nothing behind it runs the full depth.
/// One assignment is drawn uniformly from every one that fits.
fn two_row_rooms<'a>(
    rng: &mut Rng,
    front: &'a defs::RoomTypeDef,
    back: &[&'a defs::RoomTypeDef],
    w: i32,
    d: i32,
    z: Sizing,
) -> Option<Vec<LocalRoom<'a>>> {
    let t = z.t;
    let mut count = 0u64;
    two_row_assignments(back, |rows| {
        count += two_row_sizes(front, back, rows, w, d, z).is_some() as u64;
        true
    });
    if count == 0 {
        return None;
    }
    let pick = rng.below(count);
    let mut seen = 0u64;
    let mut chosen = None;
    two_row_assignments(back, |rows| {
        if let Some(sizes) = two_row_sizes(front, back, rows, w, d, z) {
            if seen == pick {
                chosen = Some((rows.clone(), sizes));
                return false;
            }
            seen += 1;
        }
        true
    });
    let (rows, sizes) = chosen?;
    let sum = sizes.sum.0 + rng.below((sizes.sum.1 - sizes.sum.0 + 1) as u64) as i32;
    let d1_lo = sizes.d1.0.max(sum - sizes.d2.1);
    let d1_hi = sizes.d1.1.min(sum - sizes.d2.0);
    let d1 = d1_lo + rng.below((d1_hi - d1_lo + 1) as u64) as i32;
    let df = d - 2 * t - sum;
    let v1 = df + t;
    let v2 = v1 + d1 + t;

    let mut rooms = vec![LocalRoom {
        def: front,
        rect: (0, 0, w, df),
        door: None,
    }];
    let mut index_of = vec![0usize; back.len()];
    let mut span = vec![(0, 0); back.len()];
    let mut cursor = 0;
    for j in (0..back.len()).filter(|&j| rows[j].is_none()) {
        let (u0, u1) = (cursor, cursor + sizes.widths[j]);
        cursor = u1 + t;
        span[j] = (u0, u1);
        let door_u = u0 + rng.below((u1 - u0) as u64) as i32;
        index_of[j] = rooms.len();
        let has_kids = rows.contains(&Some(j));
        rooms.push(LocalRoom {
            def: back[j],
            rect: (u0, v1, u1, if has_kids { v1 + d1 } else { d }),
            door: Some(LocalDoor {
                cell: (door_u, df),
                outside: (door_u, df - 1),
                inside: (door_u, v1),
                parent: 0,
            }),
        });
    }
    let mut kid_cursor: Vec<i32> = span.iter().map(|s| s.0).collect();
    for i in 0..back.len() {
        let Some(j) = rows[i] else {
            continue;
        };
        let (u0, u1) = (kid_cursor[j], kid_cursor[j] + sizes.widths[i]);
        kid_cursor[j] = u1 + t;
        let door_u = u0 + rng.below((u1 - u0) as u64) as i32;
        rooms.push(LocalRoom {
            def: back[i],
            rect: (u0, v2, u1, d),
            door: Some(LocalDoor {
                cell: (door_u, v2 - t),
                outside: (door_u, v2 - t - 1),
                inside: (door_u, v2),
                parent: index_of[j],
            }),
        });
    }
    Some(rooms)
}

/// Whether some plan lays `program` out in a `w x d` frame whose
/// entrance sits at one of `entrance_us` (the two mirrors).
fn program_fits(
    program: &[&defs::RoomTypeDef],
    w: i32,
    d: i32,
    z: Sizing,
    entrance_us: [i32; 2],
) -> bool {
    let (front, back) = (program[0], &program[1..]);
    if band_sizes(front, back, w, d, z).is_some() {
        return true;
    }
    let mut two_rows = false;
    two_row_assignments(back, |rows| {
        two_rows = two_row_sizes(front, back, rows, w, d, z).is_some();
        !two_rows
    });
    if two_rows {
        return true;
    }
    entrance_us.iter().any(|&eu| {
        let mut any = false;
        column_options(front, back, w, d, z, eu, |_, _, _| {
            any = true;
            false
        });
        any
    })
}

/// The rooms this footprint holds: the required core plus the longest
/// prefix of the optional tail, in declared order, that some plan fits
/// (a room more can make a footprint fit, by splitting a room the aspect
/// cap refuses). `None` when no prefix fits.
fn select_program<'a>(
    def: &defs::BuildingTypeDef,
    vocab: &Vocabulary<'a>,
    w: i32,
    d: i32,
    t: i32,
    cap: i32,
    entrance_us: [i32; 2],
) -> Option<Vec<&'a defs::RoomTypeDef>> {
    let mut rooms: Vec<&defs::RoomTypeDef> = def.rooms.iter().map(|&id| vocab.room(id)).collect();
    let need = |r: &defs::RoomTypeDef, doors: i32| vocab.need(r, doors);
    let z = Sizing {
        t,
        cap,
        need: &need,
    };
    let mut best = program_fits(&rooms, w, d, z, entrance_us).then(|| rooms.clone());
    for &id in def.optional_rooms {
        rooms.push(vocab.room(id));
        if program_fits(&rooms, w, d, z, entrance_us) {
            best = Some(rooms.clone());
        }
    }
    best
}

/// The fixture tags a room owes and how many of each: every committed
/// requirement row whose container the room carries (its own tags, or
/// the floor every room has), except the structural ones the layout
/// itself provides (a door, enough floor). Rows sorted by id; two rows
/// asking for one tag take the larger minimum.
fn fixtures_owed(
    room: &defs::RoomTypeDef,
    rows: &[RequirementRow],
    parts: &Parts,
) -> Vec<(TagId, u32)> {
    let mut out: Vec<(TagId, u32)> = Vec::new();
    for row in rows {
        let carried = room.tags.contains(&row.container) || row.container == parts.floor;
        if !carried || parts.is_part(row.requires) {
            continue;
        }
        match out.iter_mut().find(|(t, _)| *t == row.requires) {
            Some(e) => e.1 = e.1.max(row.min),
            None => out.push((row.requires, row.min)),
        }
    }
    out
}

/// A room's floor as a small dense grid, for the lane check: which cells
/// hold a fixture, and a reusable flood-fill scratch so a placement
/// trial costs one pass over the room and no allocation.
struct RoomGrid {
    x0: i32,
    y0: i32,
    w: usize,
    h: usize,
    occupied: Vec<bool>,
    occupied_count: usize,
    seen: Vec<u32>,
    stamp: u32,
    stack: Vec<usize>,
}

impl RoomGrid {
    fn new(rect: Rect) -> Self {
        let (w, h) = (rect.width() as usize, rect.height() as usize);
        RoomGrid {
            x0: rect.x0,
            y0: rect.y0,
            w,
            h,
            occupied: vec![false; w * h],
            occupied_count: 0,
            seen: vec![0; w * h],
            stamp: 0,
            stack: Vec::new(),
        }
    }

    fn index(&self, c: (i32, i32)) -> usize {
        (c.1 - self.y0) as usize * self.w + (c.0 - self.x0) as usize
    }

    fn cell(&self, i: usize) -> (i32, i32) {
        (self.x0 + (i % self.w) as i32, self.y0 + (i / self.w) as i32)
    }

    fn neighbours(&self, i: usize) -> [Option<usize>; 4] {
        let (x, y) = (i % self.w, i / self.w);
        [
            (x + 1 < self.w).then(|| i + 1),
            (x > 0).then(|| i - 1),
            (y + 1 < self.h).then(|| i + self.w),
            (y > 0).then(|| i - self.w),
        ]
    }

    /// Whether the free cells are one 4-connected region containing the
    /// `anchor` cell, and every occupied cell touches one of them -- the
    /// lane a citizen walks from the door to every fixture.
    fn lane_holds(&mut self, anchor: usize) -> bool {
        if self.occupied[anchor] {
            return false;
        }
        self.stamp += 1;
        let stamp = self.stamp;
        self.stack.clear();
        self.stack.push(anchor);
        self.seen[anchor] = stamp;
        let mut reached = 1usize;
        while let Some(i) = self.stack.pop() {
            for n in self.neighbours(i).into_iter().flatten() {
                if !self.occupied[n] && self.seen[n] != stamp {
                    self.seen[n] = stamp;
                    reached += 1;
                    self.stack.push(n);
                }
            }
        }
        if reached != self.w * self.h - self.occupied_count {
            return false;
        }
        (0..self.w * self.h).filter(|&i| self.occupied[i]).all(|i| {
            self.neighbours(i)
                .into_iter()
                .flatten()
                .any(|n| self.seen[n] == stamp)
        })
    }

    fn set(&mut self, i: usize, value: bool) {
        if self.occupied[i] != value {
            self.occupied[i] = value;
            if value {
                self.occupied_count += 1;
            } else {
                self.occupied_count -= 1;
            }
        }
    }

    fn clear(&mut self) {
        for i in 0..self.occupied.len() {
            self.set(i, false);
        }
    }
}

/// The order classes are placed in: the counter takes its wall first,
/// then the light, then the wall-backed anchors, then the free-standing
/// tables on what floor is left.
fn class_rank(class: defs::TagPlacement) -> u8 {
    match class {
        defs::TagPlacement::FacingDoor => 0,
        defs::TagPlacement::WallMounted => 1,
        defs::TagPlacement::WallBacked => 2,
        defs::TagPlacement::FreeStanding => 3,
    }
}

/// Where a room's own door is, as the pass places by it: the doorway
/// cell, the cell just inside it, and the footprint (to tell the shell
/// from a partition).
#[derive(Clone, Copy)]
struct DoorView {
    door: (i32, i32),
    inside: (i32, i32),
    footprint: Rect,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Wall {
    North,
    South,
    West,
    East,
}

impl DoorView {
    /// The wall the counter stands against: the one across from the door
    /// when it is the shell, else the side wall nearest the door.
    fn counter_wall(&self, rect: Rect) -> Wall {
        let (dx, dy) = (self.inside.0 - self.door.0, self.inside.1 - self.door.1);
        let across = match (dx, dy) {
            (0, 1) => Wall::South,
            (0, -1) => Wall::North,
            (1, 0) => Wall::East,
            _ => Wall::West,
        };
        let fp = self.footprint;
        let shell = match across {
            Wall::South => rect.y1 == fp.y1 - 1,
            Wall::North => rect.y0 - 1 == fp.y0,
            Wall::East => rect.x1 == fp.x1 - 1,
            Wall::West => rect.x0 - 1 == fp.x0,
        };
        if shell {
            return across;
        }
        if dy != 0 {
            if self.door.0 - rect.x0 <= rect.x1 - 1 - self.door.0 {
                Wall::West
            } else {
                Wall::East
            }
        } else if self.door.1 - rect.y0 <= rect.y1 - 1 - self.door.1 {
            Wall::North
        } else {
            Wall::South
        }
    }
}

type Score = (u32, u32, u32, u32, u64);

/// One candidate cell's score for a class (lower is better) and, for the
/// counter, the cell it is served from.
fn score(
    class: defs::TagPlacement,
    rect: Rect,
    c: (i32, i32),
    adjacent: bool,
    key: u64,
    door: &DoorView,
) -> (Score, Option<(i32, i32)>) {
    let (x, y) = c;
    let on_n = y == rect.y0;
    let on_s = y == rect.y1 - 1;
    let on_w = x == rect.x0;
    let on_e = x == rect.x1 - 1;
    let corner = (on_n || on_s) && (on_w || on_e);
    let along_row = (2 * x - (rect.x0 + rect.x1 - 1)).unsigned_abs();
    let along_col = (2 * y - (rect.y0 + rect.y1 - 1)).unsigned_abs();
    let (side, along) = if on_n {
        (0, along_row)
    } else if on_w || on_e {
        (1, along_col)
    } else if on_s {
        (2, along_row)
    } else {
        (3, along_row + along_col)
    };
    let narrow = rect.width().min(rect.height()) <= 2;
    let adj = adjacent as u32;
    let wall_backed = (adj, side, (corner && !narrow) as u32, along, key);
    match class {
        defs::TagPlacement::WallBacked => (wall_backed, None),
        defs::TagPlacement::WallMounted => ((adj, side, corner as u32, along, key), None),
        defs::TagPlacement::FreeStanding => {
            if rect.width() >= 3 && rect.height() >= 3 {
                let perimeter = (on_n || on_s || on_w || on_e) as u32;
                ((adj, perimeter, along_row + along_col, 0, key), None)
            } else {
                (wall_backed, None)
            }
        }
        defs::TagPlacement::FacingDoor => {
            let wall = door.counter_wall(rect);
            let (on, along, serve) = match wall {
                Wall::North => (on_n, along_row, (x, y + 1)),
                Wall::South => (on_s, along_row, (x, y - 1)),
                Wall::West => (on_w, along_col, (x + 1, y)),
                Wall::East => (on_e, along_col, (x - 1, y)),
            };
            if on && rect.contains(serve.0, serve.1) {
                ((0, adj, along, 0, key), Some(serve))
            } else {
                ((1, wall_backed.0, wall_backed.1, wall_backed.3, key), None)
            }
        }
    }
}

/// Places `owed` on free floor cells of `rect` by each tag's placement
/// class ([`score`]): never on a `reserved` cell (a door and the cell in
/// front of it, a counter's serving cell), never beside another fixture
/// where the room allows, and every placement leaves a lane from the
/// door. A room the classes paint into a corner is retried farthest-
/// from-the-doorway first, which always leaves the doorway's own side
/// free. `None` when the room cannot hold them either way.
#[allow(clippy::too_many_arguments)]
fn place_fixtures(
    rng: &mut Rng,
    rect: Rect,
    reserved: &[(i32, i32)],
    door: &DoorView,
    owed: &[(TagId, u32)],
    room: usize,
    vocab: &Vocabulary,
) -> Option<Vec<Fixture>> {
    let total: u32 = owed.iter().map(|&(_, n)| n).sum();
    let cell_count = (rect.width() * rect.height()) as usize;
    if total as usize > cell_count {
        return None;
    }
    let keys: Vec<u64> = (0..cell_count).map(|_| rng.below(1 << 40)).collect();
    let mut grid = RoomGrid::new(rect);
    let anchor = grid.index(door.inside);
    let reserved_ix: Vec<usize> = reserved.iter().map(|&c| grid.index(c)).collect();
    let mut by_class: Vec<(TagId, u32)> = owed.to_vec();
    by_class.sort_by_key(|&(tag, _)| class_rank(vocab.placement(tag)));
    if let Some(placed) = place_by_class(
        &mut grid,
        &reserved_ix,
        anchor,
        &by_class,
        room,
        &keys,
        rect,
        door,
        vocab,
    ) {
        return Some(placed);
    }
    let mut by_lane: Vec<usize> = (0..cell_count).collect();
    by_lane.sort_by_key(|&i| {
        let c = grid.cell(i);
        let dist = (c.0 - door.inside.0).abs() + (c.1 - door.inside.1).abs();
        (std::cmp::Reverse(dist), keys[i], i)
    });
    fill_in_order(&mut grid, &reserved_ix, anchor, &by_class, room, &by_lane)
}

#[allow(clippy::too_many_arguments)]
fn place_by_class(
    grid: &mut RoomGrid,
    reserved: &[usize],
    anchor: usize,
    owed: &[(TagId, u32)],
    room: usize,
    keys: &[u64],
    rect: Rect,
    door: &DoorView,
    vocab: &Vocabulary,
) -> Option<Vec<Fixture>> {
    grid.clear();
    let mut reserved = reserved.to_vec();
    let mut out = Vec::new();
    let mut ranked: Vec<(Score, usize, Option<usize>)> = Vec::new();
    for &(tag, count) in owed {
        let class = vocab.placement(tag);
        for _ in 0..count {
            ranked.clear();
            for (i, &key) in keys.iter().enumerate() {
                if grid.occupied[i] || reserved.contains(&i) {
                    continue;
                }
                let adjacent = grid
                    .neighbours(i)
                    .into_iter()
                    .flatten()
                    .any(|n| grid.occupied[n]);
                let (s, serve) = score(class, rect, grid.cell(i), adjacent, key, door);
                ranked.push((s, i, serve.map(|c| grid.index(c))));
            }
            ranked.sort_unstable();
            let mut picked = None;
            for &(_, i, serve) in &ranked {
                if serve.is_some_and(|s| grid.occupied[s]) {
                    continue;
                }
                grid.set(i, true);
                if grid.lane_holds(anchor) {
                    picked = Some((i, serve));
                    break;
                }
                grid.set(i, false);
            }
            let Some((i, serve)) = picked else {
                grid.clear();
                return None;
            };
            reserved.extend(serve);
            let (x, y) = grid.cell(i);
            out.push(Fixture { x, y, tag, room });
        }
    }
    grid.clear();
    Some(out)
}

/// Takes the first free candidate, in order, that leaves a lane, for each
/// owed fixture in turn; leaves `grid` empty again whether or not it
/// succeeds.
fn fill_in_order(
    grid: &mut RoomGrid,
    reserved: &[usize],
    anchor: usize,
    owed: &[(TagId, u32)],
    room: usize,
    order: &[usize],
) -> Option<Vec<Fixture>> {
    grid.clear();
    let mut out = Vec::new();
    let mut ok = true;
    'owed: for &(tag, count) in owed {
        for _ in 0..count {
            let mut picked = None;
            for &i in order {
                if grid.occupied[i] || reserved.contains(&i) {
                    continue;
                }
                grid.set(i, true);
                if grid.lane_holds(anchor) {
                    picked = Some(i);
                    break;
                }
                grid.set(i, false);
            }
            let Some(i) = picked else {
                ok = false;
                break 'owed;
            };
            let (x, y) = grid.cell(i);
            out.push(Fixture { x, y, tag, room });
        }
    }
    grid.clear();
    ok.then_some(out)
}

/// The run of cells from the entrance out to the street: the setback
/// cells and the street's own first cell. Always at least one cell.
fn approach_cells(entrance: (i32, i32), front: Side, plot: Rect) -> Vec<(i32, i32)> {
    let (dx, dy) = match front {
        Side::South => (0, 1),
        Side::North => (0, -1),
        Side::East => (1, 0),
        Side::West => (-1, 0),
    };
    let past = |c: (i32, i32)| match front {
        Side::South => c.1 >= plot.y1,
        Side::North => c.1 < plot.y0,
        Side::East => c.0 >= plot.x1,
        Side::West => c.0 < plot.x0,
    };
    let mut cells = Vec::new();
    let mut c = (entrance.0 + dx, entrance.1 + dy);
    cells.push(c);
    while !past(c) {
        c = (c.0 + dx, c.1 + dy);
        cells.push(c);
    }
    cells
}

/// The plans an attempt chooses between.
#[derive(Clone, Copy)]
enum Plan {
    Band,
    Column,
    TwoRow,
}

/// One layout attempt for a chosen program, drawing every free choice
/// (mirror, plan, back-room order, sizes, door positions, fixture cells)
/// from `rng`; a drawn mirror or plan that cannot be sized falls back to
/// the other. `None` when nothing fits or a room cannot hold what it
/// owes. Every sized plan's rooms and doors count into `work`, whether or
/// not its fixtures then fit.
#[allow(clippy::too_many_arguments)]
fn attempt_layout(
    rng: &mut Rng,
    envelope: &Envelope,
    plot: &Plot,
    program: &[&defs::RoomTypeDef],
    rows: &[RequirementRow],
    vocab: &Vocabulary,
    t: i32,
    cap: i32,
    work: &mut LayoutWork,
) -> Option<Interior> {
    let footprint = envelope.footprint;
    let first_flip = rng.below(2) == 1;
    let mut plans = [Plan::Band, Plan::Column, Plan::TwoRow];
    for i in (1..plans.len()).rev() {
        let j = rng.below(i as u64 + 1) as usize;
        plans.swap(i, j);
    }
    let front = program[0];
    let mut back: Vec<&defs::RoomTypeDef> = program[1..].to_vec();
    for i in (1..back.len()).rev() {
        let j = rng.below(i as u64 + 1) as usize;
        back.swap(i, j);
    }
    let entrance_world = front_cell(footprint, envelope.front);
    let need = |r: &defs::RoomTypeDef, doors: i32| vocab.need(r, doors);
    let z = Sizing {
        t,
        cap,
        need: &need,
    };
    for flip in [first_flip, !first_flip] {
        let frame = Frame::new(footprint, envelope.front, t, flip);
        let entrance_u = (0..frame.w).find(|&u| frame.cell(u, -t) == entrance_world)?;
        for plan in plans {
            let local = match plan {
                Plan::Band => band_rooms(rng, front, &back, frame.w, frame.d, z),
                Plan::Column => column_rooms(rng, front, &back, frame.w, frame.d, z, entrance_u),
                Plan::TwoRow => two_row_rooms(rng, front, &back, frame.w, frame.d, z),
            };
            if let Some(local) = local {
                work.cells_laid += local
                    .iter()
                    .map(|r| ((r.rect.2 - r.rect.0) * (r.rect.3 - r.rect.1) + 1) as u64)
                    .sum::<u64>();
                return furnish(rng, &frame, envelope, plot, entrance_u, &local, rows, vocab);
            }
        }
    }
    None
}

/// Turns a sized plan into world rooms, thresholds and fixtures.
#[allow(clippy::too_many_arguments)]
fn furnish(
    rng: &mut Rng,
    frame: &Frame,
    envelope: &Envelope,
    plot: &Plot,
    entrance_u: i32,
    local: &[LocalRoom],
    rows: &[RequirementRow],
    vocab: &Vocabulary,
) -> Option<Interior> {
    let footprint = envelope.footprint;
    let entrance_world = front_cell(footprint, envelope.front);
    let rect_of = |r: (i32, i32, i32, i32)| frame.rect(r.0, r.1, r.2, r.3);
    let rooms: Vec<Room> = local
        .iter()
        .map(|r| Room {
            rect: rect_of(r.rect),
            room_type: r.def.id,
        })
        .collect();
    let mut thresholds = vec![Threshold {
        x: entrance_world.0,
        y: entrance_world.1,
        room: 0,
        entrance: true,
    }];
    let front_inside = frame.cell(entrance_u, 0);
    let mut reserved: Vec<Vec<(i32, i32)>> = vec![Vec::new(); local.len()];
    reserved[0].push(front_inside);
    let mut doors = vec![DoorView {
        door: entrance_world,
        inside: front_inside,
        footprint,
    }];
    for (i, r) in local.iter().enumerate().skip(1) {
        let door = r.door?;
        let cell = frame.cell(door.cell.0, door.cell.1);
        thresholds.push(Threshold {
            x: cell.0,
            y: cell.1,
            room: i,
            entrance: false,
        });
        reserved[door.parent].push(frame.cell(door.outside.0, door.outside.1));
        let inside = frame.cell(door.inside.0, door.inside.1);
        reserved[i].push(inside);
        doors.push(DoorView {
            door: cell,
            inside,
            footprint,
        });
    }

    let mut fixtures = Vec::new();
    for (i, room) in rooms.iter().enumerate() {
        let owed = fixtures_owed(local[i].def, rows, &vocab.parts);
        let placed = place_fixtures(rng, room.rect, &reserved[i], &doors[i], &owed, i, vocab)?;
        fixtures.extend(placed);
    }

    Some(Interior {
        footprint,
        front: envelope.front,
        rooms,
        thresholds,
        fixtures,
        approach: approach_cells(entrance_world, envelope.front, plot.bounds),
    })
}

/// Lays out one building: a pure function of the city seed, the
/// envelope, its plot and its type -- never of any other building, so
/// shuffling pass 5's list or perturbing a neighbour cannot move it.
/// Each attempt seeds its own stream from the building's own bounds plus
/// the attempt index.
#[cfg(any(test, feature = "test-fixtures"))]
pub fn lay_out(
    city_seed: u64,
    envelope: &Envelope,
    plot: &Plot,
    def: &defs::BuildingTypeDef,
    cfg: &GenerationConfig,
    content: &GenerationContent,
    vocab: &Vocabulary,
) -> InteriorOutcome {
    let rows = requirement_rows(content);
    lay_out_with(city_seed, envelope, plot, def, cfg, content, vocab, &rows)
}

/// Every committed requirement row, by id -- read once per run, not once
/// per building.
fn requirement_rows(content: &GenerationContent) -> Vec<RequirementRow> {
    let mut rows: Vec<RequirementRow> = content
        .rules
        .iter()
        .filter_map(|r| r.as_requirement())
        .collect();
    rows.sort_by_key(|r| r.id);
    rows
}

/// The two mirrors' entrance column in a `Frame` over `footprint`.
fn entrance_columns(footprint: Rect, front: Side, t: i32) -> Option<[i32; 2]> {
    let entrance = front_cell(footprint, front);
    let mut out = [0; 2];
    for (k, flip) in [false, true].into_iter().enumerate() {
        let frame = Frame::new(footprint, front, t, flip);
        out[k] = (0..frame.w).find(|&u| frame.cell(u, -t) == entrance)?;
    }
    Some(out)
}

#[allow(clippy::too_many_arguments)]
fn lay_out_with(
    city_seed: u64,
    envelope: &Envelope,
    plot: &Plot,
    def: &defs::BuildingTypeDef,
    cfg: &GenerationConfig,
    content: &GenerationContent,
    vocab: &Vocabulary,
    rows: &[RequirementRow],
) -> InteriorOutcome {
    let plot_index = envelope.plot;
    if def.rooms.is_empty() {
        return InteriorOutcome::Shell {
            plot: plot_index,
            building_type: def.id,
        };
    }
    let t = cfg.envelope_wall_thickness_cells;
    let cap = cfg.interior_max_room_aspect;
    let probe = Frame::new(envelope.footprint, envelope.front, t, false);
    let program = entrance_columns(envelope.footprint, envelope.front, t)
        .and_then(|eus| select_program(def, vocab, probe.w, probe.d, t, cap, eus));
    let Some(program) = program else {
        return InteriorOutcome::Rejected {
            plot: plot_index,
            building_type: def.id,
            reason: RejectReason::ProgramDoesNotFit,
            attempts: 0,
            work: LayoutWork::default(),
        };
    };

    let building_seed = seed_from_ids(
        seed_from_ids(city_seed, PASS_ID),
        rect_seed_key(envelope.footprint),
    );
    let attempts = cfg.interior_max_layout_attempts;
    let mut work = LayoutWork::default();
    for attempt in 0..attempts {
        let mut rng = Rng::new(seed_from_ids(building_seed, attempt as u64));
        let Some(interior) = attempt_layout(
            &mut rng, envelope, plot, &program, rows, vocab, t, cap, &mut work,
        ) else {
            continue;
        };
        let in_aspect = interior
            .rooms
            .iter()
            .all(|r| within_aspect(r.rect.width() as i32, r.rect.height() as i32, cap));
        if !in_aspect {
            continue;
        }
        let site = building_site(&interior, vocab);
        work.cells_judged += site.occupied_cells() as u64;
        if crate::rules::evaluate_local(content.rules, &site).is_empty() {
            return InteriorOutcome::Laid {
                plot: plot_index,
                building_type: def.id,
                interior,
                attempts: attempt + 1,
                work,
            };
        }
    }
    InteriorOutcome::Rejected {
        plot: plot_index,
        building_type: def.id,
        reason: RejectReason::NoValidLayout,
        attempts,
        work,
    }
}

/// Runs pass 6 over every placed envelope, in envelope order -- one
/// [`InteriorOutcome`] each, aligned with pass 5's assignments.
pub fn run(
    city_seed: u64,
    envelopes: &EnvelopeMap,
    building_types: &BuildingTypeMap,
    plots: &PlotMap,
    cfg: &GenerationConfig,
    content: &GenerationContent,
) -> InteriorMap {
    let vocab = Vocabulary::new(content);
    let rows = requirement_rows(content);
    let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let outcomes = envelopes
        .envelopes()
        .zip(building_types.assignments())
        .map(|(envelope, assignment)| {
            debug_assert_eq!(
                envelope.plot, assignment.plot,
                "interiors::run: assignments must align with EnvelopeMap::envelopes() one-for-one"
            );
            let def = by_id
                .get(&assignment.building_type)
                .expect("assignment names a real committed building type");
            let plot = &plots.plots()[envelope.plot as usize];
            lay_out_with(city_seed, envelope, plot, def, cfg, content, &vocab, &rows)
        })
        .collect();
    InteriorMap { outcomes }
}

/// FR114's verdict over a finished map: a floor, not a cap.
pub fn check_enterable_count(
    interiors: &InteriorMap,
    cfg: &GenerationConfig,
) -> Result<(), GenerationError> {
    let got = interiors.enterable_count();
    if got < cfg.interior_min_enterable_count {
        return Err(GenerationError::EnterableCountBelowFloor {
            got,
            min: cfg.interior_min_enterable_count,
        });
    }
    Ok(())
}

/// Derek's verdict: a rejected building that is the subject of a
/// committed distribution row is a missing institution, read generically
/// off the rule set.
pub fn check_institutions_enterable(
    interiors: &InteriorMap,
    content: &GenerationContent,
) -> Result<(), GenerationError> {
    let subjects: BTreeSet<TagId> = content
        .rules
        .iter()
        .filter_map(|r| r.as_distribution())
        .map(|d| d.subject)
        .collect();
    let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    for outcome in interiors.outcomes() {
        if let InteriorOutcome::Rejected {
            plot,
            building_type,
            ..
        } = outcome
            && by_id
                .get(building_type)
                .is_some_and(|d| d.tags.iter().any(|t| subjects.contains(t)))
        {
            return Err(GenerationError::InstitutionNotEnterable {
                plot: *plot,
                building_type: *building_type,
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::defs;
    use crate::generation::{
        GenerationConfig, GenerationContent, land_use, plots as plots_mod, streets,
    };
    use crate::world::{World, WorldSpec};

    fn cfg() -> GenerationConfig {
        GenerationConfig::from_balance(defs::BALANCE).unwrap()
    }

    fn content() -> GenerationContent<'static> {
        GenerationContent::committed()
    }

    /// A plot big enough for a footprint with a front setback of
    /// `setback` cells, front on the south edge.
    fn plot_and_envelope(footprint: Rect, setback: i32) -> (Plot, Envelope) {
        let bounds = Rect {
            x0: footprint.x0,
            y0: footprint.y0,
            x1: footprint.x1,
            y1: footprint.y1 + setback,
        };
        (
            Plot {
                bounds,
                block: 0,
                front: Some(Side::South),
                land_use: crate::generation::LandUse::Residential,
                density: 30,
                open: false,
                building_age: 50,
                affluence: 50,
            },
            Envelope {
                plot: 0,
                footprint,
                front: Side::South,
            },
        )
    }

    /// The first committed type with a room program of at least `n`
    /// rooms in its core -- picked by structure, never by key (the
    /// generator's own content-key guard covers this file too).
    fn type_with_core(n: usize) -> &'static defs::BuildingTypeDef {
        defs::BUILDING_TYPES
            .iter()
            .find(|b| b.rooms.len() >= n)
            .expect("committed content has a type with that many core rooms")
    }

    fn shell_type() -> &'static defs::BuildingTypeDef {
        defs::BUILDING_TYPES
            .iter()
            .find(|b| b.rooms.is_empty())
            .expect("committed content has a Shell")
    }

    fn laid(
        def: &defs::BuildingTypeDef,
        footprint: Rect,
        setback: i32,
        seed: u64,
    ) -> (Interior, Plot, Envelope) {
        let c = content();
        let vocab = Vocabulary::new(&c);
        let (plot, env) = plot_and_envelope(footprint, setback);
        match lay_out(seed, &env, &plot, def, &cfg(), &c, &vocab) {
            InteriorOutcome::Laid { interior, .. } => (interior, plot, env),
            other => panic!("expected a laid-out interior, got {other:?}"),
        }
    }

    const FOOTPRINT: Rect = Rect {
        x0: 100,
        y0: 100,
        x1: 112,
        y1: 111,
    };

    #[test]
    fn a_type_with_no_room_program_is_a_shell_with_no_cells() {
        let c = content();
        let vocab = Vocabulary::new(&c);
        let (plot, env) = plot_and_envelope(FOOTPRINT, 3);
        let def = shell_type();
        let out = lay_out(7, &env, &plot, def, &cfg(), &c, &vocab);
        assert_eq!(
            out,
            InteriorOutcome::Shell {
                plot: 0,
                building_type: def.id
            }
        );
    }

    #[test]
    fn the_interior_of_a_building_at_x_y_is_found_at_x_y() {
        let (interior, _, env) = laid(type_with_core(3), FOOTPRINT, 3, 11);
        let fp = env.footprint;
        for room in &interior.rooms {
            assert!(room.rect.x0 >= fp.x0 && room.rect.x1 <= fp.x1);
            assert!(room.rect.y0 >= fp.y0 && room.rect.y1 <= fp.y1);
        }
        for t in &interior.thresholds {
            assert!(
                fp.contains(t.x, t.y),
                "a threshold lies inside the footprint"
            );
        }
        for f in &interior.fixtures {
            assert!(fp.contains(f.x, f.y), "a fixture lies inside the footprint");
        }
        for (x, y) in interior.walls() {
            assert!(fp.contains(x, y));
        }
        // The shell is a ring: every footprint border cell is a wall or a
        // threshold.
        let walls: BTreeSet<(i32, i32)> = interior.walls().into_iter().collect();
        for x in fp.x0..fp.x1 {
            for y in [fp.y0, fp.y1 - 1] {
                let door = interior.thresholds.iter().any(|t| (t.x, t.y) == (x, y));
                assert!(walls.contains(&(x, y)) || door);
            }
        }
    }

    #[test]
    fn rooms_never_overlap_and_never_touch_the_shell() {
        let (interior, _, env) = laid(type_with_core(3), FOOTPRINT, 3, 12);
        let fp = env.footprint;
        for (i, a) in interior.rooms.iter().enumerate() {
            assert!(a.rect.x0 > fp.x0 && a.rect.x1 < fp.x1);
            assert!(a.rect.y0 > fp.y0 && a.rect.y1 < fp.y1);
            for b in &interior.rooms[i + 1..] {
                let overlap = a.rect.x0 < b.rect.x1
                    && b.rect.x0 < a.rect.x1
                    && a.rect.y0 < b.rect.y1
                    && b.rect.y0 < a.rect.y1;
                assert!(!overlap, "two rooms share cells");
            }
        }
    }

    #[test]
    fn the_entrance_is_the_envelopes_own_front_cell_and_opens_onto_its_approach() {
        let (interior, plot, env) = laid(type_with_core(2), FOOTPRINT, 3, 13);
        let e = interior.entrance().expect("an entrance");
        assert_eq!((e.x, e.y), front_cell(env.footprint, env.front));
        assert_eq!(e.room, 0, "the entrance belongs to the front room");
        // South front: the approach runs straight down from the entrance
        // through the setback to the street's own first cell.
        let want: Vec<(i32, i32)> = (env.footprint.y1..=plot.bounds.y1)
            .map(|y| (e.x, y))
            .collect();
        assert_eq!(interior.approach, want);
    }

    #[test]
    fn a_flush_building_approaches_straight_onto_the_street_cell() {
        let (interior, _, env) = laid(type_with_core(2), FOOTPRINT, 0, 14);
        let e = interior.entrance().unwrap();
        assert_eq!(interior.approach, vec![(e.x, env.footprint.y1)]);
    }

    #[test]
    fn every_requirement_row_a_room_owes_is_refused_by_key_when_its_fixture_is_missing() {
        let c = content();
        let vocab = Vocabulary::new(&c);
        let mut seen_rows = BTreeSet::new();
        for seed in 0..40u64 {
            for def in defs::BUILDING_TYPES.iter().filter(|b| !b.rooms.is_empty()) {
                let (interior, _, _) = laid(def, FOOTPRINT, 3, seed);
                for row in c.rules.iter().filter_map(|r| r.as_requirement()) {
                    if vocab.parts.is_part(row.requires) || seen_rows.contains(&row.id) {
                        continue;
                    }
                    let Some((i, _)) = interior
                        .rooms
                        .iter()
                        .enumerate()
                        .find(|(_, r)| vocab.room(r.room_type).tags.contains(&row.container))
                    else {
                        continue;
                    };
                    let mut broken = interior.clone();
                    broken
                        .fixtures
                        .retain(|f| !(f.room == i && f.tag == row.requires));
                    let found: BTreeSet<&str> = check_layout(&broken, &vocab, c.rules)
                        .iter()
                        .filter_map(|v| c.rules.key_of(v.rule_id))
                        .collect();
                    assert!(
                        found.contains(row.key),
                        "removing the {} fixture must be refused by '{}', got {found:?}",
                        row.requires,
                        row.key
                    );
                    seen_rows.insert(row.id);
                }
            }
        }
        let owed: BTreeSet<u32> = c
            .rules
            .iter()
            .filter_map(|r| r.as_requirement())
            .filter(|r| !vocab.parts.is_part(r.requires))
            .filter(|r| {
                c.room_types.iter().any(|room| {
                    room.tags.contains(&r.container) || r.container == vocab.parts.floor
                })
            })
            .map(|r| r.id)
            .collect();
        assert_eq!(
            seen_rows, owed,
            "every fixture-owing requirement row was planted and refused"
        );
    }

    #[test]
    fn a_program_the_footprint_cannot_hold_is_rejected_by_reason_without_retrying() {
        let c = content();
        let vocab = Vocabulary::new(&c);
        let tiny = Rect {
            x0: 100,
            y0: 100,
            x1: 104,
            y1: 104,
        };
        let (plot, env) = plot_and_envelope(tiny, 3);
        let def = type_with_core(3);
        match lay_out(1, &env, &plot, def, &cfg(), &c, &vocab) {
            InteriorOutcome::Rejected {
                reason, attempts, ..
            } => {
                assert_eq!(reason, RejectReason::ProgramDoesNotFit);
                assert_eq!(attempts, 0, "a program that cannot fit is never retried");
            }
            other => panic!("expected a rejection, got {other:?}"),
        }
    }

    #[test]
    fn a_laid_out_building_is_accepted_within_the_attempt_cap() {
        let c = content();
        let vocab = Vocabulary::new(&c);
        let cap = cfg().interior_max_layout_attempts;
        for seed in 0..60u64 {
            let (plot, env) = plot_and_envelope(FOOTPRINT, 3);
            for def in defs::BUILDING_TYPES.iter().filter(|b| !b.rooms.is_empty()) {
                if let InteriorOutcome::Laid { attempts, .. } =
                    lay_out(seed, &env, &plot, def, &cfg(), &c, &vocab)
                {
                    assert!(attempts >= 1 && attempts <= cap);
                }
            }
        }
    }

    /// A footprint `w x d` cells of interior, south front.
    fn interior_footprint(w: i32, d: i32) -> Rect {
        Rect {
            x0: 100,
            y0: 100,
            x1: 100 + w + 2,
            y1: 100 + d + 2,
        }
    }

    #[test]
    fn size_buys_rooms_not_bigger_rooms() {
        let def = defs::BUILDING_TYPES
            .iter()
            .find(|b| b.optional_rooms.len() >= 2)
            .expect("a type with an optional tail");
        let c = content();
        let vocab = Vocabulary::new(&c);
        let snug = interior_footprint(
            def.min_interior_width_cells as i32,
            def.min_interior_depth_cells as i32,
        );
        let (plot, env) = plot_and_envelope(snug, 3);
        let InteriorOutcome::Laid { interior: a, .. } =
            lay_out(5, &env, &plot, def, &cfg(), &c, &vocab)
        else {
            panic!("the type lays out at its own minimum interior");
        };
        let (b, _, _) = laid(def, interior_footprint(18, 14), 3, 5);
        assert!(
            b.rooms.len() > a.rooms.len(),
            "a bigger footprint holds more of the optional tail ({} vs {})",
            b.rooms.len(),
            a.rooms.len()
        );
    }

    /// `tools/defs-build` holds a type's program to a lower bound on its
    /// own minimum interior; this is the real check: every type with a
    /// room program lays out there, under the aspect cap.
    #[test]
    fn every_type_lays_out_at_its_own_minimum_interior() {
        let c = content();
        let vocab = Vocabulary::new(&c);
        for def in defs::BUILDING_TYPES.iter().filter(|b| !b.rooms.is_empty()) {
            let fp = interior_footprint(
                def.min_interior_width_cells as i32,
                def.min_interior_depth_cells as i32,
            );
            let (plot, env) = plot_and_envelope(fp, 3);
            let out = lay_out(9, &env, &plot, def, &cfg(), &c, &vocab);
            assert!(
                matches!(out, InteriorOutcome::Laid { .. }),
                "{} does not lay out at its own minimum interior: {out:?}",
                def.key
            );
        }
    }

    #[test]
    fn the_same_building_lays_out_the_same_way_twice() {
        let def = type_with_core(3);
        let (a, _, _) = laid(def, FOOTPRINT, 3, 99);
        let (b, _, _) = laid(def, FOOTPRINT, 3, 99);
        assert_eq!(a, b);
    }

    #[test]
    fn a_building_across_a_chunk_corner_is_clipped_and_ownership_resolves_per_cell() {
        // x 28..40 and y 28..39 straddle the corner of chunks (0,0) (1,0)
        // (0,1) (1,1) at CHUNK_SIZE 32.
        let fp = Rect {
            x0: 28,
            y0: 28,
            x1: 40,
            y1: 39,
        };
        let (interior, _, _) = laid(type_with_core(3), fp, 2, 3);
        let map = InteriorMap::test_fixture(vec![InteriorOutcome::Laid {
            plot: 0,
            building_type: 0,
            interior: interior.clone(),
            attempts: 1,
            work: LayoutWork::default(),
        }]);
        let spec = WorldSpec {
            building_areas: map.building_areas(),
            room_areas: map.room_areas(),
            ..WorldSpec::default()
        };
        let world: World = spec.build().expect("clipped areas build");
        let building = rect_seed_key(fp);
        for y in fp.y0..fp.y1 {
            for x in fp.x0..fp.x1 {
                assert_eq!(world.ownership_at(x, y, 0).building_id, building);
            }
        }
        assert_eq!(world.ownership_at(fp.x0 - 1, fp.y0, 0).building_id, 0);
        for (i, room) in interior.rooms.iter().enumerate() {
            let id = rect_seed_key(room.rect);
            for y in room.rect.y0..room.rect.y1 {
                for x in room.rect.x0..room.rect.x1 {
                    assert_eq!(world.ownership_at(x, y, 0).room_id, id);
                }
            }
            for t in interior.thresholds.iter().filter(|t| t.room == i) {
                assert_eq!(world.ownership_at(t.x, t.y, 0).room_id, id);
            }
        }
        for (x, y) in interior.walls() {
            assert_eq!(
                world.ownership_at(x, y, 0).room_id,
                0,
                "a wall is in no room"
            );
        }
    }

    #[test]
    fn every_seed_one_cities_interiors_are_accepted_by_the_world_spec() {
        let c = cfg();
        let content = content();
        let lu = land_use::run(1, c.site(), &c).unwrap();
        let net = streets::run(1, &lu, &c);
        let pm = plots_mod::run(1, &lu, &net, &c);
        let em = crate::generation::envelopes::run(1, &pm, &c);
        let types = crate::generation::building_types::run(1, &em, &pm, &net, &c, &content);
        let map = run(1, &em, &types, &pm, &c, &content);
        assert_eq!(
            map.outcomes().len(),
            em.placed_count() as usize,
            "one outcome per placed envelope"
        );
        let spec = WorldSpec {
            building_areas: map.building_areas(),
            room_areas: map.room_areas(),
            ..WorldSpec::default()
        };
        spec.build().expect("a whole city's ownership areas build");
    }

    #[test]
    fn the_enterable_count_floor_is_a_typed_error() {
        let c = cfg();
        let empty = InteriorMap::test_fixture(Vec::new());
        assert_eq!(
            check_enterable_count(&empty, &c),
            Err(GenerationError::EnterableCountBelowFloor {
                got: 0,
                min: c.interior_min_enterable_count
            })
        );
    }

    #[test]
    fn a_rejected_distributed_institution_is_a_typed_error_read_off_the_rules() {
        let c = content();
        let subject = c
            .rules
            .iter()
            .find_map(|r| r.as_distribution())
            .map(|d| d.subject)
            .expect("a committed distribution row");
        let def = defs::BUILDING_TYPES
            .iter()
            .find(|b| b.tags.contains(&subject))
            .expect("a type carrying its subject tag");
        let map = InteriorMap::test_fixture(vec![InteriorOutcome::Rejected {
            plot: 4,
            building_type: def.id,
            reason: RejectReason::NoValidLayout,
            attempts: 8,
            work: LayoutWork::default(),
        }]);
        assert_eq!(
            check_institutions_enterable(&map, &c),
            Err(GenerationError::InstitutionNotEnterable {
                plot: 4,
                building_type: def.id
            })
        );
    }
}
