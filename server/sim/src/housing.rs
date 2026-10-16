//! Story 7.1 (FR20, FR145): the first flat. The dwelling stock is derived
//! from the generated district (a building type carrying the dwelling tag,
//! never a workplace, with a laid interior); one pure plan assigns a
//! character a flat from stable ids; the asked rent, the spawn cell and
//! the starting kit are pure functions of the generated rows. Nothing here
//! reads a table, a clock or a quoted content key.

use crate::balance;
use crate::generated::defs;

use crate::generation::Interior;
use crate::generation::{District, GenerationConfig, GenerationContent, is_workplace};
use crate::rng::{Rng, seed_from_ids};
use crate::world::Rect;

/// Whether a dwelling lies on the district edge (the generator's own
/// periphery band) or inside it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Tier {
    Edge,
    Inner,
}

/// One lettable dwelling, as assignment sees it. `id` is the building's
/// stable id; `spawn` is the cell a new tenant first stands on, `door` the
/// street cell outside the entrance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Home {
    pub id: u64,
    pub tier: Tier,
    pub density: i32,
    pub affluence: i32,
    pub rent: u64,
    pub spawn: (i32, i32),
    pub door: (i32, i32),
    /// The cell the moving box stands on.
    pub kit: (i32, i32),
    /// Laid cells of the interior: the smaller flat is let first.
    pub area: u32,
}

/// A dwelling's `open_rank` once let: past every rank a vacant one has.
pub const OCCUPIED: u64 = u64::MAX;

impl Home {
    /// The order flats are let in, lowest first: the edge before the
    /// inside; on the edge the cheapest asked, inside the nearest the
    /// edge; then the smaller interior. Equal ranks are drawn from the
    /// character id.
    pub fn rank(&self) -> u64 {
        let key = match self.tier {
            Tier::Edge => self.affluence,
            Tier::Inner => self.density,
        };
        let tier = u64::from(self.tier.code() - 1);
        (tier << 48) | ((key.clamp(0, 0xFFFF) as u64) << 32) | u64::from(self.area)
    }
}

impl Tier {
    /// The stored code of a dwelling's tier; 0 is "not a dwelling".
    pub fn code(self) -> u8 {
        match self {
            Tier::Edge => 1,
            Tier::Inner => 2,
        }
    }

    pub fn from_code(code: u8) -> Option<Tier> {
        match code {
            1 => Some(Tier::Edge),
            2 => Some(Tier::Inner),
            _ => None,
        }
    }
}

/// A [`Home`] with the generated facts it was derived from.
#[derive(Debug, Clone)]
pub struct Dwelling {
    pub plot: u32,
    pub building_type: u32,
    pub footprint: Rect,
    pub home: Home,
}

/// What the plan decided.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Assignment {
    /// A vacant edge dwelling, the cheapest asked.
    Edge(u64),
    /// No edge dwelling was vacant: the vacant dwelling nearest the edge.
    Fallback(u64),
    NoVacancy,
}

/// The tag id that marks a building type as one home.
pub fn dwelling_tag(bal: &[defs::BalanceSeed]) -> u32 {
    balance::value(bal, "generation.neighbourhood.dwelling_tag_id") as u32
}

/// The edge predicate: the generator's periphery band.
pub fn is_edge(density: i32, cfg: &GenerationConfig) -> bool {
    density <= cfg.periphery_max_density()
}

/// The rent a dwelling asks each week, a function of its neighbourhood's
/// affluence alone: the seed figure in the bottom band, rising by the
/// configured percent per affluence point above it.
pub fn asking_rent(affluence: i32, cfg: &GenerationConfig, bal: &[defs::BalanceSeed]) -> u64 {
    let base = balance::value(bal, "economy.rent.edge_flat_per_week").max(0) as u64;
    let step = balance::value(bal, "economy.rent.per_affluence_point_percent").max(0) as u64;
    let over = (affluence - cfg.neighbourhood.poor_band_max).max(0) as u64;
    base.saturating_mul(100u64.saturating_add(step.saturating_mul(over))) / 100
}

/// The entry wage over one working week, in the currency's smallest unit.
pub fn weekly_gross(bal: &[defs::BalanceSeed]) -> u64 {
    let hourly = balance::value(bal, "economy.wage.entry_per_city_hour").max(0) as u64;
    let hours = balance::value(bal, "economy.wage.paid_hours_per_day").max(0) as u64;
    let days = balance::value(bal, "economy.week_days").max(0) as u64;
    hourly * hours * days
}

/// The starting rent as a rounded percent of [`weekly_gross`]: derived,
/// never stored.
pub fn rent_share_percent(bal: &[defs::BalanceSeed]) -> u64 {
    let gross = weekly_gross(bal).max(1);
    let rent = balance::value(bal, "economy.rent.edge_flat_per_week").max(0) as u64;
    (rent * 100 + gross / 2) / gross
}

/// The cells of the entry room, nearest `from` first, ties by row then
/// column -- a deterministic scan order.
fn entry_cells_by_distance(interior: &Interior, from: (i32, i32)) -> Vec<(i32, i32)> {
    let Some(door) = interior.entrance() else {
        return Vec::new();
    };
    let Some(room) = interior.rooms.get(door.room) else {
        return Vec::new();
    };
    let mut cells: Vec<(i32, i32)> = (room.rect.y0..room.rect.y1)
        .flat_map(|y| (room.rect.x0..room.rect.x1).map(move |x| (x, y)))
        .collect();
    cells.sort_by_key(|&(x, y)| ((x - from.0).abs() + (y - from.1).abs(), y, x));
    cells
}

fn is_clear(interior: &Interior, blocked: &dyn Fn(i32, i32) -> bool, x: i32, y: i32) -> bool {
    !blocked(x, y) && !interior.fixtures.iter().any(|f| f.x == x && f.y == y)
}

/// Where a new tenant first stands: the clear cell of the entry room
/// nearest its street door.
pub fn spawn_cell(interior: &Interior, blocked: &dyn Fn(i32, i32) -> bool) -> Option<(i32, i32)> {
    let door = interior.entrance()?;
    entry_cells_by_distance(interior, (door.x, door.y))
        .into_iter()
        .find(|&(x, y)| is_clear(interior, blocked, x, y))
}

/// Where the moving box stands: the nearest clear cell of the entry room
/// to the spawn that is not the spawn and not on the straight lane between
/// the door and the spawn.
pub fn box_cell(
    spawn: (i32, i32),
    interior: &Interior,
    blocked: &dyn Fn(i32, i32) -> bool,
) -> Option<(i32, i32)> {
    let door = interior.entrance()?;
    let (lx0, lx1) = (spawn.0.min(door.x), spawn.0.max(door.x));
    let (ly0, ly1) = (spawn.1.min(door.y), spawn.1.max(door.y));
    entry_cells_by_distance(interior, spawn)
        .into_iter()
        .find(|&(x, y)| {
            (x, y) != spawn
                && (x - door.x).abs() + (y - door.y).abs() > 1
                && (x - door.x).abs().max((y - door.y).abs()) > 1
                && !((lx0..=lx1).contains(&x) && (ly0..=ly1).contains(&y))
                && is_clear(interior, blocked, x, y)
        })
}

/// The district's dwelling stock, in plot order: every laid building
/// whose type carries the dwelling tag and is no workplace, and whose
/// entry room has a clear spawn cell and a clear cell for the box.
pub fn dwellings(
    district: &District,
    cfg: &GenerationConfig,
    content: &GenerationContent,
    bal: &[defs::BalanceSeed],
) -> Vec<Dwelling> {
    let tag = dwelling_tag(bal);
    let blocked = |x: i32, y: i32| district.walkability(0).is_blocked(x, y);
    let plots = district.skeleton.plots.plots();
    let mut out = Vec::new();
    for (plot, ty, interior) in district.interiors.laid() {
        let Some(def) = content.building_types.iter().find(|b| b.id == ty) else {
            continue;
        };
        if !def.tags.contains(&tag) || is_workplace(def) {
            continue;
        }
        let (Some(entrance), Some(spawn), Some(p)) = (
            interior.entrance(),
            spawn_cell(interior, &blocked),
            plots.get(plot as usize),
        ) else {
            continue;
        };
        let Some(kit) = box_cell(spawn, interior, &blocked) else {
            continue;
        };
        let door = interior
            .approach
            .last()
            .copied()
            .unwrap_or((entrance.x, entrance.y));
        out.push(Dwelling {
            plot,
            building_type: ty,
            footprint: interior.footprint,
            home: Home {
                id: u64::from(plot),
                tier: if is_edge(p.density, cfg) {
                    Tier::Edge
                } else {
                    Tier::Inner
                },
                density: p.density,
                affluence: p.affluence,
                rent: asking_rent(p.affluence, cfg, bal),
                spawn,
                door,
                kit,
                area: interior.laid_cells() as u32,
            },
        });
    }
    out
}

/// Picks among the lowest-ranked open homes, drawn from the character id.
/// `open` yields vacant homes in ascending [`Home::rank`]; only the first
/// rank group and the one home that ends it are ever pulled, so an index
/// range read costs the group, never the stock.
pub fn plan_assign_ranked(character_id: u64, open: impl IntoIterator<Item = Home>) -> Assignment {
    let mut group: Vec<Home> = Vec::new();
    for h in open {
        if let Some(first) = group.first()
            && h.rank() != first.rank()
        {
            break;
        }
        group.push(h);
    }
    if group.is_empty() {
        return Assignment::NoVacancy;
    }
    group.sort_by_key(|h| h.id);
    let mut rng = Rng::new(seed_from_ids(character_id, 0));
    let h = group[rng.below(group.len() as u64) as usize];
    match h.tier {
        Tier::Edge => Assignment::Edge(h.id),
        Tier::Inner => Assignment::Fallback(h.id),
    }
}

/// Picks a flat from a whole stock: the open homes in rank order, through
/// [`plan_assign_ranked`]. Pure and independent of the order of `stock`.
pub fn plan_assign(
    character_id: u64,
    stock: &[Home],
    occupied: &dyn Fn(u64) -> bool,
) -> Assignment {
    let mut open: Vec<Home> = stock.iter().filter(|h| !occupied(h.id)).copied().collect();
    open.sort_by_key(|h| (h.rank(), h.id));
    plan_assign_ranked(character_id, open)
}

/// Where a let flat's two starting possessions go: the moving box on its
/// cell, and the tenancy agreement on the box with a visible offset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KitPlan {
    pub box_cell: (i32, i32),
    pub letter_cell: (i32, i32),
    pub letter_offset: (u8, u8),
}

/// The letter's offset in its cell, in sub-cells: off-centre, so it reads
/// as paper on the box.
pub const LETTER_OFFSET: (u8, u8) = (8, 2);

/// The starting kit's placements for `home`. Pure: the reducer applies it.
pub fn plan_kit(home: &Home) -> KitPlan {
    KitPlan {
        box_cell: home.kit,
        letter_cell: home.kit,
        letter_offset: LETTER_OFFSET,
    }
}
