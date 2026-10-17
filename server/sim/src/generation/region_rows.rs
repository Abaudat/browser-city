//! Story 3.16: the finished district as the rows the region tables hold.
//! Pure: [`District::region_rows`] returns plain row data in the shape of
//! `placed_object`, `building_area`, `room_area`, `floor_transition`,
//! `ground_area` and `roof_area` minus the surrogate ids;
//! `create_district` only inserts them, in its own transaction, once.
//!
//! Ground is a generator output, as rects: the street's pavement and
//! carriageway (carried through the margin past the site edge), each
//! built plot's yard and forecourt, each footprint's and room's floor --
//! each chosen by tag from what the cell is. Open ground is no row: a cell no ground
//! rect covers is open. Every building also carries its roof rects, hidden
//! by the client while its viewer is inside.

use super::streets::Side;
use super::{District, GenerationConfig, GenerationContent, building_types, props};
use crate::generated::defs;
use crate::world::{CHUNK_SIZE, Rect, chunk_key, clip_rect_to_chunks};
use std::collections::BTreeMap;

/// One `placed_object` row, minus its surrogate id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlacedOut {
    pub def_id: u32,
    pub x: i32,
    pub y: i32,
    pub floor: i8,
    pub layer: u32,
    pub orientation: u8,
    pub chunk_key: u64,
}

/// One `building_area` / `room_area` row, minus its surrogate id.
/// `owner_id` is the building's or the room's own id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AreaOut {
    pub owner_id: u64,
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
    pub floor: i8,
    pub chunk_key: u64,
}

/// One `floor_transition` row, minus its surrogate id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TransitionOut {
    pub x: i32,
    pub y: i32,
    pub floor: i8,
    pub target_x: i32,
    pub target_y: i32,
    pub target_floor: i8,
    pub chunk_key: u64,
}

/// One `ground_area` row, minus its surrogate id: `def_id` tiles the rect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GroundOut {
    pub def_id: u32,
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
    pub floor: i8,
    pub chunk_key: u64,
}

/// One `roof_area` row, minus its surrogate id: the building's own roof
/// tile over a rect of its interior net or north rim, keyed on the
/// chunk of the net's south-west cell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoofOut {
    pub building_id: u64,
    pub def_id: u32,
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
    pub floor: i8,
    pub chunk_key: u64,
}

/// What a district writes to the world.
#[derive(Debug, Clone, Default)]
pub struct RegionRows {
    pub placed: Vec<PlacedOut>,
    pub building_areas: Vec<AreaOut>,
    pub room_areas: Vec<AreaOut>,
    pub transitions: Vec<TransitionOut>,
    /// Painted in order: a later row covers an earlier one.
    pub ground: Vec<GroundOut>,
    pub roofs: Vec<RoofOut>,
}

/// The margin the district's streets are carried through, and the tag ids
/// its ground is chosen by, from balance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GroundConfig {
    pub margin_cells: i32,
    pub floor_tag: u32,
    pub pavement_tag: u32,
    pub road_tag: u32,
    pub open_tag: u32,
    pub roof_tag: u32,
    pub forecourt_tag: u32,
    pub yard_tag: u32,
    pub affluent_tag: u32,
    /// The building-age bands, newest first.
    pub aged_tags: [u32; 3],
}

impl GroundConfig {
    pub fn from_balance(balance: &[defs::BalanceSeed]) -> Self {
        let g = |k: &str| crate::balance::value(balance, k);
        GroundConfig {
            margin_cells: g("city.ground.margin_cells") as i32,
            floor_tag: g("city.ground.floor_tag_id") as u32,
            pavement_tag: g("city.ground.pavement_tag_id") as u32,
            road_tag: g("city.ground.road_tag_id") as u32,
            open_tag: g("city.ground.open_tag_id") as u32,
            roof_tag: g("city.ground.roof_tag_id") as u32,
            forecourt_tag: g("city.ground.forecourt_tag_id") as u32,
            yard_tag: g("city.ground.yard_tag_id") as u32,
            affluent_tag: g("city.ground.affluent_tag_id") as u32,
            aged_tags: [
                g("city.ground.aged_new_tag_id") as u32,
                g("city.ground.aged_mid_tag_id") as u32,
                g("city.ground.aged_old_tag_id") as u32,
            ],
        }
    }

    /// The one city's seed (`city.seed`).
    pub fn city_seed(balance: &[defs::BalanceSeed]) -> u64 {
        crate::balance::value(balance, "city.seed") as u64
    }
}

/// The object def carrying `role` whose tags overlap `want` most; among
/// those, one that agrees with `affluent` on the `affluent` tag when any
/// does; ties go to the lowest id. `None` only when no def carries `role`.
fn def_by_tags(
    content: &GenerationContent,
    role: u32,
    want: &[u32],
    affluent_tag: u32,
    affluent: bool,
) -> Option<u32> {
    let mut best: Option<(i64, u32)> = None;
    for o in content.objects.iter().filter(|o| o.tags.contains(&role)) {
        let overlap = o.tags.iter().filter(|t| want.contains(t)).count() as i64;
        let agrees = o.tags.contains(&affluent_tag) == affluent;
        let score = overlap * 2 + i64::from(agrees);
        if best.is_none_or(|(bs, bid)| score > bs || (score == bs && o.id < bid)) {
            best = Some((score, o.id));
        }
    }
    best.map(|(_, id)| id)
}

impl District {
    /// Every row of the world this district writes, in a stable order:
    /// the ground rects (yards, street pavement, carriageway, forecourts,
    /// room floors), the placed props, the ownership areas and the roofs,
    /// every rect clipped to chunks.
    pub fn region_rows(
        &self,
        ground: &GroundConfig,
        content: &GenerationContent,
        cfg: &GenerationConfig,
    ) -> RegionRows {
        let mut out = RegionRows::default();
        let plots = self.skeleton.plots.plots();
        let role_floor = ground.floor_tag;
        let role_pavement = ground.pavement_tag;
        let role_road = ground.road_tag;
        let role_ground = ground.open_tag;
        let role_roof = ground.roof_tag;
        let t_forecourt = ground.forecourt_tag;
        let t_yard = ground.yard_tag;
        let t_affluent = ground.affluent_tag;
        let age_tags = ground.aged_tags;
        let by_tag = |role: u32, want: &[u32]| {
            def_by_tags(content, role, want, t_affluent, false)
                .unwrap_or_else(|| panic!("a def carries tag {role}"))
        };
        // The street's own surfaces carry no secondary tag; the forecourt
        // and the yard are the tagged variants of the pavement and ground.
        let pavement_def = by_tag(role_pavement, &[]);
        let road_def = by_tag(role_road, &[]);
        let forecourt_def = by_tag(role_pavement, &[t_forecourt]);
        let yard_def = by_tag(role_ground, &[t_yard]);
        // Yards: each built plot's whole rect, under everything else.
        for (plot, _, _) in self.interiors.laid() {
            if let Some(p) = plots.get(plot as usize) {
                paint(&mut out, p.bounds, yard_def);
            }
        }
        // The street, carried through the margin at every site edge:
        // pavements first, then carriageways, so a junction's road wins.
        let (pavements, roads) =
            props::street_surface_rects(&self.skeleton, cfg, ground.margin_cells);
        for r in pavements {
            paint(&mut out, r, pavement_def);
        }
        for r in roads {
            paint(&mut out, r, road_def);
        }
        // Forecourts: the strip from a building's front wall to its plot's
        // street edge, across the building's width.
        for (plot, _, i) in self.interiors.laid() {
            let Some(p) = plots.get(plot as usize) else {
                continue;
            };
            let (f, b) = (i.footprint, p.bounds);
            let strip = match i.front {
                Side::North => Rect {
                    x0: f.x0,
                    y0: b.y0,
                    x1: f.x1,
                    y1: f.y0,
                },
                Side::South => Rect {
                    x0: f.x0,
                    y0: f.y1,
                    x1: f.x1,
                    y1: b.y1,
                },
                Side::West => Rect {
                    x0: b.x0,
                    y0: f.y0,
                    x1: f.x0,
                    y1: f.y1,
                },
                Side::East => Rect {
                    x0: f.x1,
                    y0: f.y0,
                    x1: b.x1,
                    y1: f.y1,
                },
            };
            paint(&mut out, strip, forecourt_def);
        }
        // Room floors: by what the room is, the neighbourhood's affluence
        // choosing between a plain tile and its affluent twin on the rich
        // band the neighbourhood guarantees are judged on.
        let nb = &cfg.neighbourhood;
        let rich_from = nb.rich_from();
        let rooms: BTreeMap<u32, &defs::RoomTypeDef> =
            content.room_types.iter().map(|r| (r.id, r)).collect();
        let types: BTreeMap<u32, &defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();
        let mut floors: BTreeMap<(u32, bool), u32> = BTreeMap::new();
        let mut shells: BTreeMap<(u32, bool), u32> = BTreeMap::new();
        for (plot, ty, i) in self.interiors.laid() {
            let affluent = plots
                .get(plot as usize)
                .is_some_and(|p| p.affluence >= rich_from);
            // The footprint first, by what the building is: the wall ring
            // stands on floor, so a window shows floor through it.
            let shell = *shells.entry((ty, affluent)).or_insert_with(|| {
                let want: Vec<u32> = types.get(&ty).map(|t| t.tags.to_vec()).unwrap_or_default();
                def_by_tags(content, role_floor, &want, t_affluent, affluent)
                    .expect("a floor def exists")
            });
            paint(&mut out, i.footprint, shell);
            for (n, room) in i.rooms.iter().enumerate() {
                let def = *floors.entry((room.room_type, affluent)).or_insert_with(|| {
                    let want: Vec<u32> = rooms
                        .get(&room.room_type)
                        .map(|r| r.tags.to_vec())
                        .unwrap_or_default();
                    def_by_tags(content, role_floor, &want, t_affluent, affluent)
                        .expect("a floor def exists")
                });
                paint(&mut out, room.rect, def);
                for t in i.thresholds.iter().filter(|t| t.room == n) {
                    paint(&mut out, cell(t.x, t.y), def);
                }
            }
        }
        for r in self.props.rows() {
            out.placed.push(PlacedOut {
                def_id: r.def_id,
                x: r.x,
                y: r.y,
                floor: r.floor,
                layer: r.layer,
                orientation: r.orientation,
                chunk_key: chunk_key(r.x, r.y, r.floor),
            });
        }
        // A building is named by its place in laid order and a room by its
        // place across the laid buildings' rooms, from 1: the ids a fresh
        // `building` and `room` table assign as `create_district` inserts
        // them in that order.
        let mut room_no = 0u64;
        for (n_building, (plot, ty, i)) in self.interiors.laid().enumerate() {
            let b = n_building as u64 + 1;
            push_area(&mut out.building_areas, b, i.footprint);
            for (n, room) in i.rooms.iter().enumerate() {
                room_no += 1;
                let owner = room_no;
                push_area(&mut out.room_areas, owner, room.rect);
                for t in i.thresholds.iter().filter(|t| t.room == n) {
                    push_area(&mut out.room_areas, owner, cell(t.x, t.y));
                }
            }
            // The roof: the family's tile, the dwelling's by the age bands
            // the neighbourhood guarantees are judged on (mid is neither).
            let age = plots.get(plot as usize).map_or(0, |p| p.building_age);
            let band = if age <= nb.new_to() {
                0
            } else if age >= nb.old_from() {
                2
            } else {
                1
            };
            let mut want: Vec<u32> = types.get(&ty).map(|t| t.tags.to_vec()).unwrap_or_default();
            want.push(age_tags[band]);
            let roof = def_by_tags(content, role_roof, &want, t_affluent, false)
                .expect("a roof def exists");
            // The roof covers the interior net -- the footprint inside its
            // wall ring -- so the walls stand out as the facade, and the
            // north rim between the side walls (what stands against the north
            // wall overhangs it) but a door set in that rim. Every row of one
            // roof is keyed on the chunk of the net's south-west cell, so a
            // client holds the whole roof or none of it.
            let t = cfg.envelope_wall_thickness_cells;
            let (x0, x1) = (i.footprint.x0 + t, i.footprint.x1 - t);
            let (rim, y1) = (i.footprint.y0 + t, i.footprint.y1 - t);
            let anchor = chunk_key(x0, y1 - 1, 0);
            let mut push_roof = |r: Rect| {
                out.roofs.push(RoofOut {
                    building_id: b,
                    def_id: roof,
                    x0: r.x0,
                    y0: r.y0,
                    x1: r.x1,
                    y1: r.y1,
                    floor: 0,
                    chunk_key: anchor,
                });
            };
            let doors: Vec<(i32, i32)> = i
                .thresholds
                .iter()
                .filter(|d| d.y < rim)
                .map(|d| (d.x, d.y))
                .collect();
            if doors.is_empty() {
                push_roof(Rect {
                    x0,
                    y0: i.footprint.y0,
                    x1,
                    y1,
                });
                continue;
            }
            push_roof(Rect {
                x0,
                y0: rim,
                x1,
                y1,
            });
            for y in i.footprint.y0..rim {
                let mut run = x0;
                for x in x0..=x1 {
                    if x == x1 || doors.contains(&(x, y)) {
                        if x > run {
                            push_roof(Rect {
                                x0: run,
                                y0: y,
                                x1: x,
                                y1: y + 1,
                            });
                        }
                        run = x + 1;
                    }
                }
            }
        }
        out
    }

    /// Where a new character first stands: the floor cell just inside the
    /// street door of a dwelling in the poorest band of the district, as
    /// far from the density peak as such a dwelling lies, and never within
    /// a viewport of the site edge. `None` only for a district with no
    /// laid interior at all.
    pub fn arrival_cell(
        &self,
        cfg: &GenerationConfig,
        content: &GenerationContent,
    ) -> Option<(i32, i32)> {
        let lu = &self.skeleton.land_use;
        let site = self.skeleton.plots.site();
        let (px, py) = lu.density_peak();
        let cs = lu.cell_size();
        let (peak_x, peak_y) = (px * cs + cs / 2, py * cs + cs / 2);
        let types: BTreeMap<u32, &defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();
        let poor = cfg.neighbourhood.poor_band_max;
        let (vw, vh) = (
            cfg.neighbourhood.viewport_width_cells,
            cfg.neighbourhood.viewport_height_cells,
        );
        let inland = |x: i32, y: i32| {
            x - site.x0 >= vw && site.x1 - x > vw && y - site.y0 >= vh && site.y1 - y > vh
        };
        let mut best: Option<(i64, u32, (i32, i32))> = None;
        // Inland first, tier by tier; the same tiers at the edge only when
        // no inland building qualifies.
        for need_inland in [true, false] {
            for tier in 0..3 {
                for (plot, ty, i) in self.interiors.laid() {
                    let Some(def) = types.get(&ty) else { continue };
                    let dwelling = def.land_uses[0] && !building_types::is_workplace(def);
                    let (cx, cy) = (
                        (i.footprint.x0 + i.footprint.x1) / 2,
                        (i.footprint.y0 + i.footprint.y1) / 2,
                    );
                    if need_inland && !inland(cx, cy) {
                        continue;
                    }
                    let affluence = lu.neighbourhood_at(cx, cy).map(|n| n.affluence);
                    let ok = match tier {
                        0 => dwelling && affluence.is_some_and(|a| a <= poor),
                        1 => dwelling,
                        _ => true,
                    };
                    if !ok {
                        continue;
                    }
                    let Some(cell) = self.inside_the_door(i) else {
                        continue;
                    };
                    let dx = (cx - peak_x) as i64;
                    let dy = (cy - peak_y) as i64;
                    let d = dx * dx + dy * dy;
                    if best.is_none_or(|(bd, bp, _)| d > bd || (d == bd && plot < bp)) {
                        best = Some((d, plot, cell));
                    }
                }
                if best.is_some() {
                    return best.map(|(_, _, c)| c);
                }
            }
        }
        None
    }

    /// Whether a body may stand on `(x, y, floor)` of this district: the
    /// floor is in range and the cell is inside the site and not blocked.
    pub fn is_standable_at(&self, x: i32, y: i32, floor: i8) -> bool {
        (defs::MIN_FLOOR..=defs::MAX_FLOOR).contains(&(floor as i32))
            && self.walkability(floor).is_standable(x, y)
    }

    /// The standable floor cell of the street door's room nearest the
    /// entrance threshold.
    pub fn inside_the_door(&self, i: &super::Interior) -> Option<(i32, i32)> {
        let door = i.entrance()?;
        let room = i.rooms.get(door.room)?;
        let grid = self.walkability(0);
        let mut cells: Vec<(i32, i32)> = Vec::new();
        for y in room.rect.y0..room.rect.y1 {
            for x in room.rect.x0..room.rect.x1 {
                if grid.is_standable(x, y) {
                    cells.push((x, y));
                }
            }
        }
        cells.sort_by_key(|&(x, y)| {
            let d = (x - door.x).abs() + (y - door.y).abs();
            (d, y, x)
        });
        cells.first().copied()
    }
}

/// Paints `def_id` over `rect`, one row per chunk piece.
fn paint(out: &mut RegionRows, rect: Rect, def_id: u32) {
    for (piece, chunk_key) in clip_rect_to_chunks(rect, 0) {
        out.ground.push(GroundOut {
            def_id,
            x0: piece.x0,
            y0: piece.y0,
            x1: piece.x1,
            y1: piece.y1,
            floor: 0,
            chunk_key,
        });
    }
}

fn cell(x: i32, y: i32) -> Rect {
    Rect {
        x0: x,
        y0: y,
        x1: x + 1,
        y1: y + 1,
    }
}

fn push_area(out: &mut Vec<AreaOut>, owner_id: u64, rect: Rect) {
    for (piece, chunk_key) in clip_rect_to_chunks(rect, 0) {
        debug_assert!(piece.x1 - piece.x0 <= CHUNK_SIZE);
        out.push(AreaOut {
            owner_id,
            x0: piece.x0,
            y0: piece.y0,
            x1: piece.x1,
            y1: piece.y1,
            floor: 0,
            chunk_key,
        });
    }
}
