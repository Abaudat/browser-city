//! Story 7.1 (FR20, FR145): the first flat. The dwelling stock is derived
//! from the generated district (a building type carrying the dwelling tag,
//! never a workplace, with a laid interior); one pure plan assigns a
//! character a flat from stable ids; the asked rent, the spawn cell and
//! the starting kit are pure functions of the generated rows. Nothing here
//! reads a table, a clock or a quoted content key.

use std::collections::BTreeMap;

use crate::balance;
use crate::cash;
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

/// The whole pieces a new character starts with in hand: the starting
/// cash in the fewest denominations.
pub fn starting_pieces(
    denoms: &[defs::Denomination],
    bal: &[defs::BalanceSeed],
) -> Option<BTreeMap<u32, u64>> {
    let amount = balance::value(bal, "economy.starting_cash").max(0) as u64;
    let plenty: BTreeMap<u32, u64> = denoms.iter().map(|d| (d.item_id, amount)).collect();
    cash::choose_change(&plenty, amount, denoms).ok().flatten()
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
            },
        });
    }
    out
}

/// One of the tied homes, drawn from the character's stable id: the ties
/// are put in id order first, so the draw never sees insertion order.
fn draw(character_id: u64, mut tied: Vec<&Home>) -> Option<u64> {
    tied.sort_by_key(|h| h.id);
    if tied.is_empty() {
        return None;
    }
    let mut rng = Rng::new(seed_from_ids(character_id, 0));
    let i = rng.below(tied.len() as u64) as usize;
    Some(tied[i].id)
}

/// Picks a flat: the cheapest vacant edge dwelling; failing any, the
/// vacant dwelling nearest the edge; failing any, `NoVacancy`. Ties are
/// drawn from `character_id`. Pure and independent of the order of `stock`.
pub fn plan_assign(
    character_id: u64,
    stock: &[Home],
    occupied: &dyn Fn(u64) -> bool,
) -> Assignment {
    let vacant = |tier: Tier| {
        stock
            .iter()
            .filter(move |h| h.tier == tier && !occupied(h.id))
    };
    if let Some(min) = vacant(Tier::Edge).map(|h| h.affluence).min() {
        let tied = vacant(Tier::Edge).filter(|h| h.affluence == min).collect();
        if let Some(id) = draw(character_id, tied) {
            return Assignment::Edge(id);
        }
    }
    if let Some(min) = vacant(Tier::Inner).map(|h| h.density).min() {
        let tied = vacant(Tier::Inner).filter(|h| h.density == min).collect();
        if let Some(id) = draw(character_id, tied) {
            return Assignment::Fallback(id);
        }
    }
    Assignment::NoVacancy
}
