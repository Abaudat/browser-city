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
//! `DistrictSite` uses ([`site_cells`]): any violation refuses the
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

use super::envelopes::{Envelope, EnvelopeMap};
use super::plots::{Plot, PlotMap};
use super::site::front_cell;
use super::streets::Side;
use super::building_types::BuildingTypeMap;
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
            push_clipped(&mut out, rect_seed_key(interior.footprint), interior.footprint);
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

/// One cell of a building as the rule engine sees it: its tags and the
/// areas that contain it. The one adapter shared by this pass's own
/// per-building verdict and `DistrictSite` (FR112).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiteCell {
    pub x: i32,
    pub y: i32,
    pub tags: Vec<TagId>,
    pub areas: Vec<AreaId>,
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

/// Every cell of `interior` the rule engine needs, floor 0. Wall cells
/// carry the wall tags; floor cells the floor tag (a fixture cell adds
/// the fixture tag and its own required tag); a threshold the threshold
/// and wall-run tags (and `entrance` for the street door); each room's
/// own door cell additionally carries that room type's tags -- the
/// marker the requirement rows' containers match; the approach cells
/// carry pavement.
pub fn site_cells(interior: &Interior, vocab: &Vocabulary) -> Vec<SiteCell> {
    let p = vocab.parts;
    let building = building_area_id(interior.footprint);
    let room_ids: Vec<AreaId> = interior
        .rooms
        .iter()
        .map(|r| room_area_id(r.rect))
        .collect();
    let mut cells: BTreeMap<(i32, i32), SiteCell> = BTreeMap::new();
    let mut put = |x: i32, y: i32, tags: &[TagId], areas: &[AreaId]| {
        let e = cells.entry((x, y)).or_insert_with(|| SiteCell {
            x,
            y,
            tags: Vec::new(),
            areas: Vec::new(),
        });
        for &t in tags {
            if !e.tags.contains(&t) {
                e.tags.push(t);
            }
        }
        for &a in areas {
            if !e.areas.contains(&a) {
                e.areas.push(a);
            }
        }
    };
    for (x, y) in interior.walls() {
        put(x, y, &[p.wall, p.wall_run], &[building]);
    }
    for (i, room) in interior.rooms.iter().enumerate() {
        for y in room.rect.y0..room.rect.y1 {
            for x in room.rect.x0..room.rect.x1 {
                put(x, y, &[p.floor], &[building, room_ids[i]]);
            }
        }
    }
    for f in &interior.fixtures {
        put(f.x, f.y, &[p.fixture, f.tag], &[]);
    }
    for t in &interior.thresholds {
        let mut tags = vec![p.threshold, p.wall_run];
        if t.entrance {
            tags.push(p.entrance);
        }
        tags.extend_from_slice(vocab.room(interior.rooms[t.room].room_type).tags);
        put(t.x, t.y, &tags, &[building, room_ids[t.room]]);
    }
    for &(x, y) in &interior.approach {
        put(x, y, &[p.pavement], &[]);
    }
    let mut out: Vec<SiteCell> = cells.into_values().collect();
    for c in &mut out {
        c.tags.sort_unstable();
        c.areas.sort_unstable();
    }
    out
}

/// The accept/reject step: `crate::rules::evaluate_local` over the site
/// of this one building. Empty means the layout may be emitted.
pub fn check_layout(interior: &Interior, vocab: &Vocabulary, rules: RuleSet<'_>) -> Vec<Violation> {
    let _ = (interior, vocab, rules);
    unimplemented!("pass 6: check_layout")
}

/// Lays out one building: a pure function of the city seed, the
/// envelope, its plot and its type -- never of any other building.
pub fn lay_out(
    city_seed: u64,
    envelope: &Envelope,
    plot: &Plot,
    def: &defs::BuildingTypeDef,
    cfg: &GenerationConfig,
    content: &GenerationContent,
    vocab: &Vocabulary,
) -> InteriorOutcome {
    let _ = (city_seed, envelope, plot, def, cfg, content, vocab);
    unimplemented!("pass 6: lay_out")
}

/// Runs pass 6 over every placed envelope, in envelope order.
pub fn run(
    city_seed: u64,
    envelopes: &EnvelopeMap,
    building_types: &BuildingTypeMap,
    plots: &PlotMap,
    cfg: &GenerationConfig,
    content: &GenerationContent,
) -> InteriorMap {
    let _ = (city_seed, envelopes, building_types, plots, cfg, content);
    unimplemented!("pass 6: run")
}

/// FR114's verdict over a finished map.
pub fn check_enterable_count(
    interiors: &InteriorMap,
    cfg: &GenerationConfig,
) -> Result<(), GenerationError> {
    let _ = (interiors, cfg);
    unimplemented!("pass 6: check_enterable_count")
}

/// Derek's verdict: a rejected building that is the subject of a
/// committed distribution row is a missing institution.
pub fn check_institutions_enterable(
    interiors: &InteriorMap,
    content: &GenerationContent,
) -> Result<(), GenerationError> {
    let _ = (interiors, content);
    unimplemented!("pass 6: check_institutions_enterable")
}

#[allow(dead_code)]
fn unused(_: BTreeSet<u8>, _: Rng, _: RequirementRow) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generation::{
        GenerationConfig, GenerationContent, land_use, plots as plots_mod, streets,
    };
    use crate::generated::defs;
    use crate::rules::{RuleDef, RuleKind};
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
            assert!(fp.contains(t.x, t.y), "a threshold lies inside the footprint");
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
        let want: Vec<(i32, i32)> = (env.footprint.y1..=plot.bounds.y1).map(|y| (e.x, y)).collect();
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
        for seed in 0..400u64 {
            for def in defs::BUILDING_TYPES.iter().filter(|b| !b.rooms.is_empty()) {
                let (interior, _, _) = laid(def, FOOTPRINT, 3, seed);
                for row in c.rules.iter().filter_map(|r| r.as_requirement()) {
                    if vocab.parts.is_part(row.requires) || seen_rows.contains(&row.id) {
                        continue;
                    }
                    let Some((i, _)) = interior.rooms.iter().enumerate().find(|(_, r)| {
                        vocab.room(r.room_type).tags.contains(&row.container)
                    }) else {
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
            .map(|r| r.id)
            .collect();
        assert_eq!(
            seen_rows, owed,
            "every fixture-owing requirement row was planted and refused"
        );
    }

    #[test]
    fn a_missing_door_entrance_or_approach_is_refused_by_key() {
        let c = content();
        let vocab = Vocabulary::new(&c);
        let (interior, _, _) = laid(type_with_core(3), FOOTPRINT, 3, 15);
        assert!(
            check_layout(&interior, &vocab, c.rules).is_empty(),
            "the untouched layout is accepted"
        );
        let keys = |i: &Interior| -> BTreeSet<&'static str> {
            check_layout(i, &vocab, c.rules)
                .iter()
                .filter_map(|v| c.rules.key_of(v.rule_id))
                .collect()
        };

        // A back room with no door.
        let mut no_door = interior.clone();
        let back = no_door.thresholds.iter().position(|t| !t.entrance).unwrap();
        no_door.thresholds.remove(back);
        assert!(keys(&no_door).contains("room_has_a_door"));

        // No street door at all.
        let mut no_entrance = interior.clone();
        no_entrance.thresholds.retain(|t| !t.entrance);
        assert!(keys(&no_entrance).contains("building_has_an_entrance"));

        // A door that opens onto bare ground.
        let mut no_pavement = interior.clone();
        no_pavement.approach.clear();
        assert!(keys(&no_pavement).contains("entrance_opens_onto_pavement"));

        // A fixture standing in front of a door.
        let mut blocked = interior.clone();
        let t = blocked.thresholds.iter().find(|t| t.entrance).copied().unwrap();
        blocked.fixtures.push(Fixture {
            x: t.x,
            y: t.y - 1,
            tag: vocab.parts.fixture,
            room: 0,
        });
        assert!(keys(&blocked).contains("door_never_blocked_by_a_fixture"));
    }

    fn unsatisfiable_content(base: &GenerationContent<'static>) -> (Vec<RuleDef>, TagId, TagId) {
        let room_tag = base
            .room_types
            .iter()
            .flat_map(|r| r.tags.iter().copied())
            .next()
            .unwrap();
        let light = base
            .rules
            .iter()
            .filter_map(|r| r.as_requirement())
            .find(|r| r.container == room_tag || true)
            .map(|r| r.requires)
            .unwrap();
        (
            vec![RuleDef {
                id: 9_999,
                key: "forced_to_fail",
                kind: RuleKind::Requirement {
                    container: room_tag,
                    requires: light,
                    min: 9_999,
                    max: None,
                },
            }],
            room_tag,
            light,
        )
    }

    #[test]
    fn forcing_every_attempt_to_fail_is_a_typed_counted_rejection_with_no_cells() {
        let base = content();
        let (rules, _, _) = unsatisfiable_content(&base);
        let forced = GenerationContent {
            rules: RuleSet::for_test(&rules),
            ..base
        };
        let vocab = Vocabulary::new(&forced);
        let (plot, env) = plot_and_envelope(FOOTPRINT, 3);
        let def = type_with_core(2);
        let c = cfg();
        let out = lay_out(21, &env, &plot, def, &c, &forced, &vocab);
        assert_eq!(
            out,
            InteriorOutcome::Rejected {
                plot: 0,
                building_type: def.id,
                reason: RejectReason::NoValidLayout,
                attempts: c.interior_max_layout_attempts,
            },
            "never a panic, never an unbounded loop, never a half-emitted room"
        );
        let map = InteriorMap::test_fixture(vec![out]);
        assert_eq!(map.enterable_count(), 0);
        assert_eq!(map.rejected_count(), 1);
        assert_eq!(map.rejected_percent(), 100);
        assert!(map.building_areas().is_empty() && map.room_areas().is_empty());
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
        let def = defs::BUILDING_TYPES
            .iter()
            .find(|b| !b.optional_rooms.is_empty())
            .expect("a type with an optional tail");
        let small = Rect {
            x0: 100,
            y0: 100,
            x1: 110,
            y1: 109,
        };
        let big = Rect {
            x0: 100,
            y0: 100,
            x1: 120,
            y1: 116,
        };
        let (a, _, _) = laid(def, small, 3, 5);
        let (b, _, _) = laid(def, big, 3, 5);
        assert!(
            b.rooms.len() > a.rooms.len(),
            "a bigger footprint holds more of the optional tail ({} vs {})",
            b.rooms.len(),
            a.rooms.len()
        );
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
            assert_eq!(world.ownership_at(x, y, 0).room_id, 0, "a wall is in no room");
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
