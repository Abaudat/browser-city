//! The two district claims every seed owes (story 3.16, AC1 and AC2),
//! measured over the rows `region_rows` produces and the walkability the
//! district derives: the pinned test (`district_world.rs`) and the fresh-seed
//! exploration (`district_explore.rs`) both read them from here.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use sim::generation::interiors::Parts;
use sim::generation::{District, GenerationConfig, GenerationContent, RegionRows};

/// A route may be this many percent of the straight Manhattan distance: a
/// grid street network detours, a mid-block cut cannot.
pub const ROUTE_STRETCH_MAX_PCT: u64 = 160;

/// Shortest walk length (4-neighbour steps over standable floor-0 cells)
/// from `from` to `to`, `None` when unreachable.
pub fn walk_len(district: &District, from: (i32, i32), to: (i32, i32)) -> Option<u32> {
    let walk = district.walkability(0);
    let mut dist: BTreeMap<(i32, i32), u32> = BTreeMap::new();
    let mut queue = VecDeque::new();
    dist.insert(from, 0);
    queue.push_back(from);
    while let Some(c) = queue.pop_front() {
        if c == to {
            return dist.get(&c).copied();
        }
        let d = dist[&c];
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let n = (c.0 + dx, c.1 + dy);
            if walk.is_standable(n.0, n.1) && !dist.contains_key(&n) {
                dist.insert(n, d + 1);
                queue.push_back(n);
            }
        }
    }
    None
}

/// Every floor-0 cell walkable from `from`.
pub fn flood(district: &District, from: (i32, i32)) -> BTreeSet<(i32, i32)> {
    let walk = district.walkability(0);
    let mut seen = BTreeSet::from([from]);
    let mut stack = vec![from];
    while let Some(c) = stack.pop() {
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let n = (c.0 + dx, c.1 + dy);
            if walk.is_standable(n.0, n.1) && seen.insert(n) {
                stack.push(n);
            }
        }
    }
    seen
}

/// The nearest standable cell to `want`, scanning outward.
pub fn standable_near(district: &District, want: (i32, i32)) -> Option<(i32, i32)> {
    let walk = district.walkability(0);
    for r in 0..64_i32 {
        for dx in -r..=r {
            for dy in -r..=r {
                if dx.abs().max(dy.abs()) != r {
                    continue;
                }
                let c = (want.0 + dx, want.1 + dy);
                if walk.is_standable(c.0, c.1) {
                    return Some(c);
                }
            }
        }
    }
    None
}

/// One measured crossing: the walk's length and its stretch over the
/// straight Manhattan distance, in percent.
#[derive(Debug, Clone, Copy)]
pub struct Crossing {
    pub from: (i32, i32),
    pub to: (i32, i32),
    pub steps: Option<u32>,
    pub stretch_pct: Option<u64>,
}

/// The three crossings of AC1: the west edge to the core, the core to the
/// east edge, and edge to edge.
pub fn crossings(district: &District, cfg: &GenerationConfig) -> Vec<Crossing> {
    let site = cfg.site();
    let lu = &district.skeleton.land_use;
    let (gx, gy) = lu.density_peak();
    let cs = lu.cell_size();
    let (px, py) = (gx * cs + cs / 2, gy * cs + cs / 2);
    let mid_y = (site.y0 + site.y1) / 2;
    let (Some(west), Some(east), Some(core)) = (
        standable_near(district, (site.x0 + 1, mid_y)),
        standable_near(district, (site.x1 - 2, mid_y)),
        standable_near(district, (px, py)),
    ) else {
        return Vec::new();
    };
    [(west, core), (core, east), (west, east)]
        .into_iter()
        .map(|(from, to)| {
            let manhattan = u64::from(
                ((from.0 - to.0).abs() + (from.1 - to.1).abs())
                    .max(1)
                    .unsigned_abs(),
            );
            let steps = walk_len(district, from, to);
            Crossing {
                from,
                to,
                steps,
                stretch_pct: steps.map(|s| u64::from(s) * 100 / manhattan),
            }
        })
        .collect()
}

/// How many buildings are enterable, furnished and reachable from the
/// arrival cell. A building counts when
///   - it has a street door a body can stand in and reach on foot from
///     `arrival`;
///   - every room of it holds at least the fixtures its room program owes
///     (the requirement rows over the room's tags), each fixture a
///     `placed_object` row;
///   - from the door, every room has a standable cell on the walk -- a
///     reachable door into a room nothing can walk through is not enterable.
pub fn furnished_reachable(
    district: &District,
    rows: &RegionRows,
    content: &GenerationContent,
    arrival: (i32, i32),
) -> usize {
    let parts = Parts::resolve(content.tags).expect("the committed tags declare every part");
    let requirements: Vec<_> = content
        .rules
        .iter()
        .filter_map(|r| r.as_requirement())
        .collect();
    let rooms: BTreeMap<u32, &sim::generated::defs::RoomTypeDef> =
        content.room_types.iter().map(|r| (r.id, r)).collect();
    // Every cell a placed row's footprint covers: a fixture is placed when
    // some row stands on its cell, however many cells that row spans.
    let defs_by_id: BTreeMap<u32, &sim::generated::defs::ObjectDef> =
        content.objects.iter().map(|o| (o.id, o)).collect();
    let mut placed: BTreeSet<(i32, i32)> = BTreeSet::new();
    for p in &rows.placed {
        let Some(def) = defs_by_id.get(&p.def_id) else {
            continue;
        };
        for dy in 0..def.height as i32 {
            for dx in 0..def.width as i32 {
                placed.insert((p.x + dx, p.y - dy));
            }
        }
    }
    let reached = flood(district, arrival);
    let walk = district.walkability(0);
    let mut good = 0;
    for (_, _, interior) in district.interiors.laid() {
        let Some(door) = interior.entrance() else {
            continue;
        };
        let door_cell = (door.x, door.y);
        if !walk.is_standable(door_cell.0, door_cell.1) || !reached.contains(&door_cell) {
            continue;
        }
        if interior.fixtures.is_empty()
            || !interior
                .fixtures
                .iter()
                .all(|f| placed.contains(&(f.x, f.y)))
        {
            continue;
        }
        let owed_met = interior.rooms.iter().enumerate().all(|(n, room)| {
            let Some(def) = rooms.get(&room.room_type) else {
                return false;
            };
            requirements.iter().all(|req| {
                let carried = def.tags.contains(&req.container) || req.container == parts.floor;
                if !carried
                    || [
                        parts.wall,
                        parts.wall_run,
                        parts.floor,
                        parts.threshold,
                        parts.entrance,
                        parts.pavement,
                        parts.fixture,
                    ]
                    .contains(&req.requires)
                {
                    return true;
                }
                let have = interior
                    .fixtures
                    .iter()
                    .filter(|f| f.room == n && f.tag == req.requires)
                    .count() as u32;
                have >= req.min
            })
        });
        if !owed_met {
            continue;
        }
        let rooms_walkable = interior.rooms.iter().all(|room| {
            (room.rect.y0..room.rect.y1).any(|y| {
                (room.rect.x0..room.rect.x1)
                    .any(|x| walk.is_standable(x, y) && reached.contains(&(x, y)))
            })
        });
        if rooms_walkable {
            good += 1;
        }
    }
    good
}
