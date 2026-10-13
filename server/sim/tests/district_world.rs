//! Story 3.16: the generated district as the world rows a client streams.
//! Everything here is measured over the rows `District::region_rows`
//! produces (what `create_district` inserts), never over the generator's
//! own structs.

use sim::generated::defs;
use sim::generation::{
    District, GenerationConfig, GenerationContent, GroundConfig, RegionRows, generate,
};
use sim::table_bounds::TABLE_BOUNDS;
use sim::world::{CHUNK_SIZE, chunk_key, clip_rect_to_chunks};

fn city() -> (GenerationConfig, GenerationContent<'static>, u64) {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    (
        cfg,
        GenerationContent::committed(),
        GroundConfig::city_seed(defs::BALANCE),
    )
}

fn world() -> (District, RegionRows, GenerationConfig) {
    let (cfg, content, seed) = city();
    let (district, _) = generate(seed, &cfg, &content).expect("the committed city generates");
    let ground = GroundConfig::from_balance(defs::BALANCE);
    let rows = district.region_rows(&ground, &content);
    (district, rows, cfg)
}

#[test]
fn every_row_carries_the_chunk_key_of_its_anchor_or_its_clipped_rect() {
    let (_, rows, _) = world();
    for p in &rows.placed {
        assert_eq!(p.chunk_key, chunk_key(p.x, p.y, p.floor), "{p:?}");
    }
    for a in rows.building_areas.iter().chain(&rows.room_areas) {
        let rect = sim::world::Rect {
            x0: a.x0,
            y0: a.y0,
            x1: a.x1,
            y1: a.y1,
        };
        let pieces = clip_rect_to_chunks(rect, a.floor);
        assert_eq!(pieces.len(), 1, "an area row lies inside one chunk: {a:?}");
        assert_eq!(pieces[0].1, a.chunk_key);
        assert!(a.x1 - a.x0 <= CHUNK_SIZE && a.y1 - a.y0 <= CHUNK_SIZE);
    }
}

#[test]
fn row_counts_sit_inside_the_declared_table_bounds() {
    let (_, rows, _) = world();
    let bound = |name: &str| {
        TABLE_BOUNDS
            .iter()
            .find(|b| b.accessor == name)
            .unwrap_or_else(|| panic!("no bound for {name}"))
    };
    for (name, n) in [
        ("placed_object", rows.placed.len()),
        ("building_area", rows.building_areas.len()),
        ("room_area", rows.room_areas.len()),
        ("floor_transition", rows.transitions.len()),
    ] {
        assert!(
            (n as u64) <= bound(name).expected_rows,
            "{name}: {n} rows over the expected {}",
            bound(name).expected_rows
        );
    }
    println!(
        "rows: placed_object={} building_area={} room_area={} floor_transition={}",
        rows.placed.len(),
        rows.building_areas.len(),
        rows.room_areas.len(),
        rows.transitions.len()
    );
}

#[test]
fn every_cell_of_the_site_and_its_margin_has_exactly_one_ground_row() {
    let (_, rows, cfg) = world();
    let ground = GroundConfig::from_balance(defs::BALANCE);
    let site = cfg.site();
    let m = ground.margin_cells;
    let w = (site.x1 - site.x0 + 2 * m) as usize;
    let h = (site.y1 - site.y0 + 2 * m) as usize;
    let mut seen = vec![0u8; w * h];
    let ground_ids = [
        ground.open_object_id,
        ground.pavement_object_id,
        ground.road_object_id,
        ground.floor_object_id,
    ];
    for p in rows
        .placed
        .iter()
        .filter(|p| ground_ids.contains(&p.def_id))
    {
        assert_eq!(p.layer, 0, "ground is the ground layer");
        let (x, y) = (p.x - (site.x0 - m), p.y - (site.y0 - m));
        assert!(
            x >= 0 && y >= 0 && (x as usize) < w && (y as usize) < h,
            "{p:?}"
        );
        seen[y as usize * w + x as usize] += 1;
    }
    let bare = seen.iter().filter(|&&n| n == 0).count();
    let doubled = seen.iter().filter(|&&n| n > 1).count();
    assert_eq!((bare, doubled), (0, 0), "bare cells, doubled cells");
}

#[test]
fn the_arrival_cell_is_a_walkable_floor_zero_cell_inside_a_dwelling() {
    let (district, _, cfg) = world();
    let content = GenerationContent::committed();
    let cell = district
        .arrival_cell(&cfg, &content)
        .expect("the committed city has a dwelling to arrive in");
    assert!(district.walkability(0).is_standable(cell.0, cell.1));
    let inside = district
        .interiors
        .laid()
        .any(|(_, _, i)| i.rooms.iter().any(|r| r.rect.contains(cell.0, cell.1)));
    assert!(inside, "{cell:?} is on a room floor");
    let again = district.arrival_cell(&cfg, &content).unwrap();
    assert_eq!(cell, again, "deterministic");
}

/// Shortest walk length (4-neighbour steps over standable floor-0 cells)
/// from `from` to `to`, `None` when unreachable.
fn walk_len(district: &District, from: (i32, i32), to: (i32, i32)) -> Option<u32> {
    use std::collections::{HashMap, VecDeque};
    let walk = district.walkability(0);
    let mut dist: HashMap<(i32, i32), u32> = HashMap::new();
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
fn flood(district: &District, from: (i32, i32)) -> std::collections::HashSet<(i32, i32)> {
    let walk = district.walkability(0);
    let mut seen = std::collections::HashSet::from([from]);
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
fn standable_near(district: &District, want: (i32, i32)) -> (i32, i32) {
    let walk = district.walkability(0);
    for r in 0..64_i32 {
        for dx in -r..=r {
            for dy in -r..=r {
                if dx.abs().max(dy.abs()) != r {
                    continue;
                }
                let c = (want.0 + dx, want.1 + dy);
                if walk.is_standable(c.0, c.1) {
                    return c;
                }
            }
        }
    }
    panic!("no standable cell near {want:?}");
}

/// A route may be this many times the straight Manhattan distance: a grid
/// street network detours, a mid-block cut cannot.
const ROUTE_STRETCH_MAX: f64 = 1.6;

#[test]
fn a_walk_crosses_the_site_edge_to_core_to_opposite_edge_within_the_stretch() {
    let (district, _, cfg) = world();
    let site = cfg.site();
    let lu = &district.skeleton.land_use;
    let (gx, gy) = lu.density_peak();
    let cs = lu.cell_size();
    let (px, py) = (gx * cs + cs / 2, gy * cs + cs / 2);
    let mid_y = (site.y0 + site.y1) / 2;
    let west = standable_near(&district, (site.x0 + 1, mid_y));
    let east = standable_near(&district, (site.x1 - 2, mid_y));
    let core = standable_near(&district, (px, py));
    let manhattan = |a: (i32, i32), b: (i32, i32)| ((a.0 - b.0).abs() + (a.1 - b.1).abs()) as f64;
    for (a, b) in [(west, core), (core, east), (west, east)] {
        let len = walk_len(&district, a, b).unwrap_or_else(|| panic!("{a:?} cannot reach {b:?}"));
        let stretch = f64::from(len) / manhattan(a, b).max(1.0);
        println!("route {a:?}->{b:?}: {len} steps, stretch {stretch:.2}");
        assert!(
            stretch <= ROUTE_STRETCH_MAX,
            "{a:?}->{b:?} stretch {stretch:.2}"
        );
    }
}

#[test]
fn at_least_a_hundred_buildings_are_enterable_furnished_and_reachable_from_arrival() {
    let (district, rows, cfg) = world();
    let content = GenerationContent::committed();
    let arrival = district.arrival_cell(&cfg, &content).unwrap();
    let reached = flood(&district, arrival);
    let placed_cells: std::collections::HashSet<(i32, i32)> =
        rows.placed.iter().map(|p| (p.x, p.y)).collect();
    let mut good = 0;
    for (_, _, interior) in district.interiors.laid() {
        let Some(door) = interior.entrance() else {
            continue;
        };
        let furnished = !interior.fixtures.is_empty()
            && interior
                .fixtures
                .iter()
                .all(|f| placed_cells.contains(&(f.x, f.y)));
        let door_cell = (door.x, door.y);
        if furnished
            && district
                .walkability(0)
                .is_standable(door_cell.0, door_cell.1)
            && reached.contains(&door_cell)
        {
            good += 1;
        }
    }
    assert!(
        good >= 100,
        "only {good} enterable furnished reachable buildings"
    );
}
