//! Story 3.16: the finished district as the rows the region tables hold.
//! Pure: [`District::region_rows`] returns plain row data in the shape of
//! `placed_object`, `building_area`, `room_area` and `floor_transition`
//! minus the surrogate ids; `create_district` only inserts them, in its
//! own transaction, once.
//!
//! Ground is a generator output: every cell of the site and of the
//! margin around it carries exactly one ground row -- carriageway,
//! pavement band, a laid room's floor, or open ground.

use super::{District, GenerationConfig, GenerationContent, building_types, rect_seed_key};
use crate::generated::defs;
use crate::world::{CHUNK_SIZE, Rect, chunk_key, clip_rect_to_chunks};

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

/// What a district writes to the world.
#[derive(Debug, Clone, Default)]
pub struct RegionRows {
    pub placed: Vec<PlacedOut>,
    pub building_areas: Vec<AreaOut>,
    pub room_areas: Vec<AreaOut>,
    pub transitions: Vec<TransitionOut>,
}

/// The ground objects and margin the district lays, from balance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GroundConfig {
    pub margin_cells: i32,
    pub open_object_id: u32,
    pub pavement_object_id: u32,
    pub road_object_id: u32,
    pub floor_object_id: u32,
}

impl GroundConfig {
    pub fn from_balance(balance: &[defs::BalanceSeed]) -> Self {
        let g = |k: &str| crate::balance::value(balance, k);
        GroundConfig {
            margin_cells: g("city.ground.margin_cells") as i32,
            open_object_id: g("city.ground.open_object_id") as u32,
            pavement_object_id: g("city.ground.pavement_object_id") as u32,
            road_object_id: g("city.ground.road_object_id") as u32,
            floor_object_id: g("city.ground.floor_object_id") as u32,
        }
    }

    /// The one city's seed (`city.seed`).
    pub fn city_seed(balance: &[defs::BalanceSeed]) -> u64 {
        crate::balance::value(balance, "city.seed") as u64
    }
}

impl District {
    /// Every row of the world this district writes, in a stable order:
    /// ground (row-major), then the placed props, then the ownership
    /// areas clipped to chunks.
    pub fn region_rows(&self, ground: &GroundConfig, content: &GenerationContent) -> RegionRows {
        let layer_of = |id: u32| {
            content
                .objects
                .iter()
                .find(|o| o.id == id)
                .map(|o| o.layer)
                .expect("a ground object id names a committed object")
        };
        let site = self.skeleton.plots.site();
        let m = ground.margin_cells;
        let (x0, y0, x1, y1) = (site.x0 - m, site.y0 - m, site.x1 + m, site.y1 + m);
        let street = self.props.street();
        // Room floors and doorways: the cells that lie under a laid interior.
        let sw = (site.x1 - site.x0) as usize;
        let mut floor_cell = vec![false; sw * (site.y1 - site.y0) as usize];
        for (_, _, i) in self.interiors.laid() {
            let mut mark = |x: i32, y: i32| {
                if x >= site.x0 && x < site.x1 && y >= site.y0 && y < site.y1 {
                    floor_cell[(y - site.y0) as usize * sw + (x - site.x0) as usize] = true;
                }
            };
            for r in &i.rooms {
                for y in r.rect.y0..r.rect.y1 {
                    for x in r.rect.x0..r.rect.x1 {
                        mark(x, y);
                    }
                }
            }
            for t in &i.thresholds {
                mark(t.x, t.y);
            }
        }
        let mut out = RegionRows::default();
        out.placed
            .reserve(((x1 - x0) as usize) * ((y1 - y0) as usize) + self.props.props().len());
        let (open, pave, road, floor) = (
            (ground.open_object_id, layer_of(ground.open_object_id)),
            (
                ground.pavement_object_id,
                layer_of(ground.pavement_object_id),
            ),
            (ground.road_object_id, layer_of(ground.road_object_id)),
            (ground.floor_object_id, layer_of(ground.floor_object_id)),
        );
        for y in y0..y1 {
            for x in x0..x1 {
                let in_site = x >= site.x0 && x < site.x1 && y >= site.y0 && y < site.y1;
                let (def_id, layer) = if !in_site {
                    open
                } else if floor_cell[(y - site.y0) as usize * sw + (x - site.x0) as usize] {
                    floor
                } else if street.is_road(x, y) {
                    road
                } else if street.is_pavement(x, y) {
                    pave
                } else {
                    open
                };
                out.placed.push(PlacedOut {
                    def_id,
                    x,
                    y,
                    floor: 0,
                    layer,
                    orientation: 0,
                    chunk_key: chunk_key(x, y, 0),
                });
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
        for (_, _, i) in self.interiors.laid() {
            let b = rect_seed_key(i.footprint);
            push_area(&mut out.building_areas, b, i.footprint);
            for (n, room) in i.rooms.iter().enumerate() {
                let owner = rect_seed_key(room.rect);
                push_area(&mut out.room_areas, owner, room.rect);
                for t in i.thresholds.iter().filter(|t| t.room == n) {
                    push_area(&mut out.room_areas, owner, cell(t.x, t.y));
                }
            }
        }
        out
    }

    /// Where a new character first stands: the floor cell just inside the
    /// street door of a dwelling in the poorest band of the district,
    /// as far from the density peak as such a dwelling lies. `None` only
    /// for a district with no laid interior at all.
    pub fn arrival_cell(
        &self,
        cfg: &GenerationConfig,
        content: &GenerationContent,
    ) -> Option<(i32, i32)> {
        let lu = &self.skeleton.land_use;
        let (px, py) = lu.density_peak();
        let cs = lu.cell_size();
        let (peak_x, peak_y) = (px * cs + cs / 2, py * cs + cs / 2);
        let types: std::collections::BTreeMap<u32, &defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();
        let poor = cfg.neighbourhood.poor_band_max;
        let mut best: Option<(i64, u32, (i32, i32))> = None;
        for tier in 0..3 {
            for (plot, ty, i) in self.interiors.laid() {
                let Some(def) = types.get(&ty) else { continue };
                let dwelling = def.land_uses[0] && !building_types::is_workplace(def);
                let (cx, cy) = (
                    (i.footprint.x0 + i.footprint.x1) / 2,
                    (i.footprint.y0 + i.footprint.y1) / 2,
                );
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
                break;
            }
        }
        best.map(|(_, _, c)| c)
    }

    /// Whether a body may stand on `(x, y, floor)` of this district: the
    /// floor is in range and the cell is inside the site and not blocked.
    pub fn is_standable_at(&self, x: i32, y: i32, floor: i8) -> bool {
        (defs::MIN_FLOOR..=defs::MAX_FLOOR).contains(&(floor as i32))
            && self.walkability(floor).is_standable(x, y)
    }

    /// The standable floor cell of the street door's room nearest the
    /// entrance threshold.
    fn inside_the_door(&self, i: &super::Interior) -> Option<(i32, i32)> {
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
