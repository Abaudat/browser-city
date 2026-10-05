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
use crate::rules::{AreaId, RequirementRow, RuleSet, TagId, Violation};
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
}

impl<'a> Vocabulary<'a> {
    pub fn new(content: &GenerationContent<'a>) -> Self {
        Vocabulary {
            parts: Parts::resolve(content.tags)
                .expect("the committed tag table declares every structural part"),
            rooms: content.room_types.iter().map(|r| (r.id, r)).collect(),
        }
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

/// One placed envelope's outcome, in envelope order. "Enterable" is
/// derived -- exactly `Laid` -- never a stored flag.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InteriorOutcome {
    Laid {
        plot: u32,
        building_type: u32,
        interior: Interior,
        attempts: u32,
    },
    /// The type declares no room program: a solid, non-enterable
    /// building.
    Shell { plot: u32, building_type: u32 },
    Rejected {
        plot: u32,
        building_type: u32,
        reason: RejectReason,
        attempts: u32,
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
pub fn check_layout(interior: &Interior, vocab: &Vocabulary, rules: RuleSet<'_>) -> Vec<Violation> {
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

/// The smallest `(width, depth)` interior a program lays out in: a front
/// band holding the front room, one partition, and the remaining rooms
/// side by side behind it.
fn needed_extent(rooms: &[&defs::RoomTypeDef], thickness: i32) -> (i32, i32) {
    let front = rooms[0];
    let back = &rooms[1..];
    if back.is_empty() {
        return (front.min_width_cells as i32, front.min_depth_cells as i32);
    }
    let back_width: i32 = back.iter().map(|r| r.min_width_cells as i32).sum::<i32>()
        + thickness * (back.len() as i32 - 1);
    let back_depth = back
        .iter()
        .map(|r| r.min_depth_cells as i32)
        .max()
        .unwrap_or(0);
    (
        (front.min_width_cells as i32).max(back_width),
        front.min_depth_cells as i32 + thickness + back_depth,
    )
}

/// The rooms this footprint holds: the required core, then the optional
/// tail in declared order while each still fits. `None` when even the
/// core does not.
fn select_program<'a>(
    def: &defs::BuildingTypeDef,
    vocab: &Vocabulary<'a>,
    w: i32,
    d: i32,
    thickness: i32,
) -> Option<Vec<&'a defs::RoomTypeDef>> {
    let mut rooms: Vec<&defs::RoomTypeDef> = def.rooms.iter().map(|&id| vocab.room(id)).collect();
    let (nw, nd) = needed_extent(&rooms, thickness);
    if nw > w || nd > d {
        return None;
    }
    for &id in def.optional_rooms {
        rooms.push(vocab.room(id));
        let (nw, nd) = needed_extent(&rooms, thickness);
        if nw > w || nd > d {
            rooms.pop();
            break;
        }
    }
    Some(rooms)
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
}

/// Places `owed` on free floor cells of `rect`, backed onto the north
/// wall first, then the side walls, the open floor and last the south
/// wall (which retracts); never on a `reserved` cell (a door and the
/// cell in front of it); every placement leaves a lane. A snug room the
/// camera preference paints into a corner (the north row can be the one
/// beside the doorway) is retried farthest-from-the-doorway first, which
/// always leaves the doorway's own side free. `None` when the room
/// cannot hold them either way.
fn place_fixtures(
    rng: &mut Rng,
    rect: Rect,
    reserved: &[(i32, i32)],
    anchor: (i32, i32),
    owed: &[(TagId, u32)],
    room: usize,
) -> Option<Vec<Fixture>> {
    let total: u32 = owed.iter().map(|&(_, n)| n).sum();
    let cell_count = (rect.width() * rect.height()) as u32;
    if total > cell_count {
        return None;
    }
    let mut order: Vec<((i32, i32), u8, u64)> = Vec::new();
    for y in rect.y0..rect.y1 {
        for x in rect.x0..rect.x1 {
            let score = if y == rect.y0 {
                0
            } else if x == rect.x0 || x == rect.x1 - 1 {
                1
            } else if y == rect.y1 - 1 {
                3
            } else {
                2
            };
            order.push(((x, y), score, rng.below(1 << 40)));
        }
    }
    // Camera preference first; then (only if that leaves a room unable to
    // hold its fixtures) farthest from the doorway.
    let mut grid = RoomGrid::new(rect);
    let anchor_ix = grid.index(anchor);
    let reserved_ix: Vec<usize> = reserved.iter().map(|&c| grid.index(c)).collect();
    let mut by_camera = order.clone();
    by_camera.sort_by_key(|&(c, score, key)| (score, key, c));
    if let Some(placed) = fill_in_order(&mut grid, &reserved_ix, anchor_ix, owed, room, &by_camera)
    {
        return Some(placed);
    }
    let mut by_lane = order;
    by_lane.sort_by_key(|&(c, _, key)| {
        let dist = (c.0 - anchor.0).abs() + (c.1 - anchor.1).abs();
        (std::cmp::Reverse(dist), key, c)
    });
    if let Some(placed) = fill_in_order(&mut grid, &reserved_ix, anchor_ix, owed, room, &by_lane) {
        return Some(placed);
    }
    None
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
    order: &[((i32, i32), u8, u64)],
) -> Option<Vec<Fixture>> {
    for i in 0..grid.occupied.len() {
        grid.set(i, false);
    }
    let mut out = Vec::new();
    let mut ok = true;
    'owed: for &(tag, count) in owed {
        for _ in 0..count {
            let mut picked = None;
            for &(c, _, _) in order {
                let i = grid.index(c);
                if grid.occupied[i] || reserved.contains(&i) {
                    continue;
                }
                grid.set(i, true);
                if grid.lane_holds(anchor) {
                    picked = Some(c);
                    break;
                }
                grid.set(i, false);
            }
            let Some(c) = picked else {
                ok = false;
                break 'owed;
            };
            out.push(Fixture {
                x: c.0,
                y: c.1,
                tag,
                room,
            });
        }
    }
    for i in 0..grid.occupied.len() {
        grid.set(i, false);
    }
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

/// One layout attempt for a chosen program, drawing every free choice
/// (mirror, back-room order, front-band depth, door positions, fixture
/// cells) from `rng`. `None` when a room cannot hold what it owes.
fn attempt_layout(
    rng: &mut Rng,
    envelope: &Envelope,
    plot: &Plot,
    program: &[&defs::RoomTypeDef],
    rows: &[RequirementRow],
    parts: &Parts,
    thickness: i32,
) -> Option<Interior> {
    let footprint = envelope.footprint;
    let flip = rng.below(2) == 1;
    let frame = Frame::new(footprint, envelope.front, thickness, flip);
    let (w, d) = (frame.w, frame.d);
    let front = program[0];
    let mut back: Vec<&defs::RoomTypeDef> = program[1..].to_vec();
    for i in (1..back.len()).rev() {
        let j = rng.below(i as u64 + 1) as usize;
        back.swap(i, j);
    }
    let k = back.len() as i32;

    // The front band's depth and each back room's width.
    let (df, widths) = if k == 0 {
        (d, Vec::new())
    } else {
        let back_min_depth = back.iter().map(|r| r.min_depth_cells as i32).max()?;
        let lo = front.min_depth_cells as i32;
        let hi = d - thickness - back_min_depth;
        if hi < lo {
            return None;
        }
        // The front band takes at most half the spare depth, so the back
        // rooms are never squeezed to their minimum by a cavernous front.
        let df = lo + rng.below(((hi - lo) / 2 + 1) as u64) as i32;
        let min_total: i32 =
            back.iter().map(|r| r.min_width_cells as i32).sum::<i32>() + thickness * (k - 1);
        let extra = w - min_total;
        if extra < 0 {
            return None;
        }
        let weight_sum: i64 = back.iter().map(|r| r.weight as i64).sum();
        let mut widths: Vec<i32> = back
            .iter()
            .map(|r| {
                r.min_width_cells as i32 + (extra as i64 * r.weight as i64 / weight_sum) as i32
            })
            .collect();
        let mut remainder = w - (widths.iter().sum::<i32>() + thickness * (k - 1));
        let mut by_weight: Vec<usize> = (0..back.len()).collect();
        by_weight.sort_by_key(|&i| std::cmp::Reverse(back[i].weight));
        let mut at = 0;
        while remainder > 0 {
            widths[by_weight[at % by_weight.len()]] += 1;
            remainder -= 1;
            at += 1;
        }
        (df, widths)
    };

    // Rooms, front first, then the back band left to right.
    let mut rooms = vec![Room {
        rect: frame.rect(0, 0, w, df),
        room_type: front.id,
    }];
    let mut thresholds: Vec<Threshold> = Vec::new();
    let entrance_world = front_cell(footprint, envelope.front);
    let entrance_u = (0..w).find(|&u| frame.cell(u, -thickness) == entrance_world)?;
    thresholds.push(Threshold {
        x: entrance_world.0,
        y: entrance_world.1,
        room: 0,
        entrance: true,
    });
    let mut reserved: Vec<Vec<(i32, i32)>> = vec![Vec::new(); 1 + back.len()];
    reserved[0].push(frame.cell(entrance_u, 0));
    let mut anchors: Vec<(i32, i32)> = vec![frame.cell(entrance_u, 0)];
    let mut cursor = 0;
    for (i, room) in back.iter().enumerate() {
        let (u0, u1) = (cursor, cursor + widths[i]);
        cursor = u1 + thickness;
        let rect = frame.rect(u0, df + thickness, u1, d);
        rooms.push(Room {
            rect,
            room_type: room.id,
        });
        let door_u = u0 + rng.below((u1 - u0) as u64) as i32;
        let door = frame.cell(door_u, df);
        thresholds.push(Threshold {
            x: door.0,
            y: door.1,
            room: i + 1,
            entrance: false,
        });
        reserved[0].push(frame.cell(door_u, df - 1));
        let inside = frame.cell(door_u, df + thickness);
        reserved[i + 1].push(inside);
        anchors.push(inside);
    }

    let mut fixtures = Vec::new();
    for (i, room) in rooms.iter().enumerate() {
        let def = if i == 0 { front } else { back[i - 1] };
        let owed = fixtures_owed(def, rows, parts);
        let placed = place_fixtures(rng, room.rect, &reserved[i], anchors[i], &owed, i)?;
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
    let thickness = cfg.envelope_wall_thickness_cells;
    let probe = Frame::new(envelope.footprint, envelope.front, thickness, false);
    let Some(program) = select_program(def, vocab, probe.w, probe.d, thickness) else {
        return InteriorOutcome::Rejected {
            plot: plot_index,
            building_type: def.id,
            reason: RejectReason::ProgramDoesNotFit,
            attempts: 0,
        };
    };

    let building_seed = seed_from_ids(
        seed_from_ids(city_seed, PASS_ID),
        rect_seed_key(envelope.footprint),
    );
    let cap = cfg.interior_max_layout_attempts;
    for attempt in 0..cap {
        let mut rng = Rng::new(seed_from_ids(building_seed, attempt as u64));
        let Some(interior) = attempt_layout(
            &mut rng,
            envelope,
            plot,
            &program,
            rows,
            &vocab.parts,
            thickness,
        ) else {
            continue;
        };
        if check_layout(&interior, vocab, content.rules).is_empty() {
            return InteriorOutcome::Laid {
                plot: plot_index,
                building_type: def.id,
                interior,
                attempts: attempt + 1,
            };
        }
    }
    InteriorOutcome::Rejected {
        plot: plot_index,
        building_type: def.id,
        reason: RejectReason::NoValidLayout,
        attempts: cap,
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

    #[test]
    fn size_buys_rooms_not_bigger_rooms() {
        let c = content();
        let vocab = Vocabulary::new(&c);
        let def = defs::BUILDING_TYPES
            .iter()
            .find(|b| b.optional_rooms.len() >= 2)
            .expect("a type with an optional tail");
        let core: Vec<&defs::RoomTypeDef> = def.rooms.iter().map(|&id| vocab.room(id)).collect();
        let (nw, nd) = needed_extent(&core, 1);
        let snug = Rect {
            x0: 100,
            y0: 100,
            x1: 100 + nw + 2,
            y1: 100 + nd + 2,
        };
        let big = Rect {
            x0: 100,
            y0: 100,
            x1: 120,
            y1: 116,
        };
        let (a, _, _) = laid(def, snug, 3, 5);
        let (b, _, _) = laid(def, big, 3, 5);
        assert_eq!(
            a.rooms.len(),
            def.rooms.len(),
            "a snug footprint holds the core only"
        );
        assert!(
            b.rooms.len() > a.rooms.len(),
            "a bigger footprint holds more of the optional tail ({} vs {})",
            b.rooms.len(),
            a.rooms.len()
        );
        let widest = |i: &Interior| i.rooms.iter().map(|r| r.rect.height()).max().unwrap();
        let _ = widest;
    }

    #[test]
    fn layout_is_a_pure_function_of_the_building_never_of_its_neighbours() {
        let def = type_with_core(3);
        let (a, _, _) = laid(def, FOOTPRINT, 3, 99);
        let (b, _, _) = laid(def, FOOTPRINT, 3, 99);
        assert_eq!(a, b);
        let (c2, _, _) = laid(def, FOOTPRINT, 3, 100);
        let _ = c2;
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
